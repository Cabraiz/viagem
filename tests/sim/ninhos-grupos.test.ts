/**
 * D-051, the nests' half of E1 (NEW-20261014-ORQ-ninhos-sim, src/sim/ninhos/ninhos.ts) on the REAL Cidade Nevada, with the
 * waves of card NEW-20261022-ORQ-monstros-espalhados (map share by quota − kills, 1–3 born in each live nest, the
 * outside group from an avenue end, all besieging the car):
 *  - the numbers (hp, period, outside group, round row, the shares);
 *  - a unit rig (createNests by hand): the wave timer, the cap retry, the quota and the kills, the first hit, the fall,
 *    the boss spot;
 *  - the assembled chaveiro run in mode 'ninhos': no director round, the waves come, the boss leaves from the biggest
 *    live nest, a checkpoint plays on with the same hash; mode 'ninhos' without the objective is ignored.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RADIUS,type Point} from '../../src/maps/world.ts';
import {NEST_COUNT,type NestPlan} from '../../src/maps/nests.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer,type StampedEvent} from '../../src/contract/index.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {SIEGE_FLAG} from '../../src/sim/stonewards/wall.ts';
import {WAVE_BOSS_IDS} from '../../src/rules/index.ts';
import {createEnemy,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {FIRST_EXIT,MINERVA_S,NEST_GRANA,NEST_PACE,NEST_MEMORY,NEST_TARGET,RETRY_SECONDS,WAVE_MEMORY,createNests,nestHp,nestRound,outsideRange,pace,
  wavePeriod,waveShares,type NestCause,type NestsOptions,type WaveEntrance} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
// The waves' timing is the subject: no minuto de Minerva here (its own test below sets it back).
NEST_PACE.minerva=0;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}

test('the numbers: hp by size and room, period shrinking with f, outside group by f, round row 2..9, the shares of a wave',()=>{
  assert.deepEqual([nestHp('P',1),nestHp('M',1),nestHp('G',1)],[600,1000,1600]);
  assert.equal(nestHp('G',6),Math.round(1600*2.5));assert.equal(nestHp('P',9),nestHp('P',6),'room clamped to 6');
  assert.equal(wavePeriod(0,1),NEST_PACE.period[0]);assert.equal(wavePeriod(0,6),NEST_PACE.period[1]);
  assert.equal(wavePeriod(1,1),NEST_PACE.period[0]*.6);assert.equal(wavePeriod(3,1),NEST_PACE.period[0]*.6,'f clamped');
  assert.deepEqual(outsideRange(.1),[5,6]);assert.deepEqual(outsideRange(.5),[6,8]);assert.deepEqual(outsideRange(.9),[8,10]);
  assert.deepEqual([0,.1,.5,.99,1,2].map(nestRound),[2,2,5,9,9,9]);
  // The user's rule (22/10): 1000 on the map → a quota of 100; no kill: 100 come; 120 killed: none, and the outside
  // group is 20 smaller (never under NEST_PACE.floor of itself).
  assert.deepEqual(waveShares(100,0,30),{map:100,outside:30});
  assert.deepEqual(waveShares(100,40,30),{map:60,outside:30});
  assert.deepEqual(waveShares(100,120,30),{map:0,outside:10+5},'floor .5 of 30 is 15');
  assert.deepEqual(waveShares(100,120,60),{map:0,outside:40});
  assert.deepEqual(waveShares(100,1000,8),{map:0,outside:4});
});

// ---------- Unit rig ----------
/** No warm start (full quota and group) and no alive cap: restored after `fn`. */
function rawPace(fn:()=>void){
  const saved=structuredClone(NEST_PACE);
  Object.assign(NEST_PACE,{alive:[1e9,1e9],warm:0,warmEase:0,size:[1,1],mapShare:[.1,.1],trickle:[1e9,1e9]});
  try{fn();}finally{Object.assign(NEST_PACE,saved);}
}
const PLAN:NestPlan={seed:1,players:1,nests:[
  {id:'p0',kind:'terreno',x:40,y:40,size:'P',radius:6,sleepers:[{x:40,y:41},{x:41,y:40}]},
  {id:'g0',kind:'terreno',x:80,y:80,size:'G',radius:12,sleepers:[{x:80,y:81},{x:81,y:80}]},
  {id:'m0',kind:'terreno',x:60,y:60,size:'M',radius:9,sleepers:[{x:60,y:61}]},
],loose:[{x:20,y:20,training:false,members:Array.from({length:45},(_,i)=>({x:20+i%9,y:20+Math.floor(i/9)}))}]};
/** 50 plan bodies (the rig fixes mapShare at .1: a quota of 5). */
const PLAN_BODIES=50;
const DOOR:WaveEntrance={id:'N',x:10,y:0,route:[{x:10,y:0},{x:50,y:50}]};
function rig(maxEnemies=300,entrances:readonly WaveEntrance[]=[DOOR],extra:Pick<NestsOptions,'calm'|'onWave'|'onExplore'>={}){
  const world=new SimWorld({terrain:city.fork(),seed:5,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  addPlayer(world,'p1',{x:0,y:0});
  const woke:[string,NestCause][]=[],crates:string[]=[],fell:string[]=[],recruited:[readonly Point[],number][]=[];let grana=0,dead=0;
  const nests=createNests({plan:()=>PLAN,maxEnemies,entrances,...extra,
    createEnemy:(ctx,kind,at,scale)=>ctx.enemies.size<maxEnemies&&isEnemyKind(kind)?createEnemy(ctx,kind,at,scale):undefined,
    mapDead:()=>dead,recruit:(_ctx,route,count)=>{recruited.push([route,count]);return count;},
    wake:(_ctx,id,cause)=>{woke.push([id,cause]);},dropCrate:(_ctx,_at,rarity)=>{crates.push(rarity);},pay:n=>{grana+=n;},
    onFall:(_ctx,n)=>{fell.push(n.id);}});
  // The nests step in the director's slot (assemble.ts), so the rig registers them under that id.
  world.register({id:'director',step:ctx=>nests.step(ctx)});
  return {world,nests,woke,crates,fell,recruited,grana:()=>grana,kill:(n:number)=>{dead+=n;}};
}
const until=(r:ReturnType<typeof rig>,tick:number)=>{while(r.world.tick<tick)r.world.step();};

test('a wave: FIRST_EXIT (+ firstLate by room size) s after the Minerva, the map share recruited along the entrance\'s route, 1–3 born in each live nest, the outside group at the avenue end, all besieging; the next only after it is over',()=>rawPace(()=>{
  const r=rig();
  r.world.step();
  const start=r.nests.state.startTick!,first=r.nests.state.nextWave!,late=pace(NEST_PACE.firstLate,r.nests.state.players);
  assert.ok(first>=start+ticks(FIRST_EXIT[0]+late)&&first<=start+ticks(FIRST_EXIT[1]+late),`first wave ${first}`);
  assert.equal(r.nests.state.quota,Math.round(PLAN_BODIES*NEST_PACE.mapShare[0]));
  for(const n of r.nests.state.nests)assert.equal(n.hp,n.maxHp);
  until(r,first+1);
  assert.equal(r.nests.state.sent,1);
  assert.deepEqual(r.recruited,[[DOOR.route,5]],'the whole quota, nobody killed');
  const bodies=[...r.world.enemies.values()];
  assert.ok(bodies.every(e=>e.memory?.[SIEGE_FLAG]===1&&e.memory?.[WAVE_MEMORY]===0),'all besiege the car, wave 0');
  const born=bodies.filter(e=>typeof e.memory?.[NEST_MEMORY]==='number'),outside=bodies.filter(e=>e.memory?.[NEST_MEMORY]===undefined);
  for(let i=0;i<PLAN.nests.length;i++){
    const mine=born.filter(e=>e.memory![NEST_MEMORY]===i);
    assert.ok(mine.length>=NEST_PACE.perNest[0]&&mine.length<=NEST_PACE.perNest[1],`${PLAN.nests[i].id}: ${mine.length}`);
    for(const e of mine)assert.ok(PLAN.nests[i].sleepers.some(p=>p.x===e.x&&p.y===e.y),'born in its yard');
  }
  const [lo,hi]=outsideRange(0);
  assert.ok(outside.length>=lo&&outside.length<=hi,`outside group of ${outside.length}`);
  for(const e of outside)assert.ok(Math.hypot(e.x-DOOR.x,e.y-DOOR.y)<4,'at the avenue end');
  const log=r.nests.state.log!.at(-1)!;
  assert.deepEqual({...log,tick:0},{tick:0,entrance:'N',quota:5,kills:0,map:5,nests:born.length,outside:outside.length,total:5+born.length+outside.length});
  // inicio-no-uno-caixas-120: open until it is over; the next wave only after the time to explore (the backstop here).
  assert.equal(r.nests.state.waveOpen,first);
  assert.equal(r.nests.state.nextWave,first+ticks(NEST_PACE.waveCap+NEST_PACE.explore));
}));

test('the time to explore (inicio-no-uno-caixas-120): a wave over (no besieger up) opens NEST_PACE.explore s, at least waveMin s after it left, and the next wave leaves at its end; a wave never holds it past waveCap',()=>rawPace(()=>{
  assert.deepEqual([NEST_PACE.explore,NEST_PACE.waveMin,NEST_PACE.waveCap],[30,20,150]);
  const r=rig();
  r.world.step();
  const first=r.nests.state.nextWave!;
  until(r,first+1);
  assert.equal(r.nests.exploring(r.world.tick),undefined,'a wave is on');
  // The besiegers die at once: still nothing before waveMin.
  r.world.enemies.clear();
  until(r,first+ticks(NEST_PACE.waveMin)-1);
  assert.equal(r.nests.state.waveOpen,first);
  until(r,first+ticks(NEST_PACE.waveMin)+1);
  const open=first+ticks(NEST_PACE.waveMin);
  assert.equal(r.nests.state.waveOpen,undefined);
  assert.deepEqual(r.nests.exploring(r.world.tick),{from:open,until:open+ticks(NEST_PACE.explore)});
  assert.equal(r.nests.state.nextWave,open+ticks(NEST_PACE.explore));
  // The next wave leaves at its end; this time its besiegers stay up: the time to explore waits for waveCap.
  until(r,open+ticks(NEST_PACE.explore)+1);
  assert.equal(r.nests.state.sent,2);
  const second=r.nests.state.waveOpen!;
  assert.equal(second,open+ticks(NEST_PACE.explore));
  assert.ok([...r.world.enemies.values()].some(e=>e.memory?.[SIEGE_FLAG]===1));
  until(r,second+ticks(NEST_PACE.waveCap)-1);
  assert.equal(r.nests.exploring(r.world.tick),undefined,'besiegers up: no time to explore');
  until(r,second+ticks(NEST_PACE.waveCap)+1);
  assert.deepEqual(r.nests.exploring(r.world.tick),{from:second+ticks(NEST_PACE.waveCap),until:second+ticks(NEST_PACE.waveCap+NEST_PACE.explore)},'the cap');
}));

test('the time to explore waits for options.calm (the boss up, a fight at the car); onWave says when a wave left and ran out; onExplore when the time to explore opens',()=>rawPace(()=>{
  let calm=false;const said:string[]=[];
  const r=rig(300,[DOOR],{calm:()=>calm,onWave:(_ctx,i,phase)=>{said.push(`${i}:${phase}`);},onExplore:ctx=>{said.push(`explora@${ctx.tick}`);}});
  r.world.step();
  const first=r.nests.state.nextWave!;
  until(r,first+1);
  r.world.enemies.clear();
  until(r,first+ticks(NEST_PACE.waveMin+5));
  assert.equal(r.nests.exploring(r.world.tick),undefined,'not calm');
  calm=true;
  until(r,r.world.tick+ticks(1)+1);
  assert.ok(r.nests.exploring(r.world.tick),'calm: the time to explore');
  assert.deepEqual(said,['0:saiu','0:escoou',`explora@${r.nests.state.exploreFrom}`],'onExplore once, when it opens');
}));

test('the kills: map bodies killed since the last wave come off its quota; past the quota they shrink the outside group (never under the floor)',()=>rawPace(()=>{
  const r=rig();
  r.world.step();
  until(r,r.nests.state.nextWave!+1);
  r.world.enemies.clear();
  // 3 of the quota of 5 killed: 2 come.
  r.kill(3);
  until(r,r.nests.state.nextWave!+1);
  assert.equal(r.recruited.at(-1)![1],2);
  assert.equal(r.nests.state.log!.at(-1)!.kills,3);
  r.world.enemies.clear();
  // 9 killed: none from the map, the outside group 4 smaller, never under half.
  r.kill(9);
  until(r,r.nests.state.nextWave!+1);
  assert.equal(r.recruited.length,2,'no recruit call');
  const log=r.nests.state.log!.at(-1)!;
  assert.equal(log.map,0);assert.equal(log.kills,9);
  const [lo,hi]=outsideRange((r.world.tick-1-r.nests.state.startTick!)/ticks(NEST_PACE.ramp));
  const fits=Array.from({length:hi-lo+1},(_,i)=>lo+i).some(b=>log.outside===Math.max(Math.ceil(b*NEST_PACE.floor),b-4));
  assert.ok(fits,`outside ${log.outside} of ${lo}-${hi}, 4 past the quota`);
}));

test('a trickle under 1 a second adds up: one with the wave, then one every 1/trickle s (solo-uno-aguenta-1a-onda); NEST_PACE 1p trickles under 1, never 0 while warming',()=>{
  const saved=structuredClone(NEST_PACE);
  Object.assign(NEST_PACE,{alive:[1e9,1e9],warm:0,warmEase:0,mapShare:[.1,.1],trickle:[.5,.5]});
  try{
    const r=rig();
    r.world.step();
    const due=r.nests.state.nextWave!;
    until(r,due+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[1],'1 with the wave');
    until(r,due+ticks(1)+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[1],'nobody a second later');
    until(r,due+ticks(2)+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[1,1],'the next after 2 s');
    until(r,due+ticks(8)+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[1,1,1,1,1],'all 5, one every 2 s');
    assert.equal(r.nests.state.drip,undefined);
  }finally{Object.assign(NEST_PACE,saved);}
  assert.ok(pace(NEST_PACE.trickle,1)<1,'1p under 1 a second');
  assert.ok(pace(NEST_PACE.trickle,1)*NEST_PACE.warmTrickle>0,'1p warming still trickles');
});

test('the map share trickles out (NEST_PACE.trickle a second, the first batch with the wave), and the wave bodies take the march, hp and damage of NEST_PACE once',()=>{
  const saved=structuredClone(NEST_PACE);
  Object.assign(NEST_PACE,{alive:[1e9,1e9],warm:0,warmEase:0,mapShare:[.1,.1],trickle:[2,2],march:[.5,.5],hp:2,damage:.5});
  try{
    const r=rig();
    r.world.step();
    const due=r.nests.state.nextWave!;
    until(r,due+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[2],'2 with the wave');
    assert.equal(r.nests.state.log!.at(-1)!.map,2);
    until(r,due+ticks(1)+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[2,2],'2 a second later');
    until(r,due+ticks(3)+1);
    assert.deepEqual(r.recruited.map(x=>x[1]),[2,2,1],'the last one, then done');
    assert.equal(r.nests.state.log!.at(-1)!.map,5);assert.equal(r.nests.state.drip,undefined);
    const e=[...r.world.enemies.values()][0],fresh=createEnemy(r.world,e.kind,{x:0,y:0},1);
    r.world.enemies.delete(fresh.id);
    assert.equal(e.memory?.tuned,1);
    assert.ok(Math.abs(e.speed-fresh.speed*.5)<1e-9,'march .5');assert.ok(Math.abs(e.damage-fresh.damage*.5)<1e-9,'damage .5');
    assert.ok(e.maxHp>fresh.maxHp,'hp ×2 over the round row');
  }finally{Object.assign(NEST_PACE,saved);}
});

test('the alive cap and the enemy cap: the wave waits RETRY_SECONDS, nobody comes; no entrance: the outside group leaves a live nest',()=>{
  const r=rig(0);
  r.world.step();
  const due=r.nests.state.nextWave!;
  until(r,due+1);
  assert.equal(r.nests.state.sent,0);assert.equal(r.nests.state.nextWave,due+ticks(RETRY_SECONDS));assert.equal(r.world.enemies.size,0);
  rawPace(()=>{
    const s=rig(300,[]);
    s.world.step();
    until(s,s.nests.state.nextWave!+1);
    assert.equal(s.recruited.length,0,'no route, no recruits');
    assert.ok([...s.world.enemies.values()].every(e=>PLAN.nests.some(n=>n.sleepers.some(p=>p.x===e.x&&p.y===e.y))),'all from the yards');
  });
});

test('hits: the first wakes the nest, 0 hp fells it: crate and Grana; a fallen nest gives no body to the waves, and a nest sends nothing between waves',()=>rawPace(()=>{
  const r=rig();
  r.world.step();
  const g=r.nests.state.nests.find(n=>n.id==='g0')!;
  assert.equal(r.nests.hit(r.world,'g0',100),false);
  assert.deepEqual(r.woke,[['g0','hit']]);
  r.nests.hit(r.world,'g0',g.maxHp/2);
  assert.equal(r.woke.length,1,'woken once');assert.equal(r.world.enemies.size,0,'no emergency group any more');
  assert.equal(r.nests.hit(r.world,'g0',1e9),true);
  assert.equal(g.down,true);assert.equal(g.hp,0);
  assert.deepEqual(r.crates,['dourada']);assert.equal(r.grana(),NEST_GRANA.G);assert.deepEqual(r.fell,['g0']);
  assert.deepEqual(r.woke.at(-1),['g0','fell']);
  assert.equal(r.nests.hit(r.world,'g0',10),false,'a fallen nest takes no more hits');
  assert.equal(r.nests.alive(),2);
  until(r,r.nests.state.nextWave!+1);
  assert.equal(g.groups,0);
  assert.equal([...r.world.enemies.values()].filter(e=>e.memory?.[NEST_MEMORY]===1).length,0,'none born in the fallen G');
  const after=r.world.enemies.size;
  until(r,r.nests.state.nextWave!-1);
  assert.equal(r.world.enemies.size,after,'nothing between waves');
  r.nests.hit(r.world,'p0',1e9);
  assert.deepEqual(r.crates,['dourada','roxa']);
}));

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
    // A light city (population 1): the waves' timing is the subject here (at the full field the moto riding by wakes bodies).
    nestPopulation:1,
    ...(options.objective===false?{}:{objective:'chaveiro' as const}),...(options.checkpoint?{checkpoint:options.checkpoint}:{})});
  return {world,sys,events:[]};
}
const stepRun=(r:Run,n=1)=>{for(let i=0;i<n;i++)r.events.push(...r.world.step());};

test('assembled mode ninhos: no round from the director, a wave (map, nests, outside), NEST_COUNT nests at their hp, a checkpoint plays on',t=>{
  // The assembly, not the timing: the first wave in FIRST_EXIT, no firstLate (balanco-mapa-175: +48 s for 2 players).
  const late=NEST_PACE.firstLate;NEST_PACE.firstLate=[0,0];t.after(()=>{NEST_PACE.firstLate=late;});
  const SEED=21,players=new Map<string,SimPlayer>();
  const a=assembled(SEED,players);
  const car=a.sys.chaveiro!.state.car;
  addPlayer(a.world,'p1',{x:car.x+1.5,y:car.y});addPlayer(a.world,'p2',{x:car.x-1.5,y:car.y});
  assert.ok(a.sys.nests,'the nests are wired');
  stepRun(a);
  const nests=a.sys.nests!;
  assert.equal(nests.state.players,2);assert.equal(nests.state.nests.length,NEST_COUNT);
  for(const n of nests.state.nests)assert.equal(n.maxHp,nestHp(n.size,2));
  assert.equal(a.world.round.phase,'wave');
  // The sleepers (E2's sono) come with the plan: every nest's and band's body asleep, out of ctx.enemies.
  const sono=a.sys.sono()!,plan=nests.plan()!;
  assert.ok(sono&&a.world.sleepers===sono.sleepers);
  // Plus one hit target per standing nest.
  assert.equal(sono.sleepers.size,plan.nests.reduce((t,n)=>t+n.sleepers.length,0)+plan.loose.reduce((t,b)=>t+b.members.length,0)+plan.nests.length);
  assert.equal(a.world.enemies.size,0);
  stepRun(a,ticks(FIRST_EXIT[0])-2);
  assert.equal(nests.state.sent+nests.state.spawned,0,'no wave before 45 s');
  assert.ok([...a.world.enemies.keys()].every(id=>sono.bodies.some(b=>b.id===id)),'only map bodies a noise woke');
  assert.equal(a.events.filter(e=>e.type==='round').length,0,'no round');
  stepRun(a,ticks(FIRST_EXIT[1]-FIRST_EXIT[0])+2);
  assert.ok(nests.state.sent>0&&nests.state.spawned>0,'a wave came by 90 s');
  // boss-fim-onda-1: the 1st wave's chefão comes at the end of its exit with his own controller (to the Uno), not a wave body.
  const all=[...a.world.enemies.values()],log=nests.state.log![0];
  // A map body the heroes' noise woke and that now hunts them (sono 2, caçando) is no wave body (asset v5: a pombo of
  // the S training band, at the S mouth by 90 s), nor one that lost them and walks home (sono 3, perdeu; asset v11, the
  // heaps gone: a mendigo at (77, 28) by 90 s).
  const hunting=(e:EnemyState)=>sono.bodies.some(b=>b.id===e.id)&&e.memory?.[SIEGE_FLAG]!==1&&(e.memory?.sono===2||e.memory?.sono===3);
  const out=all.filter(e=>!WAVE_BOSS_IDS.includes(e.kind as never)&&!hunting(e));
  assert.ok(out.length>0&&out.every(e=>e.memory?.[SIEGE_FLAG]===1),'every body of the wave besieges the car');
  assert.ok(log.map>0&&log.nests>=NEST_COUNT&&log.outside>0,`map ${log.map}, nests ${log.nests}, outside ${log.outside}`);
  assert.equal(out.filter(e=>sono.bodies.some(b=>b.id===e.id)).length,log.map,'the map share: plan bodies woken');
  assert.equal(a.world.round.remaining,a.world.enemies.size);
  assert.ok(a.sys.state().ninhos,'the nests are in the checkpoint');
  // Checkpoint (live bodies are dropped, as in every checkpoint) and play on.
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const b=assembled(SEED,new Map([...players].map(([id,p])=>[id,structuredClone(p)])),{checkpoint:systems});b.world.load(world);
  assert.equal(stateHash(b.sys.state()),stateHash(a.sys.state()));
  // Two rooms restored from it play the same minute (the map's recruits awake at the checkpoint sleep again at home in
  // both; clearing a's live bodies instead would count them dead there, not here).
  const c=assembled(SEED,new Map([...players].map(([id,p])=>[id,structuredClone(p)])),{checkpoint:structuredClone(systems)});c.world.load(world);
  stepRun(b,ticks(60));stepRun(c,ticks(60));
  assert.ok(nests.state.sent>=1);
  assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:c.world.state(),systems:c.sys.state()}));
});

test('assembled mode ninhos: the first hit on a nest wakes its sleepers into the world; dispose lets the index go',()=>{
  const a=assembled(7,new Map());
  const car=a.sys.chaveiro!.state.car;
  addPlayer(a.world,'p1',{x:car.x+1.5,y:car.y});
  stepRun(a);
  // A nest with sleepers (population 1 on asset v4 leaves some yards empty).
  const nests=a.sys.nests!,sono=a.sys.sono()!,nest=nests.state.nests.find(n=>sono.asleepIn(n.id)>0)!,id=nest.id,asleep=sono.asleepIn(id);
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
  // missao-proteger-uno-tempo: the clock ran out too (mode 'ninhos' waits on it before the last stretch).
  a.sys.chaveiro!.state.wait=0;
  stepRun(a,3);
  const boss=[...a.world.enemies.values()].find(e=>e.boss);
  assert.ok(boss,'called');
  assert.ok(Math.hypot(boss.x-spot.x,boss.y-spot.y)<3,`boss at ${boss.x},${boss.y}, nest spot ${spot.x},${spot.y}`);
  const off=assembled(21,new Map(),{objective:false});
  assert.equal(off.sys.nests,undefined);assert.equal('ninhos' in off.sys.state(),false);
});

test('the minuto de Minerva: for 30 s no critter walks (a woken one stands and hits whoever is in its reach), the sight wakes only within reach, no wave; then they walk',()=>{
  const saved=NEST_PACE.minerva;NEST_PACE.minerva=MINERVA_S;
  try{
    const a=assembled(11,new Map());
    const car=a.sys.chaveiro!.state.car;
    addPlayer(a.world,'far',{x:car.x+1.5,y:car.y});
    stepRun(a);
    const nests=a.sys.nests!,sono=a.sys.sono()!,start=nests.state.startTick!;
    assert.equal(MINERVA_S,30,'missao-proteger-uno-tempo');
    assert.equal(nests.state.minervaUntil,start+ticks(30));
    assert.ok(nests.state.nextWave!>=nests.state.minervaUntil!+ticks(NEST_PACE.first[0]),'the first wave counts from its end');
    // A hero 3 u from a sleeper (inside WAKE_SIGHT, outside MINERVA_REACH): it sleeps on.
    const loose=sono.bodies.find(b=>b.nest===undefined&&b.band!==undefined)!;
    const p=addPlayer(a.world,'p1',{x:loose.home.x+3,y:loose.home.y});
    stepRun(a,ticks(2));
    assert.equal(a.world.enemies.has(loose.id),false,'asleep at 3 u');
    // A hit wakes it, but it stands where it is for the rest of the minute.
    a.world.damageEnemy(loose.id,1,'p1');
    const e=a.world.enemies.get(loose.id)!;
    assert.ok(e,'awake');
    const at={x:e.x,y:e.y};
    stepRun(a,ticks(10));
    assert.deepEqual({x:e.x,y:e.y},at,'it never walks to the hero 3 u away');
    // A hero in its reach takes its hits, the body still in place (at contact: since heroi-empurra-inimigos a hero put
    // inside a body pushes it off).
    p.x=e.x+e.radius+RADIUS;p.y=e.y;const hp=p.hp;
    stepRun(a,ticks(5));
    assert.ok(p.hp<hp||a.world.enemies.get(loose.id)===undefined,'it hits standing');
    assert.deepEqual({x:e.x,y:e.y},at);
    assert.ok(a.world.enemies.size<=3,'no wave');
    // After the minute: it walks.
    p.x=e.x+6;
    while(a.world.tick<nests.state.minervaUntil!+ticks(2))stepRun(a);
    assert.ok(Math.hypot(e.x-at.x,e.y-at.y)>.5,'it walks after the minute');
    a.sys.dispose();
  }finally{NEST_PACE.minerva=saved;}
});
