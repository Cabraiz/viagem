/**
 * City sim tick bench (NEW-20261013-ORQ-cidade-flowfield-e-bots): the cost of one `Simulation.step()` in the Cidade
 * Nevada with 6 room bots and a horde topped up to ~300 enemies, the load the Worker room pays per tick.
 *
 * One run: `new Simulation(seed,{world:'cidade',terrain,cityStructures:true})` over the real asset, six room bots
 * (RoomBots, the room's own driver: `think` then `step`), `resetRun()`, played untimed into the round-2 wave, then
 * WARMUP + MEASURE ticks where, before every step (untimed), the horde is topped up to ENEMIES bodies (fixed kind
 * rotation, on reachable street points 12–45 u from the plaza, picked by a seeded Rng) and the bots' hp is refilled
 * (nobody falls, so the six keep moving and the players fields keep their real churn). Only `sim.step()` is timed;
 * the bots' thinking is reported apart, and `stepCpuMs` is the steps' CPU time per tick (steadier than wall time on a
 * busy machine). The final `sim.stateHash()` is printed: the same number before and after a
 * change means the change did not alter the run.
 *
 * --mode ninhos (D-051, card ninhos-benches): the chaveiro objective in the nests mode; the plan's sleepers (6 players'
 * plan, ~320 bodies) stay asleep in their index beside the ENEMIES awake ones, so the tick pays both. No round to wait
 * for: the run plays SETTLE untimed ticks (the sleepers are made on the first step), then the same top-up and measure.
 * Reported apart: the sleepers asleep at the start and the end of the measure. Barra (card): ≤ +10 % of the rounds' tick.
 *
 * --profile wraps FlowField's recompute (Dial pass + directions): count and ms per caller (the first stack frame
 * outside flowfield.ts) and per field size. D-031: nothing here runs in npm test; local node timing only.
 *
 *   node --experimental-strip-types scripts/bench-city-tick.ts [--seed 4242] [--ticks 1200] [--warmup 200]
 *     [--enemies 300] [--mode ninhos] [--profile] [--out <file.json>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Rng} from '../src/contract/rng.ts';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {FlowField,UNREACHABLE,walkable,type Point} from '../src/maps/index.ts';
import {cityPlanner} from '../src/sim/city/grid.ts';
import {citySpeed} from '../src/sim/city/speed.ts';
import {createEnemy,type EnemyKind} from '../src/sim/enemies/catalog.ts';
import type {SimContext} from '../src/sim/context.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const SEED=Number(arg('seed','4242')),MEASURE=Number(arg('ticks','1200')),WARMUP=Number(arg('warmup','200')),ENEMIES=Number(arg('enemies','300'));
const PROFILE=process.argv.includes('--profile'),OUT=arg('out',''),NESTS=arg('mode','rounds')==='ninhos';
/** --mode ninhos: untimed ticks before the measure (the sleepers come on the first step; 30 s of the bots' start). */
const SETTLE=600;
const CLASSES=['cidadao-comum','clt-cansado','feirante','cidadao-comum','clt-cansado','feirante'];
const KINDS:EnemyKind[]=['bebado','bebado','pombos','tio-pave','agiota','bebado'];
const RING_MIN=12,RING_MAX=45,LATTICE=1.5;

// --- profile: wrap FlowField.recompute -------------------------------------------------------------------------
const prof=new Map<string,{n:number;ms:number}>();
let profiling=false;
if(PROFILE){
  const proto=FlowField.prototype as unknown as {recompute():void};
  const inner=proto.recompute;
  proto.recompute=function(this:FlowField){
    if(!profiling)return inner.call(this);
    const frames=(new Error().stack??'').split('\n').slice(2).map(s=>s.trim());
    const at=frames.find(f=>!f.includes('flowfield.ts'))??'?';
    const where=(at.match(/([\w.-]+\.ts):(\d+)/)?.slice(1,3).join(':'))??at;
    const fn=at.match(/^at (?:Object\.)?([\w.<>$]+) \(/)?.[1]??'';
    const key=`${where} ${fn} ${this.width}x${this.height}`;
    const t0=performance.now();inner.call(this);const ms=performance.now()-t0;
    const s=prof.get(key)??{n:0,ms:0};s.n++;s.ms+=ms;prof.set(key,s);
  };
}

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

// Spawn points: walkable lattice points RING_MIN..RING_MAX u from the plaza that reach it on the planner's field.
const planner=cityPlanner(city),plaza=city.asset.points.praca,spots:Point[]=[];
for(let x=0;x<city.asset.cells.w*city.asset.unitsPerCell;x+=LATTICE)for(let y=0;y<city.asset.cells.h*city.asset.unitsPerCell;y+=LATTICE){
  const d=Math.hypot(x-plaza.x,y-plaza.y),p={x,y};
  if(d>=RING_MIN&&d<=RING_MAX&&walkable(p,city)&&planner.plazaField.costAt(x,y)!==UNREACHABLE)spots.push(p);
}

const sim=new Simulation(SEED,{world:'cidade',terrain:city,cityStructures:true,...(NESTS?{objective:'chaveiro' as const,mode:'ninhos' as const}:{})}),bots=new RoomBots();
CLASSES.forEach((c,i)=>{sim.addBot(`bot-${i+1}`,`bot-${i+1}`,c);bots.add(`bot-${i+1}`,i);});
sim.botState=()=>bots.state();
sim.resetRun();
let guard=0;
const settled=()=>NESTS?guard>=SETTLE:sim.world.round.index>=2&&sim.world.round.phase==='wave';
for(;guard<20*60*10&&!settled()&&sim.outcome===undefined;guard++){bots.think(sim);sim.step(sim.tick*50);}
/** D-051: the bodies asleep now (the nests' hit targets are not bodies). */
const asleepNow=()=>{const z=sim.world.sleepers;if(!z)return 0;const all:{id:string}[]=[];z.query(0,0,1e6,all);return all.filter(e=>!z.isTarget(e.id)).length;};
const asleepStart=asleepNow();
const startRound=sim.world.round.index,startTick=sim.tick;
const rng=new Rng(SEED^0x5eed);
let kindAt=0;
const ctx={get tick(){return sim.tick;},nextId:(p:string)=>sim.world.nextId(p),enemies:sim.world.enemies} as unknown as SimContext;
const topUp=()=>{
  while(sim.world.enemies.size<ENEMIES){
    const e=createEnemy(ctx,KINDS[kindAt++%KINDS.length],spots[rng.int(0,spots.length-1)]);
    e.speed=citySpeed(e.speed);
  }
};
const steps:number[]=[],thinks:number[]=[],counts:number[]=[];
// CPU time of the steps (process.cpuUsage, user + system): on a busy machine wall time also counts the time the
// process waited for a core; CPU time does not. Coarse per call (the OS clock tick, ~16 ms on Windows) but unbiased
// summed over many steps.
let cpuUs=0;
for(let i=0;i<WARMUP+MEASURE&&sim.outcome===undefined;i++){
  topUp();
  for(const p of sim.players.values())if(!p.downed&&p.hp>0)p.hp=p.stats.maxHp;
  const t0=performance.now();bots.think(sim);const t1=performance.now();
  if(i===WARMUP)profiling=true;
  const c0=process.cpuUsage();
  sim.step(sim.tick*50);
  const t2=performance.now(),c1=process.cpuUsage(c0);
  if(i>=WARMUP)cpuUs+=c1.user+c1.system;
  if(i>=WARMUP){steps.push(t2-t1);thinks.push(t1-t0);counts.push(sim.world.enemies.size);}
}
profiling=false;
const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const mean=(list:number[])=>list.reduce((a,b)=>a+b,0)/Math.max(1,list.length);
const r3=(v:number)=>+v.toFixed(3);
const result={
  seed:SEED,mode:NESTS?'ninhos':'rounds',ticks:steps.length,...(NESTS?{asleepStart,asleepEnd:asleepNow()}:{}),warmup:WARMUP,enemiesTarget:ENEMIES,enemiesMean:+mean(counts).toFixed(1),
  startRound,startTick,endRound:sim.world.round.index,endPhase:sim.world.round.phase,outcome:sim.outcome??null,
  stepMs:{mean:r3(mean(steps)),p50:r3(pct(steps,.5)),p95:r3(pct(steps,.95)),p99:r3(pct(steps,.99)),max:r3(Math.max(...steps))},
  stepCpuMs:r3(cpuUs/1000/Math.max(1,steps.length)),
  thinkMs:{mean:r3(mean(thinks)),p95:r3(pct(thinks,.95))},
  stateHash:sim.stateHash(),
  ...(PROFILE?{recompute:Object.fromEntries([...prof].sort((a,b)=>b[1].ms-a[1].ms).map(([k,v])=>[k,{n:v.n,perTick:+(v.n/Math.max(1,steps.length)).toFixed(3),ms:r3(v.ms),msPerTick:r3(v.ms/Math.max(1,steps.length))}]))}:{}),
  node:process.version,cpu:os.cpus()[0]?.model??'unknown',
};
console.log(JSON.stringify(result,null,1));
if(OUT){fs.mkdirSync(path.dirname(path.resolve(OUT)),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,1)+'\n');}
