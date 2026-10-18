/**
 * D-051, the nests' half of E1 (NEW-20261014-ORQ-ninhos-sim, src/sim/ninhos/ninhos.ts) on the REAL Cidade Nevada:
 *  - the numbers (hp, period, group size, round row, the exact 60 % siege split);
 *  - a unit rig (createNests by hand): timers, the cap retry, the first hit, the emergency group, the fall, the boss spot;
 *  - the assembled chaveiro run in mode 'ninhos': no director round, the groups come out of the nests, the boss leaves
 *    from the biggest live nest, a checkpoint plays on with the same hash; mode 'ninhos' without the objective is ignored.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import type {Point} from '../../src/maps/world.ts';
import type {NestPlan} from '../../src/maps/nests.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {SIEGE_FLAG} from '../../src/sim/stonewards/wall.ts';
import {createEnemy,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {FIRST_EXIT,NEST_GRANA,NEST_PACE,NEST_MEMORY,NEST_TARGET,RETRY_SECONDS,createNests,groupRange,isSiegeGroup,nestHp,nestPeriod,nestRound,
  type NestCause} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}

test('the numbers: hp by size and room, period shrinking with f, group size by f, round row 2..9, exactly 60 % siege',()=>{
  assert.deepEqual([nestHp('P',1),nestHp('M',1),nestHp('G',1)],[600,1000,1600]);
  assert.equal(nestHp('G',6),Math.round(1600*2.5));assert.equal(nestHp('P',9),nestHp('P',6),'room clamped to 6');
  assert.deepEqual([nestPeriod('G',0),nestPeriod('M',0),nestPeriod('P',0)],[55,70,90]);
  assert.equal(nestPeriod('G',1),55*.6);assert.equal(nestPeriod('G',3),55*.6,'f clamped');
  assert.deepEqual(groupRange('M',.1),[5,6]);assert.deepEqual(groupRange('M',.5),[6,8]);assert.deepEqual(groupRange('G',.9),[12,15]);
  assert.deepEqual([0,.1,.5,.99,1,2].map(nestRound),[2,2,5,9,9,9]);
  const first=Array.from({length:100},(_,i)=>isSiegeGroup(i));
  assert.equal(first.filter(Boolean).length,60);
  for(let n=5;n<=100;n+=5)assert.equal(first.slice(0,n).filter(Boolean).length,Math.floor(n*.6),`first ${n}`);
});

// ---------- Unit rig ----------
/** The nests' own timers, without NEST_PACE (no gap, no alive cap, no warm start): restored after `fn`. */
function rawPace(fn:()=>void){
  const saved=structuredClone(NEST_PACE);
  Object.assign(NEST_PACE,{gap:[0,0],alive:[1e9,1e9],warm:0,size:[1,1]});
  try{fn();}finally{Object.assign(NEST_PACE,saved);}
}
const PLAN:NestPlan={seed:1,players:1,loose:[],nests:[
  {id:'p0',kind:'terreno',x:40,y:40,size:'P',radius:6,sleepers:[{x:40,y:41},{x:41,y:40}]},
  {id:'g0',kind:'terreno',x:80,y:80,size:'G',radius:12,sleepers:[{x:80,y:81},{x:81,y:80}]},
  {id:'m0',kind:'terreno',x:60,y:60,size:'M',radius:9,sleepers:[{x:60,y:61}]},
]};
function rig(maxEnemies=300){
  const world=new SimWorld({terrain:city.fork(),seed:5,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  addPlayer(world,'p1',{x:0,y:0});
  const woke:[string,NestCause][]=[],crates:string[]=[],fell:string[]=[];let grana=0;
  const nests=createNests({plan:()=>PLAN,maxEnemies,
    createEnemy:(ctx,kind,at,scale)=>ctx.enemies.size<maxEnemies&&isEnemyKind(kind)?createEnemy(ctx,kind,at,scale):undefined,
    wake:(_ctx,id,cause)=>{woke.push([id,cause]);},dropCrate:(_ctx,_at,rarity)=>{crates.push(rarity);},pay:n=>{grana+=n;},
    onFall:(_ctx,n)=>{fell.push(n.id);}});
  // The nests step in the director's slot (assemble.ts), so the rig registers them under that id.
  world.register({id:'director',step:ctx=>nests.step(ctx)});
  return {world,nests,woke,crates,fell,grana:()=>grana};
}

test('timers: the first group of each nest between 45 and 90 s, the next one a period later, out of the nest\'s yard',()=>rawPace(()=>{
  const r=rig();
  r.world.step();
  const start=r.nests.state.startTick!;
  for(const n of r.nests.state.nests){
    assert.ok(n.next!>=start+ticks(FIRST_EXIT[0])&&n.next!<=start+ticks(FIRST_EXIT[1]),`${n.id} first exit ${n.next}`);
    assert.equal(n.hp,n.maxHp);
  }
  const g=r.nests.state.nests.find(n=>n.id==='g0')!,first=g.next!;
  while(r.world.tick<first)r.world.step();
  assert.equal(g.groups,1);
  const bodies=[...r.world.enemies.values()].filter(e=>e.memory?.[NEST_MEMORY]===1);
  const [lo,hi]=groupRange('G',0);
  assert.ok(bodies.length>=lo&&bodies.length<=hi,`G group of ${bodies.length}`);
  for(const e of bodies)assert.ok(PLAN.nests[1].sleepers.some(p=>p.x===e.x&&p.y===e.y),'from a yard spot');
  assert.equal(g.next,first+ticks(nestPeriod('G',(first-r.nests.state.startTick!)/ticks(540))));
  // Siege pattern over the run's groups, in order: group 0 hunts (floor(.6)=0), group 1 besieges.
  assert.equal(isSiegeGroup(0),false);
}));

test('pace (balanco-ninhos): one group per NEST_PACE.gap from any nest, a smaller warm start, none while NEST_PACE.alive are up',()=>{
  const r=rig();
  r.world.step();
  const start=r.nests.state.startTick!,due=start+ticks(50);
  for(const n of r.nests.state.nests)n.next=due;
  while(r.world.tick<=due)r.world.step();
  const sent=r.nests.state.nests.filter(n=>n.groups>0);
  assert.equal(sent.length,1,'one group, the other nests wait');
  for(const n of r.nests.state.nests)if(!n.groups)assert.equal(n.next,due+ticks(RETRY_SECONDS));
  assert.equal(r.nests.state.quietUntil,due+ticks(NEST_PACE.gap[0]),'1 player: the 1-player gap');
  const [,hi]=groupRange(sent[0].size,0);
  assert.ok(r.world.enemies.size<=Math.round(hi*NEST_PACE.warmScale),`warm group of ${r.world.enemies.size}`);
  // The alive cap: with that many up, a due nest waits.
  const saved=[...NEST_PACE.alive] as [number,number];
  NEST_PACE.alive=[r.world.enemies.size,r.world.enemies.size];
  try{
    const quiet=r.nests.state.quietUntil!,n=r.nests.state.nests.find(x=>!x.groups)!;
    n.next=quiet;
    while(r.world.tick<=quiet)r.world.step();
    assert.equal(n.groups,0);assert.equal(n.next,quiet+ticks(RETRY_SECONDS));
  }finally{NEST_PACE.alive=saved;}
});

test('the enemy cap: no room, the timer waits a second and nobody comes out',()=>{
  const r=rig(0);
  r.world.step();
  const n=r.nests.state.nests[0],due=n.next!;
  while(r.world.tick<due)r.world.step();
  assert.equal(n.groups,0);assert.equal(n.next,due+ticks(RETRY_SECONDS));assert.equal(r.world.enemies.size,0);
});

test('hits: the first wakes the nest, half hp lets one emergency group out, 0 hp fells it: no timer, crate and Grana',()=>{
  const r=rig();
  r.world.step();
  const g=r.nests.state.nests.find(n=>n.id==='g0')!;
  assert.equal(r.nests.hit(r.world,'g0',100),false);
  assert.deepEqual(r.woke,[['g0','hit']]);
  r.nests.hit(r.world,'g0',100);
  assert.equal(r.woke.length,1,'woken once');assert.equal(r.world.enemies.size,0);
  r.nests.hit(r.world,'g0',g.maxHp/2-200);
  const emergency=[...r.world.enemies.values()];
  assert.ok(emergency.length>0,'the emergency group');
  assert.ok(emergency.every(e=>e.memory?.[SIEGE_FLAG]===undefined),'it defends: hunters');
  r.nests.hit(r.world,'g0',1);
  assert.equal(r.world.enemies.size,emergency.length,'only once');
  assert.equal(r.nests.hit(r.world,'g0',1e9),true);
  assert.equal(g.down,true);assert.equal(g.next,undefined);assert.equal(g.hp,0);
  assert.deepEqual(r.crates,['dourada']);assert.equal(r.grana(),NEST_GRANA.G);assert.deepEqual(r.fell,['g0']);
  assert.deepEqual(r.woke.at(-1),['g0','fell']);
  assert.equal(r.nests.hit(r.world,'g0',10),false,'a fallen nest takes no more hits');
  assert.equal(r.nests.alive(),2);
  // A fallen nest never sends a group.
  for(let i=0;i<ticks(200);i++)r.world.step();
  assert.equal(g.groups,0);
  r.nests.hit(r.world,'p0',1e9);
  assert.deepEqual(r.crates,['dourada','roxa']);
});

test('the boss spot: the biggest live nest (a yard spot), then the next, none when all fell',()=>{
  const r=rig();
  assert.equal(r.nests.bossSpot(),undefined,'before the first step');
  r.world.step();
  assert.deepEqual(r.nests.bossSpot(),PLAN.nests[1].sleepers[0]);
  r.nests.hit(r.world,'g0',1e9);
  assert.deepEqual(r.nests.bossSpot(),PLAN.nests[2].sleepers[0]);
  r.nests.hit(r.world,'m0',1e9);r.nests.hit(r.world,'p0',1e9);
  assert.equal(r.nests.bossSpot(),undefined);
});

// ---------- Assembled ----------
interface Run {world:SimWorld;sys:RunSystems;events:StampedEvent[]}
function assembled(seed:number,players:Map<string,SimPlayer>,options:{objective?:boolean;checkpoint?:ReturnType<RunSystems['state']>}={}):Run{
  const world=new SimWorld({terrain:city.fork(),seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,mode:'ninhos',
    // The slice-1 population: the groups' timing is the subject here (at ×20 the moto riding by wakes bands on its way).
    nestPopulation:1,
    ...(options.objective===false?{}:{objective:'chaveiro' as const}),...(options.checkpoint?{checkpoint:options.checkpoint}:{})});
  return {world,sys,events:[]};
}
const stepRun=(r:Run,n=1)=>{for(let i=0;i<n;i++)r.events.push(...r.world.step());};

test('assembled mode ninhos: no round from the director, groups out of the nests, 8 nests at their hp, a checkpoint plays on',()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  const a=assembled(SEED,players);
  const car=a.sys.chaveiro!.state.car;
  addPlayer(a.world,'p1',{x:car.x+1.5,y:car.y});addPlayer(a.world,'p2',{x:car.x-1.5,y:car.y});
  assert.ok(a.sys.nests,'the nests are wired');
  stepRun(a);
  const nests=a.sys.nests!;
  assert.equal(nests.state.players,2);assert.equal(nests.state.nests.length,8);
  for(const n of nests.state.nests)assert.equal(n.maxHp,nestHp(n.size,2));
  assert.equal(a.world.round.phase,'wave');
  // The sleepers (E2's sono) come with the plan: every nest's and band's body asleep, out of ctx.enemies.
  const sono=a.sys.sono()!,plan=nests.plan()!;
  assert.ok(sono&&a.world.sleepers===sono.sleepers);
  // Plus one hit target per standing nest.
  assert.equal(sono.sleepers.size,plan.nests.reduce((t,n)=>t+n.sleepers.length,0)+plan.loose.reduce((t,b)=>t+b.members.length,0)+plan.nests.length);
  assert.equal(a.world.enemies.size,0);
  stepRun(a,ticks(FIRST_EXIT[0])-2);
  assert.equal(a.world.enemies.size,0,'nothing before 45 s');
  assert.equal(a.events.filter(e=>e.type==='round').length,0,'no round');
  stepRun(a,ticks(FIRST_EXIT[1]-FIRST_EXIT[0])+2);
  assert.ok(nests.state.sent>0&&nests.state.spawned>0,'groups went out by 90 s');
  const out=[...a.world.enemies.values()];
  assert.ok(out.length>0&&out.every(e=>typeof e.memory?.[NEST_MEMORY]==='number'),'every body came out of a nest');
  assert.equal(a.world.round.remaining,a.world.enemies.size);
  assert.ok(a.sys.state().ninhos,'the nests are in the checkpoint');
  // Checkpoint (live bodies are dropped, as in every checkpoint) and play on.
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const b=assembled(SEED,new Map([...players].map(([id,p])=>[id,structuredClone(p)])),{checkpoint:systems});b.world.load(world);
  assert.equal(stateHash(b.sys.state()),stateHash(a.sys.state()));
  for(const m of [a.world.enemies,a.world.projectiles,a.world.telegraphs])m.clear();
  stepRun(a,ticks(60));stepRun(b,ticks(60));
  assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}));
});

test('assembled mode ninhos: the first hit on a nest wakes its sleepers into the world; dispose lets the index go',()=>{
  const a=assembled(7,new Map());
  const car=a.sys.chaveiro!.state.car;
  addPlayer(a.world,'p1',{x:car.x+1.5,y:car.y});
  stepRun(a);
  const nests=a.sys.nests!,sono=a.sys.sono()!,nest=nests.state.nests[0],id=nest.id,asleep=sono.asleepIn(id);
  assert.ok(asleep>0);
  // The players' damage path (damageEnemy) reaches the nest through its target in the sleepers' index.
  assert.ok(a.world.sleepers!.has(`${NEST_TARGET}${id}`)||a.world.sleepers!.get(`${NEST_TARGET}${id}`),'the nest is a target');
  assert.equal(a.world.damageEnemy(`${NEST_TARGET}${id}`,10,'p1'),false);
  assert.equal(nest.hp,nest.maxHp-10);
  assert.ok(!a.world.enemies.has(`${NEST_TARGET}${id}`),'a target never enters the world');
  assert.equal(sono.asleepIn(id),0);
  for(const b of sono.bodiesOf(id))assert.ok(a.world.enemies.has(b),`${b} awake in the world`);
  assert.ok(a.sys.state().sono,'the sleepers are in the checkpoint');
  assert.equal(a.world.damageEnemy(`${NEST_TARGET}${id}`,1e9,'p1'),true,'the blow that fells it');
  assert.equal(nest.down,true);
  assert.equal(a.world.damageEnemy(`${NEST_TARGET}${id}`,10,'p1'),false,'gone from the index');
  a.sys.dispose();
  assert.equal(a.world.sleepers,undefined);
});

test('assembled mode ninhos: the chaveiro\'s boss leaves from the biggest live nest; without the objective the mode is ignored',()=>{
  const a=assembled(21,new Map());
  const car=a.sys.chaveiro!.state.car;
  addPlayer(a.world,'p1',{x:car.x+1.5,y:car.y});
  stepRun(a,3);
  const spot=a.sys.nests!.bossSpot()!;
  assert.ok(spot);
  const m=a.sys.chaveiro!.state.moto;m.stop=a.sys.chaveiro!.stops.length;m.task='anda';m.s=a.sys.chaveiro!.route.length-.01;
  stepRun(a,3);
  const boss=[...a.world.enemies.values()].find(e=>e.boss);
  assert.ok(boss,'called');
  assert.ok(Math.hypot(boss.x-spot.x,boss.y-spot.y)<3,`boss at ${boss.x},${boss.y}, nest spot ${spot.x},${spot.y}`);
  const off=assembled(21,new Map(),{objective:false});
  assert.equal(off.sys.nests,undefined);assert.equal('ninhos' in off.sys.state(),false);
});
