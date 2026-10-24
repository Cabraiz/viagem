#!/usr/bin/env node
/**
 * Client frame rate with a full room (NEW-20261024-ORQ-sala-ate-10-jogadores): one phone (Playwright, isMobile,
 * hasTouch, DPR 1 by the PC rule) or a PC window opens the game from vite, creates a room on the local rooms Worker
 * (wrangler dev, ALLOW_LOCAL) the way the page does (city, chaveiro, nests, manual combat), adds `players-1` room
 * bots (they escort the person, so the whole team is on screen) and plays: the person's hero walks a slow circle.
 * After the warm-up it counts the frames Phaser really drew (postrender) for `seconds`, with the CPU throttled
 * (`cpu`, 4 = a mid phone), and reads how many heroes and critters the scene holds.
 *
 *   node scripts/fps-sala-n.mjs --players 10 --web http://127.0.0.1:4207 --rooms http://127.0.0.1:8807
 *     [--device phone|pc] [--cpu 4] [--seconds 60] [--warmup 20] [--gpu] [--shot path.png] [--out path.json]
 *
 * Playwright: PLAYWRIGHT (a path) or D:/Gits/viagem-tools/node_modules/playwright. Prints a JSON report on stdout.
 * Heavy (vite + wrangler + a browser): only with the heavy slot (D:/Gits/viagem-board/tools/pesado.mjs).
 */
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT??'D:/Gits/viagem-tools/node_modules/playwright');
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const players=Number(arg('players','10')),device=arg('device','phone'),cpu=Number(arg('cpu',device==='phone'?'4':'1'));
const seconds=Number(arg('seconds','60')),warmup=Number(arg('warmup','20')),web=arg('web','http://127.0.0.1:4207'),rooms=arg('rooms','http://127.0.0.1:8807');
const shot=arg('shot'),out=arg('out');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.error(new Date().toISOString().slice(11,19),...a);
const pct=(list,q)=>{if(!list.length)return 0;const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const round=(n,d=1)=>Math.round(n*10**d)/10**d;

const args=process.argv.includes('--gpu')?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[];
const browser=await chromium.launch({args});
try{
  const ctx=await browser.newContext(device==='phone'
    ?{viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}
    :{viewport:{width:1280,height:720},deviceScaleFactor:1});
  // The first-run hints already learned (they hold the announcement slot in round 1); the economy mode off.
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));
    localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:rooms,protocol:3}}));
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);log('pageerror',e.message);});
  const cdp=await ctx.newCDPSession(page);
  await page.goto(web+'/',{waitUntil:'load',timeout:90000});
  const joined=await page.evaluate(async rooms=>{
    const {CoopClient}=await import('/src/client/net/client.ts');const {classes}=await import('/src/rules/classes.ts');
    const {objectiveFromSearch}=await import('/src/client/ui/solo-plan.ts');
    const r=await fetch(new URL('/rooms',rooms),{method:'POST',body:JSON.stringify({map:'cidade-nevada',...objectiveFromSearch()})});
    const data=await r.json();if(!r.ok)return data.error??`rooms ${r.status}`;
    const c=new CoopClient(rooms,data.code,'Tia Cleide do Lab','cidadao-comum');window.__net=c;
    const city=await import('/src/client/net/city-asset-loader.ts');c.cityRef=await city.loadCityManifest();c.cityManifest=()=>city.loadCityManifest();
    try{await c.join();}catch(e){return String(e.message);}
    const {openExploration}=await import('/src/client/explore.ts');const {mountWaitingRoom}=await import('/src/client/lobby.ts');
    void openExploration(classes.find(k=>k.id==='cidadao-comum'),'Tia Cleide do Lab',c);
    const layout=document.querySelector('dialog.explore-shell .explore-layout');if(layout)mountWaitingRoom(layout,c);
    return 'ok';
  },rooms);
  if(joined!=='ok')throw new Error(joined);
  await page.waitForFunction(()=>window.__island?.scene?.sys?.isActive?.(),null,{timeout:120000});
  for(let i=1;i<players;i++){await page.evaluate(()=>window.__net.addBot());await wait(450);}
  await page.waitForFunction(n=>window.__net.run?.members?.length===n,players,{timeout:30000});
  await page.evaluate(()=>window.__net.ready(true));
  await page.waitForFunction(()=>window.__net.run?.phase==='combat',null,{timeout:90000});
  log('combat',players,'players',device,'cpu',cpu);
  // The person walks a slow circle on the stick (keyboard: the page maps WASD), so the camera and the team move.
  const keys=['KeyW','KeyD','KeyS','KeyA'];let k=0,walking=true;
  const walk=(async()=>{while(walking){await page.keyboard.down(keys[k%4]);await wait(1500);await page.keyboard.up(keys[k%4]);k++;}})();
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  await page.evaluate(()=>{const g=window.__island.game;window.__frames=[];g.events.on('postrender',()=>window.__frames.push(performance.now()));});
  await wait(warmup*1000);
  await page.evaluate(()=>{window.__frames.length=0;});
  const samples=[];const t0=Date.now();
  while(Date.now()-t0<seconds*1000){
    await wait(2000);
    samples.push(await page.evaluate(()=>{
      const p=window.__island.probe(),w=innerWidth,h=innerHeight,on=q=>q.x>=0&&q.y>=0&&q.x<=w&&q.y<=h;
      return {heroes:p.players.filter(on).length,critters:p.enemies.filter(on).length,quality:p.quality,economy:p.economy,
        heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/2**20):null};
    }));
  }
  const frames=await page.evaluate(()=>window.__frames.slice());
  walking=false;await walk;
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  if(shot){mkdirSync(dirname(resolve(shot)),{recursive:true});await page.screenshot({path:shot});}
  const gaps=frames.slice(1).map((t,i)=>t-frames[i]),span=(frames.at(-1)-frames[0])/1000||1;
  const report={card:'NEW-20261024-ORQ-sala-ate-10-jogadores',players,device,cpu,gpu:args.length>0,seconds:round(span),
    fps:round((frames.length-1)/span),frameMs:{p50:round(pct(gaps,.5)),p95:round(pct(gaps,.95)),p99:round(pct(gaps,.99)),max:round(Math.max(0,...gaps))},
    longFrames:{over50ms:gaps.filter(g=>g>50).length,over100ms:gaps.filter(g=>g>100).length},
    onScreen:{heroesMax:Math.max(0,...samples.map(s=>s.heroes??0)),crittersMax:Math.max(0,...samples.map(s=>s.critters??0))},
    heapMBMax:Math.max(0,...samples.map(s=>s.heapMB??0)),quality:[...new Set(samples.map(s=>s.quality))],economyOn:samples.some(s=>s.economy),pageErrors:errors.length,phaseAtEnd:await page.evaluate(()=>window.__net.run?.phase)};
  console.log(JSON.stringify(report,null,1));
  if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(report,null,1)+'\n');}
  await page.evaluate(()=>{try{window.__net.leave();}catch{}});
}finally{await browser.close();}
