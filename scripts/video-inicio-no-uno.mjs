#!/usr/bin/env node
// Card NEW-20261023-ORQ-inicio-no-uno-caixas-120, etapa 3: the video of one solo match from the start to the end of the
// first time to explore (start beside the Uno → mission band → Minerva clock → 1st wave → "Você tem 2 minutos… Vá em
// dupla." → "Volte ao Uno." + the Uno's arrow). A local rooms Worker (this branch's sim) and this branch's vite DEV server
// (`--web`, already running); the hero walks off the Uno during the Minerva (the edge arrow) and back, then stays by it.
// Out: <saida>/video/*.webm (Playwright) and <saida>/linha.json, one row a second (sim tick, phase, Minerva/explore
// windows, the mission row/band text, the clock shown, the Uno arrow shown), to cut the video at the right moments.
//   node scripts/video-inicio-no-uno.mjs --saida <dir> [--web http://127.0.0.1:4210] [--port 8812] [--bots 3]
//     [--viewport 1280x720] [--mobile] [--gpu] (d3d11; default swiftshader) [--max-min 9] [--prints 30,60]
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
  browser=await chromium.launch({args:process.argv.includes('--gpu')?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader',`--window-size=${Math.max(VW,800)},${Math.max(VH,600)}`]});
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,serviceWorkers:'block',...(MOBILE?{hasTouch:true,isMobile:!process.argv.includes('--sem-ismobile')}:{}),
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
  // --prints 30,60: page screenshots that many seconds after the match opens (the phone recording's frames are scaled).
  for(const at of (arg('prints','')||'').split(',').filter(Boolean).map(Number))setTimeout(()=>void p.screenshot({path:join(OUT,`print-${at}s.png`)}).catch(()=>{}),at*1000);
  // The hands: the keyboard on the PC; on the phone the touch stick and the Atacar button (CDP touches, so the HUD stays
  // the phone's: a key press turns it into the desk's, hud.ts). move({x,y}) is a screen direction (null: stop).
  const DIRS={d:{x:1,y:0},a:{x:-1,y:0},s:{x:0,y:1},w:{x:0,y:-1}};
  const hands=await (async()=>{
    if(!MOBILE){
      let held=new Set();
      return {
        async move(v){const k=new Set();if(v){const m=Math.max(Math.abs(v.x),Math.abs(v.y));if(v.x>m*.4)k.add('d');if(v.x<-m*.4)k.add('a');if(v.y>m*.4)k.add('s');if(v.y<-m*.4)k.add('w');}
          for(const x of held)if(!k.has(x))await p.keyboard.up(x);for(const x of k)if(!held.has(x))await p.keyboard.down(x);held=k;},
        async attack(on){if(on)await p.keyboard.down('Space');else await p.keyboard.up('Space');},
      };
    }
    const cdp=await ctx.newCDPSession(p),touches=new Map();
    const center=sel=>p.evaluate(q=>{const r=document.querySelector(q)?.getBoundingClientRect();return r&&r.width?{x:r.x+r.width/2,y:r.y+r.height/2}:undefined;},sel);
    const send=type=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...touches.entries()].map(([id,t])=>({x:t.x,y:t.y,id}))});
    // CDP: a touchEnd carries no points and lifts them all; the ones still held go down again.
    const put=async(id,pt)=>{
      if(pt){const had=touches.has(id);touches.set(id,pt);return send(had?'touchMove':'touchStart');}
      if(!touches.delete(id))return;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      if(touches.size)await send('touchStart');
    };
    return {
      async move(v){
        if(!v)return put(1,undefined);
        const c=await center('.explore-stick');if(!c)return;const m=Math.hypot(v.x,v.y)||1;
        if(!touches.has(1))await put(1,c);
        await put(1,{x:c.x+v.x/m*40,y:c.y+v.y/m*40});
      },
      async attack(on){if(!on)return put(2,undefined);const c=await center('[aria-label^="Atacar"]');if(c)await put(2,c);},
    };
  })();
  const hold=async(key,ms)=>{await hands.move(DIRS[key]);await sleep(ms);await hands.move(null);};
  // Home: where the hero is born (beside the Uno). Back home by the screen direction to it (scene.project); a sidestep
  // when stuck on water or a wall.
  const home=await p.evaluate(()=>{const n=window.__island.scene.hooks.net;return {...n.predicted};});
  const toHome=()=>p.evaluate(h=>{const s=window.__island.scene,n=s.hooks.net,a=s.project(n.predicted),b=s.project(h);return {dx:b.x-a.x,dy:b.y-a.y,d:Math.hypot(n.predicted.x-h.x,n.predicted.y-h.y)};},home);
  const goHome=async maxMs=>{
    const end=Date.now()+maxMs;let best=Infinity,bestAt=Date.now(),side=0;
    while(Date.now()<end){
      const v=await toHome().catch(e=>{console.error('volta erro',String(e).slice(0,160));});if(!v)break;
      if(Date.now()-(goHome.logAt??0)>2000){goHome.logAt=Date.now();console.error('volta',JSON.stringify({d:+v.d.toFixed(1),dx:Math.round(v.dx),dy:Math.round(v.dy),side}));}
      if(v.d<3)break;
      if(v.d<best-.5){best=v.d;bestAt=Date.now();}else if(Date.now()-bestAt>2500){side=(side+1)%3;bestAt=Date.now();}
      let {dx,dy}=v;if(side===1)[dx,dy]=[-dy,dx];else if(side===2)[dx,dy]=[dy,-dx];
      await hands.move({x:dx,y:dy});await sleep(side?700:200);if(side&&Date.now()-bestAt>1500)side=0;
    }
    await hands.move(null);
  };
  await sleep(6000);// the big band, read
  // Off the Uno during the Minerva (the edge arrow shows when the car leaves the screen), a while, and back.
  await hold('d',7000);await sleep(4000);await goHome(50000);
  // Manual combat: by the Uno the hero holds the attack, off it in the time to explore.
  await hands.attack(true);
  // By the Uno; in the time to explore, out again and home at "Volte ao Uno." (the arrow again), until the next wave.
  const until=born+MAX_MS;let exploreEnd,wentOut=false;
  for(;;){
    const last=rows.at(-1)??{};
    if(last.exploraAte&&last.tick<last.exploraAte)exploreEnd=last.exploraAte;
    if(exploreEnd&&!wentOut&&last.tick>=exploreEnd-20*100){wentOut=true;await hands.attack(false);await sleep(5000);await hold('a',7000);await sleep(2000);await hold('w',3000);}
    if(exploreEnd&&wentOut&&last.tick>=exploreEnd-20*21&&last.tick<exploreEnd){await goHome(22000);await hands.attack(true);}
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
