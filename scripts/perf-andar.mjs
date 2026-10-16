#!/usr/bin/env node
// BUG-20261014-ORQ-engasgo-andando-celular: the stutter while WALKING on a phone, measured the same way before and after.
// The built site (dist/) on `vite preview` and a local rooms Worker (scripts/local-worker.mjs), like the production
// smoke; one emulated phone (touch, 390×844, DPR --dpr, CPU --cpu × slower) plays "Jogar sozinho" with ?perf=1 and walks
// with the joystick (real touch events): a zigzag into areas it has not seen ("nova"), then the same legs back ("vista").
// Per pass: frame p50/p95/p99, frames > 50 and > 100 ms, travadas/min; the stalls with their causes (dev/perf-meter.ts:
// bake, chunk, upload, rede, hud, logica, render, gc?, ?) summed; and the relief baker's counters.
//   node scripts/perf-andar.mjs [--dist dist] [--dpr 3] [--cpu 4] [--perna 6] [--perfil 8] [--saida <dir>] [--print <png>]
// Needs `npm run build` first and a free browser slot (board locks/browser-1|2, taken here). dist/multiplayer.json is
// restored on every way out. Prints a JSON summary; with --saida also writes it there.
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const DPR=Number(arg('dpr','3')),CPU=Number(arg('cpu','4')),LEG_S=Number(arg('perna','6')),OUT=arg('saida');
/** --perfil N: a CPU profile of the first N s of the "nova" pass, its self time summed by function (the top 25). */
const PROFILE_S=Number(arg('perfil','0'));
/** --print <file.png>: the screen at the end of the walk, with the ?perf=1 panel open (its last stalls). */
const PRINT=arg('print');
const PREVIEW_PORT=Number(process.env.PERF_PORT??4208),WORKER_PORT=Number(process.env.PERF_WORKER_PORT??8788);
const BOARD=process.env.VIAGEM_BOARD??'D:/Gits/viagem-board';
/** --dist <dir>: another build (e.g. the main of before, for the before/after); default dist/. */
const dist=resolve(arg('dist','dist')),mp=join(dist,'multiplayer.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(s,q)=>s.length?s[Math.min(s.length-1,Math.floor(q*s.length))]:0;
/** The zigzag (joystick directions, screen: x right, y down) into new areas; the "vista" pass walks it back reversed. */
const LEGS=[[0,-1],[1,0],[0,-1],[-1,0],[0,-1],[1,-1],[-1,-1],[1,0]];

/** A CDP profile's self time (ms) by function name and file:line, the top 25, and the total sampled. */
function selfTime(profile){
  const byId=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map(),dt=profile.timeDeltas;let total=0;
  profile.samples.forEach((id,i)=>{const n=byId.get(id),f=n.callFrame,ms=(dt[i]??0)/1000;total+=ms;
    const k=`${f.functionName||'(anon)'} ${f.url.split('/').pop()}:${f.lineNumber+1}`;self.set(k,(self.get(k)??0)+ms);});
  return {totalMs:Math.round(total),top:[...self].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,ms])=>[k,Math.round(ms)])};
}
if(!existsSync(mp))throw new Error('dist/multiplayer.json não existe: npm run build antes');
const original=readFileSync(mp,'utf8');
let restored=false;const restore=()=>{if(!restored){restored=true;writeFileSync(mp,original);}};
process.on('exit',restore);

// The browser slot (ESCALA: at most 2 headless on the PC).
let slot;
for(let tries=0;!slot;tries++){
  for(const n of [2,1]){const dir=join(BOARD,'locks',`browser-${n}`);try{mkdirSync(dir);writeFileSync(join(dir,'owner.txt'),`Executor-8 perf-andar ${new Date().toISOString()} pid ${process.pid}`);slot=dir;break;}catch{}}
  if(!slot){if(tries===0)console.error('esperando uma vaga de navegador (locks/browser-1|2)…');await sleep(15000);}
}
const freeSlot=()=>{try{if(readFileSync(join(slot,'owner.txt'),'utf8').includes(`pid ${process.pid}`))rmSync(slot,{recursive:true,force:true});}catch{}};

let worker,preview,browser;
try{
  worker=await startLocalWorker({port:WORKER_PORT,logPath:join(tmpdir(),`viagem-perf-worker-${WORKER_PORT}.log`)});
  writeFileSync(mp,JSON.stringify({...JSON.parse(original),endpoint:worker.endpoint}));
  preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(PREVIEW_PORT),'--strictPort','--outDir',dist],{stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${PREVIEW_PORT}`;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/version.json')).ok)break;}catch{}await sleep(250);}
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[]});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:DPR});
  // Every animation frame's interval, tagged with the pass the script is in.
  await ctx.addInitScript(()=>{const w=window;w.__fase='';w.__quadros=[];let last=0;const f=t=>{if(last&&w.__fase)w.__quadros.push([w.__fase,t-last]);last=t;requestAnimationFrame(f);};requestAnimationFrame(f);
    try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  const cdp=await ctx.newCDPSession(p);
  await p.goto(`${base}/?perf=1`,{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Perf';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:240000,polling:1000});
  await sleep(4000); // the first frames of the match settle (art, the first chunks)
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:CPU});
  const stick=await p.evaluate(()=>{const r=document.querySelector('.explore-stick').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  const walk=async(legs,fase)=>{
    await p.evaluate(f=>{window.__fase=f;},fase);
    const t0=Date.now();
    await touch('touchStart',stick.x,stick.y);
    for(const [dx,dy] of legs){
      const l=Math.hypot(dx,dy),x=stick.x+dx/l*44,y=stick.y+dy/l*44;
      for(let t=0;t<LEG_S*1000;t+=250){await touch('touchMove',x+(t%500?1:0),y);await sleep(250);}
    }
    await touch('touchEnd',0,0);
    await p.evaluate(()=>{window.__fase='';});
    return (Date.now()-t0)/1000;
  };
  await p.evaluate(()=>{const m=window.__perf?.meter;if(m)m.stalls.length=0;});
  let perfil;
  if(PROFILE_S>0){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
    setTimeout(async()=>{try{const {profile}=await cdp.send('Profiler.stop');perfil=selfTime(profile);}catch(e){perfil=String(e);}},PROFILE_S*1000);}
  const novaS=await walk(LEGS,'nova');
  while(PROFILE_S>0&&!perfil)await sleep(200);
  const stallsNova=await p.evaluate(()=>window.__perf?.meter.stalls.map(s=>({ms:s.ms,causes:s.causes}))??[]);
  await p.evaluate(()=>{const m=window.__perf?.meter;if(m)m.stalls.length=0;});
  const vistaS=await walk([...LEGS].reverse().map(([x,y])=>[-x,-y]),'vista');
  const stallsVista=await p.evaluate(()=>window.__perf?.meter.stalls.map(s=>({ms:s.ms,causes:s.causes}))??[]);
  if(PRINT){await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await p.evaluate(()=>document.querySelector('.perf-hud')?.dispatchEvent(new MouseEvent('click')));await sleep(600);await p.screenshot({path:PRINT});}
  const inventario=await p.evaluate(()=>window.__perf?.inventario?.());
  const quadros=await p.evaluate(()=>window.__quadros);
  const canvas=await p.evaluate(()=>{const c=document.querySelector('canvas');return c?`${c.width}×${c.height}`:'';});
  const pass=(fase,seconds,stalls)=>{
    const dts=quadros.filter(q=>q[0]===fase).map(q=>q[1]).sort((a,b)=>a-b);
    const by={};for(const s of stalls)for(const c of s.causes)by[c.kind]=Math.round((by[c.kind]??0)+c.ms);
    return {segundos:Math.round(seconds),quadros:dts.length,p50:+pct(dts,.5).toFixed(1),p95:+pct(dts,.95).toFixed(1),p99:+pct(dts,.99).toFixed(1),
      acima50:dts.filter(d=>d>50).length,acima100:dts.filter(d=>d>100).length,travadasMin:+(dts.filter(d=>d>50).length*60/seconds).toFixed(1),
      pior:Math.round(dts.at(-1)??0),causas:Object.entries(by).sort((a,b)=>b[1]-a[1])};
  };
  const report={dpr:DPR,cpu:CPU,canvas,pernaS:LEG_S,inventario,...(perfil?{perfil}:{}),nova:pass('nova',novaS,stallsNova),vista:pass('vista',vistaS,stallsVista),errors};
  console.log(JSON.stringify(report,null,1));
  if(OUT){mkdirSync(OUT,{recursive:true});writeFileSync(join(OUT,`perf-andar-dpr${DPR}-cpu${CPU}-${Date.now()}.json`),JSON.stringify(report,null,1));}
}finally{
  restore();
  await browser?.close().catch(()=>{});
  try{preview?.kill();}catch{}
  await worker?.stop().catch(()=>{});
  freeSlot();
}
process.exit(0);
