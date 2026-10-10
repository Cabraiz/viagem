#!/usr/bin/env node
/**
 * Layout audit (DSG-tokens, design/UX review): opens the HUD, emotes, lobby and waiting room on a phone viewport
 * (390x844 and 844x390, text at 100% and 125%) and FAILS (exit 1) when any visible text is cut or spills:
 *   - an ellipsis is active (text-overflow:ellipsis with scrollWidth > clientWidth),
 *   - a line clamp is hiding lines (-webkit-line-clamp with scrollHeight > clientHeight),
 *   - an overflow:hidden/clip box hides its own text (scroll size > client size),
 *   - a result card out of view (internal scroll) or under Revanche/Sair (long real names included),
 *   - text inside an offer card or a result card pokes out of the card, or a label pokes out of its button,
 * plus text under the minimum size (13 px in the match HUD and emotes), touch targets under 44 px and page scroll.
 * Usage: node scripts/audit-layout.cjs [baseUrl=http://127.0.0.1:4350] [out.json]
 * Needs Playwright: PLAYWRIGHT=/path/to/node_modules/playwright (cloud: /home/claude/tools/node_modules/playwright).
 */
const {chromium}=require(process.env.PLAYWRIGHT||'/home/claude/tools/node_modules/playwright');
const fs=require('fs');
const BASE=process.argv[2]||'http://127.0.0.1:4350';
const OUT=process.argv[3];

/** Runs in the page. Returns problems for the elements under `rootsSelector`. */
function audit(rootsSelector,minFont){
  const vis=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0&&+s.opacity>0.05&&!e.closest('[hidden]');};
  const ownText=e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  const label=e=>`${e.className||e.tagName}: "${e.textContent.trim().slice(0,28)}"`;
  const problems=[];
  const roots=[...document.querySelectorAll(rootsSelector)].filter(vis);
  for(const root of roots)for(const e of [root,...root.querySelectorAll('*')]){
    if(!vis(e)||e.closest('.rh-sr,.sr-only'))continue;
    const s=getComputedStyle(e);
    const text=ownText(e)||e.children.length===0&&e.textContent.trim();
    if(!text)continue;
    if(s.textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth+1)problems.push(`reticência: ${label(e)}`);
    if(s.webkitLineClamp&&s.webkitLineClamp!=='none'&&e.scrollHeight>e.clientHeight+1)problems.push(`line-clamp cortando: ${label(e)}`);
    const hides=v=>v==='hidden'||v==='clip';
    if((hides(s.overflowX)&&e.scrollWidth>e.clientWidth+1)||(hides(s.overflowY)&&e.scrollHeight>e.clientHeight+1))problems.push(`overflow escondendo texto: ${label(e)} (${e.scrollWidth}x${e.scrollHeight} > ${e.clientWidth}x${e.clientHeight})`);
    const box=e.closest('.rh-card,.rh-rcard,.rh-award,.rh-alert,.rh-round,.fun-emote');
    // Seals (padrão/sorte) and any chip positioned on the border ride it on purpose.
    if(box&&box!==e&&!e.closest('.rh-card-flags')&&getComputedStyle(e).position!=='absolute'){
      const b=box.getBoundingClientRect(),r=e.getBoundingClientRect();
      if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)problems.push(`texto sai da caixa: ${label(e)} em ${box.className.split(' ')[0]}`);
    }
    const fs=parseFloat(s.fontSize);
    if(ownText(e)&&fs<minFont-.01)problems.push(`texto de ${fs}px (< ${minFont}): ${label(e)}`);
  }
  for(const b of document.querySelectorAll(`${rootsSelector.split(',').map(x=>x+' button').join(',')}`)){
    if(!vis(b))continue;const r=b.getBoundingClientRect();
    if(r.width<44-.5||r.height<44-.5)problems.push(`alvo de toque ${Math.round(r.width)}x${Math.round(r.height)}: ${label(b)}`);
    // The label must fit inside its own button (round buttons included).
    const range=document.createRange();range.selectNodeContents(b);const t=range.getBoundingClientRect();
    if(t.width>0&&(t.left<r.left-1||t.right>r.right+1))problems.push(`texto sai do botão: ${label(b)}`);
  }
  // Result: every card in view (no internal scroll) and none under Revanche/Sair.
  const grid=document.querySelector('.rh-result:not([hidden]) .rh-result-grid'),actions=document.querySelector('.rh-result:not([hidden]) .rh-result-actions');
  if(grid&&vis(grid)){
    const g=grid.getBoundingClientRect(),a=actions?.getBoundingClientRect();
    const out=[...grid.querySelectorAll('.rh-rcard')].filter(c=>{const r=c.getBoundingClientRect();return r.top<g.top-1||r.bottom>g.bottom+1;}).length;
    if(out)problems.push(`resultado rola: ${out} card(s) fora da vista`);
    if(a)for(const c of grid.querySelectorAll('.rh-rcard')){const r=c.getBoundingClientRect(),top=Math.max(r.top,g.top),bottom=Math.min(r.bottom,g.bottom);
      if(bottom>top&&r.left<a.right&&r.right>a.left&&top<a.bottom&&bottom>a.top)problems.push(`card atrás de Revanche/Sair: ${label(c.querySelector('.rh-rcard-name')||c)}`);}
  }
  // The HUD is a fixed overlay: the page must not scroll. (The lobby dialog lives over the long creation page.)
  if(rootsSelector.startsWith('.rh')&&(document.documentElement.scrollHeight>innerHeight+1||document.documentElement.scrollWidth>innerWidth+1))problems.push('a página rola');
  return [...new Set(problems)];
}

const SCENES=[
  ['hud oferta do round, 6p, 4 cartas','/?sandbox=hud&players=6&state=offer-round&frozen=1','.rh',13],
  ['hud oferta de nível, 1p, 3 cartas','/?sandbox=hud&players=1&state=offer&frozen=1','.rh',13],
  ['hud oferta de coxinha','/?sandbox=hud&players=6&state=offer-heal&frozen=1','.rh',13],
  ['hud combate, 6p','/?sandbox=hud&players=6&state=wave&frozen=1','.rh',13],
  ['hud caído, 6p','/?sandbox=hud&players=6&state=downed&frozen=1','.rh',13],
  ['hud chefe, 6p','/?sandbox=hud&players=6&state=boss&frozen=1','.rh',13],
  ['hud resultado, 6p','/?sandbox=hud&players=6&state=result&frozen=1','.rh',13],
  ['hud resultado, 1p','/?sandbox=hud&players=1&state=result&frozen=1','.rh',13],
  ['emotes abertos','/?sandbox=fun&players=6&state=open&frozen=1','.fun-emotes,.fun-balloons',13],
  ['balões','/?sandbox=fun&players=6&state=balloons&frozen=1','.fun-balloons',13],
];
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium'});
  const report=[];let failed=0;
  for(const v of [{width:390,height:844},{width:844,height:390}])for(const texto of ['100','125']){
    const ctx=await browser.newContext({viewport:v,isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const page=await ctx.newPage();
    const run=async(name,url,roots,min,prep)=>{
      await page.goto(BASE+url);
      await page.evaluate(t=>{if(t==='125')document.documentElement.dataset.texto='125';},texto);
      await page.waitForTimeout(300);
      if(prep)await prep();
      await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);
      const problems=await page.evaluate(([r,m])=>(window.__audit=eval('('+window.__auditSrc+')'),window.__audit(r,m)),[roots,min]);
      report.push({view:`${v.width}x${v.height}`,texto,name,problems});
      if(problems.length)failed++;
    };
    await page.addInitScript(src=>{window.__auditSrc=src;},audit.toString());
    for(const [name,url,roots,min] of SCENES)await run(name,url,roots,min);
    // Worst case: the catalog items with the most text (name + effect) on the 2x2 and on the row of 3.
    const worst=async()=>{await page.waitForSelector('.rh-card');await page.evaluate(async()=>{
      const {allItemDisplays}=await import('/src/game/hud/items.ts');
      const items=[...allItemDisplays()];
      // Real items (name and effect stay together), the ones with the most text first.
      const longest=items.sort((a,b)=>(b.name.length+b.blurb.length)-(a.name.length+a.blurb.length));
      document.querySelectorAll('.rh-card').forEach((c,i)=>{c.querySelector('.rh-card-name').textContent=longest[i].name;c.querySelector('.rh-card-blurb').textContent=longest[i].blurb;});
    });};
    await run('hud oferta, 4 cartas, textos mais longos','/?sandbox=hud&players=6&state=offer-round&frozen=1','.rh',13,worst);
    await run('hud oferta, 3 cartas, textos mais longos','/?sandbox=hud&players=1&state=offer&frozen=1','.rh',13,worst);
    // Real long names: the lobby keeps 20 characters, the team strip shows the first name cut at 9 (team.ts).
    const longNames=async()=>{await page.waitForSelector('.rh-rcard-name,.rh-member-name');await page.evaluate(()=>{
      const names=['Maria Aparecida dos','Seu Jorge do Pastel','Wagner Washington Mo','Tia da Festa Junina','Concurseira Eterna d','Zé do Pix Parcelado'];
      document.querySelectorAll('.rh-rcard-name').forEach((e,i)=>{e.textContent=names[i%names.length];});
      document.querySelectorAll('.rh-member:not(.rh-me) .rh-member-name').forEach((e,i)=>{e.textContent=names[(i+1)%names.length].split(' ')[0].slice(0,9);});
    });};
    await run('hud resultado, 6p, nomes longos','/?sandbox=hud&players=6&state=result&frozen=1','.rh',13,longNames);
    await run('hud combate, 6p, nomes longos','/?sandbox=hud&players=6&state=wave&frozen=1','.rh',13,longNames);
    await run('hud caído, 6p, nomes longos','/?sandbox=hud&players=6&state=downed&frozen=1','.rh',13,longNames);
    await run('lobby','/','dialog.coop-lobby',10,async()=>{await page.evaluate(async()=>{const {classes}=await import('/src/classes.ts');const {openLobby}=await import('/src/game/lobby.ts');void openLobby(classes[0],'Maria Aparecida');});await page.waitForTimeout(900);});
    await run('botão de habilidade','/','.audit-actions',13,async()=>{await page.evaluate(async()=>{await import('/src/game/coop.css');const d=document.createElement('div');d.className='audit-actions';d.style.cssText='position:fixed;right:20px;bottom:20px;z-index:99';d.innerHTML='<button id="coop-attack">Habilidade</button>';document.body.append(d);});});
    await ctx.close();
  }
  await browser.close();
  for(const r of report)console.log(`${r.problems.length?'FALHA':'ok   '} ${r.view} ${r.texto}% ${r.name}${r.problems.length?'\n   - '+r.problems.join('\n   - '):''}`);
  if(OUT)fs.writeFileSync(OUT,JSON.stringify(report,null,1));
  console.log(`\n${failed} cena(s) com problema em ${report.length}`);
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
