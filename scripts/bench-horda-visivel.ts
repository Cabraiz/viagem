/**
 * Visible horde bench (card NEW-20261022-ORQ-horda-visivel-capacidade): why the city looks empty with ~4900 sleeping
 * bodies, and what raising the per-client sleeper cap (ASLEEP_PER_VIEWER) or the population costs.
 *
 * Mode 'ninhos', chaveiro, manual combat, `--bots` RoomBots walking the city, nests' population `--pop`.
 *  1. coverage: on a walkable lattice (every `--grid` u) and at the players' start, the sleepers on a real screen
 *     (a phone in portrait at the default zoom, a PC at 1920×1080; view 0) and in the area of interest; for each cap the share of points
 *     where the cap leaves on-screen sleepers out, and how many (the nearest `cap` in the area go, as the encoder does).
 *  2. cost per cap: `--ticks` ticks of the bots walking; at 10 Hz one FrameEncoder per bot per cap (its own WireIds)
 *     encodes sim.frame(), a FrameDecoder reads and acks it: KB/s per client, encode time per frame, sleepers sent.
 *  3. the sim: plan + resetRun time, bodies, heap after the plan, sim.step() ms, checkpoint bytes, stateHash ms.
 * D-031: nothing here runs in npm test; local node timing only.
 *
 *   node --experimental-strip-types scripts/bench-horda-visivel.ts [--pop 20] [--bots 4] [--seed 4242]
 *     [--caps 48,150,300,600,0] [--zoom-pc 2.0132] [--zoom-cel 0.901] [--ticks 1200] [--grid 6] [--skip-cost] [--still] [--out <file.json>]
 * --still: the bots stand at the start (nothing wakes): the cost of the sleeping population alone.
 * A cap of 0 is "no cap inside the area of interest".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../src/maps/city/terrain.ts';
import {walkable} from '../src/maps/index.ts';
import {INTEREST_HYSTERESIS,TILE_X,TILE_Y,INTEREST_RADIUS,offscreenDistance,visibleOffset,type Point} from '../src/contract/index.ts';
import {FrameDecoder,FrameEncoder,WireIds} from '../src/protocol/protocol4.ts';
import {Simulation} from '../multiplayer/simulation.ts';
import {RoomBots} from '../multiplayer/room-bots.ts';
import type {EnemyState} from '../src/sim/types.ts';
import {herois} from './elenco-ativo.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name:string,def:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0&&process.argv[i+1]?process.argv[i+1]:def;};
const POP=Number(arg('pop','20')),BOTS=Number(arg('bots','4')),SEED=Number(arg('seed','4242'));
const CAPS=arg('caps','48,150,300,600,0').split(',').map(Number),TICKS=Number(arg('ticks','1200')),GRID=Number(arg('grid','6'));
const SKIP_COST=process.argv.includes('--skip-cost'),STILL=process.argv.includes('--still'),OUT=arg('out','');
const CLASSES=herois(6);
const r1=(v:number)=>+v.toFixed(1),r3=(v:number)=>+v.toFixed(3);
const pct=(list:number[],q:number)=>{const s=[...list].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))]??0;};
const mean=(list:number[])=>list.reduce((x,y)=>x+y,0)/Math.max(1,list.length);

const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(text,hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

global.gc?.();
const heap0=process.memoryUsage().heapUsed,t0=performance.now();
const sim=new Simulation(SEED,{world:'cidade',terrain:city,objective:'chaveiro',mode:'ninhos',combat:'manual',nestPopulation:POP}),bots=new RoomBots();
for(let i=0;i<BOTS;i++){sim.addBot(`bot-${i+1}`,`bot-${i+1}`,CLASSES[i%CLASSES.length]);bots.add(`bot-${i+1}`,i);}
sim.botState=()=>bots.state();
sim.resetRun();
bots.think(sim);sim.step(sim.tick*50);
const planMs=performance.now()-t0;
global.gc?.();
const heapMb=(process.memoryUsage().heapUsed-heap0)/2**20;
const sleepers=sim.world.sleepers!,bodies=sleepers.size;

// 1. Coverage.
const reach=INTEREST_RADIUS+INTEREST_HYSTERESIS,scratch:EnemyState[]=[];
/**
 * The real screens (feet inside the rectangle, hero at the centre, view 0; no spawn margins, unlike visibleFrom), from
 * the camera zoom measured in the game (scripts/prova-horda-visivel.mjs, `camera`): CSS px per world px. The PC at
 * 1920×1080 (hero 105 px) 2.013; the phone at 390×844 in portrait at the default zoom (hero 47 px) 0.899.
 * Override with --zoom-pc / --zoom-cel.
 */
const ZOOM_PC=Number(arg('zoom-pc','2.0132')),ZOOM_CEL=Number(arg('zoom-cel','0.8992'));
const SCREEN_PC=[1920/ZOOM_PC,1080/ZOOM_PC] as const,SCREEN_PHONE=[390/ZOOM_CEL,844/ZOOM_CEL] as const;
const inRect=(dx:number,dy:number,[w,h]:readonly [number,number])=>Math.abs(TILE_X*(dx-dy))<w/2&&Math.abs(TILE_Y*(dx+dy))<h/2;
/** At `p`: the sleepers in the area sorted by distance, flagged on screen (portrait or landscape). */
function around(p:Point){
  scratch.length=0;sleepers.query(p.x,p.y,reach,scratch);
  return scratch.filter(e=>!sleepers.isTarget(e.id)&&Math.hypot(e.x-p.x,e.y-p.y)<=reach)
    .map(e=>({d:Math.hypot(e.x-p.x,e.y-p.y),id:e.id,any:visibleOffset(e.x-p.x,e.y-p.y),
      screen:(()=>{const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);return d<1e-9?0:d/offscreenDistance(dx/d,dy/d);})(),
      portrait:inRect(e.x-p.x,e.y-p.y,SCREEN_PHONE),landscape:inRect(e.x-p.x,e.y-p.y,SCREEN_PC)}))
    .sort((a,b)=>a.d-b.d||(a.id<b.id?-1:1));
}
/** Per cap: on-screen sleepers the cap keeps out at `p` (portrait). */
const missing=(list:ReturnType<typeof around>,cap:number)=>cap>0?list.slice(cap).filter(s=>s.portrait).length:0;
const missingPc=(list:ReturnType<typeof around>,cap:number)=>cap>0?list.slice(cap).filter(s=>s.landscape).length:0;
/** The same with the cap ranked by screen distance (d over the widest cameras' off-screen distance that way), not by distance. */
const missingScreen=(list:ReturnType<typeof around>,cap:number)=>cap>0?[...list].sort((a,b)=>a.screen-b.screen||(a.id<b.id?-1:1)).slice(cap).filter(s=>s.portrait).length:0;
const W=city.asset.cells.w*city.asset.unitsPerCell,H=city.asset.cells.h*city.asset.unitsPerCell;
const lattice:Point[]=[];
for(let x=GRID/2;x<W;x+=GRID)for(let y=GRID/2;y<H;y+=GRID){const p={x,y};if(walkable(p,city))lattice.push(p);}
const samples=lattice.map(around);
const anyCam=samples.map(s=>s.filter(x=>x.any).length);
const inArea=samples.map(s=>s.length),onScreen=samples.map(s=>s.filter(x=>x.portrait).length),onLand=samples.map(s=>s.filter(x=>x.landscape).length);
const coverage=CAPS.map(cap=>{
  const miss=samples.map(s=>missing(s,cap)),hit=miss.filter(m=>m>0).length,ms=samples.map(s=>missingScreen(s,cap));
  const mp=samples.map(s=>missingPc(s,cap));
  return {cap,pc:{pointsClipped:r1(100*mp.filter(m=>m>0).length/samples.length),meanWhereClipped:r1(mean(mp.filter(m=>m>0))),max:Math.max(0,...mp)},screenRanked:{pointsClipped:r1(100*ms.filter(m=>m>0).length/samples.length),meanWhereClipped:r1(mean(ms.filter(m=>m>0))),max:Math.max(0,...ms)},pointsClipped:r1(100*hit/samples.length),missingOnScreen:{meanWhereClipped:r1(mean(miss.filter(m=>m>0))),max:Math.max(0,...miss)},
    sentMean:r1(mean(inArea.map(n=>cap>0?Math.min(cap,n):n))),sentMax:Math.max(...inArea.map(n=>cap>0?Math.min(cap,n):n))};
});
const starts=[...sim.players.values()].map(p=>{const s=around(p);
  return {x:r1(p.x),y:r1(p.y),inArea:s.length,onScreenPhone:s.filter(x=>x.portrait).length,onScreenPc:s.filter(x=>x.landscape).length,
    nearest:s.length?r1(s[0].d):null};});
const plan=sim.run.nests?.plan(),nestDist=plan?plan.nests.map(n=>r1(Math.min(...[...sim.players.values()].map(p=>Math.hypot(n.x-p.x,n.y-p.y))))):[];

// 2 + 3. Walk: sim cost and, per cap, the frames.
const encs=CAPS.map(cap=>{const ids=new WireIds();return [...sim.players.keys()].map(viewer=>({cap,viewer,
  enc:new FrameEncoder(ids,{viewer,interest:{asleep:cap>0?cap:Number.MAX_SAFE_INTEGER}}),dec:new FrameDecoder(),bytes:[] as number[],encMs:[] as number[],sent:[] as number[]}));});
const steps:number[]=[],frameMs:number[]=[];
let cpuUs=0;
for(let i=0;i<(SKIP_COST?0:TICKS)&&sim.outcome===undefined;i++){
  for(const p of sim.players.values())if(!p.downed&&p.hp>0)p.hp=p.stats.maxHp;
  if(!STILL)bots.think(sim);
  const a=performance.now(),c0=process.cpuUsage();
  sim.step(sim.tick*50);
  const c1=process.cpuUsage(c0);steps.push(performance.now()-a);cpuUs+=c1.user+c1.system;
  if(i%2)continue;
  const f0=performance.now(),frame=sim.frame();frameMs.push(performance.now()-f0);
  for(const set of encs)for(const c of set){
    const e0=performance.now(),bin=c.enc.encode(frame);c.encMs.push(performance.now()-e0);c.bytes.push(bin.byteLength);
    const r=c.dec.decode(bin);if(r.ok){c.enc.ack(r.seq,r.ack.event);c.sent.push(r.view.enemies.filter(e=>(e as {asleep?:boolean}).asleep).length);}
  }
}
const cost=SKIP_COST?[]:encs.map(set=>{
  const bytes=set.flatMap(c=>c.bytes),encMs=set.flatMap(c=>c.encMs),sent=set.flatMap(c=>c.sent);
  const perClientKBs=set.map(c=>mean(c.bytes)*10/1024);
  return {cap:set[0].cap,kbPerSecPerClient:{mean:r1(mean(perClientKBs)),worst:r1(Math.max(...perClientKBs))},
    frameBytes:{p50:pct(bytes,.5),p95:pct(bytes,.95),max:Math.max(...bytes)},
    encodeMsPerClient:{mean:r3(mean(encMs)),p95:r3(pct(encMs,.95))},sleepersSent:{mean:r1(mean(sent)),p95:pct(sent,.95),max:Math.max(...sent)}};
});
const cp=JSON.stringify(sim.checkpoint());
const h0=performance.now();sim.stateHash();const hashMs=performance.now()-h0;
const result={
  pop:POP,bots:BOTS,seed:SEED,bodies,planMs:Math.round(planMs),heapMb:r1(heapMb),reach,
  sim:SKIP_COST?null:{ticks:steps.length,stepMs:{mean:r3(mean(steps)),p95:r3(pct(steps,.95)),max:r3(Math.max(...steps))},stepCpuMs:r3(cpuUs/1000/Math.max(1,steps.length)),
    frameMs:{mean:r3(mean(frameMs)),p95:r3(pct(frameMs,.95))},awakeEnd:sim.world.enemies.size,asleepEnd:sim.world.sleepers?.size??0},
  checkpointKB:Math.round(cp.length/1024),stateHashMs:r3(hashMs),
  lattice:{grid:GRID,points:samples.length,
    inArea:{mean:r1(mean(inArea)),p50:pct(inArea,.5),p95:pct(inArea,.95),max:Math.max(...inArea)},
    onScreenPhonePortrait:{mean:r1(mean(onScreen)),p50:pct(onScreen,.5),p95:pct(onScreen,.95),max:Math.max(...onScreen),emptyPct:r1(100*onScreen.filter(n=>n===0).length/onScreen.length)},
    onAnyLegalCamera:{mean:r1(mean(anyCam)),p50:pct(anyCam,.5),p95:pct(anyCam,.95),p99:pct(anyCam,.99),max:Math.max(...anyCam)},
    onScreenPc1920:{mean:r1(mean(onLand)),p50:pct(onLand,.5),p95:pct(onLand,.95),max:Math.max(...onLand),emptyPct:r1(100*onLand.filter(n=>n===0).length/onLand.length)}},
  coverage,starts,nestDistFromStart:nestDist,cost,
  node:process.version,cpu:os.cpus()[0]?.model??'unknown',
};
console.log(JSON.stringify(result,null,1));
if(OUT)fs.writeFileSync(OUT,JSON.stringify(result,null,1));
