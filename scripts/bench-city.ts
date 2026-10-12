/**
 * Enemy-AI tick benchmark per world (NEW-20261012-ORQ-cidade-02-terreno-motor): "bench do tick com 300 bichos na cidade
 * <= o atual". Same horde as the tests/sim/sim-enemies.test.ts bench (120 bebado, 90 pombos, 45 tio-pave, 45 agiota,
 * 6 players), stepped by the real SimWorld (src/sim/core.ts) with the production SpatialHash and only EnemyAi registered,
 * on three terrains:
 *  - endless: new TerrainField(seed,{world:'infinito'}), the current default room world;
 *  - island:  new TerrainField(DEFAULT_SEED), reference;
 *  - city:    CityTerrain over public/maps/cidade-nevada.json (+ manifest hash).
 * Layout: endless and city put the players around the base (the city's plaza) and the enemies on walkable lattice points
 * 10-40 u away that are connected to the base (flood fill, so nobody starts in a sealed courtyard); the island is too
 * small for that ring and keeps the test's layout (players near the centre, enemies anywhere on land).
 * Each world: 50 warm-up ticks, 200 measured. Two timing rounds in rotation (the second is reported, so every world
 * runs with the shared code already optimised and polymorphic), then one counting replay through a terrain proxy that
 * counts walkable() queries (terrain.land on island/endless, terrain.clearDisc on the city: one per walkable call).
 * Asserts every enemy is walkable at the end. Local node timing only.
 *
 * Run: node --experimental-strip-types scripts/bench-city.ts [--out <file.json>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Rng} from '../src/contract/rng.ts';
import {BASE_STATS,type EnemyState,type SimPlayer} from '../src/contract/types.ts';
import {SimWorld,stateHash} from '../src/sim/core.ts';
import type {SimContext,SimSystem} from '../src/sim/context.ts';
import {SpatialHash} from '../src/sim/spatial.ts';
import {EnemyAi} from '../src/sim/enemies/ai.ts';
import {createEnemy,type EnemyKind} from '../src/sim/enemies/catalog.ts';
import {clearSegment,maskSurface,walkable,worldBase,type Point} from '../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../src/maps/terrain/field.ts';
import {decodeCityAsset} from '../src/maps/city-asset.ts';
import {CityTerrain,cityAsField} from '../src/maps/city/terrain.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const WARMUP=50,MEASURE=200,ENEMIES=300,PLAYERS=6,SEED=14,SPAWN_SEED=1414;
const RING_MIN=10,RING_MAX=40,LATTICE=.5,PLAYER_RING=3,MICRO_REPS=200;
/** Players never go down: healing to a huge hp keeps contact damage (and its events) in the tick without ending the run. */
const HP=1e6;

type WorldId='endless'|'island'|'city';
type Stats={avg:number;median:number;p95:number;max:number;min:number};
interface Layout {players:Point[];spawns:Point[];anchor:Point;candidates:number}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const kindAt=(i:number):EnemyKind=>i<120?'bebado':i<210?'pombos':i<255?'tio-pave':'agiota';

function stats(times:number[]):Stats{
  const s=[...times].sort((a,b)=>a-b),n=s.length,q=(p:number)=>s[Math.min(n-1,Math.floor(p*n))];
  const r=(v:number)=>Math.round(v*1e4)/1e4;
  return {avg:r(times.reduce((a,b)=>a+b,0)/n),median:r(q(.5)),p95:r(q(.95)),max:r(s[n-1]),min:r(s[0])};
}

function makeTerrain(id:WorldId):TerrainField{
  if(id==='endless')return new TerrainField(DEFAULT_SEED,{world:'infinito'});
  if(id==='island')return new TerrainField(DEFAULT_SEED);
  const json=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
  const decoded=decodeCityAsset(json);
  if(!decoded.ok)throw new Error(decoded.error);
  return cityAsField(new CityTerrain(decoded.asset,manifest.hash));
}

/** Walkable lattice points connected to `anchor` (4-neighbour flood fill with swept segments) within RING_MAX+1. */
function reachable(anchor:Point,terrain:TerrainField):Point[]{
  const half=Math.ceil((RING_MAX+1)/LATTICE),side=half*2+1;
  const ax=Math.round(anchor.x/LATTICE)*LATTICE,ay=Math.round(anchor.y/LATTICE)*LATTICE;
  const at=(i:number,j:number):Point=>({x:ax+(i-half)*LATTICE,y:ay+(j-half)*LATTICE});
  const state=new Int8Array(side*side);// 0 unknown, 1 walkable+seen, -1 blocked
  const ok=(i:number,j:number)=>{
    const k=j*side+i;
    if(!state[k])state[k]=walkable(at(i,j),terrain)?1:-1;
    return state[k]===1;
  };
  // Start from the walkable lattice node nearest to the anchor.
  let start=-1;
  for(let r=0;r<=4&&start<0;r++)for(let j=half-r;j<=half+r&&start<0;j++)for(let i=half-r;i<=half+r;i++)
    if(ok(i,j)&&clearSegment(anchor,at(i,j),terrain)){start=j*side+i;break;}
  if(start<0)throw new Error('no walkable lattice node near the anchor');
  const seen=new Uint8Array(side*side),queue=[start],out:Point[]=[];seen[start]=1;
  while(queue.length){
    const k=queue.pop()!,i=k%side,j=(k-i)/side,p=at(i,j);
    if(dist(p,anchor)<=RING_MAX+1)out.push(p);
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const ni=i+di,nj=j+dj,nk=nj*side+ni;
      if(ni<0||nj<0||ni>=side||nj>=side||seen[nk]||!ok(ni,nj))continue;
      if(!clearSegment(p,at(ni,nj),terrain))continue;
      seen[nk]=1;queue.push(nk);
    }
  }
  // Deterministic order regardless of the fill order.
  return out.sort((a,b)=>a.y-b.y||a.x-b.x);
}

/** Farthest-point sampling: the node nearest the anchor first, then the ones spreading the group around it. */
function spread(points:Point[],anchor:Point,count:number):Point[]{
  const pool=[...points].sort((a,b)=>dist(a,anchor)-dist(b,anchor));
  const chosen=[pool[0]];
  while(chosen.length<count){
    let best=pool[0],bestD=-1;
    for(const p of pool){const d=Math.min(...chosen.map(c=>dist(c,p)));if(d>bestD){bestD=d;best=p;}}
    chosen.push(best);
  }
  return chosen;
}

function layout(id:WorldId,terrain:TerrainField):Layout{
  const spawn=new Rng(SPAWN_SEED);
  if(id==='island'){
    // tests/sim/sim-enemies.test.ts bench: the whole island is ~21 u across, so no 10-40 u ring exists.
    const anchor={x:12,y:12},walk:Point[]=[];
    for(let y=1;y<=23;y+=.25)for(let x=1;x<=23;x+=.25)if(walkable({x,y},terrain))walk.push({x,y});
    const near=walk.filter(p=>dist(p,anchor)<=PLAYER_RING);
    return {anchor,players:spread(near,anchor,PLAYERS),spawns:Array.from({length:ENEMIES},()=>spawn.pick(walk)),candidates:walk.length};
  }
  // City: the plaza is the base (worldBase reads it from the mask surface); endless: the origin.
  const anchor=id==='city'?{...(terrain as unknown as CityTerrain).asset.points.praca}:worldBase(terrain);
  const nodes=reachable(anchor,terrain);
  const near=nodes.filter(p=>dist(p,anchor)<=PLAYER_RING);
  const ring=nodes.filter(p=>{const d=dist(p,anchor);return d>=RING_MIN&&d<=RING_MAX;});
  if(near.length<PLAYERS||!ring.length)throw new Error(`${id}: ${near.length} player nodes, ${ring.length} spawn nodes`);
  return {anchor,players:spread(near,anchor,PLAYERS),spawns:Array.from({length:ENEMIES},()=>spawn.pick(ring)),candidates:ring.length};
}

/** Counts terrain.land / terrain.clearDisc calls made from outside (one per world.ts walkable call). */
function countingTerrain(terrain:TerrainField){
  const counter={walkable:0};
  const cache=new Map<PropertyKey,unknown>();
  const proxy=new Proxy(terrain,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(typeof value!=='function')return value;
    let fn=cache.get(key);
    if(!fn){
      const counted=key==='land'||key==='clearDisc';
      fn=counted?(...args:unknown[])=>{counter.walkable++;return (value as (...a:unknown[])=>unknown).apply(target,args);}:value.bind(target);
      cache.set(key,fn);
    }
    return fn;
  }});
  return {proxy,counter};
}

/** Times (and optionally counts) the inner EnemyAi.step under SimWorld's 'enemy-ai' slot. */
class TimedAi implements SimSystem {
  readonly id='enemy-ai';
  readonly ai=new EnemyAi();
  last=0;lastCalls=0;
  private readonly counter:{walkable:number}|undefined;
  constructor(counter?:{walkable:number}){this.counter=counter;}
  step(ctx:SimContext){
    const c0=this.counter?.walkable??0,t0=performance.now();
    this.ai.step(ctx);
    this.last=performance.now()-t0;this.lastCalls=(this.counter?.walkable??0)-c0;
  }
}

function addPlayer(world:SimWorld,id:string,at:Point){
  const p:SimPlayer={id,classId:'bench',x:at.x,y:at.y,hp:HP,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{}};
  world.players.set(id,p);
}

interface RunResult {ai:number[];tick:number[];calls:number[];hash:string;offWalkable:number;downed:number;meanPlayerDistance:number;world:SimWorld;terrain:TerrainField}
function run(terrain:TerrainField,place:Layout,counter?:{walkable:number}):RunResult{
  const world=new SimWorld({terrain,seed:SEED,enemyIndex:new SpatialHash<EnemyState>()});
  const system=new TimedAi(counter);
  world.register(system);
  place.players.forEach((p,i)=>addPlayer(world,`p${i}`,p));
  place.spawns.forEach((p,i)=>createEnemy(world,kindAt(i),p));
  const startMask=maskSurface(terrain),startClear=new Set<string>();
  for(const e of world.enemies.values())if(!startMask||startMask.clearDisc(e.x,e.y,e.radius))startClear.add(e.id);
  const ai:number[]=[],tick:number[]=[],calls:number[]=[];
  let downed=0;
  for(let t=0;t<WARMUP+MEASURE;t++){
    const t0=performance.now();
    world.step();
    const dt=performance.now()-t0;
    for(const p of world.players.values()){if(!(p.hp>0))downed++;p.hp=HP;}
    if(t>=WARMUP){ai.push(system.last);tick.push(dt);calls.push(system.lastCalls);}
  }
  let offWalkable=0,sum=0;
  // City: bodies wider than the hero must also keep their own disc out of the walls (ai.ts clearFrom).
  const mask=maskSurface(terrain);
  for(const e of world.enemies.values()){
    if(!walkable(e,terrain)||(mask&&!mask.clearDisc(e.x,e.y,e.radius)&&startClear.has(e.id)))offWalkable++;
    let best=Infinity;for(const p of world.players.values())best=Math.min(best,dist(e,p));sum+=best;
  }
  return {ai,tick,calls,hash:stateHash(world.state()),offWalkable,downed,meanPlayerDistance:Math.round(sum/world.enemies.size*100)/100,world,terrain};
}

/** Cost of one walkable() query on the final enemy positions (separates "how many" from "how expensive"). */
function microWalkable(points:Point[],terrain:TerrainField){
  let hits=0;
  for(let r=0;r<20;r++)for(const p of points)if(walkable(p,terrain))hits++;// warm
  const t0=performance.now();
  for(let r=0;r<MICRO_REPS;r++)for(const p of points)if(walkable(p,terrain))hits++;
  const ns=(performance.now()-t0)*1e6/(MICRO_REPS*points.length);
  return {nsPerCall:Math.round(ns*10)/10,sink:hits};
}

function main(){
  const outIndex=process.argv.indexOf('--out');
  const out=outIndex>=0?process.argv[outIndex+1]:undefined;
  if(outIndex>=0&&!out)throw new Error('--out needs a file path');
  const ids:WorldId[]=['endless','island','city'];
  const terrains=new Map<WorldId,TerrainField>(),layouts=new Map<WorldId,Layout>();
  for(const id of ids){
    const t0=performance.now(),terrain=makeTerrain(id),place=layout(id,terrain);
    terrains.set(id,terrain);layouts.set(id,place);
    console.error(`[bench-city] ${id}: setup ${(performance.now()-t0).toFixed(0)} ms, ${place.candidates} spawn candidates`);
  }
  // Two timing rounds in rotation; round 1 is warm-up for the JIT across all three terrain shapes.
  const rounds:Record<WorldId,RunResult>[]=[];
  for(let round=0;round<2;round++){
    const r={} as Record<WorldId,RunResult>;
    for(const id of ids)r[id]=run(terrains.get(id)!,layouts.get(id)!);
    rounds.push(r);
  }
  const report:Record<string,unknown>={};
  let failed=false;
  for(const id of ids){
    const timed=rounds[1][id];
    // Counting replay on a fresh terrain behind the proxy: same seed, so the same ticks (hash checked below).
    const {proxy,counter}=countingTerrain(makeTerrain(id));
    const counted=run(proxy,layouts.get(id)!,counter);
    const micro=microWalkable([...timed.world.enemies.values()].map(e=>({x:e.x,y:e.y})),terrains.get(id)!);
    const place=layouts.get(id)!;
    const callsPerTick=counted.calls.reduce((a,b)=>a+b,0)/counted.calls.length;
    if(timed.offWalkable)failed=true;
    report[id]={
      terrain:id==='endless'?"TerrainField(DEFAULT_SEED,{world:'infinito'})":id==='island'?'TerrainField(DEFAULT_SEED)':'CityTerrain(cidade-nevada)',
      layout:{anchor:place.anchor,players:place.players,spawnCandidates:place.candidates,rule:id==='island'?'test bench: whole island':`connected lattice ${RING_MIN}-${RING_MAX} u from base`},
      aiStepMs:stats(timed.ai),
      worldStepMs:stats(timed.tick),
      firstRoundAiStepMs:stats(rounds[0][id].ai),
      walkableCallsPerTick:{avg:Math.round(callsPerTick),max:Math.max(...counted.calls)},
      walkableNsPerCall:micro.nsPerCall,
      estWalkableShareOfAiStep:Math.round(callsPerTick*micro.nsPerCall/1e6/stats(timed.ai).avg*1000)/1000,
      enemiesLeft:timed.world.enemies.size,
      meanEnemyToNearestPlayer:timed.meanPlayerDistance,
      playerZeroHpTicks:timed.downed,
      allEnemiesWalkable:timed.offWalkable===0,
      offWalkable:timed.offWalkable,
      replayHashMatches:counted.hash===timed.hash,
    };
  }
  const city=report.city as {aiStepMs:Stats},endless=report.endless as {aiStepMs:Stats};
  const summary={
    card:'NEW-20261012-ORQ-cidade-02-terreno-motor',
    bench:'enemy-ai tick, 300 enemies (120 bebado, 90 pombos, 45 tio-pave, 45 agiota), 6 players, SimWorld + SpatialHash',
    warmupTicks:WARMUP,measuredTicks:MEASURE,seed:SEED,spawnSeed:SPAWN_SEED,
    node:process.version,cpu:os.cpus()[0]?.model??'unknown',platform:`${process.platform}-${process.arch}`,date:new Date().toISOString(),
    worlds:report,
    verdict:{
      cityMedianMs:city.aiStepMs.median,endlessMedianMs:endless.aiStepMs.median,
      medianRatio:Math.round(city.aiStepMs.median/endless.aiStepMs.median*1000)/1000,
      avgRatio:Math.round(city.aiStepMs.avg/endless.aiStepMs.avg*1000)/1000,
      cityLeEndless:city.aiStepMs.median<=endless.aiStepMs.median,
      allEnemiesWalkable:!failed,
    },
  };
  const text=JSON.stringify(summary,null,2);
  console.log(text);
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(path.resolve(out),text+'\n');console.error(`[bench-city] wrote ${path.resolve(out)}`);}
  if(failed){console.error('[bench-city] FAIL: an enemy ended off walkable ground');process.exitCode=1;}
}

main();
