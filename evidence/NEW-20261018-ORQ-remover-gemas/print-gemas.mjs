// D-054 evidence: a solo match on an emulated phone (390x844, DPR 1), built site + local rooms Worker; screenshots at the
// start and after fighting, with the XP bar (level + fill) sampled while the hero walks and holds the attack button.
// Run from the worktree root. Needs a browser slot (taken by the caller) and dist/ built.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const ROOT=process.cwd();
const {startLocalWorker}=await import(pathToFileURL(join(ROOT,'scripts/local-worker.mjs')).href);
const OUT=process.argv[2];
const PREVIEW_PORT=4219,WORKER_PORT=8797;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dist=resolve('dist'),mp=join(dist,'multiplayer.json'),original=readFileSync(mp,'utf8');
let worker,preview,browser;
const log=[];
try{
  worker=await startLocalWorker({port:WORKER_PORT,logPath:join(tmpdir(),`viagem-gemas-worker-${WORKER_PORT}.log`)});
  writeFileSync(mp,JSON.stringify({...JSON.parse(original),endpoint:worker.endpoint}));
  preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(PREVIEW_PORT),'--strictPort','--outDir',dist],{stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${PREVIEW_PORT}`;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/version.json')).ok)break;}catch{}await sleep(250);}
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  const cdp=await ctx.newCDPSession(p);
  await p.goto(base+'/',{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Gemas';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:240000,polling:1000});
  await sleep(3000);
  const xp=()=>p.evaluate(()=>{const l=document.querySelector('.rh-xp-level')?.textContent?.trim(),f=document.querySelector('.rh-xp-fill');
    return {level:l,fill:f?getComputedStyle(f).transform+' '+(f.style.width||f.style.transform||f.style.getPropertyValue('--f')||''):null,offer:!!document.querySelector('.rh-offer:not([hidden]),.rh-offer-chip:not([hidden])')};});
  log.push({t:0,...await xp()});
  await p.screenshot({path:join(OUT,'gemas-inicio.png')});
  const box=async sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return r.width?{x:r.x+r.width/2,y:r.y+r.height/2}:null;},sel);
  const stick=await box('.explore-stick'),attack=await box('#coop-attack');
  log.push({stick,attack});
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
  const t0=Date.now();let shot2=false;
  for(let i=0;Date.now()-t0<180000;i++){
    // Any open offer (D-050 pause): take the first card.
    await p.evaluate(()=>{const c=document.querySelector('.rh-offer:not([hidden]) .rh-card, .rh-offer:not([hidden]) button[data-index]');if(c)c.click();else{const chip=document.querySelector('.rh-offer-chip:not([hidden])');if(chip)chip.click();}});
    // Steer toward the nearest off-screen marker of a nest or a critter (the fight), else the square walk.
    const aim=await p.evaluate(()=>{const hero={x:innerWidth/2,y:innerHeight/2};let best=null;
      for(const e of document.querySelectorAll('.rh-edge:not([hidden])')){const k=e.dataset.kind||'',n=parseFloat(e.querySelector('.rh-edge-num')?.textContent||'999');
        if(!/ninho|bicho|enemy|inimigo|elite|chefe/.test(k))continue;const r=e.getBoundingClientRect();if(!best||n<best.n)best={n,k,x:r.x+r.width/2-hero.x,y:r.y+r.height/2-hero.y};}
      return {best,kinds:[...document.querySelectorAll('.rh-edge:not([hidden])')].map(e=>(e.dataset.kind||'?')+':'+(e.querySelector('.rh-edge-num')?.textContent||''))};});
    if(i%10===0)log.push({aim});
    let [dx,dy]=dirs[Math.floor(i/8)%4];const pts=[];
    if(aim.best){const l=Math.hypot(aim.best.x,aim.best.y)||1;dx=aim.best.x/l;dy=aim.best.y/l;}
    if(stick)pts.push({x:stick.x+dx*40,y:stick.y+dy*40,id:1});
    if(attack)pts.push({x:attack.x,y:attack.y,id:2});
    await touch(i===0?'touchStart':'touchMove',pts);
    await sleep(500);
    if(i%10===0)log.push({t:Math.round((Date.now()-t0)/1000),...await xp()});
    if(!shot2&&Date.now()-t0>120000){shot2=true;await p.screenshot({path:join(OUT,'gemas-luta.png')});}
  }
  await touch('touchEnd',[]);
  log.push({t:Math.round((Date.now()-t0)/1000),...await xp()});
  await p.screenshot({path:join(OUT,'gemas-fim.png')});
  log.push({errors});
}finally{
  writeFileSync(mp,original);
  try{await browser?.close();}catch{}
  try{preview?.kill();}catch{}
  try{await worker?.stop();}catch{}
  writeFileSync(join(OUT,'gemas-print.json'),JSON.stringify(log,null,1));
  console.log(JSON.stringify(log));
}
