#!/usr/bin/env node
// Card NEW-20261022-ORQ-horda-visivel-capacidade: how many critters a player SEES, standing on the plaza and walking,
// at one sleeper cap per run. A local rooms Worker (scripts/local-worker.mjs, LAB_SEED: the same city plan every run;
// LAB_ASLEEP: the cap) and the vite DEV server already running (`--web`, window.__island.probe needs DEV); one page
// plays "Jogar sozinho" with ?modo=ninhos&combate=manual (the hero never shoots, so nothing wakes but a walk-up).
// Plaza: PLAZA_S seconds standing still. Walk: lab moves ({t:'lab',to}) along `--rota` (scripts/rota-horda-visivel.ts, the
// same seed: start → the edges of the 3 nests nearest, never within 6 u of a sleeper), a point every 500 ms (6.2 u/s).
// Every 500 ms: critters on screen (awake / asleep), held by the client; every frame's interval (FPS).
//   node scripts/prova-horda-visivel.mjs --cap 48|300|600|sem --rota <rota.json> [--web http://127.0.0.1:4202] [--port 8802]
//     [--viewport 1920x1080] [--mobile] [--cpu 1] [--seed 4242] [--saida <dir>]
// Needs a browser slot (board locks/browser-1|2) taken by the caller. Prints a JSON summary; --saida writes it and the prints.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const CAP=arg('cap','48'),WEB=arg('web','http://127.0.0.1:4202'),PORT=Number(arg('port','8802')),SEED=arg('seed','4242');
const [VW,VH]=arg('viewport','1920x1080').split('x').map(Number),MOBILE=process.argv.includes('--mobile'),CPU=Number(arg('cpu','1'));
const ROTA=arg('rota'),PONTO=arg('ponto')?.split(',').map(Number),OUT=arg('saida'),PLAZA_S=Number(arg('praca','10')),WALK_S=Number(arg('andar','60'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(s,q)=>{const a=[...s].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(q*a.length))]:0;};
const mean=s=>s.reduce((a,b)=>a+b,0)/Math.max(1,s.length);
const r1=v=>Math.round(v*10)/10;
if(OUT)mkdirSync(OUT,{recursive:true});
const tag=`${CAP}-${VW}x${VH}${MOBILE?'-cel':''}`;

let worker,browser;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-horda-${PORT}`),logPath:join(tmpdir(),`viagem-horda-worker-${PORT}.log`),
    vars:{LAB_SEED:SEED,...(CAP==='48'?{}:{LAB_ASLEEP:CAP})}});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,...(MOBILE?{isMobile:true,hasTouch:true}:{})});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(()=>{const w=window;w.__fase='';w.__quadros=[];let last=0;const f=t=>{if(last&&w.__fase)w.__quadros.push([w.__fase,t-last]);last=t;requestAnimationFrame(f);};requestAnimationFrame(f);
    try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  const cdp=await ctx.newCDPSession(p);
  await p.goto(`${WEB}/?modo=ninhos&combate=manual`,{waitUntil:'load',timeout:120000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Prova';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card[data-hero]:not([data-bloqueado])').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  await sleep(5000); // the first frames settle (art, the first chunks)
  if(CPU>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:CPU});
  /** One sample: critters on screen (awake / asleep), held, the hero's world point. */
  const sample=()=>p.evaluate(()=>{
    const isl=window.__island,pr=isl.probe(),net=isl.scene.hooks.net,feed=net.feed.enemies;
    let awake=0,asleep=0,heldAsleep=0;
    for(const e of feed.values())if(e.hp>0&&e.asleep)heldAsleep++;
    for(const e of pr.enemies){if(e.x<0||e.y<0||e.x>innerWidth||e.y>innerHeight)continue;if(feed.get(e.id)?.asleep)asleep++;else awake++;}
    let near12=0;for(const e of feed.values())if(e.hp>0&&Math.hypot(e.x-net.predicted.x,e.y-net.predicted.y)<12)near12++;
    return {awake,asleep,onScreen:awake+asleep,held:pr.enemies.length,heldAsleep,near12,at:{x:net.predicted.x,y:net.predicted.y}};
  });
  const run=async(fase,seconds,each)=>{
    await p.evaluate(f=>{window.__fase=f;},fase);
    const list=[],t0=Date.now();
    while(Date.now()-t0<seconds*1000){if(each)await each((Date.now()-t0)/1000);list.push(await sample());await sleep(500);}
    await p.evaluate(()=>{window.__fase='';});
    return list;
  };
  const shot=async name=>{if(OUT)await p.screenshot({path:join(OUT,`${tag}-${name}.png`)});};
  // --ponto x,y: stand there instead of the plaza (a lab move; the plaza samples become that point's).
  if(PONTO){await p.evaluate(([x,y])=>window.__island.scene.hooks.net.socket.send(JSON.stringify({t:'lab',to:{x,y}})),PONTO);await sleep(1500);}
  const plaza=await run('praca',PLAZA_S);
  const camera=await p.evaluate(()=>{const pr=window.__island.probe();return {zoom:pr.zoom,heroPx:pr.camera.heroPx,view:pr.view};});
  if(process.argv.includes('--dump'))console.error(JSON.stringify(await p.evaluate(()=>{const isl=window.__island,pr=isl.probe(),net=isl.scene.hooks.net,me=net.predicted;
    const near=[...net.feed.enemies.values()].filter(e=>Math.hypot(e.x-me.x,e.y-me.y)<12);
    return {me,view:pr.view,zoom:pr.zoom,heroPx:pr.camera.heroPx,hero:pr.hero,near:near.slice(0,8).map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp,asleep:e.asleep,scr:pr.enemies.find(q=>q.id===e.id)})),
      horde:pr.horde};})));
  await shot('praca');
  // The walk: the route's points (scripts/rota-horda-visivel.ts, the same seed), one lab move every 500 ms (6.2 u/s).
  const route=JSON.parse(readFileSync(ROTA,'utf8')).points;
  const shots=new Set([20,40]);let k=0,missed=0;
  const walk=await run('andar',Math.min(WALK_S,route.length/2),async t=>{
    const s=Math.floor(t/20)*20;if(s&&shots.has(s)){shots.delete(s);await shot(`andar-${s}s`);}
    k=Math.min(route.length-1,Math.floor(t*2));const [x,y]=route[k];
    const off=await p.evaluate(to=>{const net=window.__island.scene.hooks.net,me=net.predicted;
      if(net.socket?.readyState===1)net.socket.send(JSON.stringify({t:'lab',to}));return Math.hypot(me.x-to.x,me.y-to.y);},{x,y});
    if(off>8)missed++;
  });
  await shot('andar-fim');
  const frames=await p.evaluate(()=>window.__quadros);
  const fps=f=>{const d=frames.filter(([x])=>x===f).map(([,ms])=>ms);return {fpsMean:r1(1000/mean(d)),p95FrameMs:r1(pct(d,.95)),over50ms:d.filter(x=>x>50).length};};
  const sum=list=>!list.length?null:({onScreen:{mean:r1(mean(list.map(s=>s.onScreen))),max:Math.max(...list.map(s=>s.onScreen))},
    asleepOnScreen:{mean:r1(mean(list.map(s=>s.asleep))),max:Math.max(...list.map(s=>s.asleep))},
    awakeOnScreen:{mean:r1(mean(list.map(s=>s.awake))),max:Math.max(...list.map(s=>s.awake))},
    held:{mean:r1(mean(list.map(s=>s.held))),max:Math.max(...list.map(s=>s.held))},
    walked:r1(Math.hypot(list.at(-1).at.x-list[0].at.x,list.at(-1).at.y-list[0].at.y))});
  const result={cap:CAP,viewport:`${VW}x${VH}`,mobile:MOBILE,cpu:CPU,seed:SEED,camera,praca:{...sum(plaza),...fps('praca')},andar:{...sum(walk),...fps('andar')},
    errors:errors.slice(0,5),routePoints:route.length,offRoute:missed,trail:walk.filter((_,i)=>i%10===0).map(s=>({x:r1(s.at.x),y:r1(s.at.y),on:s.onScreen}))};
  console.log(JSON.stringify(result));
  if(OUT)writeFileSync(join(OUT,`${tag}.json`),JSON.stringify(result,null,1));
}finally{
  try{await browser?.close();}catch{}
  try{await worker?.stop();}catch{}
}
