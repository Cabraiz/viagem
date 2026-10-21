// The standard print sheet (NEW-20261020-ORQ-prints-no-ci): every branch gets the same prints from GitHub Actions
// (.github/workflows/prints.yml), so an executor pushes and waits instead of opening a browser on the shared PC, and a
// visual fault (20/10: the standing hero trembling, idle↔walk at every reconcile, b837b93) shows on a sheet nobody had
// to ask for. On the BUILT site (dist/ under vite preview + the local rooms Worker, as scripts/smoke-prod.mjs):
//   1. the menu (character screen);
//   2. a solo match: the hero standing (3 frames in a row, and a sampled window: a standing hero whose texture flips
//      between an idle and a walk sheet = FAIL), walking by the keyboard (8 directions, 2 frames each), walking by the
//      mouse (a click on open ground: spots around the hero until one walks him, 3 frames, then the hold-to-follow),
//      and a burst of short keyboard walks in open ground (every stop sampled: idle↔walk back and forth = tremor);
//   2b. the phone (isMobile + hasTouch, 390×844, a match of its own): the hero standing, the joystick dragged by a
//      finger (the 4 diagonals of the dir4 page and the 4 cardinals), a tap on open ground;
//   3. modo foto scenes (src/client/dev/foto.ts, no room): a box opening (arsenal), beside towers (torres=1), shadows,
//      the hero beside a house (silhouette);
// each at 1280×720 and 390×844 (DPR 1). Out: <out>/folha-<sha>.png (every frame with its caption), <out>/folha.json
// ({ok, fails, consoleErrors, frames, tremor}), the frames themselves, and the Step Summary when GITHUB_STEP_SUMMARY is set.
// 0. the match's opening, when scripts/abertura-ci.mjs ran first into the same <out> (its abertura.json): its numbers
//    against the main's on the header (red when it got worse), its prints first, its fails on the sheet's.
// node scripts/folha-prints.mjs [outDir=folha-out] [--dist dist] [--sha <sha>]: run from the checkout whose dist/ and
// rooms Worker it plays (its own scripts/local-worker.mjs). Exit 0 ok, 1 the sheet failed, 2 infrastructure.
// Waits by state (window.__partidaPronta, __fotoPronta, the hero's texture), never a fixed long sleep: swiftshader is slow.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const outDir=resolve(process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')))??'folha-out');
const dist=resolve(arg('dist','dist'));
const sha=String(arg('sha',process.env.GITHUB_SHA??'local')).slice(0,7);
const VIEWPORTS=[{w:1280,h:720},{w:390,h:844}];
/** Modo foto scenes (name, extra query, caption). Extras pass through to the sandbox (foto.ts fotoSearch). */
const FOTOS=[
  ['arsenal','','caixa abrindo (arsenal)'],
  ['cidade-praca','&torres=1&hero=100,124','ao lado das torres (A3 atrás do prédio)'],
  ['sombra','','sombras do elenco'],
  ['cidade-regua','','herói ao lado da casa (silhueta)'],
];
const KEYS={N:['KeyW'],NE:['KeyW','KeyD'],E:['KeyD'],SE:['KeyS','KeyD'],S:['KeyS'],SW:['KeyS','KeyA'],W:['KeyA'],NW:['KeyW','KeyA']};
/**
 * A standing hero (still for STAND_STILL_MS) is sampled for STAND_FRAMES drawn frames (at most STAND_MAX_MS: swiftshader
 * draws 1280×720 at ~5 fps): any idle↔walk texture flip in it fails.
 */
const STAND_FRAMES=150,STAND_MAX_MS=30000,STAND_STILL_MS=1500,STOP_FRAMES=15,STOP_MS=2500,STOP_FLIPS_FAIL=2;
/** The burst (direction, ms held): stops in open ground, where the room's corrections really move the hero. */
const BURST=[['E',300],['W',500],['S',250],['N',650],['SE',400],['NW',300],['E',700],['W',350],['SW',450],['NE',250],['S',550],['N',400]];
/** Where a click may walk the hero: offsets from his spot on the page, in fractions of min(w,h). */
const CLICK_SPOTS=[[.3,.2],[-.3,.2],[.3,-.15],[-.3,-.15],[0,.3],[.35,0],[-.35,0],[0,-.25]];
/**
 * A real network (init script of the match page): the room's messages arrive 80–200 ms late, in order. The local Worker
 * answers at once, so the client's prediction never got a server correction and a standing hero was never nudged —
 * b837b93's trembling (idle↔walk at every reconcile nudge) did not show without it.
 */
const LATENCY=()=>{
  const W=window.WebSocket;if(!W)return;
  let last=0;const late=fn=>{const at=Math.max(last,performance.now()+80+Math.random()*120);last=at;setTimeout(fn,at-performance.now());};
  const add=W.prototype.addEventListener;
  W.prototype.addEventListener=function(type,l,o){
    if(type!=='message'||!l)return add.call(this,type,l,o);
    return add.call(this,type,e=>late(()=>typeof l==='function'?l.call(this,e):l.handleEvent(e)),o);
  };
  Object.defineProperty(W.prototype,'onmessage',{configurable:true,get(){return this.__folhaOnMessage??null;},set(f){this.__folhaOnMessage=f;if(!this.__folhaHooked){this.__folhaHooked=true;add.call(this,'message',e=>late(()=>this.__folhaOnMessage?.call(this,e)));}}});
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Infra extends Error {}

const listen=port=>new Promise(ok=>{const s=createServer();s.once('error',()=>ok(0));s.listen(port,'127.0.0.1',()=>{const got=s.address().port;s.close(()=>ok(got));});});
/** The rooms Worker accepts local origins only on the executors' vite ports (multiplayer/origins.ts: 4200–4399). */
async function previewPort(){
  for(const port of [Number(process.env.SMOKE_PORT)||0,...Array.from({length:20},(_,i)=>4379-i)])if(port&&await listen(port))return port;
  throw new Infra('nenhuma porta livre em 4360–4379 para o preview');
}
async function playwright(){
  for(const spec of [process.env.PLAYWRIGHT_MODULE,join(process.cwd(),'node_modules','playwright'),'playwright','D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Infra('Playwright não encontrado: npm install --no-save playwright@1.63.0 (ou PLAYWRIGHT_MODULE)');
}
async function startPreview(port){
  const posix=process.platform!=='win32';
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir',dist],
    {windowsHide:true,shell:false,detached:posix,stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`,want=readFileSync(join(dist,'version.json'),'utf8').trim();
  let up=false,exited=false;child.once('exit',()=>{exited=true;});
  for(let i=0;i<120&&!up&&!exited;i++){try{const r=await fetch(`${url}/version.json`,{cache:'no-store'});up=r.ok&&(await r.text()).trim()===want;}catch{}if(!up)await sleep(250);}
  const stop=()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}};
  if(!up){stop();throw new Infra(`vite preview não subiu em ${url}`);}
  return {url,stop};
}
/** Waits for fn() in the page to be truthy, up to ms; false when it never was. */
async function until(p,fn,ms,arg){
  const end=Date.now()+ms;
  while(Date.now()<end){if(await p.evaluate(fn,arg).catch(()=>false))return true;await sleep(250);}
  return false;
}

/** What the hero shows now (?perf=1 publishes the scene as window.__perfScene; the meter's panel is hidden by CSS). */
const HERO=()=>{
  const s=window.__perfScene,a=s?.actor;if(!a)return null;
  // His spot on the page: world → camera → the canvas box (CSS may scale the canvas).
  const c=s.cameras?.main,cv=s.game?.canvas,r=cv?.getBoundingClientRect?.();
  const sx=c&&r?r.left+(a.x-c.worldView.x)*c.zoom*r.width/cv.width:NaN,sy=c&&r?r.top+(a.y-c.worldView.y)*c.zoom*r.height/cv.height:NaN;
  return {key:String(a.texture?.key??''),frame:String(a.frame?.name??''),x:Math.round(a.x),y:Math.round(a.y),sx:Math.round(sx),sy:Math.round(sy)};
};
/** The game's line under the map (the scene's hooks.message: "Por aqui não dá…" when a click has no way there). */
const NOTICE=()=>document.querySelector('.explore-notice')?.textContent??'';
/** Out of play: the own hero is dead ("Assistindo: <ally>") or the match ended (the result screen, .rh-result). */
const DEAD=()=>/Assistindo:/.test(document.body.innerText)||[...document.querySelectorAll('.rh-result')].some(e=>e.getClientRects().length);
/** A walk sheet (the 128 cells `sprite128:<id>:walk:<dir>`, the legacy `…walk…`), else rest/attack. */
const isWalk=key=>/walk/i.test(key);
/** Samples the hero's texture every drawn frame (in the page), n frames or ms: the keys seen in order. */
const SAMPLE=([n,ms])=>new Promise(done=>{
  const seen=[],end=performance.now()+ms;
  const step=()=>{const a=window.__perfScene?.actor;if(a)seen.push(String(a.texture?.key??''));if(seen.length<n&&performance.now()<end)requestAnimationFrame(step);else done(seen);};
  requestAnimationFrame(step);
});
/** The level-up offer (D-050) pauses the solo match until a card is taken: takes the first one, so the hero walks again. */
const TAKE_OFFER=()=>{const c=[...document.querySelectorAll('.rh-card')].find(b=>!b.disabled&&b.getClientRects().length&&!b.closest('[hidden]'));c?.click();return !!c;};
async function clearOffer(p){
  for(let i=0;i<4&&await p.evaluate(TAKE_OFFER).catch(()=>false);i++)await sleep(700);
  await playing(p);
}
/** Each match page's way back in (set by openMenu): base URL, label, restarts left. */
const matchPages=new WeakMap();
/**
 * A dead hero or an ended match (the critters win a solo match in ~3 min on swiftshader) prints nothing of his own:
 * a new match on the same page (a warning on the sheet), at most twice per page.
 */
async function playing(p){
  const m=matchPages.get(p);
  if(!m||!await p.evaluate(DEAD).catch(()=>false))return;
  const vp=p.viewportSize(),at=`${vp.width}×${vp.height}`;
  await shot(p,'fim',`${m.label}: herói morto ou partida acabou`,{w:vp.width,h:vp.height});
  if(m.left--<=0){avisos.push(`${m.label} ${at}: herói fora de jogo de novo, sem recomeçar`);return;}
  avisos.push(`${m.label} ${at}: herói morto ou partida acabou: partida nova`);
  await p.goto(`${m.base}/?perf=1`,{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
  await enterMatch(p,{w:vp.width,h:vp.height},m.label);
  await p.evaluate(TAKE_OFFER).catch(()=>{});
}

const frames=[],fails=[],avisos=[],consoleErrors=[],tremor={};
/** scripts/abertura-ci.mjs's result in <out> (it runs before this script), or null. */
let abertura=null;
const secs=ms=>Number.isFinite(ms)?`${(ms/1000).toFixed(1).replace('.',',')} s`:'—';
/** The opening in one line: each number of this branch, the main's and how much worse (+) or better (−). */
function aberturaLine(){
  if(!abertura)return '';
  const m=abertura.mediana??{},b=m.branch??{},a=m.main,pct=abertura.piora??{};
  const cell=key=>`${secs(b[key])}${a?` (main ${secs(a[key])}${Number.isFinite(pct[key])?`, ${pct[key]>0?'+':''}${pct[key]} %`:''})`:''}`;
  const head=`abertura${abertura.ok?'':' PIOROU/FALHOU'} (celular CPU ${abertura.cpu}×, ${abertura.kbps/1000} Mbps, ${abertura.rttMs} ms; mediana de ${abertura.pares})`;
  return `${head}: frio cena ${cell('frio.cena')} · jogável ${cell('frio.jogavel')} · volta cena ${cell('volta.cena')} · jogável ${cell('volta.jogavel')}`;
}
async function shot(p,name,caption,vp){
  // JPEG frames (the artifact stays a few MB: PNG frames made it 48 MB); the sheet itself is a PNG.
  const file=`${String(frames.length).padStart(2,'0')}-${name}-${vp.w}x${vp.h}.jpg`;
  await p.screenshot({path:join(outDir,file),type:'jpeg',quality:70,timeout:30000}).catch(e=>fails.push(`print ${file}: ${String(e).split('\n')[0]}`));
  const hero=await p.evaluate(HERO).catch(()=>null);
  frames.push({file,caption:`${caption} · ${vp.w}×${vp.h}`,hero});
}
async function releaseAll(p){for(const k of new Set(Object.values(KEYS).flat()))await p.keyboard.up(k).catch(()=>{});}

/** The hero standing: 3 prints in a row, then a sampled window (a flip between idle and walk sheets fails). */
async function standing(p,vp){
  await releaseAll(p);await clearOffer(p);
  // Still: the hero's drawing has not moved for STAND_STILL_MS (a mouse route may still be walking), at most 25 s.
  let last='',since=Date.now();
  for(const end=Date.now()+25000;Date.now()<end;await sleep(250)){
    const h=await p.evaluate(HERO).catch(()=>null),at=h?`${h.x},${h.y}`:'';
    if(at!==last){last=at;since=Date.now();}else if(Date.now()-since>=STAND_STILL_MS)break;
  }
  await clearOffer(p);
  for(let i=1;i<=3;i++){await shot(p,`parado${i}`,`parado ${i}/3`,vp);await sleep(120);}
  const seen=await p.evaluate(SAMPLE,[STAND_FRAMES,STAND_MAX_MS]).catch(()=>[]);
  let flips=0;for(let i=1;i<seen.length;i++)if(isWalk(seen[i])!==isWalk(seen[i-1]))flips++;
  const walks=seen.filter(isWalk).length,keys=[...new Set(seen)];
  tremor[`${vp.w}x${vp.h}`]={...tremor[`${vp.w}x${vp.h}`],samples:seen.length,walkSamples:walks,flips,keys};
  if(!seen.length)fails.push(`${vp.w}×${vp.h}: herói não encontrado (window.__perfScene.actor)`);
  else if(flips)fails.push(`${vp.w}×${vp.h}: herói parado trocou idle↔walk ${flips}× em ${seen.length} quadros (tremor; ${walks} de walk)`);
  else if(walks)fails.push(`${vp.w}×${vp.h}: herói parado com textura de walk (${walks}/${seen.length} quadros)`);
}
async function keyboardWalk(p,vp){
  for(const [dir,keys] of Object.entries(KEYS)){
    await clearOffer(p);
    for(const k of keys)await p.keyboard.down(k);
    await sleep(500);await shot(p,`tecla-${dir}-1`,`teclado ${dir} (1/2)`,vp);
    await sleep(250);await shot(p,`tecla-${dir}-2`,`teclado ${dir} (2/2)`,vp);
    for(const k of keys)await p.keyboard.up(k);
    await stopped(p,vp,dir);
  }
  await releaseAll(p);
}
/**
 * Right after letting go: STOP_FRAMES drawn frames AND at least STOP_MS (the room's corrections land 80–200 ms late; a
 * nudge after them walks the hero again). Walk → rest is one flip; more is the hero going back and forth (tremor).
 */
async function stopped(p,vp,label,list='stops'){
  const seen=await p.evaluate(([n,ms,min])=>new Promise(done=>{
    const seen=[],t0=performance.now();
    const step=()=>{const a=window.__perfScene?.actor;if(a)seen.push(String(a.texture?.key??''));const t=performance.now()-t0;if((seen.length<n||t<min)&&t<ms)requestAnimationFrame(step);else done(seen);};
    requestAnimationFrame(step);
  }),[STOP_FRAMES,STAND_MAX_MS,STOP_MS]).catch(()=>[]);
  let flips=0;for(let i=1;i<seen.length;i++)if(isWalk(seen[i])!==isWalk(seen[i-1]))flips++;
  const t=tremor[`${vp.w}x${vp.h}`]??={};(t[list]??=[]).push(flips);
  // b837b93's trembling stops flipped 3–5× (phone joystick); 2 is one late nudge (seen once on 20/10's main against a
  // wall): a warning, so the sheet does not fail every branch on it.
  const msg=`${vp.w}×${vp.h}: ao parar (${label}) o herói trocou idle↔walk ${flips}× em ${seen.length} quadros`;
  if(flips>STOP_FLIPS_FAIL)fails.push(`${msg} (tremor)`);else if(flips>1)avisos.push(`${msg} (um empurrão tardio)`);
}
/** The burst (BURST): short walks in open ground, each stop sampled; how many stops trembled goes on the sheet. */
async function burst(p,vp){
  for(const [dir,ms] of BURST){
    await clearOffer(p);
    for(const k of KEYS[dir])await p.keyboard.down(k);
    await sleep(ms);
    for(const k of KEYS[dir])await p.keyboard.up(k);
    await stopped(p,vp,`rajada ${dir} ${ms} ms`,'burst');
  }
  const b=tremor[`${vp.w}x${vp.h}`]?.burst??[];
  await shot(p,'rajada',`rajada: ${b.filter(f=>f>STOP_FLIPS_FAIL).length}/${b.length} paradas com tremor`,vp);
}
/** Moved: the hero's world spot is more than 6 px from where it was. */
const moved=(a,b)=>!!(a&&b)&&Math.hypot(a.x-b.x,a.y-b.y)>6;
/**
 * A press (a click, a tap) that walks the hero: tries CLICK_SPOTS around him, off the HUD, until one moves him in 900 ms
 * (a spot on a building has no way there: the scene says "Por aqui não dá" and he stays). The spot, or null and a fail.
 */
async function walkByPress(p,vp,press,label){
  // A free spot: the game's canvas is what the page would press there (scene.ts walks on the canvas's own presses only).
  const free=(x,y)=>p.evaluate(([x,y])=>document.elementFromPoint(x,y)===window.__perfScene?.game?.canvas,[x,y]).catch(()=>false);
  const tried=[];
  for(const [fx,fy] of CLICK_SPOTS){
    await clearOffer(p);
    const h=await p.evaluate(HERO).catch(()=>null);if(!h)break;
    const m=Math.min(vp.w,vp.h),x=Math.round((Number.isFinite(h.sx)?h.sx:vp.w/2)+fx*m),y=Math.round((Number.isFinite(h.sy)?h.sy:vp.h/2)+fy*m);
    if(x<20||y<20||x>vp.w-20||y>vp.h-20||!await free(x,y))continue;
    await press(x,y);
    // Back as soon as he walks (the caller prints him walking, not already arrived).
    let after=null;
    for(const end=Date.now()+900;Date.now()<end&&!moved(h,after);)after=await p.evaluate(HERO).catch(()=>null);
    if(moved(h,after))return {x,y,tried};
    const notice=await p.evaluate(NOTICE).catch(()=>'');
    tried.push(`(${x},${y}) ${/não dá/i.test(notice)?'sem caminho':'não andou'}`);
  }
  fails.push(`${vp.w}×${vp.h}: ${label}: nenhum ponto andou o herói (${tried.join(', ')||'nenhum ponto livre'})`);
  return null;
}
async function mouseWalk(p,vp){
  // A click on open ground (the 20/10 sheet clicked a fixed spot that fell on a building: "Por aqui não dá", no walk).
  const got=await walkByPress(p,vp,(x,y)=>p.mouse.click(x,y),'mouse');
  await shot(p,'mouse1',got?`mouse: clique em (${got.x},${got.y})${got.tried.length?`; antes ${got.tried.join(', ')}`:''} 1/3`:'mouse: clique (não andou)',vp);
  for(let i=2;i<=3;i++){await sleep(250);await shot(p,`mouse${i}`,`mouse: clique ${i}/3`,vp);}
  await sleep(1500);
  // Hold-to-follow: press the ground and sweep the cursor in a half circle around the hero; he follows while it is down.
  await clearOffer(p);
  const h=await p.evaluate(HERO).catch(()=>null);
  if(!h||!Number.isFinite(h.sx))return;
  const r=Math.min(vp.w,vp.h)*.28;
  await p.mouse.move(h.sx+r,h.sy);await p.mouse.down();
  for(let i=1;i<=10;i++){const a=i/10*Math.PI;await p.mouse.move(h.sx+Math.cos(a)*r,h.sy+Math.sin(a)*r*.6,{steps:2});await sleep(150);}
  await shot(p,'mouse-segura','mouse: segurando (o herói segue o cursor)',vp);
  const end=await p.evaluate(HERO).catch(()=>null);
  await p.mouse.up();
  if(!moved(h,end))fails.push(`${vp.w}×${vp.h}: mouse segurado não moveu o herói`);
  await sleep(1200);
}

async function match(browser,base){
  const ctx=await browser.newContext({viewport:{width:VIEWPORTS[0].w,height:VIEWPORTS[0].h},deviceScaleFactor:1});
  const p=await ctx.newPage();
  p.on('pageerror',e=>consoleErrors.push(`pageerror: ${String(e).slice(0,300)}`));
  p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,300));});
  try{
    await openMenu(p,base,'desktop');
    for(const vp of [...VIEWPORTS].reverse()){await p.setViewportSize({width:vp.w,height:vp.h});await sleep(600);await shot(p,'menu','menu (personagem)',vp);}
    if(!await enterMatch(p,VIEWPORTS[0],'desktop'))return;
    for(const vp of VIEWPORTS){
      await p.setViewportSize({width:vp.w,height:vp.h});await sleep(800);
      // The mouse first: the match starts against a wall, where the keys walk into it and no correction ever lands.
      for(const stage of [standing,mouseWalk,keyboardWalk,burst])await stage(p,vp);
    }
  }finally{await ctx.close().catch(()=>{});}
}
/** The menu of the built site with the room's latency and the perf scene (the meter's panel hidden). */
async function openMenu(p,base,label){
  matchPages.set(p,{base,label,left:2});
  await p.addInitScript(LATENCY);
  await p.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.perf-hud{display:none!important}';document.head.append(s);});});
  await p.goto(`${base}/?perf=1`,{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
}
/** Character → island: true once the solo match runs (false and a fail when it did not start in 180 s). */
async function enterMatch(p,vp,label){
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Folha';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  if(!await until(p,()=>window.__partidaPronta===true&&!!window.__perfScene?.actor,180000)){fails.push(`${label}: a partida solo não começou em 180 s`);await shot(p,'sem-partida',`sem partida (${label})`,vp);return false;}
  // The own walk clips load after the match starts (P0 since preload-heroi-primeiro): give them a moment.
  await sleep(3000);return true;
}
/** A finger on the joystick (CDP touch events: Playwright only taps), dragged toward (dx,dy) and held ms; during() runs held. */
async function stickDrag(p,cdp,dx,dy,ms,during){
  const r=await p.evaluate(()=>{const b=document.querySelector('.explore-stick')?.getBoundingClientRect();return b&&b.width?{x:b.left+b.width/2,y:b.top+b.height/2,w:b.width}:null;});
  if(!r)return false;
  const at=f=>[{x:r.x+dx*r.w*.4*f,y:r.y+dy*r.w*.4*f,id:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:at(0)});
  for(let i=1;i<=4;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:at(i/4)});await sleep(30);}
  const end=Date.now()+ms;await during?.();await sleep(Math.max(0,end-Date.now()));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  return true;
}
/** The phone (D-009: the game is mobile): a touch context and a match of its own; the stick by a finger, then a tap. */
async function phone(browser,base){
  const vp={w:390,h:844},tag={w:'celular-390',h:844};
  const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const p=await ctx.newPage();
  p.on('pageerror',e=>consoleErrors.push(`celular: pageerror: ${String(e).slice(0,300)}`));
  try{
    await openMenu(p,base,'celular');
    if(!await enterMatch(p,vp,'celular'))return;
    await standing(p,tag);
    const cdp=await ctx.newCDPSession(p);
    for(const [dir,dx,dy] of [['NE',.71,-.71],['SE',.71,.71],['SW',-.71,.71],['NW',-.71,-.71],['N',0,-1],['E',1,0],['S',0,1],['W',-1,0]]){
      await clearOffer(p);
      const ok=await stickDrag(p,cdp,dx,dy,900,async()=>{await sleep(600);await shot(p,`cel-stick-${dir}`,`celular: joystick ${dir}`,vp);});
      if(!ok){fails.push('celular: joystick (.explore-stick) não está na tela');break;}
      await stopped(p,tag,`joystick ${dir}`);
    }
    const got=await walkByPress(p,vp,(x,y)=>p.touchscreen.tap(x,y),'celular: toque');
    await shot(p,'cel-toque',got?`celular: toque em (${got.x},${got.y}) 1/2`:'celular: toque (não andou)',vp);
    await sleep(400);await shot(p,'cel-toque2','celular: toque 2/2',vp);
  }finally{await ctx.close().catch(()=>{});}
}

async function fotos(browser,base){
  for(const vp of VIEWPORTS){
    const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},deviceScaleFactor:1});
    try{
      for(const [cena,extra,caption] of FOTOS){
        const p=await ctx.newPage();
        p.on('pageerror',e=>consoleErrors.push(`${cena}: pageerror: ${String(e).slice(0,300)}`));
        try{
          await p.goto(`${base}/?foto=${cena}${extra}`,{waitUntil:'load',timeout:90000});
          const ok=await until(p,()=>window.__fotoPronta===true||!!window.__fotoErro,90000);
          const erro=await p.evaluate(()=>window.__fotoErro??'').catch(()=>'');
          // A slow scene (swiftshader: "não desenhou em 30 s") still prints what it drew: a warning, not a failure.
          if(!ok||erro)avisos.push(`foto ${cena} ${vp.w}×${vp.h}: ${erro||'não ficou pronta em 90 s'}`);
          await shot(p,`foto-${cena}`,caption,vp);
        }finally{await p.close().catch(()=>{});}
      }
    }finally{await ctx.close().catch(()=>{});}
  }
}

/** Every frame on one PNG: a grid of captioned cells, laid out and printed by the same browser. */
async function sheet(browser,file){
  const cells=frames.filter(f=>existsSync(join(outDir,f.file))).map(f=>{
    const src=`data:image/jpeg;base64,${readFileSync(join(outDir,f.file)).toString('base64')}`;
    const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    return `<figure><img src="${src}"><figcaption>${esc(f.caption)}${f.hero?` <small>${esc(f.hero.key)}#${esc(f.hero.frame)}</small>`:''}</figcaption></figure>`;
  }).join('');
  const head=`folha ${sha} · ${fails.length?`FALHOU: ${fails.join(' | ')}`:'ok'}`,ab=aberturaLine();
  const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:13px system-ui}h1{font-size:15px;margin:8px;color:${fails.length?'#f66':'#6f6'}}
main{display:flex;flex-wrap:wrap;gap:6px;padding:6px}figure{margin:0;width:320px}img{width:320px;height:240px;object-fit:contain;background:#000;display:block}
figcaption{padding:2px 0}small{color:#999;word-break:break-all}h2{font-size:14px;margin:0 8px 6px;color:${abertura?.ok===false?'#f66':'#9cf'}}</style><h1>${head.replace(/[&<>]/g,'')}</h1>${ab?`<h2>${ab.replace(/[&<>]/g,'')}</h2>`:''}<main>${cells}</main>`;
  const ctx=await browser.newContext({viewport:{width:1662,height:600},deviceScaleFactor:1});
  try{const p=await ctx.newPage();await p.setContent(html,{waitUntil:'load',timeout:60000});await p.screenshot({path:file,fullPage:true,timeout:60000});}
  finally{await ctx.close().catch(()=>{});}
}

let worker,preview,code=0,original;
const mpFile=join(dist,'multiplayer.json');
const restore=()=>{if(original!==undefined){try{writeFileSync(mpFile,original);}catch{}original=undefined;}};
process.on('exit',restore);
mkdirSync(outDir,{recursive:true});
try{abertura=JSON.parse(readFileSync(join(outDir,'abertura.json'),'utf8'));}catch{}
if(abertura){frames.push(...(abertura.frames??[]));fails.push(...(abertura.fails??[]));avisos.push(...(abertura.avisos??[]));}
try{
  if(!existsSync(mpFile))throw new Infra(`${mpFile} não existe: rode npm run build antes`);
  const {chromium}=await playwright();
  const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts','local-worker.mjs')).href);
  const workerPort=await listen(0),port=await previewPort();
  worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-folha-worker-${workerPort}.log`)});
  original=readFileSync(mpFile,'utf8');
  writeFileSync(mpFile,JSON.stringify({...JSON.parse(original),endpoint:`http://127.0.0.1:${workerPort}`}));
  preview=await startPreview(port);
  let browser;
  try{browser=await chromium.launch();}catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  try{
    await match(browser,preview.url);
    await phone(browser,preview.url);
    await fotos(browser,preview.url);
    if(consoleErrors.some(e=>e.startsWith('pageerror')||/: pageerror/.test(e)))fails.push('pageerror no console (ver folha.json)');
    await sheet(browser,join(outDir,`folha-${sha}.png`));
  }finally{await browser.close().catch(()=>{});}
  code=fails.length?1:0;
}catch(e){
  if(!(e instanceof Infra)&&!/não subiu|ocupada|Porta|wrangler|health/i.test(String(e)))fails.push(`erro: ${String(e).split('\n')[0]}`);
  console.log(`folha: INFRA · ${String(e.message??e).split('\n')[0]}`);code=e instanceof Infra?2:1;
}finally{
  restore();preview?.stop();await Promise.resolve(worker?.stop()).catch(()=>{});
}
const result={sha,ok:code===0,infra:code===2,fails,avisos,consoleErrors:consoleErrors.slice(0,50),tremor,frames,
  abertura:abertura&&{ok:abertura.ok,linha:aberturaLine(),mediana:abertura.mediana,piora:abertura.piora,desvio:abertura.desvio,baseSha:abertura.baseSha}};
writeFileSync(join(outDir,'folha.json'),JSON.stringify(result,null,1));
const line=`folha ${sha}: ${code===0?'ok':code===2?'INFRA':'FALHOU'}${fails.length?` · ${fails.join(' | ')}`:''}`;
console.log(line);
if(process.env.GITHUB_STEP_SUMMARY){
  try{appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Folha de prints ${sha}: ${code===0?'ok':code===2?'INFRA':'**FALHOU**'}\n\n${fails.map(f=>`- ${f}`).join('\n')||'- sem falhas'}${avisos.map(a=>`\n- aviso: ${a}`).join('')}\n\nTremor (parado; trocas idle↔walk em cada parada e na rajada): \`${JSON.stringify(Object.fromEntries(Object.entries(tremor).map(([k,v])=>[k,{flips:v.flips,walk:v.walkSamples,n:v.samples,paradas:v.stops,rajada:v.burst}])))}\`\n\n${abertura?`${aberturaLine()}\n\n`:''}Artefato: \`folha-${sha}\` (folha-${sha}.png + folha.json + quadros).\n`);}catch{}
}
process.exit(code);
