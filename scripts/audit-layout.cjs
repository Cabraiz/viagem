#!/usr/bin/env node
/**
 * Layout audit (DSG-tokens, design/UX review): opens the HUD, emotes, lobby and waiting room on a phone viewport
 * (390x844 and 844x390, text at 100% and 125%) and FAILS (exit 1) when any visible text is cut or spills:
 *   - an ellipsis is active (text-overflow:ellipsis with scrollWidth > clientWidth),
 *   - a line clamp is hiding lines (-webkit-line-clamp with scrollHeight > clientHeight),
 *   - an overflow:hidden/clip box hides its own text (scroll size > client size),
 *   - a result card out of view (internal scroll) or under Revanche/Sair (long real names included),
 *   - text inside an offer card or a result card pokes out of the card, or a label pokes out of its button,
 * a glyph of a tag's text outside the tag, an offer over a fallen ally or over a "caiu!" banner, an edge arrow behind an
 * open window (offer, forge, kill-cam, minimap) or a caído/boss arrow missing in the arrows scenes,
 * plus text under the minimum size (13 px in the match HUD and emotes), touch targets under 44 px and page scroll.
 * Usage: node scripts/audit-layout.cjs [baseUrl=http://127.0.0.1:4350] [out.json]
 * AUDIT_SLOW_MS=<ms> delays the sandbox modules (a loaded box); AUDIT_ONLY=<text> runs only scenes whose name has it.
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
  if(!roots.length)return ['nada para medir: a cena não está na tela'];
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
    // Seal × title (DSG-adesivos-itens): the "Novo!" star, the level price and the word tag never cover a letter of the
    // tag's name or effect (the star's burst counts whole, minus 2 px of its points).
    if(e.parentElement&&e.parentElement.matches('.rh-card-star,.rh-card-price,.rh-card-tag')||e.matches('.rh-card-tag')){
      const seal=e.matches('.rh-card-tag')?e:e.parentElement,card=seal.closest('.rh-card'),sr=seal.getBoundingClientRect();
      const box={left:sr.left+2,right:sr.right-2,top:sr.top+2,bottom:sr.bottom-2};
      for(const t of card?card.querySelectorAll('.rh-card-name,.rh-card-blurb'):[]){
        if(!vis(t))continue;const range=document.createRange();range.selectNodeContents(t);
        if([...range.getClientRects()].some(r=>r.width&&r.right>box.left&&r.left<box.right&&r.bottom>box.top&&r.top<box.bottom)){problems.push(`selo cobre o texto: ${label(t)}`);break;}
      }
    }
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
  // The top band's fichas never cross each other (soma N15 + 046B, 125%): round chip, XP, boss bar, base ficha, minimap.
  {const tops=[...document.querySelectorAll('.rh-round,.rh-xp,.rh-boss,.rh-camp,.rh-minimap,.explore-camera-hint:not([hidden])')].filter(vis).map(e=>({e,r:e.getBoundingClientRect()}));
    for(let i=0;i<tops.length;i++)for(let j=i+1;j<tops.length;j++){const a=tops[i].r,b=tops[j].r;
      // (The "Gira no intervalo" balloon counts against every ficha, the XP bar included: NEW-UX-balao-girar-retrato.)
      if(a.right>b.left+.5&&b.right>a.left+.5&&a.bottom>b.top+.5&&b.bottom>a.top+.5)problems.push(`fichas do topo se cruzam: ${tops[i].e.className.split(' ')[0]} × ${tops[j].e.className.split(' ')[0]}`);}}
  // NEW-20261011-UX-janela-esconde-caido: an edge arrow (ficha, tag or "+N") never sits behind an open window (offer,
  // forge), the kill-cam or the minimap; and in the arrows scenes (cenario=bordas: two caídos and the boss off screen)
  // the caído and the boss always keep their arrow, whatever window is open.
  {const wins=[...document.querySelectorAll('.rh-offer:not([hidden]),.rh-forge:not([hidden]),.rh-killcam:not([hidden]),.rh-minimap')].filter(vis);
    for(const e of document.querySelectorAll('.rh-edge:not([hidden])'))if(vis(e))for(const part of [e,...e.querySelectorAll('.rh-edge-tag:not([hidden]),.rh-edge-count:not([hidden]),.rh-edge-name:not([hidden])')]){
      const a=part.getBoundingClientRect();
      for(const w of wins){const b=w.getBoundingClientRect();
        if(a.right>b.left+.5&&b.right>a.left+.5&&a.bottom>b.top+.5&&b.bottom>a.top+.5)problems.push(`seta atrás da janela: ${e.dataset.kind} × ${w.className.split(' ')[0]}`);}}
    // (Only for what is off the field and not in plain view: the arrows' layer lists those kinds in data-need, the same
    // list the game writes and the zones audit reads.)
    for(const kind of (document.querySelector('.rh-edges')?.dataset.need??'').split(' ').filter(Boolean))
      if(![...document.querySelectorAll(`.rh-edge[data-kind=${kind}]:not([hidden])`)].some(vis))problems.push(`sem seta: ${kind}`);}
  // NEW-UX-nome-do-time-na-coluna: a team name ficha stays inside its member's box (the box the useful area and the arrows
  // avoid) and on screen.
  for(const n of document.querySelectorAll('.rh-member-name'))if(vis(n)){const m=n.closest('.rh-member').getBoundingClientRect(),r=n.getBoundingClientRect();
    if(r.left<m.left-.5||r.right>m.right+.5||r.left<-.5||r.right>innerWidth+.5)problems.push(`nome sai da coluna do time: ${label(n)}`);
    for(const w of document.querySelectorAll('.rh-offer:not([hidden]),.rh-forge:not([hidden]),.rh-camp:not([hidden])'))if(vis(w)){const b=w.getBoundingClientRect();
      if(r.right>b.left+.5&&b.right>r.left+.5&&r.bottom>b.top+.5&&b.bottom>r.top+.5)problems.push(`nome do time sob a janela: ${label(n)} × ${w.className.split(' ')[0]}`);}}
  // pacote-bugs-ux (design review): the caído ficha of a window never lies on the visible part of a card or tag.
  for(const f of document.querySelectorAll('.rh-window-fall:not([hidden])'))if(vis(f)){const r=f.getBoundingClientRect();
    for(const c of document.querySelectorAll('.rh-offer:not([hidden]) .rh-card,.rh-forge:not([hidden]) .rh-forge-tag')){if(!vis(c))continue;
      const list=c.closest('.rh-offer-cards,.rh-forge-tags'),b=c.getBoundingClientRect(),l=list?list.getBoundingClientRect():b;
      const top=Math.max(b.top,l.top),bottom=Math.min(b.bottom,l.bottom),left=Math.max(b.left,l.left),right=Math.min(b.right,l.right);
      if(bottom>top&&right>left&&r.right>left+.5&&r.left<right-.5&&r.bottom>top+.5&&r.top<bottom-.5)problems.push(`ficha do caído sobre ${label(c)}`);}}
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
  // The owner's result (D-025): "Arrumar a sala" with Revanche and Sair; and with the playtest's "Métricas" chip (?dev=1).
  // Six players with the owner's row (BUG-resultado-dono-6p-rola): long real names through the game's own card name,
  // room bots, defeat, the "Métricas" chip and the owner arranging the room (cards trade prizes for buttons).
  ['hud resultado do dono, 6p, nomes longos','/?sandbox=hud&players=6&state=result&frozen=1&dono=1&nomes=longos','.rh',13],
  ['hud resultado do dono, 6p, derrota, 4 bots, Métricas (dev)','/?sandbox=hud&players=6&state=result&frozen=1&dono=1&nomes=longos&lose=1&bots=4&dev=1','.rh',13],
  ['hud resultado do dono, 6p, derrota, nomes longos','/?sandbox=hud&players=6&state=result&frozen=1&dono=1&nomes=longos&lose=1','.rh',13],
  // The real room ended by the lab (DSG-adesivos-itens): ties everywhere, so most cards carry a long vice line.
  ['hud resultado do dono, 6p, derrota, vices longos (empates)','/?sandbox=hud&players=6&state=result&frozen=1&dono=1&nomes=longos&lose=1&premios=empates','.rh',13],
  ['hud resultado, 6p, vices longos (empates)','/?sandbox=hud&players=6&state=result&frozen=1&premios=empates','.rh',13],
  ['hud resultado do dono, 2p','/?sandbox=hud&players=2&state=result&frozen=1&dono=1','.rh',13],
  ['hud resultado do dono, 2p, derrota, Métricas (dev)','/?sandbox=hud&players=2&state=result&frozen=1&dono=1&lose=1&dev=1','.rh',13],
  ['hud resultado do dono, 1p, Métricas (dev)','/?sandbox=hud&players=1&state=result&frozen=1&dono=1&dev=1','.rh',13],
  ['hud setas na borda e minimapa (bordas), 6p','/?sandbox=hud&players=6&state=wave&frozen=1&cenario=bordas','.rh',13],
  ['hud setas na borda, vista 2','/?sandbox=hud&players=6&state=wave&frozen=1&cenario=bordas&vista=1','.rh',13],
  // The soma (N15 + 046B): minimap, base ficha and arrows with the forge open, the horn, and the round offer.
  ['soma: minimapa + base + setas + forja aberta','/?sandbox=hud&players=6&state=camp-forge&frozen=1&cenario=bordas','.rh',13],
  ['soma: minimapa + base + setas + corneta','/?sandbox=hud&players=6&state=camp-horn&frozen=1&cenario=bordas','.rh',13],
  ['soma: minimapa + base + setas + oferta do round','/?sandbox=hud&players=6&state=offer-round&frozen=1&cenario=bordas','.rh',13],
  // NEW-20261011-UX-janela-esconde-caido: every window over the field with two caídos and the boss off screen. The check
  // above fails when an arrow sits behind the window or the caído/boss arrow is gone.
  ['janela: forja aberta + caídos e chefe fora da tela','/?sandbox=hud&players=6&state=camp-forge&frozen=1&cenario=bordas&vista=2','.rh',13],
  ['janela: oferta de nível no intervalo + caídos e chefe fora','/?sandbox=hud&players=6&state=offer-prepare&frozen=1&cenario=bordas','.rh',13],
  ['janela: painel de nível aberto em combate + caídos e chefe fora','/?sandbox=hud&players=6&state=offer-open&frozen=1&cenario=bordas','.rh',13],
  ['janela: kill-cam + caídos e chefe fora','/?sandbox=hud&players=6&state=wave&frozen=1&cenario=bordas&zueira=killcam','.rh',13],
  // Stonewards (VGM-046B): the forge window in the camp, the horn far from it, the wall low in a wave.
  ['hud forja no acampamento, 6p','/?sandbox=hud&players=6&state=camp-forge&frozen=1','.rh',13],
  ['hud corneta longe da base, 6p','/?sandbox=hud&players=6&state=camp-horn&frozen=1','.rh',13],
  ['hud muralha baixa no round, 6p','/?sandbox=hud&players=6&state=camp-wave&frozen=1','.rh',13],
  // Zueira events (VGM-053B): an event's banner in a wave, and the kill-cam window at the round's end.
  ['hud faixa do apagão, 6p','/?sandbox=hud&players=6&state=wave&frozen=1&zueira=apagao','.rh',13],
  ['hud kill-cam do último bicho, 6p','/?sandbox=hud&players=6&state=prepare&frozen=1&zueira=killcam','.rh',13],
  // First-run coach (VGM-056): each hint as the row of the announcement slot, 6 players, both orientations, 100% and 125%.
  ['dica andar (6p)','/?sandbox=hud&players=6&state=wave&frozen=1&dica=walk','.rh',13],
  ['dica XP (6p)','/?sandbox=hud&players=6&state=wave&frozen=1&dica=xp','.rh',13],
  ['dica chip (6p, 2 níveis)','/?sandbox=hud&players=6&state=offer&frozen=1&dica=chip','.rh',13],
  ['dica resgatar (6p, 1 caído)','/?sandbox=hud&players=6&state=wave&frozen=1&dica=rescue','.rh',13],
  ['dica coleta (intervalo, 6p)','/?sandbox=hud&players=6&state=prepare&frozen=1&dica=gather','.rh',13],
  ['dica andar + setas e minimapa','/?sandbox=hud&players=6&state=wave&frozen=1&dica=walk&cenario=bordas','.rh',13],
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
      if(process.env.AUDIT_ONLY&&!name.includes(process.env.AUDIT_ONLY))return;
      await page.goto(BASE+url);
      await page.evaluate(t=>{if(t==='125')document.documentElement.dataset.texto='125';},texto);
      // BUG-audit-scroll-flaky: on a loaded box Vite may still be serving the sandbox module 1 s after the page loads, and
      // the audit then measured the long creation page under it ("a página rola", in a random scene). Measure only a
      // mounted scene: the sandbox's own "drawn" flag, then the scene's roots on screen, the fonts and two frames. A scene
      // that never mounts fails as such; nothing is measured on a half-built page.
      const mounted=async()=>{
        const flag=url.includes('sandbox=hud')?'hudReady':url.includes('sandbox=fun')?'funReady':undefined;
        if(flag)await page.waitForFunction(f=>document.body.dataset[f]==='1',flag,{timeout:30000});
        // The arrows scenes draw once their modules are in (and again 4 times a second): wait for the first drawing.
        if(url.includes('cenario=bordas'))await page.waitForFunction(()=>document.body.dataset.bordas==='1',null,{timeout:30000});
      };
      const settled=async()=>{
        await page.waitForSelector(roots,{state:'visible',timeout:30000});
        await page.evaluate(()=>document.fonts.ready);
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      };
      let problems;
      try{
        await mounted();await page.waitForTimeout(300);
        if(prep)await prep();
        await settled();await page.waitForTimeout(700);
        problems=await page.evaluate(([r,m])=>(window.__audit=eval('('+window.__auditSrc+')'),window.__audit(r,m)),[roots,min]);
      }catch(e){problems=[`cena não montou: ${String(e.message).split('\n')[0]}`];}
      report.push({view:`${v.width}x${v.height}`,texto,name,problems});
      if(problems.length)failed++;
    };
    await page.addInitScript(src=>{window.__auditSrc=src;},audit.toString());
    // AUDIT_SLOW_MS=1500 holds every sandbox module that long, as a loaded box does (BUG-audit-scroll-flaky): the result
    // must be the same as without it.
    if(+process.env.AUDIT_SLOW_MS>0)await page.route(/\/src\/game\/sandbox-[a-z]+\.ts/,async r=>{await new Promise(t=>setTimeout(t,+process.env.AUDIT_SLOW_MS));await r.continue();});
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
    await run('hud resultado, 6p, nomes longos','/?sandbox=hud&players=6&state=result&frozen=1&nomes=longos','.rh',13);
    // The owner arranging the room with six players: each card trades its prizes (and, in landscape, its numbers) for the
    // 48 px "Expulsar" / "Tirar bot" button, one of them armed with the longest confirmation.
    await run('hud resultado do dono arrumando a sala, 6p, 2 bots','/?sandbox=hud&players=6&state=result&frozen=1&dono=1&nomes=longos&bots=2&clean=1','.rh',13,async()=>{
      await page.click('.rh-result-manage');await page.click('.rh-rcard-manage.is-person');});
    // The real "Gira no intervalo" balloon (explore.css) over the arrows scene with a window open: in landscape the
    // minimap moved under the view buttons, and the balloon must not open over it or a top ficha (UX review janela-caido).
    for(const [name,state] of [['forja','camp-forge'],['painel de nível','offer-open'],['combate (round)','wave'],['muralha baixa','camp-wave']])
      await run(`janela: balão "Gira no intervalo" com ${name} aberta`,`/?sandbox=hud&players=6&state=${state}&frozen=1&cenario=bordas`,'.rh',13,async()=>{
        await page.evaluate(async()=>{await import('/src/game/explore.css');const d=document.createElement('div');d.className='explore-camera';d.dataset.locked='true';
          d.innerHTML='<button></button><span class="explore-view"><i style="display:block;width:32px;height:32px"></i></span><button></button><span class="explore-camera-hint" role="status"><i class="ic"></i><span>Gira no intervalo</span></span>';document.querySelector('.hs-world').append(d);});});
    // Portrait: the answer is a row of the announcement slot, ahead of the coach's hint (the same markup as explore.ts).
    for(const [name,state,extra] of [['combate','wave',''],['dica andar na vaga','wave','&dica=walk'],['muralha baixa','camp-wave','']])
      await run(`"Gira no intervalo" na vaga de anúncio, ${name}`,`/?sandbox=hud&players=6&state=${state}&frozen=1${extra}`,'.rh',13,async()=>{
        await page.evaluate(async()=>{await import('/src/game/explore.css');const {icon}=await import('/src/ui/icon.ts');
          const row=document.createElement('div');row.className='explore-camera-row';row.setAttribute('role','status');row.innerHTML=`${icon('cadeado',{size:24})}<span>Gira no intervalo</span>`;
          window.__hud.queueRow(row,60000,{answer:true});});
        await page.waitForTimeout(300);});
    await run('hud combate, 6p, nomes longos','/?sandbox=hud&players=6&state=wave&frozen=1','.rh',13,longNames);
    await run('hud caído, 6p, nomes longos','/?sandbox=hud&players=6&state=downed&frozen=1','.rh',13,longNames);
    await run('lobby','/','dialog.coop-lobby',10,async()=>{await page.evaluate(async()=>{const {classes}=await import('/src/classes.ts');const {openLobby}=await import('/src/game/lobby.ts');void openLobby(classes[0],'Maria Aparecida');});await page.waitForTimeout(900);});
    // The real SkillButton (sticker + "Habilidade", E7-skill-hud-wiring), ready and cooling with the widest note.
    for(const [label,setup] of [['botão de habilidade','ready'],['botão de habilidade, recarga','cooling'],['botão de habilidade, nota','note']])
      await run(label,'/','.audit-actions',13,async()=>{await page.evaluate(async state=>{await import('/src/game/coop.css');const {SkillButton}=await import('/src/game/hud/skill.ts');
        const d=document.createElement('div');d.className='audit-actions';d.style.cssText='position:fixed;right:20px;bottom:20px;z-index:99';d.innerHTML='<button id="coop-attack"></button>';document.body.append(d);
        const b=new SkillButton(d.querySelector('#coop-attack'),'cidadao-comum');
        if(state==='cooling')b.update({skillTick:1,skillReadyTick:300},100,0);
        if(state==='note'){b.update({skillTick:1,skillReadyTick:300},100,0);b.tap(()=>1,0);}},setup);});
    await ctx.close();
  }
  await browser.close();
  for(const r of report)console.log(`${r.problems.length?'FALHA':'ok   '} ${r.view} ${r.texto}% ${r.name}${r.problems.length?'\n   - '+r.problems.join('\n   - '):''}`);
  if(OUT)fs.writeFileSync(OUT,JSON.stringify(report,null,1));
  console.log(`\n${failed} cena(s) com problema em ${report.length}`);
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
