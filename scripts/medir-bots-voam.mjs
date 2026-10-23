#!/usr/bin/env node
// Card BUG-20261023-ORQ-bots-ainda-mais-rapidos: how fast the bots and the hero go ON SCREEN, frame by frame, against
// the room's own positions. A local rooms Worker (scripts/local-worker.mjs) and the vite DEV server already running
// (`--web`, window.__island needs DEV); one page plays "Jogar sozinho" with `--bots` room bots and walks the hero with the
// keyboard (W/A/S/D in turns). Every animation frame: the drawn feet of every hero (scene.drawnFeet: what the screen
// draws) and the room's last position of each (net.players); every frame from the room: its arrival time and tick.
// Out: per hero, the speed in u/s on the server (tick to tick) and on screen (frame to frame: mean while walking, p95,
// max over 100 ms windows, share of frames over 1.25× the server walk), and the bots' modes are not on the wire, so the
// server side is split by moving / standing only.
//   node scripts/medir-bots-voam.mjs [--web http://127.0.0.1:4210] [--port 8810] [--bots 3] [--segundos 40] [--saida <dir>]
//     [--viewport 390x844] [--mobile] [--atraso <ms>] (WebSocket frames held by a random 0..ms each, in order: a phone link)
//     [--gif <file.gif>] (screenshots during the walk, ffmpeg makes the GIF: the screenshots slow the page, so the numbers
//     of a --gif run are not the measure)
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const WEB=arg('web','http://127.0.0.1:4210'),PORT=Number(arg('port','8810')),BOTS=Number(arg('bots','3')),SECONDS=Number(arg('segundos','40'));
const [VW,VH]=arg('viewport','390x844').split('x').map(Number),MOBILE=process.argv.includes('--mobile'),OUT=arg('saida'),JITTER=Number(arg('atraso','0'));
const GIF=arg('gif');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(OUT)mkdirSync(OUT,{recursive:true});

let worker,browser;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-voam-${PORT}`),logPath:join(tmpdir(),`viagem-voam-worker-${PORT}.log`)});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:process.argv.includes('--gpu')?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,...(MOBILE?{isMobile:true,hasTouch:true}:{})});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(([bots,jitter])=>{
    try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:solo-bots:v1',String(bots));}catch{}
    if(!jitter)return;
    // A phone link: each message from the room is held 0..jitter ms, never overtaking the one before (TCP keeps order).
    const Native=WebSocket;
    window.WebSocket=class extends Native{
      constructor(...a){super(...a);let free=0;const add=this.addEventListener.bind(this);
        const hold=fn=>e=>{const at=Math.max(performance.now()+Math.random()*jitter,free);free=at;setTimeout(()=>fn.call(this,e),at-performance.now());};
        this.addEventListener=(type,fn,o)=>add(type,type==='message'?hold(fn):fn,o);
        let on;Object.defineProperty(this,'onmessage',{get:()=>on,set:fn=>{if(on)this.removeEventListener('message',on.__h);on=fn;if(fn){fn.__h=hold(fn);add('message',fn.__h);}}});
      }
    };
  },[BOTS,JITTER]);
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  console.error('worker ok');
  await p.goto(`${WEB}/`,{waitUntil:'load',timeout:120000});
  p.on('console',m=>{if(m.type()==='error')console.error('console:',m.text().slice(0,200));});const STALL=join(OUT??tmpdir(),'stall.png');
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Medida';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  console.error('menu ok');
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  console.error('entrou');const spy=setInterval(async()=>{try{console.error('estado',await p.evaluate(()=>JSON.stringify({pronta:window.__partidaPronta,isl:!!window.__island,phase:window.__island?.scene?.hooks?.net?.run?.phase,conn:window.__island?.scene?.hooks?.net?.connected,txt:document.getElementById('explore-error')?.textContent})));await p.screenshot({path:STALL});}catch(e){console.error('spy',String(e).slice(0,120));}},15000);
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  await p.waitForFunction(()=>window.__island?.scene?.hooks?.net?.run?.phase==='combat',null,{timeout:120000,polling:500});
  clearInterval(spy);console.error('combate');await sleep(3000);
  // The recorder: every animation frame and every room frame.
  await p.evaluate(()=>{
    const isl=window.__island,scene=isl.scene,net=scene.hooks.net,w=window;
    w.__rec={frames:[],arrivals:[],ids:{}};
    const push=net.arrivals.push.bind(net.arrivals);
    net.arrivals.push=at=>{w.__rec.arrivals.push({at,tick:net.tick,delay:net.arrivals.delay(),pos:Object.fromEntries([...net.players.values()].map(q=>[q.id,[q.x,q.y]]))});return push(at);};
    for(const q of net.players.values())w.__rec.ids[q.id]={self:q.id===net.id,name:q.name,classId:q.classId};
    const f=t=>{
      const drawn={};for(const [id,at] of scene.drawnFeet)drawn[id]=[at.x,at.y];
      w.__rec.frames.push({t,tick:net.tick,drawn,pred:[net.predicted.x,net.predicted.y]});
      if(w.__rec.on!==false)requestAnimationFrame(f);
    };requestAnimationFrame(f);
  });
  // The walk: hold one key at a time, in turns (with short stops: a person walks and stops).
  // The GIF: screenshots as fast as they come, each with its time (ffmpeg's concat keeps the real pace).
  const shots=[];let shooting=!!GIF;const frameDir=GIF&&join(dirname(GIF),'gif-quadros');
  if(GIF)mkdirSync(frameDir,{recursive:true});
  const shooter=GIF&&(async()=>{while(shooting){const path=join(frameDir,`q${String(shots.length).padStart(4,'0')}.png`);await p.screenshot({path}).catch(()=>{});shots.push({path,t:Date.now()});}})();
  const keys=['d','s','a','w'];const t0=Date.now();let k=0;
  while(Date.now()-t0<SECONDS*1000){
    const key=keys[k++%keys.length];await p.keyboard.down(key);await sleep(2500);await p.keyboard.up(key);await sleep(k%3===0?800:150);
  }
  shooting=false;await shooter;
  if(GIF&&shots.length>1){
    const fwd=s=>s.replaceAll('\\','/');
    const list=shots.map((q,i)=>`file '${fwd(q.path)}'\nduration ${(((shots[i+1]?.t??q.t+100)-q.t)/1000).toFixed(3)}`).join('\n');
    writeFileSync(join(frameDir,'lista.txt'),`${list}\nfile '${fwd(shots.at(-1).path)}'\n`);
    execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',join(frameDir,'lista.txt'),'-vf','fps=12,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer','-loop','0',GIF]);
    console.error(`gif: ${GIF} (${shots.length} quadros)`);
  }
  const rec=await p.evaluate(()=>{window.__rec.on=false;return window.__rec;});
  if(OUT)writeFileSync(join(OUT,`rec-${JITTER}.json`),JSON.stringify(rec));
  // Analysis.
  const HZ=20;
  const speeds=[];
  for(const [id,info] of Object.entries(rec.ids)){
    // Server: positions per tick from the arrivals (a frame's tick and position).
    const arr=rec.arrivals.filter(a=>a.pos[id]);
    const srv=[];for(let i=1;i<arr.length;i++){const a=arr[i-1],b=arr[i],dt=(b.tick-a.tick)/HZ;if(dt<=0)continue;const d=Math.hypot(b.pos[id][0]-a.pos[id][0],b.pos[id][1]-a.pos[id][1]);srv.push({v:d/dt,gapMs:b.at-a.at,ticks:b.tick-a.tick});}
    // Screen: drawn feet frame to frame.
    const fr=rec.frames.filter(f=>f.drawn[id]);
    const scr=[];for(let i=1;i<fr.length;i++){const a=fr[i-1],b=fr[i],dt=(b.t-a.t)/1000;if(dt<=0)continue;scr.push({t:b.t,v:Math.hypot(b.drawn[id][0]-a.drawn[id][0],b.drawn[id][1]-a.drawn[id][1])/dt,dt});}
    // 100 ms windows on screen.
    const win=[];for(let i=0,j=0;i<fr.length;i++){while(j<fr.length&&fr[j].t-fr[i].t<100)j++;if(j>=fr.length)break;const a=fr[i],b=fr[j];win.push(Math.hypot(b.drawn[id][0]-a.drawn[id][0],b.drawn[id][1]-a.drawn[id][1])/((b.t-a.t)/1000));}
    const moving=s=>s.filter(x=>x.v>.3);
    const pct=(a,q)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(q*s.length))]:0;};
    const mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
    const sm=moving(srv),cm=moving(scr),wm=win.filter(v=>v>.3);
    const top=pct(sm.map(x=>x.v),.9)||1;
    speeds.push({id,self:info.self,classId:info.classId,
      servidor:{mediaAndando:+mean(sm.map(x=>x.v)).toFixed(2),p90:+pct(sm.map(x=>x.v),.9).toFixed(2),max:+Math.max(0,...sm.map(x=>x.v)).toFixed(2)},
      tela:{mediaAndando:+mean(cm.map(x=>x.v)).toFixed(2),p95:+pct(cm.map(x=>x.v),.95).toFixed(2),max:+Math.max(0,...cm.map(x=>x.v)).toFixed(2),
        janela100msP95:+pct(wm,.95).toFixed(2),janela100msMax:+Math.max(0,...wm).toFixed(2),
        quadrosAcima125:`${(100*cm.filter(x=>x.v>1.25*top).length/Math.max(1,cm.length)).toFixed(1)} %`,
        quadrosParado:`${(100*scr.filter(x=>x.v<.05).length/Math.max(1,scr.length)).toFixed(1)} %`}});
  }
  const gaps=rec.arrivals.slice(1).map((a,i)=>a.at-rec.arrivals[i].at),ticks=rec.arrivals.slice(1).map((a,i)=>a.tick-rec.arrivals[i].tick);
  const result={bots:BOTS,atrasoMs:JITTER,quadros:rec.frames.length,chegadas:rec.arrivals.length,
    chegadaGapMs:{min:Math.round(Math.min(...gaps)),p50:Math.round([...gaps].sort((a,b)=>a-b)[gaps.length>>1]),max:Math.round(Math.max(...gaps)),abaixo30ms:gaps.filter(g=>g<30).length},
    ticksPorQuadro:Object.fromEntries([...new Set(ticks)].sort((a,b)=>a-b).map(t=>[t,ticks.filter(x=>x===t).length])),speeds,errors:errors.slice(0,5)};
  console.log(JSON.stringify(result,null,1));
  if(OUT)writeFileSync(join(OUT,`resumo-${JITTER}.json`),JSON.stringify(result,null,1));
}finally{
  try{await browser?.close();}catch{}
  try{await worker?.stop();}catch{}
}
