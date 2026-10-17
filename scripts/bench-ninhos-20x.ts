/**
 * Ninhos ×20 bench (card NEW-20261017-ORQ-ninhos-perto-ataca-20x): what the sleeping horde costs the room, at the
 * nests' population `--pop` (1 = the slice-1 city, 20 = the card's), mode 'ninhos' with the chaveiro and the manual
 * combat, `--bots` room bots (RoomBots, the room's own driver) walking the city and waking it.
 *
 * Per run: the plan's bodies; then `--ticks` ticks (after `--warmup`), each timed: the bots' thinking and `sim.step()`
 * (wall and CPU), the bodies awake and asleep; every 2nd tick (10 Hz) the frame of one client (bot-1's view, the
 * viewer's area of interest, acked at once: a perfect link) is encoded and its bytes counted; at the end the
 * checkpoint's JSON size and the time of one stateHash. Nobody falls (hp refilled, untimed), so the bots keep walking.
 * D-031: nothing here runs in npm test; local node timing only.
 *
 *   node --experimental-strip-types scripts/bench-ninhos-20x.ts [--pop 20] [--bots 6] [--seed 4242] [--ticks 3600]
 *     [--warmup 200] [--out <file.json>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {FrameDecoder,FrameEncoder} from '../src/protocol/protocol4.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const POP=Number(arg('pop','20')),BOTS=Number(arg('bots','6')),SEED=Number(arg('seed','4242'));
const MEASURE=Number(arg('ticks','3600')),WARMUP=Number(arg('warmup','200')),OUT=arg('out','');
const CLASSES=['cidadao-comum','clt-cansado','feirante'];

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);

const t0=performance.now();
const sim=new Simulation(SEED,{world:'cidade',terrain:loaded.terrain,objective:'chaveiro',mode:'ninhos',combat:'manual',nestPopulation:POP}),bots=new RoomBots();
for(let i=0;i<BOTS;i++){sim.addBot(`bot-${i+1}`,`bot-${i+1}`,CLASSES[i%CLASSES.length]);bots.add(`bot-${i+1}`,i);}
sim.botState=()=>bots.state();
sim.resetRun();
bots.think(sim);sim.step(sim.tick*50);
const startMs=performance.now()-t0;
const bodies=sim.run.sono()?.bodies.length??0;

const enc=new FrameEncoder(undefined,{viewer:'bot-1'}),dec=new FrameDecoder();
const steps:number[]=[],thinks:number[]=[],awake:number[]=[],asleep:number[]=[],bytes:number[]=[],sent:number[]=[];
let cpuUs=0,woke=0;
for(let i=0;i<WARMUP+MEASURE&&sim.outcome===undefined;i++){
  for(const p of sim.players.values())if(!p.downed&&p.hp>0)p.hp=p.stats.maxHp;
  const a=performance.now();bots.think(sim);const b=performance.now();
  const c0=process.cpuUsage();
  sim.step(sim.tick*50);
  const c=performance.now(),c1=process.cpuUsage(c0);
  if(i<WARMUP)continue;
  cpuUs+=c1.user+c1.system;steps.push(c-b);thinks.push(b-a);
  awake.push(sim.world.enemies.size);asleep.push(sim.world.sleepers?.size??0);
  if(i%2===0){
    const frame=enc.encode(sim.frame()),r=dec.decode(frame);
    if(r.ok){enc.ack(r.seq,r.ack.event);sent.push(r.view.enemies.length);woke+=r.view.events.filter(e=>e.type==='acordou').length;}
    bytes.push(frame.byteLength);
  }
}
const cp=JSON.stringify(sim.checkpoint());
const h0=performance.now();sim.stateHash();const hashMs=performance.now()-h0;
const pct=(list:number[],q:number)=>{const s=[...list].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const mean=(list:number[])=>list.reduce((x,y)=>x+y,0)/Math.max(1,list.length);
const r3=(v:number)=>+v.toFixed(3);
const result={
  pop:POP,bots:BOTS,seed:SEED,bodies,ticks:steps.length,startMs:Math.round(startMs),outcome:sim.outcome??null,
  stepMs:{mean:r3(mean(steps)),p50:r3(pct(steps,.5)),p95:r3(pct(steps,.95)),p99:r3(pct(steps,.99)),max:r3(Math.max(...steps))},
  stepCpuMs:r3(cpuUs/1000/Math.max(1,steps.length)),thinkMs:{mean:r3(mean(thinks)),p95:r3(pct(thinks,.95))},
  awake:{mean:Math.round(mean(awake)),max:Math.max(...awake)},asleepEnd:asleep[asleep.length-1]??0,
  frameBytes:{mean:Math.round(mean(bytes)),p95:pct(bytes,.95),max:Math.max(...bytes),perSecond:Math.round(mean(bytes)*10)},
  enemiesSent:{mean:Math.round(mean(sent)),max:Math.max(...sent)},acordouEvents:woke,
  checkpointBytes:cp.length,stateHashMs:r3(hashMs),
  node:process.version,cpu:os.cpus()[0]?.model??'unknown',
};
console.log(JSON.stringify(result,null,1));
if(OUT)fs.writeFileSync(OUT,JSON.stringify(result,null,1));
