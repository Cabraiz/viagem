#!/usr/bin/env node
/**
 * VGM-048 · lab numbers for docs/desempenho.md (a 2-core container without GPU: not a phone, see VGM-051).
 *
 *   node scripts/perf-lab.mjs weight  [--web http://127.0.0.1:4187]           first load of the built site (scripts/serve.mjs)
 *   node scripts/perf-lab.mjs scene   [--web http://127.0.0.1:4325] [--rooms http://127.0.0.1:8826]
 *        [--seconds 40] [--cpu 1|4] [--economy off|on|auto] [--shots <dir>]
 *     One phone (Playwright, isMobile, DPR 3, 390×844) owns a room on `wrangler dev` (ALLOW_LOCAL, LAB_HORDE=300 for the
 *     high horde) and adds 5 room bots: 6 players. Measures the drawn frames (Phaser postrender), the JS heap, the
 *     WebSocket bytes and messages of this client (CDP), the room's tick p50/p95 (/lab) and the canvas pixels per CSS px.
 *     --economy: off (saved off and declined, the FPS watch stays quiet), on (saved on), auto (default settings: the
 *     watch may turn it on; the run reports when). --shots: prints of the settings and the toast in both orientations.
 *
 * Playwright comes from PLAYWRIGHT (a path) or the cloud tools folder; Chromium from CHROMIUM (default /opt/pw-browsers/chromium).
 * Prints a JSON report on stdout.
 */
import {createRequire} from 'node:module';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {join,resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT??'/home/claude/tools/node_modules/playwright');
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const mode=process.argv[2]??'scene';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.error(new Date().toISOString().slice(11,19),...a);
const pct=(list,q)=>{if(!list.length)return 0;const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const round=(n,d=1)=>Math.round(n*10**d)/10**d;
const PORTRAIT={width:390,height:844},LANDSCAPE={width:844,height:390};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM??'/opt/pw-browsers/chromium'});
const phone=()=>browser.newContext({viewport:PORTRAIT,isMobile:true,hasTouch:true,deviceScaleFactor:3});

async function weight(){
  const web=arg('web','http://127.0.0.1:4187'),dist=resolve('dist');
  const ctx=await phone(),page=await ctx.newPage(),loaded=[];
  page.on('requestfinished',r=>{const u=new URL(r.url());if(u.origin===web)loaded.push(u.pathname);});
  const t0=Date.now();await page.goto(web+'/',{waitUntil:'load'});const loadMs=Date.now()-t0;
  await wait(1500);
  const timing=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];const fcp=performance.getEntriesByName('first-contentful-paint')[0];return {domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),fcp:fcp&&Math.round(fcp.startTime)};});
  const files=[...new Set(loaded)].map(p=>{const f=join(dist,p==='/'?'index.html':p.slice(1));if(!existsSync(f))return {path:p,raw:0,gzip:0,brotli:0};const b=readFileSync(f);
    return {path:p,raw:b.length,gzip:gzipSync(b,{level:9}).length,brotli:brotliCompressSync(b).length};});
  const sum=k=>files.reduce((a,f)=>a+f[k],0);
  // The scene chunks (Phaser and the game) load on "Jogar": every JS file in dist/assets not in the first load.
  const assets=join(dist,'assets'),first=new Set(files.map(f=>f.path));
  const {readdirSync}=await import('node:fs');
  const later=readdirSync(assets).filter(n=>n.endsWith('.js')&&!first.has('/assets/'+n)).map(n=>{const b=readFileSync(join(assets,n));return {path:'/assets/'+n,raw:b.length,gzip:gzipSync(b,{level:9}).length,brotli:brotliCompressSync(b).length};}).sort((a,b)=>b.raw-a.raw);
  await ctx.close();
  return {web,loadMs,timing,firstLoad:{files:files.length,raw:sum('raw'),gzip:sum('gzip'),brotli:sum('brotli'),byType:Object.entries(files.reduce((m,f)=>{const t=f.path.split('.').pop();m[t]=(m[t]??0)+f.raw;return m;},{})),biggest:files.sort((a,b)=>b.raw-a.raw).slice(0,8)},
    lazyJs:{files:later.length,raw:later.reduce((a,f)=>a+f.raw,0),gzip:later.reduce((a,f)=>a+f.gzip,0),brotli:later.reduce((a,f)=>a+f.brotli,0),biggest:later.slice(0,5)}};
}

async function scene(){
  const web=arg('web','http://127.0.0.1:4325'),rooms=arg('rooms','http://127.0.0.1:8826');
  const seconds=Number(arg('seconds','40')),cpu=Number(arg('cpu','1')),economy=arg('economy','off'),shots=arg('shots');
  const created=await fetch(rooms+'/rooms',{method:'POST',headers:{Origin:web}});if(created.status!==201)throw new Error('room '+created.status);
  const {code}=await created.json();log('room',code,'cpu',cpu,'economy',economy);
  const lab=()=>fetch(`${rooms}/lab/${code}`,{headers:{Origin:web}}).then(r=>r.json());
  const ctx=await phone();
  await ctx.addInitScript(value=>{try{if(value==='off')localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));
    else if(value==='on')localStorage.setItem('viagem:economia:v1',JSON.stringify({on:true,auto:false,declined:false}));
    else localStorage.removeItem('viagem:economia:v1');}catch{}},economy);
  const page=await ctx.newPage();
  page.on('pageerror',e=>log('pageerror',e.message));
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Performance.enable');
  const ws={in:{n:0,bytes:0,binary:0,text:0},out:{n:0,bytes:0}};let counting=false;
  // Binary frames come base64 (opcode 2), text frames as is (opcode 1).
  const size=f=>f.opcode===2?Math.floor(f.payloadData.length*3/4)-(f.payloadData.endsWith('==')?2:f.payloadData.endsWith('=')?1:0):Buffer.byteLength(f.payloadData);
  cdp.on('Network.webSocketFrameReceived',e=>{if(!counting)return;ws.in.n++;ws.in.bytes+=size(e.response);if(e.response.opcode===2)ws.in.binary++;else ws.in.text++;});
  cdp.on('Network.webSocketFrameSent',e=>{if(!counting)return;ws.out.n++;ws.out.bytes+=size(e.response);});
  await page.goto(web+'/');
  const joined=await page.evaluate(async([code,rooms])=>{
    const {CoopClient}=await import('/src/game/net/client.ts');const {classes}=await import('/src/classes.ts');
    const c=new CoopClient(rooms,code,'Tia Cleide Aparecida','cidadao-comum');window.__net=c;
    try{await c.join();}catch(e){return String(e.message);}
    const {openExploration}=await import('/src/game/explore.ts');const {mountWaitingRoom}=await import('/src/game/lobby.ts');
    void openExploration(classes.find(k=>k.id==='cidadao-comum'),'Tia Cleide Aparecida',c);
    const layout=document.querySelector('dialog.explore-shell .explore-layout');if(layout)mountWaitingRoom(layout,c);
    return 'ok';
  },[code,rooms]);
  if(joined!=='ok')throw new Error(joined);
  await page.waitForFunction(()=>window.__island?.scene?.sys?.isActive?.(),null,{timeout:120000});
  for(let i=0;i<5;i++){await page.evaluate(()=>window.__net.addBot());await wait(450);}
  await page.waitForFunction(()=>window.__net.run?.members?.length===6,null,{timeout:20000});
  await page.evaluate(()=>window.__net.ready(true));
  await page.waitForFunction(()=>window.__net.run?.phase==='combat',null,{timeout:60000});
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  // Frames Phaser really drew (postrender), not rAF callbacks: the 30 fps gate skips rAFs.
  await page.evaluate(()=>{const g=window.__island.game;window.__frames=[];g.events.on('postrender',()=>window.__frames.push(performance.now()));});
  // The horde fills up (LAB_HORDE) and the scene warms its pools before the window.
  await wait(8000);
  const economyAtStart=await page.evaluate(()=>window.__island.probe().economy);
  await page.evaluate(()=>{window.__frames.length=0;});
  const metrics=async()=>{const m=await cdp.send('Performance.getMetrics');return Object.fromEntries(m.metrics.map(x=>[x.name,x.value]));};
  const m0=await metrics();
  counting=true;const t0=Date.now();const heap=[];const enemies=[];
  let toastShot=false,economyOnAt;
  // The lab draws ~1 frame/s, so a print pair outlives the toast's 9 s: it is held on screen for the prints (noted).
  const shot=async(label)=>{const keep=label.startsWith('aviso');
    for(const [o,vp] of [['retrato',PORTRAIT],['paisagem',LANDSCAPE]]){await page.setViewportSize(vp);
      if(keep)await page.evaluate(()=>{document.querySelector('.economy-toast').hidden=false;});
      await wait(1500);
      if(keep)log(o,await page.evaluate(()=>{const t=document.querySelector('.economy-toast');const r=t.getBoundingClientRect();const cs=getComputedStyle(t);
        return JSON.stringify({hidden:t.hidden,parent:t.parentElement?.className,hud:t.closest('.rh')?.hidden,rect:[r.x,r.y,r.width,r.height].map(Math.round),display:cs.display,vis:cs.visibility,op:cs.opacity});}));
      await page.screenshot({path:`${shots}/${label}-${o}.png`});}
    await page.setViewportSize(PORTRAIT);};
  if(shots)mkdirSync(shots,{recursive:true});
  while(Date.now()-t0<seconds*1000){
    for(let i=0;i<20;i++){
      await wait(250);
      if(economyOnAt===undefined&&await page.evaluate(()=>window.__island.scene.economyOn)){
        economyOnAt=round((Date.now()-t0)/1000);log('economy on at',economyOnAt,'s');
        // The toast stays 9 s: print it now (the frames of these seconds are the print's, noted in the report).
        if(shots&&!toastShot&&await page.evaluate(()=>!document.querySelector('.economy-toast').hidden)){await shot('aviso-ligou-sozinho');toastShot=true;}
      }
    }
    const m=await cdp.send('Performance.getMetrics');const get=k=>m.metrics.find(x=>x.name===k)?.value??0;
    heap.push(get('JSHeapUsedSize'));
    enemies.push(await page.evaluate(()=>window.__net.feed.enemies.size));
  }
  counting=false;const span=(Date.now()-t0)/1000;const m1=await metrics();
  const frames=await page.evaluate(()=>{const f=window.__frames,d=[];for(let i=1;i<f.length;i++)d.push(f[i]-f[i-1]);return {count:f.length,first:f[0],last:f[f.length-1],deltas:d};});
  const fps=frames.count>1?(frames.count-1)*1000/(frames.last-frames.first):0;
  // Main-thread time per drawn frame (CDP, seconds → ms): steadier than fps on a shared 2-core box.
  const busy=k=>(m1[k]-m0[k])*1000;
  const mainThread={taskMsPerFrame:round(busy('TaskDuration')/Math.max(1,frames.count),1),scriptMsPerFrame:round(busy('ScriptDuration')/Math.max(1,frames.count),1),
    busyShare:round(busy('TaskDuration')/(span*1000),2)};
  const room=await lab();
  const probe=await page.evaluate(()=>{const p=window.__island.probe();const c=document.querySelector('.explore-canvas canvas');
    return {economy:p.economy,fpsWatch:p.fps,enemies:p.horde,canvas:{width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight},dpr:devicePixelRatio,
      toast:!document.querySelector('.economy-toast')?.hidden,
      hudText:(()=>{const e=document.querySelector('.rh-top, .rh-bar, .explore-config');return e?{font:getComputedStyle(e).fontSize}:null;})()};});
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const report={code,cpu,economySetting:economy,economyAtStart,economyAtEnd:probe.economy,economyOnAtS:economyOnAt,toastPrintedDuringWindow:toastShot,seconds:round(span),
    fps:round(fps),frameMs:{p50:round(pct(frames.deltas,.5)),p95:round(pct(frames.deltas,.95)),max:round(Math.max(0,...frames.deltas))},
    mainThread,fpsWatchWindows:probe.fpsWatch,toastShown:probe.toast,
    heapMB:{min:round(Math.min(...heap)/2**20),max:round(Math.max(...heap)/2**20),last:round(heap.at(-1)/2**20)},
    enemiesOnClient:{min:Math.min(...enemies),max:Math.max(...enemies)},
    client:{inPerS:round(ws.in.n/span),inBytesPerS:Math.round(ws.in.bytes/span),inKBps:round(ws.in.bytes/span/1024,2),binaryPerS:round(ws.in.binary/span),textPerS:round(ws.in.text/span),
      outPerS:round(ws.out.n/span),outBytesPerS:Math.round(ws.out.bytes/span)},
    room:{tickP50:room.tickP50,tickP95:room.tickP95,maxTickMs:room.maxTickMs,encodeP50:room.encodeP50,encodeP95:room.encodeP95,enemies:room.enemies,bots:room.bots,clock:room.clock,
      ticks:room.ticks,meanTickMs:round(room.tickMs/Math.max(1,room.ticks),2)},
    canvas:probe.canvas,canvasPxPerCssPx:round(probe.canvas.width/probe.canvas.cssWidth,2),devicePixelRatio:probe.dpr};
  if(shots){
    // The watch never fired in this run (economy still off, never declined here): the same hook the scene calls.
    if(!toastShot&&economy==='auto'&&!probe.economy)await page.evaluate(()=>window.__island.scene.hooks.slow?.());
    await wait(300);report.toastPrint=toastShot||await page.evaluate(()=>!document.querySelector('.economy-toast').hidden);
    if(report.toastPrint&&!toastShot)await shot('aviso-ligou-sozinho');
    await page.evaluate(()=>document.querySelector('.explore-config').click());await wait(600);
    await shot('configuracoes-modo-economico');
    report.settings=await page.evaluate(()=>{const b=document.querySelector('.explore-economy');const r=b.getBoundingClientRect();return {text:b.textContent,pressed:b.getAttribute('aria-pressed'),w:Math.round(r.width),h:Math.round(r.height),
      fonts:[...b.querySelectorAll('span')].map(s=>getComputedStyle(s).fontSize)};});
    // One tap turns it off (and the phone remembers the "no"): the same switch, off.
    await page.evaluate(()=>document.querySelector('.explore-economy').click());await wait(400);
    await shot('configuracoes-modo-economico-desligado');
    report.afterTap=await page.evaluate(()=>({pressed:document.querySelector('.explore-economy').getAttribute('aria-pressed'),scene:window.__island.scene.economyOn,saved:localStorage.getItem('viagem:economia:v1')}));
  }
  await page.evaluate(()=>{try{window.__net.socket.send(JSON.stringify({t:'lab',end:true}));}catch{}});
  await ctx.close();
  return report;
}

try{
  const out=mode==='weight'?await weight():await scene();
  console.log(JSON.stringify(out,null,1));
}finally{await browser.close();}
