#!/usr/bin/env node
// BUG-20261022-ORQ-minerva-acordar-trava: the end of the minuto de Minerva in a real match. A local rooms Worker
// (scripts/local-worker.mjs, LAB_SEED) and the vite DEV server already running (`--web`); one page plays "Jogar sozinho"
// with ?modo=ninhos&combate=manual. During the minute the hero (lab moves, {t:'lab',to}) walks up to a sleeper every
// STOP_S seconds (its band wakes and stands, held); FINAL_S before the end he stays beside one band (the user's print),
// and RUN_AT s after the end he walks RUN_U u away (the crowd loses him and walks home: the old freeze).
// Every 100 ms the frame tick against the wall clock (a room that freezes stops the ticks); from SHOT_FROM s before the
// end to SHOT_TO s after it a print every SHOT_MS (--saida: the prints, a GIF with ffmpeg and the JSON).
//   node scripts/prova-minerva.mjs [--web http://127.0.0.1:4205] [--port 8809] [--seed 4242] [--viewport 960x540] [--saida <dir>]
// Needs a browser slot (board locks/browser-1|2) taken by the caller.
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {startLocalWorker} from './local-worker.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const WEB=arg('web','http://127.0.0.1:4205'),PORT=Number(arg('port','8809')),SEED=arg('seed','4242'),OUT=arg('saida');
const [VW,VH]=arg('viewport','960x540').split('x').map(Number);
const STOP_S=2.5,FINAL_S=6,RUN_AT=2,RUN_U=22,SHOT_FROM=3,SHOT_TO=14,SHOT_MS=200,HZ=20;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(OUT)mkdirSync(OUT,{recursive:true});

let worker,browser;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-minerva-${PORT}`),logPath:join(tmpdir(),`viagem-minerva-worker-${PORT}.log`),vars:{LAB_SEED:SEED}});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  await p.goto(`${WEB}/?modo=ninhos&combate=manual`,{waitUntil:'load',timeout:120000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Prova';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  const until=await p.waitForFunction(()=>window.__island.scene.hooks.net.run?.minervaAteTick,null,{timeout:30000,polling:200}).then(h=>h.jsonValue());
  const net=fn=>p.evaluate(fn);
  const tick=()=>net(()=>window.__island.scene.hooks.net.tick);
  const move=to=>p.evaluate(to=>{const n=window.__island.scene.hooks.net;if(n.socket?.readyState===1)n.socket.send(JSON.stringify({t:'lab',to}));},to);
  /** The nearest sleeper at least `min` u from the hero (the feed: those within his interest radius). */
  const sleeper=min=>p.evaluate(min=>{const n=window.__island.scene.hooks.net,me=n.predicted;let best;
    for(const e of n.feed.enemies.values()){if(!(e.hp>0&&e.asleep))continue;const d=Math.hypot(e.x-me.x,e.y-me.y);if(d>=min&&(!best||d<best.d))best={x:e.x,y:e.y,d};}
    return best;},min);
  const awakeNear=()=>p.evaluate(()=>{const n=window.__island.scene.hooks.net,me=n.predicted;let a=0;for(const e of n.feed.enemies.values())if(e.hp>0&&!e.asleep&&Math.hypot(e.x-me.x,e.y-me.y)<12)a++;return a;});
  // The minute: a sleeper every STOP_S s, the last FINAL_S s beside one band.
  let stops=0;
  for(;;){
    const left=(until-await tick())/HZ;
    if(left<=FINAL_S)break;
    const s=await sleeper(3);
    if(s){await move({x:s.x+.9,y:s.y});stops++;}
    await sleep(STOP_S*1000);
  }
  const s=await sleeper(0);
  if(s)await move({x:s.x+.9,y:s.y});
  // The samples: frame tick against the wall clock, the prints around the end.
  const samples=[],shots=[];let ran=false,lastShot=0,k=0;
  const t0=Date.now();
  for(;;){
    const now=Date.now(),t=await tick(),dt=(t-until)/HZ;
    samples.push([now-t0,t]);
    if(dt>=RUN_AT&&!ran){ran=true;const me=await net(()=>window.__island.scene.hooks.net.predicted);await move({x:me.x+RUN_U,y:me.y});}
    if(OUT&&dt>=-SHOT_FROM&&dt<=SHOT_TO&&now-lastShot>=SHOT_MS){lastShot=now;const f=join(OUT,`q${String(k++).padStart(4,'0')}.png`);await p.screenshot({path:f});shots.push({f,dt:+dt.toFixed(2),awake:await awakeNear()});}
    if(dt>SHOT_TO)break;
    await sleep(100);
  }
  // Freezes: the longest wall-clock gap between two different frame ticks, and the worst 1 s window's ticks.
  let stall=0,prev=samples[0];
  for(const s of samples){if(s[1]!==prev[1]){stall=Math.max(stall,s[0]-prev[0]);prev=s;}}
  const rate=[];for(const [w,t] of samples){const b=samples.find(([w2])=>w2>=w+1000);if(b)rate.push((b[1]-t)/((b[0]-w)/1000));}
  const result={seed:SEED,until,stops,longestStallMs:stall,ticksPerSecond:{min:+Math.min(...rate).toFixed(1),mean:+(rate.reduce((a,b)=>a+b,0)/rate.length).toFixed(1)},
    shots:shots.map(({dt,awake})=>({dt,awake})),errors:errors.slice(0,5)};
  console.log(JSON.stringify(result));
  if(OUT){
    writeFileSync(join(OUT,'prova-minerva.json'),JSON.stringify(result,null,1));
    const fps=String(Math.round(1000/SHOT_MS));
    execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',fps,'-i',join(OUT,'q%04d.png'),'-vf','fps='+fps+',scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer','-loop','0',join(OUT,'minerva-acordar.gif')]);
  }
}finally{
  try{await browser?.close();}catch{}
  try{await worker?.stop();}catch{}
}
