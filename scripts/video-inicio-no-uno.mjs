#!/usr/bin/env node
// Card NEW-20261023-ORQ-inicio-no-uno-caixas-120, etapa 3: the video of one solo match from the start to the end of the
// first time to explore (start beside the Uno → mission band → Minerva clock → 1st wave → "Você tem 2 minutos… Vá em
// dupla." → "Volte ao Uno." + the Uno's arrow). A local rooms Worker (this branch's sim) and this branch's vite DEV server
// (`--web`, already running); the hero walks off the Uno during the Minerva (the edge arrow) and back, then stays by it.
// Out: <saida>/video/*.webm (Playwright) and <saida>/linha.json, one row a second (sim tick, phase, Minerva/explore
// windows, the mission row/band text, the clock shown, the Uno arrow shown), to cut the video at the right moments.
//   node scripts/video-inicio-no-uno.mjs --saida <dir> [--web http://127.0.0.1:4210] [--port 8812] [--bots 3]
//     [--viewport 1280x720] [--mobile] [--gpu] (d3d11; default swiftshader) [--max-min 9]
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const WEB=arg('web','http://127.0.0.1:4210'),PORT=Number(arg('port','8812')),BOTS=Number(arg('bots','3')),OUT=arg('saida','video-inicio');
const [VW,VH]=arg('viewport','1280x720').split('x').map(Number),MOBILE=process.argv.includes('--mobile'),MAX_MS=Number(arg('max-min','9'))*60000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
mkdirSync(OUT,{recursive:true});
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);

let worker,browser,release;
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E5 video inicio-no-uno ${MOBILE?'celular':'pc'}`});
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-video-${PORT}`),logPath:join(OUT,'worker.log')});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:process.argv.includes('--gpu')?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,serviceWorkers:'block',...(MOBILE?{isMobile:true,hasTouch:true}:{}),
    recordVideo:{dir:join(OUT,'video'),size:{width:VW,height:VH}}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:32}}));
  await ctx.addInitScript(bots=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:solo-bots:v1',String(bots));}catch{}},BOTS);
  const p=await ctx.newPage();const born=Date.now();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  await p.goto(`${WEB}/`,{waitUntil:'commit',timeout:120000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:600000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Video';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  const startedAt=(Date.now()-born)/1000;console.error('partida pronta em',startedAt.toFixed(1),'s do vídeo');
  // One row a second: what the room says and what the HUD shows.
  const rows=[];
  const sample=async()=>{try{rows.push({v:(Date.now()-born)/1000,...await p.evaluate(()=>{
    const net=window.__island?.scene?.hooks?.net,run=net?.run,txt=s=>{const e=document.querySelector(s);return e&&!e.hidden?e.textContent:undefined;};
    const me=net?.players?.get(net.id);
    return {tick:net?.tick,phase:run?.phase,wave:run?.wave,minervaAte:run?.minervaAteTick,exploraDesde:run?.exploraDesdeTick,exploraAte:run?.exploraAteTick,
      linha:txt('.rh-missao'),grande:txt('.rh-missao-grande'),relogio:!!document.querySelector('.rh-minerva:not([hidden])'),
      setaUno:[...document.querySelectorAll('[class*="seta"],[class*="arrow"]')].some(e=>!e.hidden&&/uno|car/i.test(e.className)&&e.getBoundingClientRect().width>0),
      vivo:me?(me.hp??1)>0:undefined};})});}catch(e){rows.push({v:(Date.now()-born)/1000,erro:String(e).slice(0,120)});}};
  const timer=setInterval(()=>void sample(),1000);
  const hold=async(key,ms)=>{await p.keyboard.down(key);await sleep(ms);await p.keyboard.up(key);};
  // Home: where the hero is born (beside the Uno). Back home by the screen direction to it (scene.project), keys held
  // by its sign; a sidestep when stuck on water or a wall.
  const home=await p.evaluate(()=>{const n=window.__island.scene.hooks.net;return {...n.predicted};});
  const toHome=()=>p.evaluate(h=>{const s=window.__island.scene,n=s.hooks.net,a=s.project(n.predicted),b=s.project(h);return {dx:b.x-a.x,dy:b.y-a.y,d:Math.hypot(n.predicted.x-h.x,n.predicted.y-h.y)};},home);
  const goHome=async maxMs=>{
    const end=Date.now()+maxMs;let held=new Set(),best=Infinity,bestAt=Date.now(),side=0;
    const set=async keys=>{for(const k of held)if(!keys.has(k))await p.keyboard.up(k);for(const k of keys)if(!held.has(k))await p.keyboard.down(k);held=keys;};
    while(Date.now()<end){
      const v=await toHome().catch(()=>undefined);if(!v)break;
      if(v.d<2.5)break;
      if(v.d<best-.5){best=v.d;bestAt=Date.now();}else if(Date.now()-bestAt>2500){side=(side+1)%3;bestAt=Date.now();}
      let {dx,dy}=v;if(side===1)[dx,dy]=[-dy,dx];else if(side===2)[dx,dy]=[dy,-dx];
      const k=new Set(),m=Math.max(Math.abs(dx),Math.abs(dy));
      if(dx>m*.4)k.add('d');if(dx<-m*.4)k.add('a');if(dy>m*.4)k.add('s');if(dy<-m*.4)k.add('w');
      await set(k);await sleep(side?700:200);if(side&&Date.now()-bestAt>1500)side=0;
    }
    await set(new Set());
  };
  await sleep(6000);// the big band, read
  // Off the Uno during the Minerva (the edge arrow shows when the car leaves the screen), a while, and back.
  await hold('d',8000);await sleep(3000);await hold('s',3000);await sleep(3000);await goHome(30000);
  // By the Uno; in the time to explore, out again and home at "Volte ao Uno." (the arrow again), until the next wave.
  const until=born+MAX_MS;let exploreEnd,wentOut=false;
  for(;;){
    const last=rows.at(-1)??{};
    if(last.exploraAte&&last.tick<last.exploraAte)exploreEnd=last.exploraAte;
    if(exploreEnd&&!wentOut&&last.tick>=exploreEnd-20*100){wentOut=true;await sleep(5000);await hold('a',7000);await sleep(2000);await hold('w',3000);}
    if(exploreEnd&&wentOut&&last.tick>=exploreEnd-20*21&&last.tick<exploreEnd)await goHome(25000);
    if(exploreEnd&&last.tick>=exploreEnd+20*8)break;// 8 s into the 2nd wave
    if(Date.now()>until){console.error('tempo máximo');break;}
    await sleep(1000);
  }
  clearInterval(timer);
  writeFileSync(join(OUT,'linha.json'),JSON.stringify({startedAt,errors,rows},null,1));
  console.error('erros da página:',errors.length,errors.slice(0,4));
  await p.close();await ctx.close();
}catch(e){console.error('falhou:',e.message.split('\n')[0]);process.exitCode=2;}
finally{await browser?.close().catch(()=>{});await worker?.stop?.().catch?.(()=>{});release?.();}
