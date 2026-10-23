/**
 * Card BUG-20261023-ORQ-bots-ainda-mais-rapidos: how fast a remote hero (a bot, a friend) goes ON SCREEN against its
 * speed in the room, with the client's own render buffer (net/client.ts view → net/smoothing.ts), over links of every
 * kind. The room walks it at the hero speed in a straight line (20 ticks/s, a frame every SEND_EVERY ticks, catch-up
 * bursts of the room clock flush one frame); the frames reach the phone after a delay drawn from the link model, in order
 * (TCP); the screen samples the drawn point at 60 Hz. The local hero is drawn by the prediction (STEP every 50 ms of the
 * phone's clock): the hero speed exactly, the reference.
 *
 * Out per link: the remote's speed on screen frame to frame (mean while walking, p95, max), over 100 ms windows (p95,
 * max), the share of frames over 1.25× the hero, and the share of frames standing still.
 *   node --experimental-strip-types scripts/medir-tela-remotos.ts [--json out.json] [--modo atual|chegada]
 */
import {writeFileSync} from 'node:fs';
import {SEND_EVERY} from '../src/protocol/protocol4.ts';
import {ArrivalJitter,RemoteClock,remoteAt,tickTime,type RemoteSample} from '../src/client/net/smoothing.ts';

const arg=(name:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:undefined;};
const TICK_MS=50,FRAME_MS=1000/60,SECONDS=60;
/** atual: the client as shipped (room time by tick, RemoteClock); chegada: the old one (arrival time, ArrivalJitter). */
const MODE=arg('modo')??'atual';
const speed=3.99; // the city's hero walk (maps/world.ts heroSpeed, cidade-nevada)

/** Deterministic random (mulberry32). */
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

type Link={name:string;delay:(r:()=>number,sentAt:number)=>number;clock?:'drift'};
const LINKS:Link[]=[
  {name:'local (5 ms fixo)',delay:()=>5},
  {name:'wi-fi bom (30 ms ± 10)',delay:r=>30+r()*20},
  {name:'4G (60 ms, jitter 0-80)',delay:r=>60+(-Math.log(1-r()))*25},
  {name:'4G + perda (TCP: 1 em 30 segura 250 ms)',delay:r=>60+(-Math.log(1-r()))*25+(r()<1/30?250:0)},
  {name:'sala atrasada (rajadas de 2-3 ticks) + 4G',delay:r=>60+(-Math.log(1-r()))*25,clock:'drift'},
];

function run(link:Link,seed=7){
  const r=rng(seed);
  // The room: ticks at their wall time; a drifting clock fires late and runs 2-3 ticks back to back.
  const ticks:{tick:number;at:number}[]=[];let wall=0;
  for(let tick=1;tick<=SECONDS*20;){
    wall=tick*TICK_MS;
    if(link.clock==='drift'&&r()<.12){const n=2+(r()<.4?1:0);wall+=(n-1)*TICK_MS+r()*10;for(let k=0;k<n&&tick<=SECONDS*20;k++)ticks.push({tick:tick++,at:wall});}
    else ticks.push({tick:tick++,at:wall+r()*3});
  }
  // Frames: every SEND_EVERY ticks (a burst sends one frame, at its last tick); position = speed × tick time.
  const sent:{tick:number;at:number}[]=[];
  for(let i=0;i<ticks.length;i++){
    const t=ticks[i],burstEnd=i+1>=ticks.length||ticks[i+1].at!==t.at;
    const owed=t.tick%SEND_EVERY===0||(sent.length&&t.tick-sent.at(-1)!.tick>=SEND_EVERY);
    if(owed&&burstEnd)sent.push(t);
  }
  let free=0;
  const arrivals=sent.map(s=>{const at=Math.max(free,s.at+link.delay(r,s.at));free=at;return {...s,arrival:at};});
  // The phone: 60 Hz frames, the render buffer as the client keeps it.
  const samples:RemoteSample[]=[];let k=0;const drawn:{t:number;x:number}[]=[];
  const jitter=new ArrivalJitter(),clock=new RemoteClock();
  for(let t=500;t<SECONDS*1000;t+=FRAME_MS){
    while(k<arrivals.length&&arrivals[k].arrival<=t){const a=arrivals[k++];jitter.push(a.arrival);clock.push(a.arrival,a.tick);samples.push({at:a.arrival,tick:a.tick,players:new Map([['bot',{x:speed*a.tick/20,y:0}]])});if(samples.length>12)samples.shift();}
    const p=MODE==='chegada'?remoteAt(samples,t-jitter.delay(),'bot'):remoteAt(samples,clock.time(t)??-Infinity,'bot',tickTime);
    if(p)drawn.push({t,x:p.x});
  }
  const v:number[]=[];for(let i=1;i<drawn.length;i++)v.push((drawn[i].x-drawn[i-1].x)/((drawn[i].t-drawn[i-1].t)/1000));
  const w:number[]=[];for(let i=0;i+6<drawn.length;i++)w.push((drawn[i+6].x-drawn[i].x)/((drawn[i+6].t-drawn[i].t)/1000));
  const pct=(a:number[],q:number)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
  const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const f2=(x:number)=>Math.round(x*100)/100;
  return {link:link.name,heroi:f2(speed),botServidor:f2(speed),
    telaMedia:f2(mean(v)),telaP95:f2(pct(v,.95)),telaMax:f2(Math.max(...v)),janela100msP95:f2(pct(w,.95)),janela100msMax:f2(Math.max(...w)),
    quadrosAcima125:`${(100*v.filter(x=>x>1.25*speed).length/v.length).toFixed(1)} %`,quadrosParado:`${(100*v.filter(x=>x<.05).length/v.length).toFixed(1)} %`};
}
const rows=LINKS.map(l=>run(l));
console.table(rows);
const out=arg('json');if(out)writeFileSync(out,JSON.stringify(rows,null,1));
