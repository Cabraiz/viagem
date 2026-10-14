// Production smoke (after hotfix 90cd819): the BUILT site plays a solo match. A chunk cycle that only exists in the
// production bundle (e5b34e5) left top-level constants undefined and "Jogar sozinho" failed on the live site while
// check, test and build were green. This runs what a player does, on dist/:
//   1. `vite preview` of dist/ and a local rooms Worker (scripts/local-worker.mjs), on free ports;
//   2. dist/multiplayer.json points at that Worker for the run (restored after);
//   3. headless Chromium: the character, "Jogar sozinho", in each mode (normal and ?modo=chaveiro): it must enter the
//      city match (the HUD minimap's canvas shows) within ENTER_MS, with no pageerror and no loaded chunk that rejects
//      when imported again (a module that throws at load).
// node scripts/smoke-prod.mjs [--dist dist] [--modes normal,chaveiro]   (exit 1 on failure; one line per mode)
// Playwright is not a dependency of the repo: `import('playwright')`, else PLAYWRIGHT_MODULE, else the PC's
// D:/Gits/viagem-tools copy. CI: `npm install --no-save playwright@1.63.0 && npx playwright install --with-deps chromium`.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const ENTER_MS=120000;
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const dist=resolve(arg('dist','dist'));
const MODES={normal:'',chaveiro:'?modo=chaveiro'};
const modes=arg('modes','normal,chaveiro').split(',').filter(m=>m in MODES);
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
  throw new Error('nenhuma porta livre em 4380–4399 para o preview (SMOKE_PORT)');
}

async function playwright(){
  for(const spec of ['playwright',process.env.PLAYWRIGHT_MODULE,'D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{
      const url=spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href;
      const m=await import(url);return m.chromium?m:m.default;
    }catch{}
  }
  throw new Error('Playwright não encontrado: npm install --no-save playwright@1.63.0 (ou PLAYWRIGHT_MODULE)');
}

async function startPreview(port){
  const posix=process.platform!=='win32';
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir',dist],
    {windowsHide:true,shell:false,detached:posix,stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;
  for(let i=0;i<120;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(250);}
  return {url,stop:()=>{try{if(posix)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}}};
}

/** One mode: enters the solo match; returns the failure text or ''. */
async function smoke(browser,base,mode){
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
    const why=[!entered&&(said?`não entrou: "${said}"`:`não entrou em ${ENTER_MS/1000} s`),...errors.map(e=>`pageerror: ${e}`),...rejected.map(r=>`chunk: ${r}`)].filter(Boolean);
    return why.join(' | ');
  }catch(e){return String(e).split('\n')[0];}
  finally{await ctx.close();}
}

const config=join(dist,'multiplayer.json');
if(!existsSync(config))throw new Error(`${config} não existe: rode npm run build antes`);
const original=readFileSync(config,'utf8');
let worker,preview,browser,failed=false;
try{
  const workerPort=await freePort(),port=await previewPort();
  worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-smoke-worker-${workerPort}.log`)});
  writeFileSync(config,JSON.stringify({...JSON.parse(original),endpoint:`http://127.0.0.1:${workerPort}`}));
  preview=await startPreview(port);
  const {chromium}=await playwright();
  // On Windows the PC's GPU (as the visual checks do); elsewhere (CI) the default software GL.
  browser=await chromium.launch({args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[]});
  for(const mode of modes){
    const why=await smoke(browser,preview.url,mode);
    failed||=!!why;
    console.log(`smoke ${mode}: ${why?`FALHOU · ${why}`:'OK'}`);
  }
}finally{
  await browser?.close().catch(()=>{});
  preview?.stop();
  await worker?.stop();
  writeFileSync(config,original);
}
process.exit(failed?1:0);
