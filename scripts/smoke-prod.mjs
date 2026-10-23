// Production smoke (after hotfix 90cd819): the BUILT site plays a solo match. A chunk cycle that only exists in the
// production bundle (e5b34e5) left top-level constants undefined and "Jogar sozinho" failed on the live site while
// check, test and build were green. This runs what a player does, on dist/:
//   1. `vite preview` of dist/ and a local rooms Worker (scripts/local-worker.mjs), on free ports;
//   2. dist/multiplayer.json points at that Worker for the run (restored after);
//   3. headless Chromium: the character, "Jogar sozinho", in each mode (normal and ?modo=chaveiro): it must enter the
//      city match (window.__partidaPronta: the scene drew a run view with a round) while it keeps progressing, with no pageerror and no loaded chunk that rejects
//      when imported again (a module that throws at load).
// node scripts/smoke-prod.mjs [outDir] [--dist dist] [--modes normal,chaveiro]: one line per mode; a print per mode in
// outDir when given. Exit 0 ok, 1 the game failed (no entry, pageerror, a chunk that throws at load), 2 infrastructure
// (no dist, no Playwright, no port, the Worker or the browser did not start). Each mode runs in a fresh browser; a run
// whose only fault is a lost WebGL context or a hung renderer (the GPU under load, not the game) is tried once more,
// in a fresh browser (the upgrade mode: both builds again, in a fresh profile).
// --travar <n[,n…]> (the test of that verdict; a flag, so the queue never inherits it): the n-th entry of the run (1, 2, … counting every page that enters,
// retries included) hangs its page on purpose a few seconds after "Jogar sozinho".
// Upgrade mode (BUG-20261014-ORQ-mapa-cache-velho), --upgrade-from <previous checkout>: ONE persistent browser profile on
// ONE origin plays solo on the previous build (its own dist/ and rooms Worker), then on this one; both must enter. Both
// dists are served like GitHub Pages (max-age=600 + ETag), so a file fetched at an unversioned URL comes back stale,
// as it did for the players who had played before the 1.7× city. Exit 1 also when the previous build does not enter.
// The integration queue (tools/fila.mjs) runs it after `npm run build` and holds a board browser slot for it.
// Playwright is not a dependency of the repo: `import('playwright')`, else PLAYWRIGHT_MODULE, else the PC's
// D:/Gits/viagem-tools copy. CI: `npm install --no-save playwright@1.63.0 && npx playwright install --with-deps chromium`.
import {spawn} from 'node:child_process';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'node:net';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,extname,join,normalize,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

// Entering is judged by progress and a stall, and a failure is the machine's (exit 2) only with a starved page AND
// outside evidence (scripts/smoke-veredito.mjs).
import {ENTER_CAP_MS,STALL_MS,EVAL_TIMEOUT_MS,PROBE_MS,CHUNKS_UNVERIFIED,progressSignature,pageStarved,rendererHung,machineEvidence,isMachine,smokeExit} from './smoke-veredito.mjs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
/** The smoke's own event loop: late when the whole machine is starved (outside evidence for a stall). */
const nodeLag=monitorEventLoopDelay({resolution:20});nodeLag.enable();
/** Headless browsers on the PC (each one's main process): more than the 2 slots is a machine over its rule. */
function browsersOnPc(){
  try{
    if(process.platform==='win32'){
      const out=execFileSync('powershell',['-NoProfile','-Command',"(Get-CimInstance Win32_Process -Filter \"Name='chrome-headless-shell.exe' or Name='headless_shell.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | Measure-Object).Count"],{encoding:'utf8',timeout:15000});
      return Number(out.trim())||0;
    }
    const out=execFileSync('sh',['-c',"ps -eo args | grep -E 'headless_shell|chrome-headless-shell' | grep -v -e '--type=' -e grep | wc -l"],{encoding:'utf8',timeout:5000});
    return Number(out.trim())||0;
  }catch{return 0;}
}
/** The local room's state (/lab, ALLOW_LOCAL only): its phase and tick, and how long it took to answer. */
async function roomState(endpoint,code,origin){
  if(!endpoint||!code)return undefined;
  const t0=Date.now();
  try{
    const r=await fetch(`${endpoint}/lab/${code}`,{headers:{Origin:origin},signal:AbortSignal.timeout(5000)});
    const j=r.ok?await r.json():undefined;
    return {ok:r.ok,ms:Date.now()-t0,phase:j?.phase??'',tick:j?.tick??-1};
  }catch{return {ok:false,ms:Date.now()-t0,phase:'',tick:-1};}
}
/** The rooms Worker's /health, when the page never gave a room code: {ok, ms}. */
async function workerHealth(endpoint){
  if(!endpoint)return undefined;
  const t0=Date.now();
  try{const r=await fetch(`${endpoint}/health`,{signal:AbortSignal.timeout(5000)});return {ok:r.ok,ms:Date.now()-t0};}
  catch{return {ok:false,ms:Date.now()-t0};}
}
/** A page poll that never hangs: undefined after EVAL_TIMEOUT_MS (answered: false), or when the page threw/reloaded. */
const poll=(p,fn,arg,ms=EVAL_TIMEOUT_MS)=>Promise.race([p.evaluate(fn,arg).then(v=>({v,answered:true}),()=>({v:undefined,answered:true})),new Promise(r=>setTimeout(()=>r({v:undefined,answered:false}),ms))]);
/** The page's event-loop probe (added before any script): a PROBE_MS timer counting its fires since the last read. */
const PROBE=`(()=>{const w=window;w.__probe={fires:0,since:performance.now()};setInterval(()=>{w.__probe.fires++;},${PROBE_MS});})();`;
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const dist=resolve(arg('dist','dist'));
const MODES={normal:'',chaveiro:'?modo=chaveiro'};
const modes=arg('modes','normal,chaveiro').split(',').filter(m=>m in MODES);
/** --upgrade-from <checkout>: the returning-player run (see the upgrade mode below); its dist/ must be built. */
const upgradeFrom=arg('upgrade-from',undefined);
/** The entries that hang their page on purpose (--travar, see the header), and the entries so far. */
const HANG=new Set(String(arg('travar','')).split(',').map(Number).filter(n=>n>0));
let entries=0;
const outDir=process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')));
/** A failure of the machine, not of the game: exit 2. */
class Infra extends Error {}
/** A pageerror of a lost or missing WebGL context (Phaser's renderer under GPU load). */
const glFault=(e)=>/webGLProgram|WebGL|context lost|CONTEXT_LOST/i.test(e);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/** Closing a page, context or browser: never waits on a renderer stuck in a loop more than CLOSE_MS (it is left behind). */
const CLOSE_MS=15000,within=(pr)=>Promise.race([pr.catch(()=>{}),sleep(CLOSE_MS)]);
const listen=port=>new Promise(ok=>{const s=createServer();s.once('error',()=>ok(0));s.listen(port,'127.0.0.1',()=>{const got=s.address().port;s.close(()=>ok(got));});});
/** Any free port (the Worker's). */
const freePort=()=>listen(0);
/**
 * The preview's port: the rooms Worker accepts local origins only on the executors' vite ports (multiplayer/origins.ts:
 * 4187, 4200–4399), so SMOKE_PORT or the first free one from 4399 down.
 */
async function previewPort(){
  for(const port of [Number(process.env.SMOKE_PORT)||0,...Array.from({length:20},(_,i)=>4399-i)])if(port&&await listen(port))return port;
  throw new Infra('nenhuma porta livre em 4380–4399 para o preview (SMOKE_PORT)');
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

async function startPreview(port){
  const posix=process.platform!=='win32';
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir',dist],
    {windowsHide:true,shell:false,detached:posix,stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;
  // Up and OURS: the port was free when picked, but another server may take it before the spawn (then --strictPort
  // fails and the other one would answer): its /version.json must be this dist's.
  const want=readFileSync(join(dist,'version.json'),'utf8').trim();
  let up=false,exited=false;child.once('exit',()=>{exited=true;});
  for(let i=0;i<120&&!up&&!exited;i++){try{const r=await fetch(`${url}/version.json`,{cache:'no-store'});up=r.ok&&(await r.text()).trim()===want;}catch{}if(!up)await sleep(250);}
  if(!up){try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}throw new Infra(`vite preview não subiu em ${url}${exited?' (porta tomada?)':''}`);}
  return {url,stop:()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}}};
}

/**
 * The solo match in an open page: enters it, then every loaded chunk must import cleanly. {why, errors, starved, hung},
 * why '' when ok (smoke-veredito.mjs).
 */
async function enter(p,base,mode,errors,shot,reload=false,roomEndpoint=undefined){
  const start=Date.now(),entry=++entries;nodeLag.reset();
  const trace=[];let roomCode='',lastSig='',lastChange=start,roomLast;
  // Where the time goes (BUG-20261020-ORQ-smoke-60s-instavel): seconds since the start at each step, printed per entry.
  const marks={},mark=(k)=>{marks[k]=+((Date.now()-start)/1000).toFixed(1);};
  // Outside evidence of a starved machine, for any failure below.
  const evidence=async()=>machineEvidence({nodeLagP90:nodeLag.percentile(90)/1e6,roomMs:roomLast?.ms,roomOk:roomLast?.ok??true,browsers:browsersOnPc()});
  try{
    await p.addInitScript(PROBE).catch(()=>{});
    await p.goto(`${base}/${MODES[mode]}`,{waitUntil:'load',timeout:90000});
    // The returning player's new visit: a reload revalidates the page itself (the new build's HTML and hashed chunks)
    // while the subresources still come from the HTTP cache when fresh — where a stale unversioned file bites.
    if(reload)await p.reload({waitUntil:'load',timeout:90000});
    mark('load');
    await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
    mark('personagem');
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Smoke';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
    await p.evaluate(()=>document.getElementById('enter-island').click());
    mark('jogar');
    if(HANG.has(entry)){console.log(`  --travar: a entrada ${entry} trava a página de propósito`);await p.evaluate(()=>{setTimeout(()=>{for(;;){}},3000);});}
    let entered=false,said='',stalled='';
    while(!entered&&!said&&!stalled&&Date.now()-start<ENTER_CAP_MS){
      await sleep(1000);
      // The game's own signal (scene.ts: a round in the run view, drawn): not a HUD element a HUD card may change.
      // A build older than that signal (the upgrade mode's previous build; window.__island is dev-only): the match HUD
      // on screen — a minimap drawn (the canvas one or the city's) or the round chip ("Round 2/10"). The rest is what
      // the player sees, to tell progress from a stall (stable texts only: never the round's clock).
      const {v:st,answered}=await poll(p,(probeMs)=>{
        const q=(sel)=>document.querySelector(sel)?.textContent?.trim()||'',drawn=(sel)=>!!document.querySelector(sel)?.getBoundingClientRect().width;
        const old=window.__partidaPronta===undefined&&(drawn('.rh-mm-canvas')||drawn('.ch-minimap')||/\bRound \d+\/\d+/.test(document.body.innerText));
        const w=document.querySelector('.coop-wait'),probe=window.__probe,now=performance.now();
        const fires=probe?probe.fires:0,dueFires=probe?(now-probe.since)/probeMs:0;if(probe){probe.fires=0;probe.since=now;}
        const loading=q('.explore-loading');
        return {entered:window.__partidaPronta===true||old,said:document.getElementById('explore-error')?.textContent||(/Não foi possível|não baixou/i.test(loading)?loading:''),
          stage:w&&!w.closest('[hidden]')?'sala':document.querySelector('.rh-top')?'partida':'?',loading,ready:q('.coop-wait-ready'),p0:w?.dataset.preloadP0??'',
          bytes:w?.dataset.preloadBytes??'',count:q('.coop-wait-count'),roundLabel:q('.rh-round-label'),code:q('.coop-wait-code strong'),fires,dueFires};
      },PROBE_MS);
      const now=Date.now();
      if(st?.code)roomCode=st.code;
      const room=await roomState(roomEndpoint,roomCode,base);if(room)roomLast=room;
      trace.push({wallMs:now,answered,...(st??{}),roomPhase:room?.phase,roomTick:room?.tick,roomMs:room?.ms});
      if(st){({entered,said}=st);}
      // The room's tick counts as progress only before combat: in combat it advances every second like a clock.
      const sig=progressSignature({...(st??{}),roomPhase:room?.phase,roomTick:room?.phase==='combat'?undefined:room?.tick});
      if(st&&sig!==lastSig){lastSig=sig;lastChange=now;}
      else if(now-lastChange>STALL_MS)stalled=`nada mudou em ${STALL_MS/1000} s (${st?.stage??'sem resposta'}: "${st?.ready||st?.roundLabel||st?.loading||''}", sala ${room?.phase??'?'} tick ${room?.tick??'?'})`;
    }
    mark(entered?'entrou':'saiu');
    let starved='',hung='';
    if(!entered&&!said){
      const now=Date.now();
      // A page that answered nothing while the room did: a hung renderer, the machine's on its own (smoke-veredito.mjs).
      hung=rendererHung(trace,now,roomCode?await roomState(roomEndpoint,roomCode,base):await workerHealth(roomEndpoint));
      const page=pageStarved(trace,now);
      if(hung)starved=hung;
      else if(page){const out=await evidence();if(out)starved=`${page}; ${out}`;}
      console.log(`  rastro ${mode}: ${JSON.stringify(trace.slice(-3).map(t=>({s:Math.round((t.wallMs-start)/1000),stage:t.stage,ready:t.ready,round:t.roundLabel,sala:t.roomPhase,tick:t.roomTick,salaMs:t.roomMs,timer:t.dueFires?Math.round(t.fires/t.dueFires*100)+'%':undefined,resp:t.answered})))}`);
    }
    // Every chunk the page loaded must import cleanly (a module that throws at load rejects every time): the reason this
    // smoke exists (e5b34e5). Never skipped: a slow page gets a longer try (not a hung one), and no answer at all is a
    // failure (the machine's only when the renderer hung or the page was starved with outside evidence).
    // All at once and only once (BUG-20261020-ORQ-smoke-60s-instavel): one by one, each import waited for a turn of a
    // page busy drawing the match in software GL (CI, no GPU): 74 chunks took 20–60 s, and the longer try started over.
    // In parallel they share those turns; the longer try awaits the same promise.
    const importAll=()=>{
      const w=window;
      if(!w.__smokeImports){
        const urls=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\/assets\/.*\.js(\?|$)/.test(n)))];
        // Progress the smoke reads when this does not answer in time (how many chunks, how far, how long).
        const prog={n:urls.length,done:0,t0:performance.now(),ms:0};
        prog.out=Promise.all(urls.map(u=>import(u).then(()=>'',e=>`${u.split('/').pop()}: ${e&&e.message}`).finally(()=>{prog.done++;prog.ms=Math.round(performance.now()-prog.t0);})))
          .then(all=>all.filter(Boolean));
        w.__smokeImports=prog;
      }
      return w.__smokeImports.out;
    };
    let chunks=await poll(p,importAll);
    mark('chunks1');
    // A hung renderer will not answer in a minute either: no longer try then.
    if(!chunks.answered&&!hung){chunks=await poll(p,importAll,undefined,60000);mark('chunks2');}
    const {v:prog}=await poll(p,()=>{const i=window.__smokeImports;return i&&{n:i.n,done:i.done,ms:i.ms};},undefined,5000),last=trace.at(-1);
    console.log(`  tempos ${mode}#${entry} (s): ${JSON.stringify(marks)} chunks ${chunks.answered?'ok':'sem resposta'} ${prog?`${prog.done}/${prog.n} em ${prog.ms} ms`:'?'} timer ${last?.dueFires?Math.round(last.fires/last.dueFires*100)+'%':'?'}`);
    const rejected=chunks.answered?chunks.v??[]:[CHUNKS_UNVERIFIED];
    if(shot)await p.screenshot({path:shot,timeout:30000}).catch(()=>{});
    const why=[!entered&&(said?`não entrou: "${said}"`:stalled?`não entrou: ${stalled}`:`não entrou em ${ENTER_CAP_MS/1000} s`),...errors.map(e=>`pageerror: ${e}`),...rejected.map(r=>`chunk: ${r}`)].filter(Boolean);
    return {why:why.join(' | '),errors,starved,hung};
  }catch(e){
    // A step that timed out before the room (the page load, the character screen): the machine's only with outside evidence.
    const msg=String(e).split('\n')[0],timeout=/Timeout|timed out/i.test(msg),out=timeout?await evidence():'';
    return {why:timeout?`não entrou: ${msg}`:msg,errors,starved:out};
  }
}

// SMOKE_SWIFTSHADER=1: render on the CPU. 23/10/2026: with the GPU busy (TangoFlux sounds), d3d11 Chromium hung and
// the smoke failed a good batch ("Ops, peraí", tick -1); SwiftShader entered the same match in under 10 s.
const launchArgs=(env=process.env,platform=process.platform)=>env.SMOKE_SWIFTSHADER==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']
  :platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[];

/** One mode in a fresh browser: enters the solo match; returns enter()'s result (why '' when it passed). */
async function smoke(chromium,base,mode,roomEndpoint){
  // On Windows the PC's GPU (as the visual checks do); elsewhere (CI) the default software GL.
  let browser;
  try{browser=await chromium.launch({args:launchArgs()});}
  catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  const errors=[];let p;
  try{p=await (await browser.newContext({viewport:{width:1335,height:620},deviceScaleFactor:1})).newPage();}
  catch(e){await within(browser.close());throw new Infra(`a página não abriu: ${String(e).split('\n')[0]}`);}
  p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
  try{return await enter(p,base,mode,errors,outDir?join(outDir,`smoke-${mode}-1335x620.png`):undefined,false,roomEndpoint);}
  finally{await within(browser.close());}
}

// ---------- upgrade mode (BUG-20261014-ORQ-mapa-cache-velho): the player who comes back after a deploy ----------
/** The content types the game's files need (GitHub Pages sends the usual ones). */
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
  '.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.ico':'image/x-icon','.txt':'text/plain'};
/**
 * dist/ served like GitHub Pages: every file with `Cache-Control: max-age=600` and an ETag (304 on If-None-Match), a
 * folder by its index.html, 404.html for the rest. vite preview sends no max-age, so a stale city would never show there.
 */
async function startPages(dir,port){
  const want=readFileSync(join(dir,'version.json'),'utf8').trim();
  const server=createHttpServer((req,res)=>{
    let path;try{path=decodeURIComponent(new URL(req.url,'http://x').pathname);}catch{res.writeHead(400).end();return;}
    let file=join(dir,normalize(path).replace(/^([\\/]\.\.)+/,''));
    if(!file.startsWith(dir)){res.writeHead(403).end();return;}
    try{if(statSync(file).isDirectory())file=join(file,'index.html');}catch{/* not there */}
    let st;try{st=statSync(file);}catch{st=undefined;}
    if(!st||!st.isFile()){const nf=join(dir,'404.html');res.writeHead(404,{'Content-Type':TYPES['.html']});res.end(existsSync(nf)?readFileSync(nf):'');return;}
    const etag=`"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers={'Cache-Control':'max-age=600','ETag':etag,'Content-Type':TYPES[extname(file).toLowerCase()]??'application/octet-stream','Access-Control-Allow-Origin':'*'};
    if(req.headers['if-none-match']===etag){res.writeHead(304,headers).end();return;}
    res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:readFileSync(file));
  });
  await new Promise((ok,ko)=>{server.once('error',ko);server.listen(port,'127.0.0.1',ok);}).catch(e=>{throw new Infra(`a porta ${port} não abriu para o dist (${e.code??e})`);});
  const url=`http://127.0.0.1:${port}`;
  // This build, not another server on the port: its /version.json.
  let got='';try{got=(await (await fetch(`${url}/version.json`,{cache:'no-store'})).text()).trim();}catch{}
  if(got!==want){server.close();throw new Infra(`o servidor em ${url} não é o deste dist (${got.slice(0,40)})`);}
  return {url,stop:()=>new Promise(r=>{server.closeAllConnections?.();server.close(()=>r());})};
}

/**
 * The checkout's own rooms Worker (its scripts/local-worker.mjs and multiplayer/, the protocol of THAT build): wrangler
 * runs from the current directory, so it is started from inside the checkout.
 */
async function startWorkerOf(checkout,port){
  const {startLocalWorker:start}=await import(pathToFileURL(join(checkout,'scripts','local-worker.mjs')).href);
  const here=process.cwd();
  try{process.chdir(checkout);return await start({port,logPath:join(tmpdir(),`viagem-smoke-worker-${port}.log`)});}
  finally{process.chdir(here);}
}

const configs=new Map();
/** Points a dist's multiplayer.json at a Worker, remembering the original (restored on every way out). */
function pointAt(distDir,endpoint){
  const file=join(distDir,'multiplayer.json');
  if(!existsSync(file))throw new Infra(`${file} não existe: rode npm run build nesse checkout antes`);
  if(!configs.has(file))configs.set(file,readFileSync(file,'utf8'));
  writeFileSync(file,JSON.stringify({...JSON.parse(configs.get(file)),endpoint}));
}
let restored=false;
/** Every dist's multiplayer.json back as built: on every way out, before anything else (never ship 127.0.0.1). */
const restore=()=>{if(restored)return;restored=true;for(const [file,text] of configs){try{writeFileSync(file,text);}catch{}}};

/**
 * The upgrade run (BUG-20261014-ORQ-mapa-cache-velho): the previous build, then this one, in ONE fresh persistent profile
 * on one origin. The first failing entry's result (the previous build failing is never a pass), or undefined when both entered.
 */
async function upgrade(chromium){
  // The same profile and the same origin (port) for both builds: what a returning player's browser keeps.
  const previous=resolve(upgradeFrom),prevDist=join(previous,'dist'),port=await previewPort();
  const profile=mkdtempSync(join(tmpdir(),'viagem-smoke-perfil-'));
  let context;
  try{context=await chromium.launchPersistentContext(profile,{args:launchArgs(),viewport:{width:1335,height:620},deviceScaleFactor:1});}
  catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  try{
    for(const [phase,checkout,distDir] of [['anterior',previous,prevDist],['novo',process.cwd(),dist]]){
      const workerPort=await freePort();
      worker=await startWorkerOf(checkout,workerPort);
      pointAt(distDir,`http://127.0.0.1:${workerPort}`);
      preview=await startPages(distDir,port);
      const errors=[],p=await context.newPage();p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
      const r=await enter(p,preview.url,'normal',errors,outDir?join(outDir,`smoke-upgrade-${phase}-1335x620.png`):undefined,phase==='novo',worker.endpoint);
      await within(p.close());
      await preview.stop();preview=undefined;await worker.stop();worker=undefined;
      console.log(`smoke upgrade (${phase}, ${phase==='anterior'?basename(previous):'este build'}): ${r.why?`${isMachine(r)?'INFRA':'FALHOU'} · ${r.why}${r.starved?` · ${r.starved}`:''}`:'OK'}`);
      if(r.why)return r;
    }
    return undefined;
  }finally{await within(context.close());try{rmSync(profile,{recursive:true,force:true});}catch{}}
}

let worker,preview,code=0;
process.on('exit',restore);
// Ctrl+C / a CI cancel: restore and stop the server here; the Worker's own handler (local-worker.mjs) then stops it
// and exits with 128 + the signal.
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.prependListener(sig,()=>{restore();void preview?.stop();if(!worker)process.exit(130);});
if(outDir)mkdirSync(outDir,{recursive:true});
try{
  if(!existsSync(join(dist,'multiplayer.json')))throw new Infra(`${join(dist,'multiplayer.json')} não existe: rode npm run build antes`);
  const {chromium}=await playwright();
  if(upgradeFrom){
    let r=await upgrade(chromium);
    // A hung renderer: both builds once more, in a fresh profile (a player's own browser would not have hung).
    if(r?.hung){console.log('smoke upgrade: 2ª tentativa num perfil novo (o renderer travou na 1ª)');r=await upgrade(chromium);
      if(r?.hung)console.log('smoke upgrade: travou nas 2 tentativas, em perfis novos: se repetir, pode ser um laço do jogo');}
    code=r?smokeExit([r]):0;
  }else{
    const workerPort=await freePort(),port=await previewPort();
    worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-smoke-worker-${workerPort}.log`)});
    pointAt(dist,`http://127.0.0.1:${workerPort}`);
    preview=await startPreview(port);
    const results=[];
    for(const mode of modes){
      let r=await smoke(chromium,preview.url,mode,worker.endpoint),again='';
      // Only a lost WebGL context, nothing else wrong, or a hung renderer: the GPU, not the game. Once more, in a new browser.
      if(r.why&&r.errors.length&&r.errors.every(glFault)&&r.why.split(' | ').every(w=>w.startsWith('pageerror')||w.startsWith('não entrou'))){again=' (2ª tentativa: o contexto WebGL caiu na 1ª)';r=await smoke(chromium,preview.url,mode,worker.endpoint);}
      else if(r.hung){again=' (2ª tentativa num navegador novo: o renderer travou na 1ª)';r=await smoke(chromium,preview.url,mode,worker.endpoint);
        if(r.hung)again=' (travou nas 2 tentativas, em navegadores novos: se repetir, pode ser um laço do jogo)';}
      results.push(r);
      console.log(`smoke ${mode}: ${r.why?`${isMachine(r)?'INFRA':'FALHOU'} · ${r.why}${r.starved?` · ${r.starved}`:''}`:'OK'}${again}`);
    }
    // A game failure wins over the machine's (exit 1 is never retried; 2 is once).
    code=smokeExit(results);
  }
}catch(e){
  if(!(e instanceof Infra)&&!/não subiu|ocupada|Porta|wrangler|health/i.test(String(e)))throw e;
  console.log(`smoke: INFRA · ${String(e.message??e).split('\n')[0]}`);code=2;
}finally{
  restore();
  await preview?.stop();
  await worker?.stop();
}
process.exit(code);
