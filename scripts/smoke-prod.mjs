// Production smoke (after hotfix 90cd819): the BUILT site plays a solo match. A chunk cycle that only exists in the
// production bundle (e5b34e5) left top-level constants undefined and "Jogar sozinho" failed on the live site while
// check, test and build were green. This runs what a player does, on dist/:
//   1. `vite preview` of dist/ and a local rooms Worker (scripts/local-worker.mjs), on free ports;
//   2. dist/multiplayer.json points at that Worker for the run (restored after);
//   3. headless Chromium: the character, "Jogar sozinho", in each mode (normal and ?modo=chaveiro): it must enter the
//      city match (window.__partidaPronta: the scene drew a run view with a round) within ENTER_MS, with no pageerror and no loaded chunk that rejects
//      when imported again (a module that throws at load).
// node scripts/smoke-prod.mjs [outDir] [--dist dist] [--modes normal,chaveiro]: one line per mode; a print per mode in
// outDir when given. Exit 0 ok, 1 the game failed (no entry, pageerror, a chunk that throws at load), 2 infrastructure
// (no dist, no Playwright, no port, the Worker or the browser did not start). Each mode runs in a fresh browser; a run
// whose only fault is a lost WebGL context (the GPU under load, not the game) is tried once more.
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

const ENTER_MS=120000;
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const dist=resolve(arg('dist','dist'));
const MODES={normal:'',chaveiro:'?modo=chaveiro'};
const modes=arg('modes','normal,chaveiro').split(',').filter(m=>m in MODES);
/** --upgrade-from <checkout>: the returning-player run (see the upgrade mode below); its dist/ must be built. */
const upgradeFrom=arg('upgrade-from',undefined);
const outDir=process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')));
/** A failure of the machine, not of the game: exit 2. */
class Infra extends Error {}
/** A pageerror of a lost or missing WebGL context (Phaser's renderer under GPU load). */
const glFault=(e)=>/webGLProgram|WebGL|context lost|CONTEXT_LOST/i.test(e);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
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

/** The solo match in an open page: enters it, then every loaded chunk must import cleanly. {why, errors}, why '' when ok. */
async function enter(p,base,mode,errors,shot,reload=false){
  try{
    await p.goto(`${base}/${MODES[mode]}`,{waitUntil:'load',timeout:90000});
    // The returning player's new visit: a reload revalidates the page itself (the new build's HTML and hashed chunks)
    // while the subresources still come from the HTTP cache when fresh — where a stale unversioned file bites.
    if(reload)await p.reload({waitUntil:'load',timeout:90000});
    await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Smoke';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
    await p.evaluate(()=>document.getElementById('enter-island').click());
    let entered=false,said='';
    for(const end=Date.now()+ENTER_MS;Date.now()<end&&!entered&&!said;){
      await sleep(1000);
      // The game's own signal (scene.ts: a round in the run view, drawn): not a HUD element a HUD card may change.
      // A build older than that signal (the upgrade mode's previous build; window.__island is dev-only): the match HUD
      // on screen — a minimap drawn (the canvas one or the city's) or the round chip ("Round 2/10").
      ({entered,said}=await p.evaluate(()=>{
        const drawn=(sel)=>!!document.querySelector(sel)?.getBoundingClientRect().width;
        const old=window.__partidaPronta===undefined&&(drawn('.rh-mm-canvas')||drawn('.ch-minimap')||/\bRound \d+\/\d+/.test(document.body.innerText));
        return {entered:window.__partidaPronta===true||old,said:document.getElementById('explore-error')?.textContent||''};
      }));
    }
    // Every chunk the page loaded must import cleanly (a module that throws at load rejects every time).
    const rejected=await p.evaluate(async()=>{
      const out=[];
      for(const u of new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\/assets\/.*\.js(\?|$)/.test(n)))){
        try{await import(u);}catch(e){out.push(`${u.split('/').pop()}: ${e&&e.message}`);}
      }
      return out;
    });
    if(shot)await p.screenshot({path:shot}).catch(()=>{});
    const why=[!entered&&(said?`não entrou: "${said}"`:`não entrou em ${ENTER_MS/1000} s`),...errors.map(e=>`pageerror: ${e}`),...rejected.map(r=>`chunk: ${r}`)].filter(Boolean);
    return {why:why.join(' | '),errors};
  }catch(e){return {why:String(e).split('\n')[0],errors};}
}

const launchArgs=()=>process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[];

/** One mode in a fresh browser: enters the solo match; returns {why, errors} (why '' when it passed). */
async function smoke(chromium,base,mode){
  // On Windows the PC's GPU (as the visual checks do); elsewhere (CI) the default software GL.
  let browser;
  try{browser=await chromium.launch({args:launchArgs()});}
  catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  const errors=[];let p;
  try{p=await (await browser.newContext({viewport:{width:1335,height:620},deviceScaleFactor:1})).newPage();}
  catch(e){await browser.close().catch(()=>{});throw new Infra(`a página não abriu: ${String(e).split('\n')[0]}`);}
  p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
  try{return await enter(p,base,mode,errors,outDir?join(outDir,`smoke-${mode}-1335x620.png`):undefined);}
  finally{await browser.close().catch(()=>{});}
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
        const r=await enter(p,preview.url,'normal',errors,outDir?join(outDir,`smoke-upgrade-${phase}-1335x620.png`):undefined,phase==='novo');
        await p.close().catch(()=>{});
        await preview.stop();preview=undefined;await worker.stop();worker=undefined;
        console.log(`smoke upgrade (${phase}, ${phase==='anterior'?basename(previous):'este build'}): ${r.why?`FALHOU · ${r.why}`:'OK'}`);
        // The previous build failing is never a pass: the profile did not get the old files (1), or its build is missing (2, thrown above).
        if(r.why){code=1;break;}
      }
    }finally{await context.close().catch(()=>{});try{rmSync(profile,{recursive:true,force:true});}catch{}}
  }else{
    const workerPort=await freePort(),port=await previewPort();
    worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-smoke-worker-${workerPort}.log`)});
    pointAt(dist,`http://127.0.0.1:${workerPort}`);
    preview=await startPreview(port);
    for(const mode of modes){
      let r=await smoke(chromium,preview.url,mode),again='';
      // Only a lost WebGL context, nothing else wrong: the GPU, not the game. Once more, in a new browser.
      if(r.why&&r.errors.length&&r.errors.every(glFault)&&r.why.split(' | ').every(w=>w.startsWith('pageerror')||w.startsWith('não entrou'))){again=' (2ª tentativa: o contexto WebGL caiu na 1ª)';r=await smoke(chromium,preview.url,mode);}
      if(r.why)code=1;
      console.log(`smoke ${mode}: ${r.why?`FALHOU · ${r.why}`:'OK'}${again}`);
    }
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
