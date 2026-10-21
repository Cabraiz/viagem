// The match's opening on the print sheet (NEW-20261021-ORQ-prints-ci-mede-abertura): the time from the island click to the
// scene being born and to the hero being playable, on a phone (390×844, touch, CPU 4×) over a slow link (9 Mbps, 170 ms
// before each response, throttled at the server so the service worker's own fetches pay it too), with a cold cache and
// for the returning player (a 2nd page in the same profile). Until 21/10 only scripts like the board's fases.mjs measured
// it, by hand on the user's PC (44 → 29 s in batch 46): a card that slowed it down went unseen.
// Measures THIS build (--dist) against the main it branched from (--base-dist, the merge-base's build), in pairs whose
// order alternates (the runner's drift falls on both), and compares the medians (5 pairs: with 3, main against itself
// differed by up to 13 % on the returning player's playable time, one sample being ±15 % on swiftshader): a number PIORA worse (and at least
// PIORA_MIN_MS, the noise of a 7 s opening) fails. The rooms Worker is this checkout's (scripts/local-worker.mjs) for
// both builds: a base whose protocol it no longer speaks does not open, which is a warning (no comparison), not a fail.
//   node scripts/abertura-ci.mjs [outDir=folha-out] --dist dist [--base-dist <dir>] [--base-sha <sha>] [--pares 5]
//     [--cpu 4] [--kbps 9000] [--rtt 170]
// Out: <out>/abertura.json ({ok, fails, avisos, mediana, piora, desvio, runs, frames}) and the opening prints, which
// scripts/folha-prints.mjs puts on the sheet (its header, red on a fail). Exit 0 measured (the verdict is in the json),
// 2 infrastructure.
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const outDir=resolve(process.argv.slice(2).find((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')))??'folha-out');
const dist=resolve(arg('dist','dist')),baseDist=arg('base-dist')?resolve(arg('base-dist')):undefined,baseSha=String(arg('base-sha','')).slice(0,7);
const PARES=Number(arg('pares',5)),CPU=Number(arg('cpu',4)),KBPS=Number(arg('kbps',9000)),RTT=Number(arg('rtt',170));
/** Worse by more than this fraction of the base's median, and by at least PIORA_MIN_MS: the sheet fails. */
const PIORA=0.15,PIORA_MIN_MS=1000;
/** One opening, click → playable, at most this long (swiftshader at CPU 4×). */
const OPEN_MAX_MS=240000;
const METRICS=[['frio','cena'],['frio','jogavel'],['volta','cena'],['volta','jogavel']];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Infra extends Error {}

const listen=port=>new Promise(ok=>{const s=createServer();s.once('error',()=>ok(0));s.listen(port,'127.0.0.1',()=>{const got=s.address().port;s.close(()=>ok(got));});});
/** The rooms Worker accepts local origins only on the executors' vite ports (multiplayer/origins.ts: 4200–4399). */
async function sitePort(){
  for(let port=4359;port>=4340;port--)if(await listen(port))return port;
  throw new Infra('nenhuma porta livre em 4340–4359 para o site');
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

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.webm':'video/webm','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4'};
/**
 * A built site behind one shared slow link (a token bucket of KBPS, RTT before each response's first byte), ETag + 304
 * like a CDN; /multiplayer.json points at the local Worker. Bytes served are counted (the opening's weight).
 */
async function site(root,endpoint){
  root=resolve(root);
  const mp=JSON.stringify({...JSON.parse(readFileSync(join(root,'multiplayer.json'),'utf8')),endpoint});
  const perMs=KBPS*1000/8/1000;let linkFree=0;const stats={bytes:0,n:0};
  const srv=httpServer(async(req,res)=>{
    const path=decodeURIComponent(new URL(req.url||'/','http://x').pathname);
    try{
      await sleep(RTT);
      if(path==='/multiplayer.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'}).end(mp);return;}
      const f=resolve(root,'.'+(path==='/'?'/index.html':path));
      if(!f.startsWith(root+sep)){res.writeHead(403).end();return;}
      const st=await stat(f),etag=`"${st.size}-${Math.round(st.mtimeMs)}"`;
      if(req.headers['if-none-match']===etag){res.writeHead(304,{ETag:etag}).end();return;}
      const data=await readFile(f);
      res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream','Cache-Control':'no-cache',ETag:etag,'Content-Length':data.length});
      for(let i=0;i<data.length;i+=16384){
        const chunk=data.subarray(i,i+16384),now=Date.now(),start=Math.max(now,linkFree);linkFree=start+chunk.length/perMs;
        if(linkFree>now)await sleep(linkFree-now);
        if(!res.write(chunk))await new Promise(r=>res.once('drain',r));
      }
      res.end();stats.bytes+=data.length;stats.n++;
    }catch{if(!res.headersSent)res.writeHead(404).end('Not found');else res.destroy();}
  });
  const port=await sitePort();
  await new Promise((ok,ko)=>{srv.once('error',ko);srv.listen(port,'127.0.0.1',ok);});
  return {url:`http://127.0.0.1:${port}`,stats,close:()=>{srv.closeAllConnections?.();return new Promise(r=>srv.close(r));}};
}

/**
 * In the page, every 100 ms from the click (window.__ab.t0): `cena` = the scene exists (?perf=1 publishes it as
 * window.__perfScene), `jogavel` = the later of the loading cover gone and the waiting room gone (the board's fases.mjs
 * rule, so the numbers read the same; both only after 1 s, before the shell has drawn its cover).
 */
const PROBE=()=>{
  const A=window.__ab={t0:0,m:{}};
  const mark=(k,t)=>{if(A.m[k]===undefined)A.m[k]=Math.round(t);};
  setInterval(()=>{
    if(!A.t0)return;const t=performance.now()-A.t0;
    const shell=document.querySelector('dialog.explore-shell'),c=shell?.querySelector('canvas');
    const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
    const lay=shell?.querySelector('.explore-layout');
    const wait=!!lay&&[...lay.children].some(e=>vis(e)&&/coop-wait/.test(String(e.className)));
    const cover=!!shell?.querySelector('.explore-loading:not([hidden])');
    if(window.__perfScene)mark('cena',t);
    if(t>1000&&c&&!cover)mark('capa',t);
    if(t>1000&&c&&!wait)mark('sala',t);
    if(A.m.capa!==undefined&&A.m.sala!==undefined)mark('jogavel',Math.max(A.m.capa,A.m.sala));
  },100);
};
const SETTINGS=()=>{try{
  localStorage.setItem('viagem:solo-bots:v1','2');
  localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));
  localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));
}catch{}};

const frames=[],fails=[],avisos=[],runs=[];
/** One opening on a page of ctx: menu (the service worker in control, as a player who looks at it a few seconds) → click → playable. */
async function open(ctx,url,label,kind,print){
  const p=await ctx.newPage();const errors=[];
  p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  try{
    const cdp=await ctx.newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:CPU});
    await p.goto(`${url}/?perf=1`,{waitUntil:'load',timeout:180000});
    await p.waitForSelector('#confirm',{state:'attached',timeout:180000});
    await p.waitForFunction(()=>!!navigator.serviceWorker?.controller,null,{timeout:30000}).catch(()=>{});
    await sleep(2000);
    await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Folha';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card')?.click();document.getElementById('confirm').click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
    await p.evaluate(()=>{window.__ab.t0=performance.now();document.getElementById('enter-island').click();});
    let m={};
    for(const end=Date.now()+OPEN_MAX_MS;Date.now()<end;await sleep(500)){m=await p.evaluate(()=>window.__ab.m).catch(()=>m);if(m.jogavel!==undefined)break;}
    if(print){await sleep(300);const file=`ab-${label}-${kind}.jpg`;await p.screenshot({path:join(outDir,file),type:'jpeg',quality:70,timeout:30000}).then(()=>frames.push({file,caption:`abertura ${label} (${kind}): jogável em ${m.jogavel===undefined?'—':`${(m.jogavel/1000).toFixed(1)} s`} · 390×844`})).catch(()=>{});}
    return {cena:m.cena??null,jogavel:m.jogavel??null,errors};
  }finally{await p.close().catch(()=>{});}
}
/** One run of a build: a fresh profile (cold cache), then the returning player in the same profile. */
async function run(browser,build,label,print){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await ctx.addInitScript(SETTINGS);await ctx.addInitScript(PROBE);
  const before=build.stats.bytes;
  try{
    const frio=await open(ctx,build.url,label,'frio',print),kbFrio=Math.round((build.stats.bytes-before)/1024);
    const volta=await open(ctx,build.url,label,'volta',print);
    const r={label,frio:{cena:frio.cena,jogavel:frio.jogavel,kb:kbFrio},volta:{cena:volta.cena,jogavel:volta.jogavel},errors:[...frio.errors,...volta.errors].slice(0,5)};
    runs.push(r);
    console.log(`abertura ${label}: frio cena ${frio.cena} jogável ${frio.jogavel} (${kbFrio} KB) · volta cena ${volta.cena} jogável ${volta.jogavel}`);
    return r;
  }finally{await ctx.close().catch(()=>{});}
}

const median=l=>{const s=l.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:Math.round((s[s.length/2-1]+s[s.length/2])/2):null;};
/** (max − min) / median of a build's runs: how much this runner wobbles on the same build. */
const spread=l=>{const s=l.filter(Number.isFinite);const m=median(s);return s.length>1&&m?Math.round((Math.max(...s)-Math.min(...s))/m*100):null;};

let worker,code=0;const sites=[];
const result={ok:false,infra:false,cpu:CPU,kbps:KBPS,rttMs:RTT,pares:PARES,baseSha,piora:{},mediana:{},desvio:{},runs,fails,avisos,frames};
mkdirSync(outDir,{recursive:true});
try{
  if(!existsSync(join(dist,'multiplayer.json')))throw new Infra(`${dist}/multiplayer.json não existe: rode npm run build antes`);
  const hasBase=!!baseDist&&existsSync(join(baseDist,'multiplayer.json'));
  if(baseDist&&!hasBase)avisos.push(`abertura: build da main (${baseSha||baseDist}) não existe: sem comparação`);
  const {chromium}=await playwright();
  const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts','local-worker.mjs')).href);
  const workerPort=await listen(0);
  worker=await startLocalWorker({port:workerPort,logPath:join(tmpdir(),`viagem-abertura-worker-${workerPort}.log`)});
  const endpoint=`http://127.0.0.1:${workerPort}`;
  const branch=await site(dist,endpoint);sites.push(branch);
  const base=hasBase?await site(baseDist,endpoint):undefined;if(base)sites.push(base);
  // The first room of a fresh wrangler takes seconds to compile: not the opening's time.
  for(let i=0;i<3;i++){const t=Date.now();await fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:branch.url},body:'{"map":"cidade-nevada","solo":true}'}).catch(()=>{});if(Date.now()-t<3000)break;}
  let browser;
  try{browser=await chromium.launch();}catch(e){throw new Infra(`o navegador não abriu: ${String(e).split('\n')[0]}`);}
  try{
    for(let i=0;i<PARES;i++){
      const order=base?(i%2?[[base,'main'],[branch,'branch']]:[[branch,'branch'],[base,'main']]):[[branch,'branch']];
      for(const [b,label] of order)await run(browser,b,label,i===0);
    }
  }finally{await browser.close().catch(()=>{});}
  const of=(label,kind,k)=>runs.filter(r=>r.label===label).map(r=>r[kind][k]);
  for(const label of base?['branch','main']:['branch']){
    result.mediana[label]={};result.desvio[label]={};
    for(const [kind,k] of METRICS){result.mediana[label][`${kind}.${k}`]=median(of(label,kind,k));result.desvio[label][`${kind}.${k}`]=spread(of(label,kind,k));}
    result.mediana[label]['frio.kb']=median(of(label,'frio','kb'));
  }
  const miss=METRICS.filter(([kind,k])=>result.mediana.branch[`${kind}.${k}`]===null).map(([kind,k])=>`${kind} ${k}`);
  if(miss.length)fails.push(`abertura: o branch não chegou a ${miss.join(', ')} em ${OPEN_MAX_MS/1000} s`);
  if(runs.some(r=>r.label==='branch'&&r.errors.length))fails.push(`abertura: pageerror (${runs.find(r=>r.label==='branch'&&r.errors.length).errors[0]})`);
  if(base){
    for(const [kind,k] of METRICS){
      const key=`${kind}.${k}`,a=result.mediana.main[key],b=result.mediana.branch[key];
      if(a===null){avisos.push(`abertura: a main não chegou a ${kind} ${k}: sem comparação`);continue;}
      if(b===null)continue;
      const pct=Math.round((b-a)/a*100);result.piora[key]=pct;
      if(b-a>a*PIORA&&b-a>=PIORA_MIN_MS)fails.push(`abertura ${kind} ${k}: ${(b/1000).toFixed(1)} s, main ${(a/1000).toFixed(1)} s (+${pct} %, limite ${PIORA*100} %)`);
    }
  }
  result.ok=!fails.length;
}catch(e){
  result.infra=e instanceof Infra;code=result.infra?2:0;
  (result.infra?avisos:fails).push(`abertura: ${result.infra?'infra: ':'erro: '}${String(e.message??e).split('\n')[0]}`);
  console.log(`abertura: ${String(e.stack??e).split('\n').slice(0,3).join(' | ')}`);
}finally{
  for(const s of sites)await s.close().catch(()=>{});
  await Promise.resolve(worker?.stop()).catch(()=>{});
}
writeFileSync(join(outDir,'abertura.json'),JSON.stringify(result,null,1));
console.log(`abertura: ${result.ok?'ok':'FALHOU'} · ${JSON.stringify(result.mediana)} · piora ${JSON.stringify(result.piora)}${fails.length?` · ${fails.join(' | ')}`:''}`);
process.exit(code);
