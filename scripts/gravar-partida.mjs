// GIF and prints of a solo match (NEW-20261025-ORQ-cicd-gif-prints): what a player sees, recorded by a headless Chromium,
// on GitHub Actions (.github/workflows/prints.yml) or on the PC. Nothing here publishes anything: it only reads a build.
//   1. the built dist/ under `vite preview` and a local rooms Worker (scripts/local-worker.mjs), like scripts/smoke-prod.mjs;
//      or, with --url, a live site as it is (the print after each deploy: --url https://viagem.cyou --build <sha12>);
//   2. menu → hero → "SELECIONAR" → name → "BORA!" → "Jogar sozinho", until the scene signals the match
//      (window.__partidaPronta, scene.ts);
//   3. a roteiro (ROTEIROS: parado, andando, uno) for --segundos, while frames are taken for the GIF; PNGs at the start,
//      the middle and the end at the screen's real density; quadros.png, 8 frames of the GIF side by side with their
//      second (what an executor reads: Read shows a GIF's first frame only); every pageerror and console error in erros.txt.
//      The snow changes the whole frame, so the GIF runs ~0.5 MB/s even lossy (interFrameMaxError).
// node scripts/gravar-partida.mjs <outDir> [--roteiro parado|andando|uno|empurra|todos] [--tela celular|pc|ambas] [--segundos 20]
//      [--fps 5] [--modo normal|chaveiro] [--dist dist] [--url <site> [--build <sha12>] [--esperar-build 12]]
//      [--sem-gif] [--zero-erros] [--com-dicas] [--sem-escolha]
// Writes <outDir>/<roteiro>-<tela>/{partida.gif,quadros.png,inicio.png,meio.png,fim.png,erros.txt} and <outDir>/resumo.{md,json}
// (≤ 10 lines). The coach's hints and the economy question start as already seen (as the ORQ's prod prints did), so
// the match is in view; --com-dicas keeps them. A level-up offer that opens during the roteiro gets its first card
// (the match pauses on it: the walk would stop under the cards); --sem-escolha leaves it open to record it. Exit 0 ok; 1 the game failed (no entry, a pageerror; with --zero-erros any console error; the site not
// on --build); 2 infrastructure (no dist, no Playwright, no port, the Worker or the browser did not start).
// Playwright is not a dependency of the repo: `import('playwright')`, else PLAYWRIGHT_MODULE, else D:/Gits/viagem-tools.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

/** The screens: the phone (the game's main target) and the PC's usual window (smoke-prod, tools/foto.mjs). */
export const TELAS=Object.freeze({
  celular:{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,gifWidth:270,sheetCols:8,
    userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'},
  pc:{viewport:{width:1335,height:620},deviceScaleFactor:1,isMobile:false,hasTouch:false,gifWidth:480,sheetCols:4},
});
export const MODOS=Object.freeze({normal:'',chaveiro:'?modo=chaveiro'});
/** Eight directions on screen (+x right, +y down), the stick's and the keys' frame (desktop-input.ts keyVector). */
const D=Object.freeze({n:{x:0,y:-1},ne:{x:1,y:-1},l:{x:1,y:0},se:{x:1,y:1},s:{x:0,y:1},so:{x:-1,y:1},o:{x:-1,y:0},no:{x:-1,y:-1}});
/**
 * The roteiros: steps {dir (undefined: still), ms} that fill `segundos`.
 *  - parado: the hero still where the team spawns (beside the Uno, inicio-no-uno);
 *  - andando: a lap through the eight directions, the walk and its turns;
 *  - uno: short steps out and back around the spawn; when the Uno's edge arrow shows (the stick's steps do not cancel
 *    out exactly), the next step walks toward it, so the hero stays beside the Uno the whole time;
 *  - empurra (card heroi-empurra-inimigos): waits (out of the GIF, up to EMPURRA_WAIT_MS) for awake solid bodies near
 *    the hero (the 1st wave), then walks into the nearest one, one second at a time, without attacking: the hero pushes
 *    the crowd (solid bodies) and the GIF shows whether the phone's prediction shakes. Not in "todos" (it waits minutes).
 */
export const ROTEIROS=Object.freeze({
  parado:s=>[{ms:s*1000}],
  andando:s=>{const each=Math.round(s*1000/8);return ['n','ne','l','se','s','so','o','no'].map(k=>({dir:D[k],ms:each}));},
  uno:s=>{
    const loop=[{dir:D.l,ms:700},{ms:800},{dir:D.o,ms:700},{ms:800},{dir:D.n,ms:600},{ms:600},{dir:D.s,ms:600},{ms:800}];
    const out=[];let left=s*1000;
    for(let i=0;left>0;i++){const st=loop[i%loop.length],ms=Math.min(st.ms,left);out.push({...st,ms});left-=ms;}
    return out;
  },
  empurra:s=>{const out=[];for(let left=s*1000;left>0;left-=1000)out.push({dir:D.l,ms:Math.min(1000,left)});return out;},
});
/** empurra: how long to wait for the 1st wave's bodies (the minuto de Minerva 120 s + the first wave's 30–60 s). */
export const EMPURRA_WAIT_MS=300000;
/** The roteiros "todos" records (empurra waits minutes for a wave: only by name). */
export const TODOS=Object.freeze(['parado','andando','uno']);
/** The keys of a direction (MOVE_KEYS in desktop-input.ts): any vector, snapped to the eight the keys can make. */
export const keysOf=dir=>{
  if(!dir)return [];
  const len=Math.hypot(dir.x,dir.y)||1,x=dir.x/len,y=dir.y/len,cut=Math.sin(Math.PI/8);
  return [...y<-cut?['KeyW']:y>cut?['KeyS']:[],...x>cut?['KeyD']:x<-cut?['KeyA']:[]];
};
/** From the screen's center toward a point (the Uno's edge arrow), unit length; undefined at the center. */
export const toward=(from,to)=>{const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);return len>1?{x:dx/len,y:dy/len}:undefined;};

const VALUE_FLAGS=new Set(['roteiro','tela','segundos','fps','modo','dist','url','build','esperar-build']);
/** argv → options (validated); throws on a bad value. */
export function parseOpts(argv){
  const flags={},pos=[];
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')){pos.push(a);continue;}
    const name=a.slice(2);
    if(VALUE_FLAGS.has(name)){flags[name]=argv[++i];if(flags[name]===undefined)throw new Error(`--${name} sem valor`);}
    else flags[name]=true;
  }
  const list=(v,all,what)=>{const out=v==='todos'?[...TODOS]:v==='ambas'?Object.keys(all):String(v).split(',');for(const x of out)if(!(x in all))throw new Error(`${what} desconhecido: ${x} (${Object.keys(all).join(', ')})`);return out;};
  const num=(v,def,min,max,what)=>{const n=v===undefined?def:Number(v);if(!(Number.isFinite(n)&&n>=min&&n<=max))throw new Error(`--${what}: ${min} a ${max}, veio ${v}`);return n;};
  if(flags.modo!==undefined&&!(flags.modo in MODOS))throw new Error(`modo desconhecido: ${flags.modo}`);
  if(flags.url!==undefined&&!/^https?:\/\/[^/]+/.test(flags.url))throw new Error(`--url inválida: ${flags.url}`);
  if(flags.build!==undefined&&!/^[0-9a-f]{7,40}$/.test(flags.build))throw new Error(`--build: um sha, veio ${flags.build}`);
  return {out:pos[0],roteiros:list(flags.roteiro??'parado',ROTEIROS,'roteiro'),telas:list(flags.tela??'celular',TELAS,'tela'),
    segundos:num(flags.segundos,20,3,120,'segundos'),fps:num(flags.fps,5,1,15,'fps'),modo:flags.modo??'normal',dist:resolve(flags.dist??'dist'),
    url:flags.url?.replace(/\/+$/,''),build:flags.build,esperarBuild:num(flags['esperar-build'],12,0,30,'esperar-build'),
    gif:!flags['sem-gif'],zeroErros:!!flags['zero-erros'],dicas:!!flags['com-dicas'],escolher:!flags['sem-escolha']};
}

/** The screencast's frames (it sends one per change, as fast as the page paints) kept at least 1000/fps ms apart. */
export function pickFrames(frames,fps){
  const out=[],gap=1000/fps-1;
  for(const f of frames)if(!out.length||f.t-out.at(-1).t>=gap)out.push(f);
  return out;
}
/** Per-frame GIF delays (ms) from the capture times: the real pace, so the GIF plays at the match's speed. */
export function gifDelays(times){
  if(times.length<2)return times.map(()=>200);
  const gaps=times.slice(1).map((t,i)=>Math.min(5000,Math.max(20,Math.round(t-times[i]))));
  const sorted=[...gaps].sort((a,b)=>a-b);
  return [...gaps,sorted[Math.floor(sorted.length/2)]];
}

/** Which frames go in quadros.png: `n` spread evenly over `total`, first and last included. */
export function sheetFrames(total,n=8){
  if(total<=n)return Array.from({length:total},(_,i)=>i);
  return Array.from({length:n},(_,i)=>Math.round(i*(total-1)/(n-1)));
}

/** One line per recording, at most 10 (the run's summary and the board line). */
export function resumoLinhas(results,{origem=''}={}){
  const lines=results.map(r=>{
    const what=`${r.roteiro} ${r.tela}${r.modo!=='normal'?` ${r.modo}`:''}`;
    if(r.falha)return `❌ ${what}: ${r.falha}`;
    const fps=r.quadros>1?(r.quadros/(r.duracaoMs/1000)).toFixed(1):'0';
    const err=r.erros.length?` · ${r.erros.length} erro(s): ${r.erros[0].slice(0,90)}`:' · 0 erros';
    return `${r.erros.length?'⚠️':'✅'} ${what}: entrou em ${(r.entrouMs/1000).toFixed(0)} s${r.quadros?` · ${r.quadros} quadros (${fps}/s)`:''}${r.fpsJogo?` · jogo a ${r.fpsJogo} fps`:''}${r.gifKB?` · gif ${r.gifKB} KB`:''}${r.escolhas?` · ${r.escolhas} carta(s) escolhida(s)`:''}${err}`;
  });
  const head=origem?[`Partida solo em ${origem}`]:[];
  const all=[...head,...lines];
  return all.length<=10?all:[...all.slice(0,9),`… e mais ${all.length-9}`];
}

// ----------------------------------------------------------------------------------------------------------------------
// The recording (only when run as a script)
// ----------------------------------------------------------------------------------------------------------------------

/** A failure of the machine, not of the game: exit 2. */
class Infra extends Error {}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CLOSE_MS=15000,within=pr=>Promise.race([pr.catch(()=>{}),sleep(CLOSE_MS)]);
/** Entering the match, from the page load: CI's software GL takes ~1 min; past this it did not enter. */
const ENTER_MS=180000;
const listen=port=>new Promise(ok=>{const s=createServer();s.once('error',()=>ok(0));s.listen(port,'127.0.0.1',()=>{const got=s.address().port;s.close(()=>ok(got));});});
/**
 * The preview's port: the rooms Worker accepts local origins only on the executors' vite ports (multiplayer/origins.ts:
 * 4200–4399); GRAVAR_PORT or the first free one from 4379 down (smoke-prod takes 4380–4399).
 */
async function previewPort(){
  for(const port of [Number(process.env.GRAVAR_PORT)||0,...Array.from({length:20},(_,i)=>4379-i)])if(port&&await listen(port))return port;
  throw new Infra('nenhuma porta livre em 4360–4379 para o preview (GRAVAR_PORT)');
}
async function playwright(){
  for(const spec of ['playwright',process.env.PLAYWRIGHT_MODULE,'D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Infra('Playwright não encontrado: npm install --no-save playwright@1.63.0 (ou PLAYWRIGHT_MODULE)');
}
async function startPreview(dist,port){
  const posix=process.platform!=='win32';
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir',dist],
    {windowsHide:true,shell:false,detached:posix,stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`,want=readFileSync(join(dist,'version.json'),'utf8').trim();
  const stop=()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}};
  let up=false,exited=false;child.once('exit',()=>{exited=true;});
  for(let i=0;i<120&&!up&&!exited;i++){try{const r=await fetch(`${url}/version.json`,{cache:'no-store'});up=r.ok&&(await r.text()).trim()===want;}catch{}if(!up)await sleep(250);}
  if(!up){stop();throw new Infra(`vite preview não subiu em ${url}${exited?' (porta tomada?)':''}`);}
  return {url,stop};
}
// SMOKE_SWIFTSHADER=1 renders on the CPU (smoke-prod); on Windows the PC's GPU; elsewhere (CI) the default software GL.
const launchArgs=()=>process.env.SMOKE_SWIFTSHADER==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']
  :process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[];

/** Two build ids of one commit (version.json keeps 12 hex digits; a sha may be longer or shorter). */
export const sameBuild=(a,b)=>!!a&&!!b&&(a.startsWith(b)||b.startsWith(a));
/** The live site's build (version.json), waited for up to `minutes` when it is not `want` yet (the Pages CDN caches 10 min). */
async function waitBuild(url,want,minutes){
  const end=Date.now()+minutes*60000;let got='';
  for(;;){
    try{got=JSON.parse(await (await fetch(`${url}/version.json?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(15000)})).text()).build??'';}catch{got='';}
    if(sameBuild(got,want))return got;
    if(Date.now()>end)return got;
    console.log(`  o site ainda está no build ${got||'?'} (quero ${want}); tento de novo em 30 s`);
    await sleep(30000);
  }
}

/** menu → hero → SELECIONAR → name → BORA! → Jogar sozinho → the match (scene.ts window.__partidaPronta). ms to enter. */
async function entrar(p,base,modo){
  const t0=Date.now();
  await p.goto(`${base}/${MODOS[modo]}`,{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
  // #confirm says SELECIONAR (locks the hero), then BORA! (the name step, menu-etapa.ts); the dialog opens on the second.
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Gravador';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  for(;;){
    const st=await p.evaluate(()=>{
      const drawn=sel=>!!document.querySelector(sel)?.getBoundingClientRect().width;
      // A build older than the signal: the match HUD on screen (smoke-prod's fallback).
      const old=window.__partidaPronta===undefined&&(drawn('.rh-mm-canvas')||drawn('.ch-minimap')||/\bRound \d+\/\d+/.test(document.body.innerText));
      const loading=document.querySelector('.explore-loading')?.textContent?.trim()||'';
      return {entered:window.__partidaPronta===true||old,said:document.getElementById('explore-error')?.textContent||(/Não foi possível|não baixou/i.test(loading)?loading:'')};
    }).catch(()=>({entered:false,said:''}));
    if(st.entered)return Date.now()-t0;
    if(st.said)throw new Error(`não entrou: "${st.said.trim().slice(0,120)}"`);
    if(Date.now()-t0>ENTER_MS)throw new Error(`não entrou em ${ENTER_MS/1000} s`);
    await sleep(1000);
  }
}

/** Moves the hero: the stick by touch on the phone (CDP touch: pointerType touch keeps the phone's HUD), keys on the PC. */
async function mover(p,cdp,tela,dir,ms){
  if(!dir){await sleep(ms);return;}
  const stick=TELAS[tela].hasTouch?await p.evaluate(()=>{const r=document.querySelector('.explore-stick')?.getBoundingClientRect();return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2,r:r.width/2}:null;}).catch(()=>null):null;
  if(stick&&cdp){
    const len=Math.hypot(dir.x,dir.y),at=f=>[{x:stick.x+dir.x/len*stick.r*f,y:stick.y+dir.y/len*stick.r*f,id:1}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:at(0)});
    for(const f of [.3,.6,.9])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:at(f)});
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    return;
  }
  const keys=keysOf(dir);
  for(const k of keys)await p.keyboard.down(k);
  await sleep(ms);
  for(const k of keys)await p.keyboard.up(k);
}

/**
 * The level-up offer's first card, picked like a player does: offer.ts counts a click only when its pointerdown hit the
 * same card, so a real tap on the phone (a mouse event there would switch the HUD to the mouse's and hide the stick)
 * and a real click on the PC. True when a card was picked.
 */
async function escolher(p,tela){
  const box=await p.evaluate(()=>{const b=document.querySelector('.rh-offer-cards .rh-card:not([disabled])'),r=b?.getBoundingClientRect();return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null;}).catch(()=>null);
  if(!box)return false;
  if(TELAS[tela].hasTouch)await p.touchscreen.tap(box.x,box.y).catch(()=>{});
  else await p.mouse.click(box.x,box.y).catch(()=>{});
  await sleep(400);
  return true;
}

/** One roteiro on one screen, in a fresh browser: the result for the summary (falha set when it failed). */
async function gravar(chromium,base,o,roteiro,tela,dir){
  const t=TELAS[tela],r={roteiro,tela,modo:o.modo,erros:[],quadros:0,duracaoMs:0,entrouMs:0,gifKB:0,escolhas:0,voltas:0,fpsJogo:0,falha:''};
  mkdirSync(dir,{recursive:true});
  let browser;
  try{browser=await chromium.launch({args:launchArgs()});}
  catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  try{
    const ctx=await browser.newContext({viewport:t.viewport,deviceScaleFactor:t.deviceScaleFactor,isMobile:t.isMobile,hasTouch:t.hasTouch,...t.userAgent?{userAgent:t.userAgent}:{}});
    // ui/tela-cheia.ts TELA_CHEIA_KEY 'off' (the player turned full screen off): a touch screen asks for it on BORA!, and
    // a headless browser's full screen is its bare 800x600 window, which the screencast then records instead of the phone.
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:tela-cheia:v1','off');}catch{}});
    // economy.ts ECONOMY_KEY (the question answered "no"), hud/coach.ts COACH_KEY (the first hints seen).
    if(!o.dicas)await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
    // empurra: the scene is only on window in a build with the perf switch (scene.ts __perfScene); its meter stays hidden.
    if(roteiro==='empurra')await ctx.addInitScript(()=>{try{sessionStorage.setItem('viagem:perf','1');}catch{}
      document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.perf-hud{display:none!important}';document.head.append(s);});});
    const p=await ctx.newPage();
    p.on('pageerror',e=>r.erros.push(`pageerror: ${String(e).slice(0,300)}`));
    p.on('console',m=>{if(m.type()==='error')r.erros.push(`console: ${m.text().slice(0,300)}`);});
    const cdp=await ctx.newCDPSession(p).catch(()=>undefined);
    try{r.entrouMs=await entrar(p,base,o.modo);}
    catch(e){r.falha=String(e.message??e).split('\n')[0];await p.screenshot({path:join(dir,'falha.png'),timeout:30000}).catch(()=>{});return r;}
    // The world drawn: the run's HUD comes first, over "Arrumando a ilha pra visita…" (.explore-loading) for a few
    // seconds more on a phone; then the camera's first second out of the GIF.
    await p.waitForFunction(()=>{const l=document.querySelector('.explore-loading');return !l||l.closest('[hidden]')||!l.getBoundingClientRect().width;},null,{timeout:60000}).catch(()=>{});
    await sleep(1500);
    // empurra: the 1st wave's solid bodies near the hero (the phone's copies, client.ts bodies), before the GIF starts.
    const nearest=()=>p.evaluate(()=>{const s=window.__perfScene??window.__island?.scene,n=s?.hooks?.net,me=n?.predicted;if(!me)return null;let best=null,bd=Infinity,count=0;
      for(const b of n.bodies??[]){const d=Math.hypot(b.x-me.x,b.y-me.y);if(d<10)count++;if(d<bd){bd=d;best=b;}}
      if(!best)return null;const a=s.project(me),c=s.project(best);return {d:bd,count,dir:{x:c.x-a.x,y:c.y-a.y}};}).catch(()=>null);
    if(roteiro==='empurra'){
      const until=Date.now()+EMPURRA_WAIT_MS;
      for(;;){if(o.escolher)await escolher(p,tela);const n=await nearest();if(n&&n.d<12&&n.count>=2)break;if(Date.now()>until){r.falha=`nenhuma onda perto do herói (${JSON.stringify(n)})`;await p.screenshot({path:join(dir,'falha.png'),timeout:30000}).catch(()=>{});return r;}await sleep(2000);}
    }
    await p.screenshot({path:join(dir,'inicio.png'),timeout:30000}).catch(()=>{});
    // The GIF's frames from the compositor's screencast (CDP), not page.screenshot: on CI's software GL a screenshot
    // reads the frame back and holds the page ~3 s (0.2 frames/s, and a 12 s roteiro took 65 s). Only kept --fps apart.
    const all=[],start=Date.now();
    const onFrame=f=>{all.push({t:f.metadata.timestamp*1000,buf:Buffer.from(f.data,'base64')});cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});};
    if(o.gif&&cdp){cdp.on('Page.screencastFrame',onFrame);await cdp.send('Page.startScreencast',{format:'jpeg',quality:75,maxWidth:t.gifWidth,maxHeight:Math.ceil(t.viewport.height*t.gifWidth/t.viewport.width),everyNthFrame:1}).catch(()=>{});}
    // The game's own pace (requestAnimationFrame), for the summary: CI has no GPU.
    await p.evaluate(()=>{const w=window;w.__gravarRaf={n:0,t0:performance.now()};const tick=()=>{w.__gravarRaf.n++;requestAnimationFrame(tick);};requestAnimationFrame(tick);}).catch(()=>{});
    const steps=ROTEIROS[roteiro](o.segundos);let midShot=false,elapsed=0;
    for(const st of steps){
      if(o.escolher&&await escolher(p,tela))r.escolhas++;
      let go=st.dir;
      if(roteiro==='uno'){
        // hud/edges.ts: the Uno's arrow is kind 'uno' (taking hits) or 'base' (the mission points at it).
        const arrow=await p.evaluate(()=>{const a=document.querySelector('.rh-edge:not([hidden])[data-kind="uno"]')??document.querySelector('.rh-edge:not([hidden])[data-kind="base"]'),b=a?.getBoundingClientRect();return b&&b.width?{x:b.left+b.width/2,y:b.top+b.height/2}:null;}).catch(()=>null);
        if(arrow){go=toward({x:t.viewport.width/2,y:t.viewport.height/2},arrow);r.voltas++;}
      }
      if(roteiro==='empurra'){const n=await nearest();if(n&&Math.hypot(n.dir.x,n.dir.y)>1){go=n.dir;r.voltas++;}}
      await mover(p,cdp,tela,go,st.ms);elapsed+=st.ms;
      if(!midShot&&elapsed>=o.segundos*500){midShot=true;await p.screenshot({path:join(dir,'meio.png'),timeout:30000}).catch(()=>{});}
    }
    r.fpsJogo=await p.evaluate(()=>{const g=window.__gravarRaf;return g?Math.round(g.n/((performance.now()-g.t0)/1000)):0;}).catch(()=>0);
    if(cdp&&o.gif){await cdp.send('Page.stopScreencast').catch(()=>{});cdp.off('Page.screencastFrame',onFrame);}
    const frames=pickFrames(all,o.fps);
    r.duracaoMs=Date.now()-start;r.quadros=frames.length;
    await p.screenshot({path:join(dir,'fim.png'),timeout:30000}).catch(()=>{});
    if(o.gif&&frames.length){
      // The game checkout's sharp (a devDependency): on CI this script runs from a sparse checkout without node_modules.
      const sharp=createRequire(join(process.cwd(),'package.json'))('sharp');
      const w=t.gifWidth,small=await Promise.all(frames.map(f=>sharp(f.buf).resize({width:w}).png().toBuffer()));
      const gif=await sharp(small,{join:{animated:true}}).gif({delay:gifDelays(frames.map(f=>f.t)),loop:0,colours:96,effort:4,interFrameMaxError:8,interPaletteMaxError:3}).toBuffer();
      writeFileSync(join(dir,'partida.gif'),gif);r.gifKB=Math.round(gif.length/1024);
      const pick=sheetFrames(frames.length),h=Math.round(t.viewport.height*w/t.viewport.width),cols=Math.min(t.sheetCols,pick.length),rows=Math.ceil(pick.length/cols);
      const label=s=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26"><rect width="64" height="26" fill="#000" fill-opacity=".6"/><text x="6" y="19" font-family="sans-serif" font-size="16" fill="#fff">${s}</text></svg>`);
      await sharp({create:{width:cols*w,height:rows*h,channels:3,background:'#000'}})
        .composite(pick.flatMap((i,k)=>[{input:small[i],left:(k%cols)*w,top:Math.floor(k/cols)*h},{input:label(`${((frames[i].t-frames[0].t)/1000).toFixed(1)} s`),left:(k%cols)*w,top:Math.floor(k/cols)*h}]))
        .png().toFile(join(dir,'quadros.png'));
    }
    return r;
  }finally{
    writeFileSync(join(dir,'erros.txt'),r.erros.length?r.erros.join('\n')+'\n':'(nenhum)\n');
    await within(browser.close());
  }
}

/** dist/multiplayer.json pointed at the local Worker for the run, restored on every way out (never ship 127.0.0.1). */
let saved;
const restore=()=>{if(saved){try{writeFileSync(saved.file,saved.text);}catch{}saved=undefined;}};

async function main(argv){
  let o;
  try{o=parseOpts(argv);}catch(e){console.error(e.message);return 2;}
  if(!o.out){console.error('uso: node scripts/gravar-partida.mjs <pasta> [--roteiro parado|andando|uno|todos] [--tela celular|pc|ambas] [--segundos 30] [--url <site> --build <sha>]');return 2;}
  mkdirSync(o.out,{recursive:true});
  let preview,worker,release,code=0;const results=[];
  process.on('exit',restore);
  for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.prependListener(sig,()=>{restore();preview?.stop();if(!worker)process.exit(130);});
  try{
    let base=o.url;
    if(o.url&&o.build){
      const got=await waitBuild(o.url,o.build,o.esperarBuild);
      if(!sameBuild(got,o.build)){
        results.push({roteiro:o.roteiros[0],tela:o.telas[0],modo:o.modo,erros:[],falha:`o site está no build ${got||'?'}, não no ${o.build}`});
        code=1;
      }
    }
    if(!code){
      const {chromium}=await playwright();
      // On the PC one of the 2 headless browser slots (ESCALA.md, tools/vaga.mjs) for the whole run; CI has none.
      const locks=join(process.env.VIAGEM_BOARD??'D:/Gits/viagem-board','locks');
      if(!process.env.CI&&existsSync(locks)){
        const {claimSlot}=await import(new URL('../tools/vaga.mjs',import.meta.url).href);
        console.log('  esperando uma vaga de navegador (locks/browser-1|2)…');
        release=await claimSlot({locks,prefix:'browser',count:2,label:`gravar-partida ${o.roteiros.join(',')} ${o.telas.join(',')}`});
      }
      if(!o.url){
        if(!existsSync(join(o.dist,'multiplayer.json')))throw new Infra(`${join(o.dist,'multiplayer.json')} não existe: rode npm run build antes`);
        const {startLocalWorker}=await import('./local-worker.mjs');
        const workerPort=await listen(0),port=await previewPort();
        worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-gravar-worker-${workerPort}.log`)});
        const file=join(o.dist,'multiplayer.json');saved={file,text:readFileSync(file,'utf8')};
        writeFileSync(file,JSON.stringify({...JSON.parse(saved.text),endpoint:worker.endpoint}));
        preview=await startPreview(o.dist,port);base=preview.url;
      }
      for(const tela of o.telas)for(const roteiro of o.roteiros){
        const r=await gravar(chromium,base,o,roteiro,tela,join(o.out,`${roteiro}-${tela}`));
        results.push(r);
        const pageErr=r.erros.some(e=>e.startsWith('pageerror'));
        if(r.falha||pageErr||(o.zeroErros&&r.erros.length))code=1;
        console.log(resumoLinhas([r])[0]);
      }
    }
  }catch(e){
    if(!(e instanceof Infra)&&!/não subiu|Porta|wrangler|health/i.test(String(e)))throw e;
    console.log(`gravar: INFRA · ${String(e.message??e).split('\n')[0]}`);code=2;
    results.push({roteiro:o.roteiros[0],tela:o.telas[0],modo:o.modo,erros:[],falha:`infra: ${String(e.message??e).split('\n')[0]}`});
  }finally{
    restore();preview?.stop();await worker?.stop();release?.();
  }
  const lines=resumoLinhas(results,{origem:o.url?o.url+(o.build?` (build ${o.build})`:''):''});
  writeFileSync(join(o.out,'resumo.md'),lines.join('\n')+'\n');
  writeFileSync(join(o.out,'resumo.json'),JSON.stringify({code,url:o.url??null,build:o.build??null,results:results.map(({erros,...r})=>({...r,erros:erros.slice(0,20)}))},null,1)+'\n');
  return code;
}

const entry=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:'';
if(entry===import.meta.url)process.exit(await main(process.argv.slice(2)));
