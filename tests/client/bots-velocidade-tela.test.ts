// BUG bots-ainda-mais-rapidos: a remote hero (a bot, a friend) is never drawn faster than the local hero walks, on any
// link (net/client.ts view → smoothing.ts RemoteClock + remoteAt by room tick).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ArrivalJitter,RemoteClock,remoteAt,tickTime,TICK_MS,CLOCK_FAST,CLOCK_SNAP_MS,EXTRAPOLATE_MAX_MS,type RemoteSample} from '../../src/client/net/smoothing.ts';
import {SEND_EVERY} from '../../src/protocol/protocol4.ts';

const FRAME=1000/60,SECONDS=40,SPEED=3.99;
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
type Link={name:string;delay:(r:()=>number)=>number;drift?:boolean};
const LINKS:Link[]=[
  {name:'local',delay:()=>5},
  {name:'4G',delay:r=>60+(-Math.log(1-r()))*25},
  {name:'4G + perda',delay:r=>60+(-Math.log(1-r()))*25+(r()<1/30?250:0)},
  {name:'sala atrasada + 4G',delay:r=>60+(-Math.log(1-r()))*25,drift:true},
];

/**
 * The room walks the bot at SPEED in a straight line (a frame every SEND_EVERY ticks, one per catch-up burst), the frames
 * reach the phone in order after the link's delay, the phone draws at 60 Hz. Returns the drawn x per frame.
 */
function drawn(link:Link,mode:'tick'|'chegada',seed=11){
  const r=rng(seed),ticks:{tick:number;at:number}[]=[];
  for(let tick=1;tick<=SECONDS*20;){
    let wall=tick*TICK_MS;
    if(link.drift&&r()<.12){const n=2+(r()<.4?1:0);wall+=(n-1)*TICK_MS+r()*10;for(let k=0;k<n&&tick<=SECONDS*20;k++)ticks.push({tick:tick++,at:wall});}
    else ticks.push({tick:tick++,at:wall+r()*3});
  }
  const sent:{tick:number;at:number}[]=[];
  for(let i=0;i<ticks.length;i++){
    const t=ticks[i],burstEnd=i+1>=ticks.length||ticks[i+1].at!==t.at;
    if((t.tick%SEND_EVERY===0||(sent.length&&t.tick-sent.at(-1)!.tick>=SEND_EVERY))&&burstEnd)sent.push(t);
  }
  let free=0;const arrivals=sent.map(s=>{const at=Math.max(free,s.at+link.delay(r));free=at;return {...s,arrival:at};});
  const samples:RemoteSample[]=[],out:{t:number;x:number}[]=[],jitter=new ArrivalJitter(),clock=new RemoteClock();let k=0;
  for(let t=500;t<SECONDS*1000;t+=FRAME){
    while(k<arrivals.length&&arrivals[k].arrival<=t){
      const a=arrivals[k++];jitter.push(a.arrival);clock.push(a.arrival,a.tick);
      samples.push({at:a.arrival,tick:a.tick,players:new Map([['bot',{x:SPEED*a.tick*TICK_MS/1000,y:0}]])});if(samples.length>12)samples.shift();
    }
    const p=mode==='tick'?remoteAt(samples,clock.time(t)??-Infinity,'bot',tickTime):remoteAt(samples,t-jitter.delay(),'bot');
    if(p)out.push({t,x:p.x});
  }
  return out;
}
const speeds=(d:{t:number;x:number}[])=>d.slice(1).map((p,i)=>(p.x-d[i].x)/((p.t-d[i].t)/1000));

for(const link of LINKS)test(`bot na tela ≤ 1,05× o herói, quadro a quadro (${link.name})`,()=>{
  const v=speeds(drawn(link,'tick')),max=Math.max(...v),mean=v.reduce((a,b)=>a+b,0)/v.length;
  assert.ok(max<=1.05*SPEED,`${link.name}: ${max.toFixed(2)} u/s na tela, herói ${SPEED}`);
  assert.ok(Math.abs(mean-SPEED)<.05*SPEED,`${link.name}: média ${mean.toFixed(2)} u/s (não pode ficar para trás)`);
  assert.ok(v.filter(x=>x<.05).length<.02*v.length,`${link.name}: parado demais`);
});

test('o relógio por chegada (o antigo) desenhava o bot acima de 1,25× no 4G com perda: o teste pega o bug',()=>{
  const v=speeds(drawn(LINKS[2],'chegada'));
  assert.ok(Math.max(...v)>1.25*SPEED);
});

test('RemoteClock: segue o tick no ritmo do celular, não volta, para no fim da extrapolação e salta depois de uma queda',()=>{
  const c=new RemoteClock();
  assert.equal(c.time(0),undefined);
  for(let i=1;i<=10;i++)c.push(1000+i*100,i*2);
  const t0=c.time(2000)!;
  // A burst of 5 frames at once (a held link): the drawn time does not jump, at most CLOCK_FAST × the phone's dt.
  for(let i=11;i<=15;i++)c.push(2500,i*2);
  const t1=c.time(2016)!;
  assert.ok(t1-t0<=16*CLOCK_FAST+1e-9&&t1>=t0);
  assert.equal(c.time(2010),t1,'never goes back');
  // No more frames: it stops at the newest + EXTRAPOLATE_MAX_MS.
  let t=2016;for(;t<2600;t+=16)c.time(t);
  assert.ok(c.time(t)!<=30*TICK_MS+EXTRAPOLATE_MAX_MS+1e-9);
  // After a long drop it snaps to the new frames instead of gliding.
  c.push(20000,400);
  const late=c.time(20000+CLOCK_SNAP_MS+100)!;
  assert.ok(late>300*TICK_MS);
  c.reset();assert.equal(c.time(30000),undefined);
});
