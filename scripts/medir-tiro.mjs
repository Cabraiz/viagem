// BUG-20261027-ORQ-tiro-delay-1s-predicao: how long a tap on Atacar takes to show, measured in a real solo match.
// Nothing here publishes anything: it opens a site (the live one by default), plays, and reads its own WebSocket.
//   1. a phone (or the PC) enters a solo match like scripts/gravar-partida.mjs;
//   2. every --intervalo ms it taps #coop-attack (CDP touch on the phone, Space on the PC), --toques times;
//   3. a wrapper around the page's WebSocket notes, on the page's clock (performance.now): the tap (pointerdown or
//      keydown), each message out (the {t:'input'} that first carries the attack bit) and each binary frame in; with
//      --atraso <ms> it holds every message half of that each way (a slower link than the PC's: Chrome's throttling
//      does not touch WebSocket messages);
//   4. the frames are decoded here with the client's own decoder (src/client/net/run-feed.ts), in order, and each tap
//      gets: ms to send, ms until the first frame where the hero's attackTick moved (the swing starts on the next
//      animation frame, sprite-motion.ts), the first 'fire' event of the hero (shot FX and sound) and its first damage.
// node scripts/medir-tiro.mjs <outDir> [--url https://viagem.cyou] [--tela celular|pc] [--toques 12] [--intervalo 1500]
//      [--atraso 0] [--video 1] [--extra "combate=manual"] [--worker http://127.0.0.1:8808] (a local build and Worker)
// Writes <outDir>/medida.json (every tap) and resumo.md (medians and maxima). Exit 0 ok, 1 no entry / no attack seen.
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FrameRunFeed} from '../src/client/net/run-feed.ts';
import {claimSlot} from '../tools/vaga.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ENTER_MS=180000;
const TELAS={
  celular:{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'},
  pc:{viewport:{width:1335,height:620},deviceScaleFactor:1,isMobile:false,hasTouch:false},
};

function parse(argv){
  const o={out:argv[0],url:'https://viagem.cyou',tela:'celular',toques:12,intervalo:1500,atraso:0,extra:''};
  for(let i=1;i<argv.length;i++){const k=argv[i].replace(/^--/,'');o[k]=['toques','intervalo','atraso'].includes(k)?Number(argv[++i]):argv[++i];}
  if(!o.out)throw new Error('uso: node scripts/medir-tiro.mjs <outDir> [--url] [--tela] [--toques] [--intervalo] [--atraso] [--extra]');
  return o;
}
async function playwright(){
  for(const spec of ['playwright',process.env.PLAYWRIGHT_MODULE,'D:/Gits/viagem-tools/node_modules/playwright']){
    if(!spec)continue;
    try{const m=await import(spec==='playwright'?spec:pathToFileURL(join(spec,existsSync(join(spec,'index.mjs'))?'index.mjs':'index.js')).href);return m.chromium?m:m.default;}catch{}
  }
  throw new Error('Playwright não encontrado');
}

/** Runs in the page before its scripts: the WebSocket log (and the optional delay), the taps. */
function hook(atraso){
  const log=window.__tiro={taps:[],out:[],in:[],local:[]};
  const half=Math.max(0,atraso)/2;
  const Native=window.WebSocket;
  class Wrapped extends Native{
    constructor(...a){
      super(...a);
      const add=this.addEventListener.bind(this);
      let onmessage=null;
      // The page sets ws.onmessage: deliver it ourselves (late by `half` when asked), with the arrival noted first.
      Object.defineProperty(this,'onmessage',{get:()=>onmessage,set:fn=>{onmessage=fn;},configurable:true});
      add('message',ev=>{
        // Noted when the page gets it (after the delay, when there is one).
        const d=ev.data;
        const fire=()=>{const t=performance.now();if(typeof d!=='string')log.in.push({t,b:Array.from(new Uint8Array(d))});else log.in.push({t,s:d.length<4000?d:d.slice(0,4000)});if(onmessage)onmessage.call(this,ev);};
        if(half)setTimeout(fire,half);else fire();
      });
    }
    send(data){
      const t=performance.now();
      if(typeof data==='string')log.out.push({t,s:data});
      if(half)setTimeout(()=>{try{super.send(data);}catch{}},half);else super.send(data);
    }
  }
  window.WebSocket=Wrapped;
  const tap=e=>{if(e.type==='keydown'&&e.code!=='Space')return;if(e.type==='pointerdown'&&!e.target?.closest?.('#coop-attack'))return;log.taps.push({t:performance.now(),how:e.type});};
  addEventListener('pointerdown',tap,{capture:true});addEventListener('keydown',tap,{capture:true});
}

/** menu → hero → SELECIONAR → name → BORA! → Jogar sozinho → the match (scene.ts window.__partidaPronta). */
async function entrar(p,base,extra){
  const t0=Date.now();
  await p.goto(`${base}/${extra?`?${extra}`:''}`,{waitUntil:'load',timeout:90000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:60000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Medidor';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  for(;;){
    const st=await p.evaluate(()=>({entered:window.__partidaPronta===true,said:document.getElementById('explore-error')?.textContent||''})).catch(()=>({entered:false,said:''}));
    if(st.entered)return Date.now()-t0;
    if(st.said.trim())throw new Error(`não entrou: ${st.said.trim().slice(0,120)}`);
    if(Date.now()-t0>ENTER_MS)throw new Error('não entrou a tempo');
    await sleep(1000);
  }
}


/** The page's log decoded as it grows (the hero, the crates), for steering before the taps. */
class Live {
  constructor(p){this.p=p;this.feed=new FrameRunFeed();this.seen=0;this.me=undefined;this.view=undefined;}
  async pull(){
    const fresh=await this.p.evaluate(i=>window.__tiro.in.slice(i),this.seen);this.seen+=fresh.length;
    for(const m of fresh){
      if(m.s){try{const j=JSON.parse(m.s);if(j.t==='welcome'&&j.id)this.me=j.id;}catch{}continue;}
      const r=this.feed.decode(new Uint8Array(m.b));if(r.ok)this.view=r.view;
    }
    const self=this.view?.players.find(q=>q.id===this.me);
    return {self,chests:(this.view?.pickups??[]).filter(k=>k.kind==='chest')};
  }
}
const label=p=>p.evaluate(()=>document.querySelector('#coop-attack')?.textContent.trim()??'').catch(()=>'');
/**
 * The run starts with no weapon (D-051: "Sem arma"): walk to the nearest crate and stand by it until the button names
 * a weapon. The phone walks with the stick (CDP touch), the PC with WASD (a diagonal is two keys). The screen direction
 * → world is calibrated first (two short walks), so the camera's rotation does not matter. True when armed.
 */
async function armar(p,cdp){
  const live=new Live(p);
  let walk;
  if(cdp){
    const stick=await p.evaluate(()=>{const r=document.querySelector('.explore-stick')?.getBoundingClientRect();return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2,r:r.width/2}:null;});
    if(!stick)return false;
    const touch=async(type,d)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:stick.x+d.x*stick.r*.9,y:stick.y+d.y*stick.r*.9,id:1}]});
    walk=async(d,ms)=>{await touch('touchStart',{x:0,y:0});await touch('touchMove',{x:d.x*.5,y:d.y*.5});await touch('touchMove',d);await sleep(ms);await touch('touchEnd');await sleep(400);};
  }else{
    walk=async(d,ms)=>{
      const keys=[d.x>.38&&'KeyD',d.x<-.38&&'KeyA',d.y>.38&&'KeyS',d.y<-.38&&'KeyW'].filter(Boolean);
      for(const k of keys)await p.keyboard.down(k);
      await sleep(ms);
      for(const k of keys)await p.keyboard.up(k);
      await sleep(400);
    };
  }
  const at=async()=>{await sleep(150);return (await live.pull()).self;};
  let a=await at();if(!a)return false;
  await walk({x:1,y:0},500);let b=await at();const ex={x:b.x-a.x,y:b.y-a.y};
  await walk({x:0,y:-1},500);a=await at();const ey={x:a.x-b.x,y:a.y-b.y};
  console.log('calibração',JSON.stringify({ex,ey}));
  const det=ex.x*ey.y-ex.y*ey.x;if(Math.abs(det)<1e-6)return false;
  // world d = sx·ex + sy'·ey with screen (sx, -sy'): solve for the stick.
  const toStick=d=>{const sx=(d.x*ey.y-d.y*ey.x)/det,sy=(ex.x*d.y-ex.y*d.x)/det,l=Math.hypot(sx,sy)||1;return {x:sx/l,y:-sy/l};};
  // Short walks toward the nearest crate, looking after each; a crate the hero makes no way to (a wall) is skipped.
  const end=Date.now()+120000,skip=new Set();let goal,best=Infinity,stuck=0;
  while(Date.now()<end){
    const now=await label(p);
    // In a shop's ring Trabalhar takes the attack's place: step out of it (any way) before the taps.
    if(/trabalhar/i.test(now)){const a=Math.random()*2*Math.PI;await walk({x:Math.cos(a),y:Math.sin(a)},700);continue;}
    if(!/sem arma/i.test(now))return true;
    const {self,chests}=await live.pull();
    if(!self){await sleep(200);continue;}
    const near=chests.filter(c=>!skip.has(c.id)).map(c=>({c,d:Math.hypot(c.x-self.x,c.y-self.y)})).sort((u,v)=>u.d-v.d)[0];
    if(!near){await sleep(500);continue;}
    if(process.env.MEDIR_DEBUG)console.log('herói',self.x.toFixed(1),self.y.toFixed(1),'caixa',near.c.id,near.d.toFixed(2));
    if(near.c.id!==goal){goal=near.c.id;best=near.d;stuck=0;}
    if(near.d<.8){await sleep(700);continue;}
    if(near.d<best-.3){best=near.d;stuck=0;}else if(++stuck>=6){skip.add(goal);goal=undefined;continue;}
    await walk(toStick({x:near.c.x-self.x,y:near.c.y-self.y}),Math.min(600,Math.max(120,near.d*110)));
  }
  return false;
}

const SEGMENT_ATTACK=2;
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:NaN;};
const r0=n=>Number.isFinite(n)?Math.round(n):null;

/** The taps against the log: per tap the times (ms after the tap) of the send and of what came back. */
export function analyse(log){
  let me;
  for(const m of log.in)if(m.s){try{const j=JSON.parse(m.s);if(j.t==='welcome'&&j.id)me=j.id;}catch{}}
  const feed=new FrameRunFeed(),frames=[];
  for(const m of log.in){
    if(m.s){try{const j=JSON.parse(m.s);if(j.t==='welcome'||j.t==='map')feed.reset?.();}catch{}continue;}
    const r=feed.decode(new Uint8Array(m.b));
    if(!r.ok)continue;
    const v=r.view,self=v.players.find(q=>q.id===me);
    frames.push({t:m.t,tick:v.tick,attackTick:self?.attackTick??0,fire:v.events.some(e=>e.type==='fire'&&e.player===me),
      hit:v.events.some(e=>e.type==='damage'&&e.source===me)});
  }
  const sends=log.out.map(m=>{try{return {t:m.t,j:JSON.parse(m.s)};}catch{return undefined;}}).filter(Boolean);
  const local=log.local??[];
  const taps=[];let lastAttack=frames[0]?.attackTick??0,fi=0;
  for(let i=0;i<log.taps.length;i++){
    const tap=log.taps[i].t,next=log.taps[i+1]?.t??Infinity;
    while(fi<frames.length&&frames[fi].t<tap){lastAttack=Math.max(lastAttack,frames[fi].attackTick);fi++;}
    const send=sends.find(s=>s.t>=tap&&s.t<next&&s.j.t==='input'&&s.j.steps?.some(w=>(w[3]&SEGMENT_ATTACK)!==0));
    const win=frames.filter(f=>f.t>=tap&&f.t<next);
    const swing=win.find(f=>f.attackTick>lastAttack),fire=win.find(f=>f.fire),hit=win.find(f=>f.hit);
    const drawn=local.find(t=>t>=tap&&t<next);
    taps.push({tap:r0(tap),golpeLocal:drawn!==undefined?r0(drawn-tap):null,envio:send?r0(send.t-tap):null,ataqueTick:swing?r0(swing.t-tap):null,tiro:fire?r0(fire.t-tap):null,dano:hit?r0(hit.t-tap):null,
      tickDoServidor:swing?.tick??null});
  }
  // The room's frame gaps (its send period and the link's jitter).
  const gaps=frames.slice(1).map((f,i)=>f.t-frames[i].t);
  return {me,frames:frames.length,taps,frameGap:{mediana:r0(median(gaps)),max:r0(Math.max(...gaps))}};
}

async function main(argv){
  const o=parse(argv),out=resolve(o.out);mkdirSync(out,{recursive:true});
  const {chromium}=await playwright();
  // One of the PC's two browser slots (ESCALA.md), waited for.
  const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`medir-tiro ${o.tela}`});
  const browser=await chromium.launch({args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[]});
  try{
    // --video 1: the whole session recorded (<outDir>/*.webm), the taps' start noted in video.json for cutting a GIF.
    const tela=TELAS[o.tela],ctx=await browser.newContext(o.video?{...tela,recordVideo:{dir:out,size:tela.viewport}}:tela),t0=Date.now();
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:tela-cheia:v1','off');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
    await ctx.addInitScript(hook,o.atraso);
    const p=await ctx.newPage(),cdp=tela.hasTouch?await ctx.newCDPSession(p):undefined;
    // --worker http://127.0.0.1:8808: the local rooms Worker (wrangler dev) instead of the site's.
    if(o.worker)await p.route('**/multiplayer.json',async r=>{const j=await (await r.fetch()).json();await r.fulfill({json:{...j,endpoint:o.worker}});});
    const entrou=await entrar(p,o.url.replace(/\/$/,''),o.extra);
    console.log(`entrou em ${Math.round(entrou/1000)} s`);
    await sleep(3000);
    if(!await armar(p,cdp))console.log('não conseguiu arma: mede assim mesmo');
    await p.evaluate(()=>{window.__tiro.taps=[];window.__tiro.local=[];});
    const box=await p.evaluate(()=>{const r=document.querySelector('#coop-attack')?.getBoundingClientRect();return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2,label:document.querySelector('#coop-attack').textContent.trim()}:null;});
    if(!box)throw new Error('sem #coop-attack na tela');
    console.log(`botão: "${box.label}"`);
    if(o.video)writeFileSync(join(out,'video.json'),JSON.stringify({toquesDesdeOInicio:(Date.now()-t0)/1000,intervalo:o.intervalo}));
    for(let i=0;i<o.toques;i++){
      if(cdp){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y,id:7}]});
        await sleep(80);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }else{await p.keyboard.down('Space');await sleep(80);await p.keyboard.up('Space');}
      await sleep(o.intervalo);
    }
    await p.screenshot({path:join(out,'fim.png')}).catch(()=>{});
    const build=await p.evaluate(async()=>{try{return (await (await fetch('/version.json',{cache:'no-store'})).json()).build;}catch{return '';}});
    const log=await p.evaluate(()=>window.__tiro);
    const res={url:o.url,build,tela:o.tela,atraso:o.atraso,...analyse(log)};
    writeFileSync(join(out,'medida.json'),JSON.stringify(res,null,1));
    const col=k=>res.taps.map(t=>t[k]).filter(v=>v!==null);
    const linha=(nome,k)=>`| ${nome} | ${r0(median(col(k)))??'—'} | ${col(k).length?Math.max(...col(k)):'—'} | ${col(k).length}/${res.taps.length} |`;
    const md=[`# Tiro: ms do toque até… (${o.url}, build ${build}, ${o.tela}, atraso extra ${o.atraso} ms)`,'',
      '| etapa | mediana | máx | toques |','|---|---|---|---|',
      linha('golpe previsto desenhado (quadro local)','golpeLocal'),linha('input com o ataque sai','envio'),linha('frame com attackTick novo (o golpe começa)','ataqueTick'),linha("frame com o 'fire' (tiro/clarão/som)",'tiro'),linha('frame com o dano','dano'),
      '',`Frames: ${res.frames}, intervalo mediano ${res.frameGap.mediana} ms (máx ${res.frameGap.max}).`].join('\n');
    writeFileSync(join(out,'resumo.md'),md+'\n');console.log(md);
    return col('ataqueTick').length?0:1;
  }finally{await browser.close();release();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).then(c=>process.exit(c),e=>{console.error(e);process.exit(1);});
