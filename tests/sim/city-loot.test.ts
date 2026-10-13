/**
 * cidade-07 (saque-intervalo): loot crates in the Cidade Nevada intermission, on the REAL city asset
 * (public/maps/cidade-nevada.json, hash-checked by cityTerrainFrom, as tests/sim/city-director.test.ts).
 *
 * Reference walk: the plaza goal cells of the avenue planner (cityPlanner, the same flood the run uses), flooded over
 * the hero grid (cityFlowGrid: the hero rule at each cell centre, doors closed as in the asset, D-032) with no wall
 * penalty, so cost / STRAIGHT_COST × cell is the 8-neighbour walking distance; seconds at the maps hero SPEED
 * (3.1 u/s, what moveStep walks heroes at in every world today). Tier checks skip crates within TIER_SLACK of a bound.
 * Heroes walk with moveSafely at SPEED, one step per 20 Hz tick, along flow-field directions (no teleports while
 * timing a trip). The left-behind line is the existing `say` event, key 'ficou-pra-tras', source = the player id.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {defaultTerrain,TerrainField} from '../../src/maps/terrain/field.ts';
import {SPEED,heroSpeed,obstacles,walkable,worldBase,type Point} from '../../src/maps/world.ts';
import {FlowField,STRAIGHT_COST,UNREACHABLE} from '../../src/maps/flowfield.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type RoundPhase,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {moveSafely} from '../../src/sim/enemies/ai.ts';
import {createStonewardsSystem,HORN_LEAD,MAX_PREPARE_TICKS,type StonewardsOptions,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {GATHER_REACH,MAX_GATHER_DISTANCE,NODE_CAPACITY,WORK_PER_UNIT,nodesNear,nodeValue,type NodeInfo} from '../../src/sim/stonewards/resources.ts';
import type {ResourceKind} from '../../src/sim/stonewards/state.ts';
import {CAMP_RADIUS,RETURN_SLACK_SECONDS,returnTicks} from '../../src/rules/stonewards.ts';
import {STONEWARDS_INTERMISSION_SECONDS} from '../../src/sim/assemble.ts';
import * as zueiraCidade from '../../src/rules/zueira-cidade.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

// ---------- The real city, built once ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,CS=city.asset.unitsPerCell,GW=city.asset.cells.w,GH=city.asset.cells.h;
/** The hero speed the sim moves heroes at in the city (maps heroSpeed, cidade-04), the one loot.ts sizes the tiers with. */
const HERO=heroSpeed(city);
const P=cityPlanner(city);
const plazaGoals:Point[]=[];
for(let cy=0;cy<GH;cy++)for(let cx=0;cx<GW;cx++)if(P.plazaField.cellCost(cx,cy)===0)plazaGoals.push({x:(cx+.5)*CS,y:(cy+.5)*CS});
/** Walking distance field to the plaza (no wall penalty: a walk, not a steering cost). */
const walkField=new FlowField(P.grid,plazaGoals,{wallPenalty:0});
/** Seconds a hero walks from p to the plaza; Infinity when p is not reachable with the doors closed. */
const walkSeconds=(p:Point)=>{const c=walkField.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*CS/HERO;};
/** Goal: the plaza center only (used to trace the way out, played backwards). */
const centerField=new FlowField(P.grid,[P.plazaCenter]);
const TIER_SLACK=.25;
/** Farthest a crate may sit from its candidate: the centre of a neighbouring cell (a candidate whose own cell centre the hero rule closes). */
const NEIGHBOUR_CELL=CS*1.5*Math.SQRT2+1e-6;
const KINDS:readonly ResourceKind[]=['coco','pedra'];
const isCrate=(n:{id:string})=>/^caixa-\d+$/.test(n.id);
const fmt=(p:Point)=>`(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Every crate of the city (the reach covers the whole map). */
const allCrates=()=>nodesNear(city,P.plazaCenter,1e4);
const goodCrates=()=>allCrates().filter(n=>{const s=walkSeconds(n);return s>10+TIER_SLACK&&s<15-TIER_SLACK;});
/** A crate with no other crate within two gather reaches (a hero on it works only that one). */
const isolated=(n:NodeInfo,all=allCrates())=>all.every(o=>o.id===n.id||dist(o,n)>2*MAX_GATHER_DISTANCE+.5);

// ---------- Stonewards fixture (tests/sim/sim-stonewards.test.ts) ----------
type FakeCtx=SimContext&{tick:number;events:SimEvent[];sentAt:number[];round:{index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number}};
function player(id:string,p:Point,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x:p.x,y:p.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function fakeCtx(players:SimPlayer[],terrain:SimContext['terrain']=city):FakeCtx{
  const events:SimEvent[]=[],sentAt:number[]=[],enemies=new Map<string,EnemyState>();
  let id=0;
  const unused=()=>{throw new Error('not used by stonewards');};
  const ctx:FakeCtx={
    tick:0,events,sentAt,terrain,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),
    enemies,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:1,total:10,phase:'prepare',phaseEndsTick:ticks(20),remaining:0},
    enemyIndex:{rebuild:unused,query:unused,nearest:()=>undefined},
    nextId:prefix=>`${prefix}${++id}`,
    emit:e=>{events.push(e);sentAt.push(ctx.tick);},
    damageEnemy:()=>false,
    damagePlayer:unused,
  } as FakeCtx;
  return ctx;
}
/** The director's intermission start: the next tick is its first, `seconds` long. */
function openPrepare(ctx:FakeCtx,index:number,seconds:number){
  Object.assign(ctx.round,{index,phase:'prepare',phaseEndsTick:ctx.tick+1+ticks(seconds),remaining:0});
}
/** Director order: on the tick the intermission ends the wave starts (director steps before 'structures'). */
function flip(ctx:FakeCtx){
  if(ctx.round.phase==='prepare'&&ctx.tick>=ctx.round.phaseEndsTick){ctx.round.phase='wave';ctx.round.phaseEndsTick=ctx.tick+ticks(90);return true;}
  return false;
}
/** n ticks: tick++, the director's flip, `move` (the players system), then the stonewards step. */
function drive(ctx:FakeCtx,sys:StonewardsSystem,n:number,move?:(ctx:FakeCtx)=>void){
  for(let i=0;i<n;i++){ctx.tick++;flip(ctx);move?.(ctx);sys.step(ctx);}
}
const stretcher=(log?:number[]):Pick<StonewardsOptions,'extendPrepare'>=>({extendPrepare:(c,endsTick)=>{
  log?.push(c.tick);
  if(c.round.phase==='prepare'&&Number.isSafeInteger(endsTick)&&endsTick>c.round.phaseEndsTick)c.round.phaseEndsTick=endsTick;
}});
const record=(sys:StonewardsSystem,id:string)=>sys.state.nodes.find(n=>n.id===id);
const leftBehind=(ctx:{events:SimEvent[];sentAt:number[]})=>ctx.events.flatMap((e,i)=>e.type==='say'&&e.key==='ficou-pra-tras'?[{source:e.source,line:e.line,tick:ctx.sentAt[i]}]:[]);

// ---------- Walking ----------
const dir={x:0,y:0};
/** One hero step at SPEED along `field`; false when the field has no direction there. */
function stepAlong(field:FlowField,body:Point){
  field.directionAt(body.x,body.y,dir);
  const l=Math.hypot(dir.x,dir.y);
  if(!(l>1e-6))return false;
  moveSafely(body,dir.x/l*HERO/SIM_HZ,dir.y/l*HERO/SIM_HZ,city);
  return true;
}
/** Positions of a hero walking from `from` along `field` until `done` (from included), one per tick. */
function trace(field:FlowField,from:Point,done:(p:Point)=>boolean,maxTicks=ticks(120)):Point[]{
  const body={x:from.x,y:from.y},out=[{...body}];
  for(let t=0;t<maxTicks&&!done(body)&&stepAlong(field,body);t++)out.push({...body});
  assert.ok(done(body),`walk from ${fmt(from)} stuck at ${fmt(body)}`);
  return out;
}
/** The walk plaza center → p: the walk p → plaza center played backwards (every step one tick at SPEED). */
const pathFromPlaza=(p:Point)=>trace(centerField,p,q=>dist(q,P.plazaCenter)<.5).reverse();
/** Ticks a hero at p needs to walk into the base. */
const ticksHome=(p:Point)=>trace(P.plazaField,p,q=>P.insideBase(q)).length-1;

/** Deterministic walkable spots outside the base, `minFromWall` u from the wall and `minFromCrate` u from every crate. */
function awaySpots(count:number,seed:number,minFromWall=CAMP_RADIUS+4,minFromCrate=3):Point[]{
  const r=new Rng(seed),all=allCrates(),wall=worldBase(city),out:Point[]=[];
  for(let guard=0;out.length<count&&guard<100000;guard++){
    const p={x:(r.int(0,GW-1)+.5)*CS,y:(r.int(0,GH-1)+.5)*CS};
    if(walkable(p,city)&&walkField.reachable(p.x,p.y)&&!P.insideBase(p)&&dist(p,wall)>minFromWall&&all.every(n=>dist(n,p)>minFromCrate)&&out.every(q=>dist(q,p)>2))out.push(p);
  }
  assert.equal(out.length,count,'away spots');
  return out;
}
/** Walkable base cells within `maxFromWall` u of the wall (inside by both rules: the planner's base and CAMP_RADIUS). */
function baseSpots(maxFromWall:number,minFromWall=0):Point[]{
  const wall=worldBase(city);
  return plazaGoals.filter(p=>walkable(p,city)&&P.insideBase(p)&&dist(p,wall)<=maxFromWall&&dist(p,wall)>=minFromWall);
}
/** The new left-behind lines: an exported list of rules/zueira-cidade.ts holding `line`. */
function linesHolding(line:string):readonly string[]|undefined{
  for(const v of Object.values(zueiraCidade as Record<string,unknown>))
    if(Array.isArray(v)&&v.length&&v.every(s=>typeof s==='string')&&v.includes(line))return v as readonly string[];
  return undefined;
}

// ---------- 1. no phantom nodes ----------
test('city nodesNear returns only crates anywhere in the city, never island obstacles; the island keeps its obstacles',()=>{
  const all=allCrates();
  assert.ok(all.length>0,'the city has crates');
  assert.deepEqual(all.filter(n=>!isCrate(n)).map(n=>n.id),[],'no island obstacle in the city');
  // The phantom bug: the island's obstacle spots, read on the city terrain.
  for(const o of obstacles)assert.ok(nodesNear(city,o,3).every(isCrate),`phantom at ${fmt(o)}`);
  assert.ok(nodesNear(city,{x:12,y:12},50).every(isCrate));
  // Sweep the whole map: exactly the crates within reach, every crate met.
  const ids=(l:readonly NodeInfo[])=>l.map(n=>n.id).sort();
  const seen=new Set<string>();
  for(let y=4;y<GH*CS;y+=12)for(let x=4;x<GW*CS;x+=12)for(const reach of [MAX_GATHER_DISTANCE,20]){
    const got=nodesNear(city,{x,y},reach);
    assert.deepEqual(ids(got),ids(all.filter(n=>Math.hypot(n.x-x,n.y-y)<=reach)),`at (${x},${y}) reach ${reach}`);
    for(const n of got)seen.add(n.id);
  }
  assert.equal(seen.size,all.length,'the sweep meets every crate');
  assert.deepEqual(nodesNear(city,P.plazaCenter,1e4),all,'same crates on every call');
  assert.deepEqual(nodesNear(city,{x:Number.NaN,y:1},10),[]);
  // Island: its 16 obstacles exactly as before (ids, kinds, values, capacities, order).
  const base=worldBase(defaultTerrain);
  const island=obstacles.map((o,i)=>{
    const kind:ResourceKind=o.kind==='rock'?'pedra':'coco';
    return {id:`no-${kind}-${i}`,kind,x:o.x,y:o.y,radius:o.radius,value:nodeValue(Math.hypot(o.x-base.x,o.y-base.y)),capacity:NODE_CAPACITY[kind]};
  });
  assert.deepEqual(nodesNear(defaultTerrain,{x:12,y:12},50),island);
  assert.deepEqual(nodesNear(defaultTerrain,obstacles[12],1),island.filter(n=>dist(n,obstacles[12])<=1));
  const endless=nodesNear(new TerrainField(7,{world:'infinito'}),{x:0,y:0},70);
  assert.ok(endless.length>20&&!endless.some(isCrate),'endless keeps its obstacles and piles');
});

// ---------- 2. where the crates are ----------
test('crates: the NodeInfo shape nodeViews reads, capacity 1, on walkable cells reachable with the doors closed, never in the base, one per cell',t=>{
  const all=allCrates(),cells=new Set<number>();
  for(const n of all){
    assert.deepEqual(Object.keys(n).sort(),['capacity','id','kind','radius','value','x','y'],n.id);
    assert.match(n.id,/^caixa-\d+$/);
    assert.ok(KINDS.includes(n.kind),n.id);
    assert.equal(n.capacity,1,n.id);
    assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y),n.id);
    assert.ok(n.radius>0&&n.radius+GATHER_REACH<=MAX_GATHER_DISTANCE,`${n.id}: gatherStep must see it (radius ${n.radius})`);
    assert.ok(Number.isFinite(n.value)&&n.value>0,`${n.id} value ${n.value}`);
    assert.ok(walkable(n,city),`${n.id} on walkable ground ${fmt(n)}`);
    assert.ok(walkField.reachable(n.x,n.y)&&P.plazaField.reachable(n.x,n.y),`${n.id} reachable from the plaza ${fmt(n)}`);
    assert.ok(!P.insideBase(n),`${n.id} outside the base`);
    const cell=Math.floor(n.x/CS)+Math.floor(n.y/CS)*GW;
    assert.ok(!cells.has(cell),`${n.id}: one crate per cell`);cells.add(cell);
    assert.ok(city.asset.loot.some(c=>dist(c,n)<=NEIGHBOUR_CELL),`${n.id} comes from an asset candidate (its cell or a neighbour's centre)`);
  }
  assert.equal(new Set(all.map(n=>n.id)).size,all.length,'unique ids');
  assert.ok(all.length<=city.asset.loot.length);
  let behind=0;
  for(const c of city.asset.loot){
    if(!walkField.reachable(c.x,c.y)){behind++;continue;}
    assert.ok(all.some(n=>dist(c,n)<=NEIGHBOUR_CELL),`reachable candidate ${fmt(c)} has its crate`);
  }
  for(const k of KINDS)assert.ok(all.some(n=>n.kind===k),`some ${k}`);
  t.diagnostic(`${all.length} crates from ${city.asset.loot.length} candidates (${behind} not reachable with the doors closed)`);
});

// ---------- 3. tiers ----------
test('tiers by walk time from the plaza at the hero speed: value grows near → good → far, good crates exist at 10–15 s',t=>{
  const tiers:Record<'near'|'good'|'far',NodeInfo[]>={near:[],good:[],far:[]};
  for(const n of allCrates()){
    const s=walkSeconds(n);
    assert.ok(Number.isFinite(s),n.id);
    if(s<10-TIER_SLACK)tiers.near.push(n);
    else if(s>10+TIER_SLACK&&s<15-TIER_SLACK)tiers.good.push(n);
    else if(s>15+TIER_SLACK)tiers.far.push(n);
  }
  assert.ok(tiers.good.length>=1,'good crates at 10–15 s of walking');
  // At the city hero speed (cidade-04, ~1.99 u/s) the nearest candidate is already ~10 s out, so the near tier may be
  // empty; far crates must exist.
  assert.ok(tiers.far.length>=1,'the asset has far candidates too');
  const values=(l:NodeInfo[])=>l.map(n=>n.value);
  if(tiers.near.length)assert.ok(Math.max(...values(tiers.near))<Math.min(...values(tiers.good)),`near ${values(tiers.near)} < good ${values(tiers.good)}`);
  assert.ok(Math.max(...values(tiers.good))<Math.min(...values(tiers.far)),`good ${values(tiers.good)} < far ${values(tiers.far)}`);
  for(const [tier,l] of Object.entries(tiers))if(l.length>=2)for(const k of KINDS)assert.ok(l.some(n=>n.kind===k),`${tier} tier pays ${k} too`);
  t.diagnostic(`near ${tiers.near.length}, good ${tiers.good.length} (${tiers.good.map(n=>walkSeconds(n).toFixed(1)).join(', ')} s), far ${tiers.far.length}`);
});

// ---------- 4. collected once ----------
test('a crate is collected once per intermission, even with two heroes standing on it',()=>{
  const c=goodCrates().find(n=>isolated(n));
  assert.ok(c,'an isolated good crate');
  const a=player('a',c),b=player('b',{x:c.x+.1,y:c.y});
  const ctx=fakeCtx([a,b]),sys=createStonewardsSystem({terrain:city});
  ctx.tick=40;openPrepare(ctx,2,30);
  drive(ctx,sys,ticks(10));
  const other=c.kind==='coco'?'pedra':'coco';
  assert.equal(sys.state.balance[c.kind],c.value,'its value, once');
  assert.equal(sys.state.balance[other],0);
  assert.ok(Math.abs((sys.state.gathered.a??0)+(sys.state.gathered.b??0)-c.value)<1e-9,JSON.stringify(sys.state.gathered));
  assert.equal(record(sys,c.id)?.remaining,0);
  assert.deepEqual(sys.state.nodes.map(n=>n.id),[c.id]);
  drive(ctx,sys,ticks(10));
  assert.deepEqual(sys.state.balance,{[c.kind]:c.value,[other]:0} as Record<ResourceKind,number>,'standing on it longer gives nothing more');
});

// ---------- 5. crates come back ----------
test('crates come back the next intermission (same crates, full again)',()=>{
  const c=goodCrates().find(n=>isolated(n))!;
  const before=allCrates();
  const a=player('a',c),ctx=fakeCtx([a]),sys=createStonewardsSystem({terrain:city});
  openPrepare(ctx,2,30);
  drive(ctx,sys,ticks(5));
  assert.equal(sys.state.balance[c.kind],c.value);
  drive(ctx,sys,ctx.round.phaseEndsTick-ctx.tick+ticks(3));
  assert.equal(ctx.round.phase,'wave');
  assert.equal(sys.state.balance[c.kind],c.value,'nothing in the wave');
  openPrepare(ctx,3,30);
  drive(ctx,sys,1);
  const r=record(sys,c.id);
  assert.ok(!r||r.remaining===1,'full again');
  drive(ctx,sys,ticks(5));
  assert.equal(sys.state.balance[c.kind],2*c.value,'collected again, once');
  assert.equal(record(sys,c.id)?.remaining,0);
  assert.deepEqual(allCrates(),before,'the same crates every intermission');
});

// ---------- 6. horn ----------
test('the horn sounds 10 s before the end of a city intermission; the island keeps 5 s',()=>{
  assert.equal(HORN_LEAD,ticks(5),'island HORN_LEAD unchanged');
  const cases:[string,SimContext['terrain'],Point,number][]=[['city',city,P.plazaCenter,ticks(10)],['island',defaultTerrain,{x:12,y:17},ticks(5)]];
  for(const [name,terrain,home,lead] of cases){
    const ctx=fakeCtx([player('a',home)],terrain),sys=createStonewardsSystem({terrain});
    Object.assign(ctx.round,{index:2,phaseEndsTick:ticks(30)});
    const horns=()=>ctx.events.filter(e=>e.type==='horn');
    drive(ctx,sys,ticks(30)-lead-1);
    assert.equal(horns().length,0,`${name}: not yet`);
    drive(ctx,sys,1);
    assert.equal(horns().length,1,`${name}: ${lead/SIM_HZ} s before the end`);
    assert.ok(horns()[0].type==='horn'&&horns()[0].endsTick===ticks(30),name);
    drive(ctx,sys,lead-1);
    assert.equal(horns().length,1,`${name}: once`);
  }
});

test('city horn: sized by the real walk back (not the straight line); who leaves on the horn is in the base before the wave',t=>{
  const wall=worldBase(city);
  // The crate whose walk back beats its straight-line estimate the most (blocks in between).
  let pick:NodeInfo|undefined,gap=-Infinity;
  for(const n of allCrates()){
    const s=walkSeconds(n);
    if(s>45)continue;
    const g=s*SIM_HZ-returnTicks(dist(n,wall));
    if(g>gap){gap=g;pick=n;}
  }
  assert.ok(pick);
  const back=ticksHome(pick!),straight=returnTicks(dist(pick!,wall));
  assert.ok(straight<back,`precondition: the straight-line estimate (${straight/SIM_HZ} s) is shorter than the walk (${back/SIM_HZ} s)`);
  const hero=player('far',pick!),ctx=fakeCtx([hero]),sys=createStonewardsSystem({terrain:city,...stretcher()});
  ctx.tick=200;openPrepare(ctx,3,60);
  let hornTick=-1,left=-1,home=-1,end=-1;
  while(ctx.tick<ticks(200)){
    ctx.tick++;
    if(flip(ctx))break;
    if(hornTick>=0&&!P.insideBase(hero))stepAlong(P.plazaField,hero);
    if(hornTick>=0&&home<0&&P.insideBase(hero))home=ctx.tick;
    sys.step(ctx);
    if(hornTick<0&&ctx.events.some(e=>e.type==='horn')){hornTick=ctx.tick;left=ctx.round.phaseEndsTick-ctx.tick;}
    end=ctx.round.phaseEndsTick;
  }
  const s=walkSeconds(pick!);
  assert.equal(ctx.events.filter(e=>e.type==='horn').length,1);
  assert.ok(hornTick>0);
  assert.ok(left>=Math.floor(s*SIM_HZ),`horn ${left/SIM_HZ} s before the end, the walk is ${s.toFixed(2)} s`);
  assert.ok(left<=Math.ceil((s+RETURN_SLACK_SECONDS+1)*SIM_HZ),`horn ${left/SIM_HZ} s before the end: the walk (${s.toFixed(2)} s) + ${RETURN_SLACK_SECONDS} s, not more`);
  assert.ok(home>0&&home<end,`home at ${home}, the wave at ${end}`);
  t.diagnostic(`crate ${pick!.id}: walk ${s.toFixed(1)} s (straight-line estimate ${straight/SIM_HZ} s), horn ${left/SIM_HZ} s before the wave, home in ${((home-hornTick)/SIM_HZ).toFixed(1)} s`);
});

// ---------- 7. intermission sized by the trip ----------
test('the city intermission fits the trip to the farthest good crate: out at hero speed, collect, back before the wave',t=>{
  const good=goodCrates();
  const far=good.reduce((a,b)=>walkSeconds(b)>walkSeconds(a)?b:a);
  const path=pathFromPlaza(far),S=walkSeconds(far);
  const hero=player('a',path[0]),ctx=fakeCtx([hero]),calls:number[]=[];
  const sys=createStonewardsSystem({terrain:city,...stretcher(calls)});
  ctx.tick=100;openPrepare(ctx,2,STONEWARDS_INTERMISSION_SECONDS);
  const start=ctx.tick+1;
  let i=1,collected=-1,home=-1,end=-1,startEnd=-1;
  while(ctx.tick<ticks(300)){
    ctx.tick++;
    if(flip(ctx))break;
    if(i<path.length)Object.assign(hero,path[i++]);
    else if(collected>=0&&!P.insideBase(hero))stepAlong(P.plazaField,hero);
    sys.step(ctx);
    if(ctx.tick===start)startEnd=ctx.round.phaseEndsTick;
    if(collected<0&&record(sys,far.id)?.remaining===0)collected=ctx.tick;
    if(collected>=0&&home<0&&P.insideBase(hero))home=ctx.tick;
    end=ctx.round.phaseEndsTick;
  }
  const length=startEnd-start,need=Math.ceil(2*S*SIM_HZ)+WORK_PER_UNIT[far.kind];
  assert.ok(collected>0,'the crate was collected');
  assert.ok(home>0&&home<end,`back in the base (tick ${home}) before the wave (tick ${end})`);
  assert.ok(length>=need,`sized on the first tick: ${length/SIM_HZ} s ≥ 2 × ${S.toFixed(2)} s + collect`);
  if(need>ticks(STONEWARDS_INTERMISSION_SECONDS))assert.equal(calls[0],start,'extended once, on the first tick');
  assert.ok(length<=MAX_PREPARE_TICKS,'within the cap');
  assert.equal(sys.state.balance[far.kind]>=far.value,true);
  t.diagnostic(`farthest good crate ${far.id} at ${S.toFixed(2)} s; intermission ${(length/SIM_HZ).toFixed(2)} s; collected at +${((collected-start)/SIM_HZ).toFixed(2)} s, home at +${((home-start)/SIM_HZ).toFixed(2)} s`);
  // The island is not resized: nobody out, no stretch.
  const ictx=fakeCtx([player('h',{x:12,y:17})],defaultTerrain),icalls:number[]=[];
  const isys=createStonewardsSystem({terrain:defaultTerrain,...stretcher(icalls)});
  openPrepare(ictx,2,STONEWARDS_INTERMISSION_SECONDS);
  const iend=ictx.round.phaseEndsTick;
  drive(ictx,isys,ticks(STONEWARDS_INTERMISSION_SECONDS)-1);
  assert.equal(ictx.round.phaseEndsTick,iend,'island intermission untouched');
  assert.deepEqual(icalls,[]);
});

// ---------- 8. left behind ----------
test('left behind: one line per standing hero outside the base at the prepare→wave transition, none inside, once per round',()=>{
  const [o1,o2,o3,o4,o5]=awaySpots(5,7),inside=baseSpots(CAMP_RADIUS-1);
  assert.ok(inside.length>=2);
  const ps=[
    player('in1',P.plazaCenter),player('in2',inside[inside.length>>1]),
    player('out1',o1),player('out2',o2),
    player('down',o3,{hp:0,downed:{sinceTick:0,bleedOutTick:99999,progress:0}}),
    player('off',o4,{online:false}),player('spec',o5,{spectator:true}),
  ];
  const ctx=fakeCtx(ps),sys=createStonewardsSystem({terrain:city,...stretcher()});
  openPrepare(ctx,2,30);
  let waveAt=-1;
  while(ctx.tick<ticks(300)&&waveAt<0){ctx.tick++;if(flip(ctx))waveAt=ctx.tick;sys.step(ctx);}
  assert.ok(waveAt>0);
  drive(ctx,sys,ticks(10));
  let said=leftBehind(ctx);
  assert.deepEqual(said.map(s=>s.source).sort(),['out1','out2'],'the two standing heroes outside');
  for(const s of said){
    assert.ok(s.tick===waveAt||s.tick===waveAt-1,`on the transition (said at ${s.tick}, wave at ${waveAt})`);
    assert.ok(typeof s.line==='string'&&s.line.length>0&&s.line.length<=34,JSON.stringify(s.line));
    const list=linesHolding(s.line);
    assert.ok(list,`"${s.line}" comes from rules/zueira-cidade.ts`);
    assert.ok(list!.length>=8&&list!.every(l=>l.length>0&&l.length<=34)&&new Set(list).size===list!.length,'8+ unique short lines');
  }
  // Next round: out2 walked home; out1 is still out and hears it again (once per player per round).
  Object.assign(ps[3],P.plazaCenter);
  openPrepare(ctx,3,30);
  waveAt=-1;
  while(ctx.tick<ticks(600)&&waveAt<0){ctx.tick++;if(flip(ctx))waveAt=ctx.tick;sys.step(ctx);}
  drive(ctx,sys,ticks(10));
  said=leftBehind(ctx);
  assert.deepEqual(said.map(s=>s.source),[...said.slice(0,2).map(s=>s.source),'out1'],'round 3: only out1');
  // The island has no left-behind line.
  const ictx=fakeCtx([player('far',{x:obstacles[15].x+1,y:obstacles[15].y}),player('h',{x:12,y:17})],defaultTerrain);
  const isys=createStonewardsSystem({terrain:defaultTerrain,...stretcher()});
  openPrepare(ictx,2,30);
  drive(ictx,isys,ticks(40));
  assert.equal(ictx.round.phase,'wave');
  assert.deepEqual(leftBehind(ictx),[],'none on the island');
});

test('left behind: a hero who empties a crate in the last 2 s before the wave is still told (once per player outside)',()=>{
  const c=allCrates().find(n=>isolated(n)&&dist(n,worldBase(city))>CAMP_RADIUS+4)!;
  // Waits outside near the crate (the horn sounds for that walk, well before the end), steps on it at the last moment.
  const wait=awaySpots(40,11).reduce((a,b)=>dist(b,c)<dist(a,c)?b:a);
  const hero=player('late',wait),ctx=fakeCtx([hero]),sys=createStonewardsSystem({terrain:city,...stretcher()});
  openPrepare(ctx,2,30);
  let waveAt=-1,moved=false;
  while(ctx.tick<ticks(300)&&waveAt<0){
    ctx.tick++;
    if(flip(ctx))waveAt=ctx.tick;
    else if(!moved&&ctx.round.phaseEndsTick-ctx.tick<=WORK_PER_UNIT[c.kind]+10){Object.assign(hero,{x:c.x,y:c.y});moved=true;}
    sys.step(ctx);
  }
  drive(ctx,sys,ticks(5));
  assert.ok(waveAt>0&&moved);
  assert.equal(record(sys,c.id)?.remaining,0,'emptied before the wave');
  const joke=ctx.events.findIndex(e=>e.type==='say'&&e.source==='late'&&e.key===`no-${c.kind}`);
  assert.ok(joke>=0&&waveAt-ctx.sentAt[joke]<ticks(2),`precondition: the depleted joke went out less than 2 s before the wave (${joke>=0?waveAt-ctx.sentAt[joke]:'none'} ticks)`);
  assert.deepEqual(leftBehind(ctx).map(s=>s.source),['late']);
});

// ---------- 9. determinism ----------
const ISLAND_STATE_KEYS=['balance','nodes','wall','towers','gathered','handled','refilledRound','hornRound','prepareStart','hornEndsTick','stretched','sayReady','wallDown','defeatReported','rng'];

test('state JSON round trip: a checkpoint restore anywhere replays the same state and events; island state keeps its keys',()=>{
  const goods=goodCrates().filter(n=>isolated(n));
  assert.ok(goods.length>=2);
  const [away]=awaySpots(1,3);
  const scenario=(restoreAt:readonly number[])=>{
    const ps=[player('g1',goods[0]),player('g2',goods[1]),player('out',away),player('in',P.plazaCenter)];
    const ctx=fakeCtx(ps),opts={terrain:city,...stretcher()};
    let sys=createStonewardsSystem(opts);
    const marks:number[]=[];
    const step=()=>{
      ctx.tick++;if(flip(ctx))marks.push(ctx.tick);
      sys.step(ctx);
      if(restoreAt.includes(ctx.tick)){
        const json=JSON.stringify(sys.state);
        assert.deepEqual(JSON.parse(json),sys.state,'JSON-safe');
        sys=createStonewardsSystem(opts,JSON.parse(json));
      }
    };
    openPrepare(ctx,2,30);marks.push(ctx.tick+1);
    while(ctx.round.phase==='prepare')step();
    for(let i=0;i<ticks(3);i++)step();
    openPrepare(ctx,3,30);marks.push(ctx.tick+1);
    for(let i=0;i<ticks(5);i++)step();
    return {json:JSON.stringify({state:sys.state,events:ctx.events,sentAt:ctx.sentAt,round:ctx.round,players:ps}),marks};
  };
  const straight=scenario([]);
  const [s2,w2,s3]=straight.marks;
  assert.ok(s2>0&&w2>s2&&s3>w2,JSON.stringify(straight.marks));
  const restored=scenario([s2,s2+1,s2+ticks(.5),w2-2,w2-1,w2,w2+1,s3,s3+3]);
  assert.equal(restored.json,straight.json);
  assert.equal(scenario([]).json,straight.json,'same inputs, same run');
  // Island: no city field in its state, before or after an intermission and its wave.
  const ictx=fakeCtx([player('far',{x:obstacles[15].x+1,y:obstacles[15].y})],defaultTerrain);
  const isys=createStonewardsSystem({terrain:defaultTerrain,...stretcher()});
  assert.deepEqual(Object.keys(isys.state),ISLAND_STATE_KEYS);
  openPrepare(ictx,2,30);drive(ictx,isys,ticks(35));
  assert.deepEqual(Object.keys(isys.state),ISLAND_STATE_KEYS);
});

// ---------- 10. the whole run (assemble.ts wiring, multiplayer/simulation.ts views) ----------
test('assembled city run: crates in the frame nodes, 6 heroes on 6 crates, intermission sized, left-behind at the real wave start',t=>{
  const s=new Simulation(4242,{world:'cidade',terrain:city});
  for(let i=0;i<6;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  const w=s.world,st=s.run.stonewards.state,log:{tick:number;e:SimEvent}[]=[];
  const step=()=>{s.step();for(const e of s.events as SimEvent[])log.push({tick:w.tick,e});};
  for(let i=0;i<ticks(10)&&w.round.phase!=='wave';i++)step();
  assert.equal(w.round.phase,'wave');assert.equal(w.round.index,1);
  for(let i=0;i<ticks(1);i++)step();
  assert.deepEqual(log.filter(x=>x.e.type==='say'&&x.e.key==='ficou-pra-tras'),[],'round 1: everyone starts at the crashed vehicle, nobody is told');
  // End round 1 now: nothing queued, nobody alive and, since round 1 in the city is the crash walk (cidade-08), a hero
  // standing in the plaza (the director's own round end, not a forced phase).
  const d=s.run.director.state;
  d.nextGroup=d.plan!.groups.length;d.pending=[];
  for(const id of [...w.enemies.keys()])w.damageEnemy(id,1e9);
  Object.assign(s.players.get('p0')!,{x:city.asset.points.praca.x,y:city.asset.points.praca.y});
  step();
  assert.equal(w.round.phase,'prepare');assert.equal(w.round.index,2);
  const start=st.prepareStart,end0=w.round.phaseEndsTick;
  assert.ok(start>=w.tick-1&&start<=w.tick,`the intermission started this step (${start}, tick ${w.tick})`);
  assert.equal(d.round.phaseEndsTick,w.round.phaseEndsTick,'the director knows the intermission length');
  const far=goodCrates().reduce((a,b)=>walkSeconds(b)>walkSeconds(a)?b:a),S=walkSeconds(far);
  assert.ok(end0-start>=Math.ceil(2*S*SIM_HZ)+WORK_PER_UNIT[far.kind],`intermission ${(end0-start)/SIM_HZ} s fits 2 × ${S.toFixed(2)} s + collect`);
  assert.ok(end0-start<=MAX_PREPARE_TICKS);
  // Six crates far apart (different blocks), one hero on each.
  const picked:NodeInfo[]=[];
  for(const n of [...allCrates()].sort((a,b)=>walkSeconds(a)-walkSeconds(b)))if(picked.length<6&&isolated(n)&&picked.every(q=>dist(q,n)>2*MAX_GATHER_DISTANCE+4))picked.push(n);
  assert.equal(picked.length,6);
  const heroes=[...s.players.values()];
  heroes.forEach((p,i)=>Object.assign(p,{x:picked[i].x,y:picked[i].y}));
  // The view the phone draws: crates as NodeViews (nodesNear through nodeViews), full, nothing from the island.
  const views=s.frame().nodes;
  assert.ok(views.length>=6&&views.every(isCrate),JSON.stringify(views.map(v=>v.id)));
  for(const n of picked){
    const v=views.find(x=>x.id===n.id);
    assert.ok(v,`${n.id} in the frame`);
    assert.deepEqual(Object.keys(v!).sort(),['capacity','id','kind','progress','remaining','value','x','y']);
    assert.deepEqual({id:v!.id,kind:v!.kind,x:v!.x,y:v!.y,capacity:v!.capacity,value:v!.value,remaining:v!.remaining,progress:v!.progress},
      {id:n.id,kind:n.kind,x:n.x,y:n.y,capacity:1,value:n.value,remaining:1,progress:0});
  }
  const before={...st.balance},gotBefore={...st.gathered};
  for(let i=0;i<Math.max(...KINDS.map(k=>WORK_PER_UNIT[k]))+2;i++)step();
  const sum=(k:ResourceKind)=>picked.filter(n=>n.kind===k).reduce((a,n)=>a+n.value,0);
  for(const k of KINDS)assert.equal(st.balance[k]-before[k],sum(k),`${k}: the sum of the six crates, once`);
  heroes.forEach((p,i)=>assert.ok(Math.abs((st.gathered[p.id]??0)-(gotBefore[p.id]??0)-picked[i].value)<1e-9,`${p.id} got its own crate`));
  for(const n of picked)assert.equal(s.frame().nodes.find(x=>x.id===n.id)?.remaining,0,`${n.id} empty in the view`);
  const after={...st.balance};
  for(let i=0;i<ticks(3);i++)step();
  assert.deepEqual(st.balance,after,'nothing more from empty crates');
  // Left behind at the director's real wave start: p3 and p4 stay out; the rest go home, one on the plaza edge.
  const wall=worldBase(city),edge=baseSpots(Infinity,CAMP_RADIUS+1);
  Object.assign(heroes[0],P.plazaCenter);Object.assign(heroes[1],baseSpots(CAMP_RADIUS-1)[0]);Object.assign(heroes[5],baseSpots(CAMP_RADIUS-1)[1]);
  if(edge.length)Object.assign(heroes[2],edge[0]);else Object.assign(heroes[2],baseSpots(CAMP_RADIUS-1)[2]);
  const from=log.length;
  for(let i=0;i<ticks(120)&&w.round.phase==='prepare';i++)step();
  assert.equal(w.round.phase,'wave');assert.equal(w.round.index,2);
  const waveAt=w.tick;
  for(let i=0;i<ticks(2);i++)step();
  const said=log.slice(from).filter(x=>x.e.type==='say'&&x.e.key==='ficou-pra-tras');
  assert.deepEqual(said.map(x=>x.e.type==='say'?x.e.source:'').sort(),['p3','p4'],`told: ${JSON.stringify(said)}`);
  assert.ok(said.every(x=>x.tick===waveAt),'on the wave start');
  assert.equal(new Set(said.map(x=>x.e.type==='say'?x.e.line:'')).size,said.length,'heroes left behind in the same tick hear different lines');
  // Exactly one horn in this intermission (it may sound early, while heroes are still out at far crates).
  assert.equal(log.filter(x=>x.tick>=start&&x.e.type==='horn').length,1,'one horn in the intermission');
  assert.deepEqual(JSON.parse(JSON.stringify(st)),st,'stonewards state JSON-safe');
  t.diagnostic(`intermission ${((end0-start)/SIM_HZ).toFixed(2)} s at start; plaza edge hero ${edge.length?`${dist(edge[0],wall).toFixed(1)} u from the wall`:'n/a'}`);
});
