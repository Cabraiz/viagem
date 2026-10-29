/**
 * D-051 band, the worst case of proposal A6 (card NEW-20261014-ORQ-ninhos-benches): six clients in the Cidade Nevada,
 * ENEMIES awake bodies chasing them (topped up every tick, so they change every tick), and at ARRIVE_S the whole team
 * steps beside the biggest nest (a G: its sleepers enter the six areas of interest at once). Each client is a
 * FrameEncoder like the room's (shared WireIds, its slot, chain, FAR_EVERY) whose frames a FrameDecoder reads and acks
 * at once; the same run feeds a second set encoding every tick (20 Hz). Nobody falls (hp refilled), nobody moves on
 * their own (no bot brain: the hit, the kills and the noise still wake bodies around them).
 * Per rate: KB/s per client before and after the arrival, the worst 1 s window, frame bytes (p50, p95, max) and the
 * sleeping bodies on the wire. `--mode rounds` runs the same without nests: its max frame is today's burst ceiling.
 * Bars (card): < 30 KB/s at 10 Hz, < 50 KB/s at 20 Hz, no frame over the rounds run's max.
 *   node --experimental-strip-types scripts/bench-ninhos-bytes.ts [--mode ninhos|rounds] [--seed 4242] [--enemies 300]
 *     [--seconds 30] [--out <file.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Rng} from '../src/contract/rng.ts';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {walkable,type Point} from '../src/maps/index.ts';
import {citySpeed} from '../src/sim/city/speed.ts';
import {createEnemy,type EnemyKind} from '../src/sim/enemies/catalog.ts';
import type {SimContext} from '../src/sim/context.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {FAR_EVERY} from '../multiplayer/room.ts';
import {FrameDecoder,FrameEncoder,SEND_EVERY,WireIds} from '../src/protocol/protocol4.ts';
import {ROTA_INIMIGOS,herois} from './elenco-ativo.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const NESTS=arg('mode','ninhos')==='ninhos',SEED=Number(arg('seed','4242')),ENEMIES=Number(arg('enemies','300'));
const SECONDS=Number(arg('seconds','30')),OUT=arg('out','');
/** The team arrives at the nest this far into the measure (s); the first 2 s after it are "the arrival". */
const ARRIVE_S=SECONDS/2,ARRIVAL_S=2;
const CLASSES=herois(6);
const KINDS:EnemyKind[]=[...ROTA_INIMIGOS];
const RING_MIN=12,RING_MAX=40,LATTICE=1.5,HZ=20;

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

const sim=new Simulation(SEED,{world:'cidade',terrain:city,cityStructures:true,objective:'chaveiro',...(NESTS?{mode:'ninhos' as const}:{})});
CLASSES.forEach((c,i)=>sim.addBot(`bot-${i+1}`,`bot-${i+1}`,c));
sim.resetRun();
for(let i=0;i<3;i++)sim.step(sim.tick*50);

/** Walkable lattice points RING_MIN..RING_MAX u around `c`, where the awake bodies are topped up. */
const ring=(c:Point)=>{
  const out:Point[]=[],W=city.asset.cells.w*city.asset.unitsPerCell,H=city.asset.cells.h*city.asset.unitsPerCell;
  for(let x=Math.max(0,c.x-RING_MAX);x<Math.min(W,c.x+RING_MAX);x+=LATTICE)for(let y=Math.max(0,c.y-RING_MAX);y<Math.min(H,c.y+RING_MAX);y+=LATTICE){
    const d=Math.hypot(x-c.x,y-c.y),p={x,y};if(d>=RING_MIN&&d<=RING_MAX&&walkable(p,city))out.push(p);
  }
  return out;
};
const plaza=city.asset.points.praca;
// Where the team goes: beside the biggest nest (ninhos), or as far from the plaza in the rounds run (same walk).
const nests=NESTS?sim.run.nests!.state.nests:[];
const order={G:3,M:2,P:1} as Record<string,number>;
const target=nests.length?[...nests].sort((a,b)=>(order[b.size]??0)-(order[a.size]??0)||a.id.localeCompare(b.id))[0]:undefined;
const goal:Point=target?{x:target.x,y:target.y}:{x:plaza.x+40,y:plaza.y};
/** A walkable point next to `c` (the nest's yard), for each player in turn. */
const beside=(c:Point,i:number):Point=>{
  for(let r=3;r<12;r+=.5)for(let k=0;k<12;k++){const a=(i*12+k)/12*Math.PI*2/6+i,p={x:c.x+Math.cos(a)*r,y:c.y+Math.sin(a)*r};if(walkable(p,city))return p;}
  return c;
};
const place=(at:Point)=>{let i=0;for(const p of sim.players.values()){const q=beside(at,i++);p.x=q.x;p.y=q.y;}};
place(plaza);

const rng=new Rng(SEED^0xb17e5);
let kindAt=0,spots=ring(plaza);
const ctx={get tick(){return sim.tick;},nextId:(p:string)=>sim.world.nextId(p),enemies:sim.world.enemies} as unknown as SimContext;
const topUp=()=>{
  while(sim.world.enemies.size<ENEMIES&&spots.length){
    const e=createEnemy(ctx,KINDS[kindAt++%KINDS.length],spots[rng.int(0,spots.length-1)]);
    e.speed=citySpeed(e.speed);
  }
};

interface Client {enc:FrameEncoder;dec:FrameDecoder;bytes:number[];at:number[];asleep:number[];full:boolean[]}
const clients=()=>{
  const ids=new WireIds();
  return [...sim.players.keys()].map((id,i):Client=>({enc:new FrameEncoder(ids,{viewer:id,slot:i%SEND_EVERY,chain:true,farEvery:FAR_EVERY}),dec:new FrameDecoder(),bytes:[],at:[],asleep:[],full:[]}));
};
const at10=clients(),at20=clients();
let decodeErrors=0;
const send=(c:Client,frame:ReturnType<typeof sim.frame>,second:number)=>{
  const fulls=c.enc.stats.fullFrames,data=c.enc.encode(frame),r=c.dec.decode(data);
  if(!r.ok){decodeErrors++;c.enc.resync();return;}
  c.enc.ack(r.seq);c.bytes.push(data.length);c.at.push(second);c.full.push(c.enc.stats.fullFrames>fulls);
  c.asleep.push(r.view.enemies.filter(e=>e.asleep).length);
};

// Fill up the horde before measuring (25 a tick, like the lab).
for(let i=0;i<HZ*5;i++){topUp();sim.step(sim.tick*50);}
const startTick=sim.tick;
for(let t=0;t<SECONDS*HZ;t++){
  const second=t/HZ;
  // The team and its 300 awake bodies arrive together: the nest's sleepers enter on top of a full horde.
  if(t===ARRIVE_S*HZ){place(goal);spots=ring(goal);for(const e of sim.world.enemies.values()){const q=spots[rng.int(0,spots.length-1)];e.x=q.x;e.y=q.y;}}
  topUp();
  for(const p of sim.players.values())if(!p.downed&&p.hp>0)p.hp=p.stats.maxHp;
  const events=sim.step(sim.tick*50);
  for(const c of [...at10,...at20])c.enc.pushEvents(events);
  const frame=sim.frame();
  for(const c of at10)if(c.enc.due(sim.tick))send(c,frame,second);
  for(const c of at20)send(c,frame,second);
}

const pct=(list:number[],q:number)=>{const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const kb=(b:number,s:number)=>+(b/1024/Math.max(1e-9,s)).toFixed(2);
const report=(set:Client[])=>{
  const per=set.map(c=>{
    const sum=(from:number,to:number)=>c.bytes.reduce((a,b,i)=>c.at[i]>=from&&c.at[i]<to?a+b:a,0);
    let worst=0;for(let s=0;s+1<=SECONDS;s+=.5)worst=Math.max(worst,sum(s,s+1));
    return {before:kb(sum(0,ARRIVE_S),ARRIVE_S),arrival:kb(sum(ARRIVE_S,ARRIVE_S+ARRIVAL_S),ARRIVAL_S),after:kb(sum(ARRIVE_S,SECONDS),SECONDS-ARRIVE_S),
      worst1s:kb(worst,1),maxFrame:Math.max(...c.bytes),asleepMax:Math.max(...c.asleep),
      // The biggest delta frame (a full one is the join's keyframe or a resync) and when it went (s into the measure).
      maxDelta:Math.max(0,...c.bytes.filter((_,i)=>!c.full[i])),maxDeltaAt:c.at[c.bytes.findIndex((b,i)=>!c.full[i]&&b===Math.max(0,...c.bytes.filter((_,j)=>!c.full[j])))]??null};
  });
  const all=set.flatMap(c=>c.bytes);
  return {KBps:{before:Math.max(...per.map(p=>p.before)),arrival:Math.max(...per.map(p=>p.arrival)),after:Math.max(...per.map(p=>p.after)),worst1s:Math.max(...per.map(p=>p.worst1s))},
    frameBytes:{p50:pct(all,.5),p95:pct(all,.95),max:Math.max(...all),maxDelta:Math.max(...per.map(p=>p.maxDelta)),
      maxDeltaAt:per.reduce((a,p)=>p.maxDelta>a.d?{d:p.maxDelta,at:p.maxDeltaAt}:a,{d:-1,at:null as number|null}).at},asleepOnWire:Math.max(...per.map(p=>p.asleepMax)),perClient:per};
};
const asleep=()=>{const z=sim.world.sleepers;if(!z)return 0;const all:{id:string}[]=[];z.query(0,0,1e6,all);return all.filter(e=>!z.isTarget(e.id)).length;};
const result={mode:NESTS?'ninhos':'rounds',seed:SEED,enemies:ENEMIES,seconds:SECONDS,arriveAt:ARRIVE_S,startTick,
  nest:target?{id:target.id,size:target.size}:null,asleepLeft:asleep(),awakeEnd:sim.world.enemies.size,decodeErrors,
  hz10:report(at10),hz20:report(at20),node:process.version};
console.log(JSON.stringify({...result,hz10:{...result.hz10,perClient:undefined},hz20:{...result.hz20,perClient:undefined}},null,1));
if(OUT){fs.mkdirSync(path.dirname(path.resolve(OUT)),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,1)+'\n');}
