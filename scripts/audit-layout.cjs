#!/usr/bin/env node
/**
 * Layout audit (DSG-tokens, design/UX review): opens the HUD, emotes, lobby and waiting room on a phone viewport
 * (390x844 and 844x390, text at 100% and 125%) and FAILS (exit 1) when any visible text is cut or spills:
 *   - an ellipsis is active (text-overflow:ellipsis with scrollWidth > clientWidth),
 *   - a line clamp is hiding lines (-webkit-line-clamp with scrollHeight > clientHeight),
 *   - an overflow:hidden/clip box hides its own text (scroll size > client size),
 *   - a result card out of view (internal scroll) or under Revanche/Sair (long real names included),
 *   - text inside an offer card or a result card pokes out of the card, or a label pokes out of its button,
 * a glyph of a tag's text outside the tag, an offer over a fallen ally or over a "caiu!" banner,
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
    // Seals (padrão/sorte, the "Novo!" encarte star) and any chip positioned on the border ride it on purpose.
    if(box&&box!==e&&!e.closest('.rh-card-flags,.rh-card-star')&&getComputedStyle(e).position!=='absolute'){
      const b=box.getBoundingClientRect(),r=e.getBoundingClientRect();
      if(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)problems.push(`texto sai da caixa: ${label(e)} em ${box.className.split(' ')[0]}`);
    }
    // Glyphs, not boxes: a text squeezed by min-width:0 keeps its box inside the tag while the letters spill out.
    const tag=e.closest('.rh-card');
    if(tag&&!e.closest('.rh-card-stamp,.rh-card-star')){
      const t=tag.getBoundingClientRect();
      if(e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).display!=='inline')problems.push(`texto mais largo que a caixa: ${label(e)}`);
      for(const n of e.childNodes){if(n.nodeType!==3||!n.textContent.trim())continue;
        const range=document.createRange();range.selectNodeContents(n);
        for(const r of range.getClientRects())if(r.width&&(r.left<t.left-1||r.right>t.right+1||r.top<t.top-1||r.bottom>t.bottom+1)){problems.push(`letra sai da etiqueta: ${label(e)}`);break;}}
    }
    // The "Novo!" word must sit inside the star's body (the burst's points leave ~80% of its width usable).
    if(e.parentElement&&e.parentElement.classList.contains('rh-card-star')&&e.offsetWidth>e.parentElement.clientWidth*.8+.5)
      problems.push(`letra sai da estrela: ${label(e)} (${e.offsetWidth} > 80% de ${e.parentElement.clientWidth})`);
    // Window header: the title's letters must not run into the clock or the "Levar os indicados" button.
    if(e.classList.contains('rh-offer-title')){
      const range=document.createRange();range.selectNodeContents(e);const tr=range.getBoundingClientRect();
      for(const o of e.closest('.rh-offer').querySelectorAll('.rh-offer-time,.rh-offer-queue,.rh-offer-all')){
        if(!vis(o))continue;const r=o.getBoundingClientRect();
        if(tr.width&&tr.right>r.left+1&&tr.left<r.right-1&&tr.bottom>r.top+1&&tr.top<r.bottom-1){problems.push(`título da oferta encosta em ${o.className.split(' ')[0]}`);break;}
      }
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
  // The offer (window or strip) never covers a fallen ally (portrait, SOS badge and timer) or a "caiu!" banner.
  const offer=document.querySelector('.rh-offer:not([hidden])');
  if(offer&&vis(offer)){
    const o=offer.getBoundingClientRect();
    const hit=r=>r.width&&r.right>o.left+1&&r.left<o.right-1&&r.bottom>o.top+1&&r.top<o.bottom-1;
    for(const m of document.querySelectorAll('.rh-member[data-state=downed]'))if(vis(m)&&hit(m.getBoundingClientRect()))problems.push(`oferta cobre aliado caído: ${label(m)}`);
    for(const a of document.querySelectorAll('.rh-alert:not([hidden])'))if(vis(a)){const z=+getComputedStyle(a.closest('.rh-stack')||a).zIndex||0,zo=+getComputedStyle(offer).zIndex||0;
      if(hit(a.getBoundingClientRect())&&z<=zo)problems.push(`aviso de queda atrás da oferta: ${label(a)}`);}
  }
  // The HUD is a fixed overlay: the page must not scroll. (The lobby dialog lives over the long creation page.)
  // UX review: in portrait the intermission window never takes more than 32% of the height.
  for(const w of document.querySelectorAll('.rh-offer[data-mode=intermission]'))if(vis(w)&&innerHeight>500&&w.getBoundingClientRect().height>innerHeight*.32+1)
    problems.push(`janela do intervalo com ${Math.round(w.getBoundingClientRect().height/innerHeight*100)}% da altura (> 32%)`);
  if(rootsSelector.startsWith('.rh')&&(document.documentElement.scrollHeight>innerHeight+1||document.documentElement.scrollWidth>innerWidth+1))problems.push('a página rola');
  return [...new Set(problems)];
}

const SCENES=[
  ['hud oferta do round, 6p, 4 cartas','/?sandbox=hud&players=6&state=offer-round&frozen=1','.rh',13],
  ['hud oferta de nível no intervalo, 1p, 3 cartas','/?sandbox=hud&players=1&state=offer-prepare&frozen=1','.rh',13],
  ['hud oferta de nível no intervalo, 6p','/?sandbox=hud&players=6&state=offer-prepare&frozen=1','.rh',13],
  ['hud combate com 2 níveis no chip, 6p','/?sandbox=hud&players=6&state=offer&frozen=1','.rh',13],
  ['hud combate, painel compacto aberto, 6p','/?sandbox=hud&players=6&state=offer-open&frozen=1','.rh',13],
  ['hud intervalo com 2 caídos (o último do time)','/?sandbox=hud&players=6&state=offer-downed&frozen=1','.rh',13],
  ['hud combate, faixa aberta com 2 caídos','/?sandbox=hud&players=6&state=offer-open-downed&frozen=1','.rh',13],
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
    await run('hud oferta, 3 cartas, textos mais longos','/?sandbox=hud&players=1&state=offer-prepare&frozen=1','.rh',13,worst);
    await run('hud combate, painel compacto, textos mais longos','/?sandbox=hud&players=6&state=offer-open&frozen=1','.rh',13,worst);
    // The stamp: a picked tag shows "LEVEI" over its own text; nothing may spill (reduced motion makes it instant).
    await run('hud carimbo LEVEI no intervalo','/?sandbox=hud&players=6&state=offer-round&frozen=1','.rh',13,async()=>{await page.waitForSelector('.rh-card');await page.waitForTimeout(400);await page.evaluate(()=>{const c=document.querySelectorAll('.rh-card')[1];c.closest('.rh-offer').classList.add('rh-offer-pending','rh-offer-stamping');c.classList.add('rh-card-chosen');});});
    await run('hud carimbo LEVEI em combate','/?sandbox=hud&players=6&state=offer-open&frozen=1','.rh',13,async()=>{await page.waitForSelector('.rh-card');await page.evaluate(()=>{const c=document.querySelectorAll('.rh-card')[1];c.closest('.rh-offer').classList.add('rh-offer-pending','rh-offer-stamping');c.classList.add('rh-card-chosen');});});
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
