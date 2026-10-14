// Production smoke (after hotfix 90cd819): the BUILT site plays a solo match. A chunk cycle that only exists in the
// production bundle (e5b34e5) left top-level constants undefined and "Jogar sozinho" failed on the live site while
// check, test and build were green. This runs what a player does, on dist/:
//   1. `vite preview` of dist/ and a local rooms Worker (scripts/local-worker.mjs), on free ports;
//   2. dist/multiplayer.json points at that Worker for the run (restored after);
//   3. headless Chromium: the character, "Jogar sozinho", in each mode (normal and ?modo=chaveiro): it must enter the
//      city match (the HUD minimap's canvas shows) within ENTER_MS, with no pageerror and no loaded chunk that rejects
//      when imported again (a module that throws at load).
// node scripts/smoke-prod.mjs [outDir] [--dist dist] [--modes normal,chaveiro]: one line per mode; a print per mode in
// outDir when given. Exit 0 ok, 1 the game failed (no entry, pageerror, a chunk that throws at load), 2 infrastructure
// (no dist, no Playwright, no port, the Worker or the browser did not start). Each mode runs in a fresh browser; a run
// whose only fault is a lost WebGL context (the GPU under load, not the game) is tried once more.
// The integration queue (tools/fila.mjs) runs it after `npm run build` and holds a board browser slot for it.
// Playwright is not a dependency of the repo: `import('playwright')`, else PLAYWRIGHT_MODULE, else the PC's
// D:/Gits/viagem-tools copy. CI: `npm install --no-save playwright@1.63.0 && npx playwright install --with-deps chromium`.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const ENTER_MS=120000;
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const dist=resolve(arg('dist','dist'));
const MODES={normal:'',chaveiro:'?modo=chaveiro'};
const modes=arg('modes','normal,chaveiro').split(',').filter(m=>m in MODES);
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
  let up=false;
  for(let i=0;i<120&&!up;i++){try{up=(await fetch(url)).ok;}catch{}if(!up)await sleep(250);}
  if(!up){try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}throw new Infra(`vite preview não subiu em ${url}`);}
  return {url,stop:()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}}};
}

/** One mode in a fresh browser: enters the solo match; returns {why, errors} (why '' when it passed). */
async function smoke(chromium,base,mode){
  // On Windows the PC's GPU (as the visual checks do); elsewhere (CI) the default software GL.
  let browser;
  try{browser=await chromium.launch({args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[]});}
  catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  const ctx=await browser.newContext({viewport:{width:1335,height:620},deviceScaleFactor:1});
  const p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
  try{
    await p.goto(`${base}/${MODES[mode]}`,{waitUntil:'load',timeout:90000});
    await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Smoke';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
    await p.evaluate(()=>document.getElementById('enter-island').click());
    let entered=false,said='';
    for(const end=Date.now()+ENTER_MS;Date.now()<end&&!entered&&!said;){
      await sleep(1000);
      ({entered,said}=await p.evaluate(()=>({entered:!!document.querySelector('.rh-mm-canvas')?.getBoundingClientRect().width,said:document.getElementById('explore-error')?.textContent||''})));
    }
    // Every chunk the page loaded must import cleanly (a module that throws at load rejects every time).
    const rejected=await p.evaluate(async()=>{
      const out=[];
      for(const u of new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\/assets\/.*\.js(\?|$)/.test(n)))){
        try{await import(u);}catch(e){out.push(`${u.split('/').pop()}: ${e&&e.message}`);}
      }
      return out;
    });
    if(outDir)await p.screenshot({path:join(outDir,`smoke-${mode}-1335x620.png`)}).catch(()=>{});
    const why=[!entered&&(said?`não entrou: "${said}"`:`não entrou em ${ENTER_MS/1000} s`),...errors.map(e=>`pageerror: ${e}`),...rejected.map(r=>`chunk: ${r}`)].filter(Boolean);
    return {why:why.join(' | '),errors};
  }catch(e){return {why:String(e).split('\n')[0],errors};}
  finally{await browser.close().catch(()=>{});}
}

const config=join(dist,'multiplayer.json');
if(!existsSync(config)){console.log(`smoke: INFRA · ${config} não existe: rode npm run build antes`);process.exit(2);}
const original=readFileSync(config,'utf8');
let worker,preview,code=0;
if(outDir)mkdirSync(outDir,{recursive:true});
try{
  const workerPort=await freePort(),port=await previewPort();
  worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-smoke-worker-${workerPort}.log`)});
  writeFileSync(config,JSON.stringify({...JSON.parse(original),endpoint:`http://127.0.0.1:${workerPort}`}));
  preview=await startPreview(port);
  const {chromium}=await playwright();
  for(const mode of modes){
    let r=await smoke(chromium,preview.url,mode),again='';
    // Only a lost WebGL context, nothing else wrong: the GPU, not the game. Once more, in a new browser.
    if(r.why&&r.errors.length&&r.errors.every(glFault)&&r.why.split(' | ').every(w=>w.startsWith('pageerror')||w.startsWith('não entrou'))){again=' (2ª tentativa: o contexto WebGL caiu na 1ª)';r=await smoke(chromium,preview.url,mode);}
    if(r.why)code=1;
    console.log(`smoke ${mode}: ${r.why?`FALHOU · ${r.why}`:'OK'}${again}`);
  }
}catch(e){
  if(!(e instanceof Infra)&&!/não subiu|ocupada|Porta|wrangler|health/i.test(String(e)))throw e;
  console.log(`smoke: INFRA · ${String(e.message??e).split('\n')[0]}`);code=2;
}finally{
  preview?.stop();
  await worker?.stop();
  writeFileSync(config,original);
}
process.exit(code);
