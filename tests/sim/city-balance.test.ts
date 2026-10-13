/**
 * cidade-11 (balanço da run): the city's balance knobs (src/sim/city/balance.ts) on top of the shared tables.
 *  1. applyCityBalance on real plans (planRound, every round, 1..6 players): neutral knobs keep the plan itself, round
 *     1 is never touched, and each knob does what it says (count, hp, cadence) and nothing else.
 *  2. cityBalanceFrom (a runner's --knobs JSON) and roundKnobs (all × round).
 *  3. The director on the REAL city: no option and CITY_BALANCE give the digests recorded before this card; a knob
 *     changes rounds 2+ only (round 1, the tutorial, spawns the same bodies); siegeShare per round.
 *  4. Island and endless untouched: the director and the assembled run with strong knobs give the same output as
 *     without them (assembled digests recorded before this card); the city's assembled default too.
 *  5. Stonewards: lootValue pays whole units per crate, intermissionExtraSeconds lengthens the city intermission;
 *     the island ignores both (same state, same keys). bossHp: the city boss only (assemble and Simulation option).
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField,defaultTerrain} from '../../src/maps/terrain/field.ts';
import {obstacles,worldSpawn,type Point} from '../../src/maps/world.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type RoundPhase,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createDirector,type DirectorOptions} from '../../src/sim/director.ts';
import {createEnemy as catalogEnemy,enemyDef,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {citySpeed} from '../../src/sim/city/speed.ts';
import {CITY_BALANCE,NEUTRAL_ROUND,applyCityBalance,cityBalanceFrom,cityCrateValue,isNeutralRound,roundKnobs,type CityBalance} from '../../src/sim/city/balance.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {BOSS_TUNING,bossMaxHp} from '../../src/sim/boss.ts';
import {createStonewardsSystem,MAX_PREPARE_TICKS,type StonewardsOptions,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {nodesNear} from '../../src/sim/stonewards/resources.ts';
import {MAX_ROUND_ENEMIES,ROUND_COUNT,drawTheme,planRound} from '../../src/rules/waves.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

// ---------- The real city, built once ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,P=cityPlanner(city);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);

/** Knobs strong enough to change every city round (used where they must change nothing: island, endless). */
const STRONG:CityBalance=cityBalanceFrom({all:{count:1.6,hp:1.4,cadence:.7,siegeShare:.5},rounds:{2:{count:2},10:{hp:2}},lootValue:2,intermissionExtraSeconds:9,bossHp:1.5});

/** Every round's plan as the director draws it (theme then plan from one stream), for `players`. */
function plans(seed:number,players:number){
  const rng=new Rng(seed),used:string[]=[];
  return Array.from({length:ROUND_COUNT},(_,i)=>{
    const theme=drawTheme(i+1,rng,used);used.push(theme.name);if(theme.modifierId)used.push(theme.modifierId);
    return planRound(i+1,players,theme,rng);
  });
}
const regularOf=(plan:ReturnType<typeof planRound>)=>plan.groups.filter(g=>!g.boss&&!g.elite);
const count=(groups:readonly {members:readonly string[]}[])=>groups.reduce((n,g)=>n+g.members.length,0);

// ---------- 1. applyCityBalance ----------
test('defaults: CITY_BALANCE is neutral on every round and applyCityBalance keeps the plan object itself',()=>{
  for(let index=1;index<=ROUND_COUNT;index++)assert.ok(isNeutralRound(roundKnobs(CITY_BALANCE,index)),`round ${index} neutral`);
  for(const seed of [1,2,3])for(const players of [1,3,6])for(const plan of plans(seed,players)){
    const before=JSON.stringify(plan);
    assert.equal(applyCityBalance(plan,roundKnobs(CITY_BALANCE,plan.index)),plan,`seed ${seed} ${players}p round ${plan.index}: same object`);
    assert.equal(applyCityBalance(plan,NEUTRAL_ROUND),plan);
    assert.equal(JSON.stringify(plan),before,'not mutated');
  }
});

test('round 1 (the tutorial) is never touched by any knob',()=>{
  assert.deepEqual(roundKnobs(STRONG,1),NEUTRAL_ROUND,'round 1 knobs are neutral even with `all` set');
  for(const players of [1,6]){
    const plan=plans(4,players)[0];
    assert.equal(applyCityBalance(plan,{count:3,hp:4,cadence:.2,siegeShare:1}),plan,'round 1 plan kept as is');
  }
  assert.throws(()=>cityBalanceFrom({rounds:{1:{count:2}}}),/round 1 is the tutorial/);
});

test('count, hp and cadence change only what they name (regular members, hp, spacing); the input plan is not mutated',()=>{
  for(const seed of [5,6])for(const players of [1,3,6])for(const plan of plans(seed,players)){
    if(plan.index<2)continue;
    const before=JSON.stringify(plan),regular=regularOf(plan),sum=count(regular);
    // count ×1.5: exact total (capped), the same groups, members repeated from the group itself, elite/boss untouched.
    const more=applyCityBalance(plan,{count:1.5,hp:1,cadence:1});
    const target=Math.max(regular.length,Math.min(MAX_ROUND_ENEMIES,Math.round(sum*1.5)));
    assert.equal(count(regularOf(more)),target,`seed ${seed} ${players}p r${plan.index}: regular total`);
    assert.equal(more.groups.length,plan.groups.length,'same groups');
    more.groups.forEach((g,i)=>{
      const o=plan.groups[i];
      assert.equal(g.at,o.at,'same ticks');
      if(o.boss||o.elite)assert.deepEqual(g.members,o.members,'elite and boss untouched');
      else for(const [j,kind] of g.members.entries())assert.equal(kind,o.members[j%o.members.length],'grows by repeating its own members');
    });
    assert.equal(more.total,count(more.groups));
    assert.equal(more.hp,plan.hp);assert.equal(more.durationTicks,plan.durationTicks);
    // count ×0.5: fewer, at least one per group.
    const fewer=applyCityBalance(plan,{count:.5,hp:1,cadence:1});
    assert.ok(count(regularOf(fewer))<=Math.max(regular.length,Math.round(sum*.5))+regular.length,'shrinks');
    assert.ok(regularOf(fewer).every(g=>g.members.length>=1),'never an empty group');
    // hp ×1.3: hp and elite hp only.
    const tough=applyCityBalance(plan,{count:1,hp:1.3,cadence:1});
    assert.equal(tough.hp,plan.hp*1.3);assert.equal(tough.eliteHp,plan.eliteHp*1.3);
    assert.deepEqual(tough.groups,plan.groups);assert.equal(tough.durationTicks,plan.durationTicks);
    // cadence ×2: every non-boss gap from the first group doubles; the boss keeps its tick; the round grows by the shift.
    const slow=applyCityBalance(plan,{count:1,hp:1,cadence:2});
    const moving=plan.groups.filter(g=>!g.boss),at0=Math.min(...moving.map(g=>g.at)),last=Math.max(...moving.map(g=>g.at));
    const want=plan.groups.map(g=>g.boss?g.at:Math.round(at0+(g.at-at0)*2)).sort((a,b)=>a-b);
    assert.deepEqual(slow.groups.map(g=>g.at),want,`seed ${seed} ${players}p r${plan.index}: gaps ×2`);
    assert.equal(slow.durationTicks,plan.durationTicks+(Math.max(...slow.groups.filter(g=>!g.boss).map(g=>g.at))-last));
    assert.equal(count(slow.groups),count(plan.groups));
    assert.equal(JSON.stringify(plan),before,'input plan not mutated');
  }
});

// ---------- 2. JSON knobs ----------
test('cityBalanceFrom: partial JSON over CITY_BALANCE; roundKnobs multiplies all × round; bad input throws',()=>{
  assert.equal(cityBalanceFrom(undefined),CITY_BALANCE);
  const b=cityBalanceFrom(JSON.parse('{"all":{"hp":1.2},"rounds":{"3":{"hp":1.5,"count":0.8,"siegeShare":0.5}},"lootValue":1.5}'));
  assert.deepEqual(roundKnobs(b,2),{count:1,hp:1.2,cadence:1});
  assert.deepEqual(roundKnobs(b,3),{count:.8,hp:1.2*1.5,cadence:1,siegeShare:.5});
  assert.equal(b.lootValue,1.5);assert.equal(b.intermissionExtraSeconds,0);assert.equal(b.bossHp,1);
  assert.deepEqual(roundKnobs(b,ROUND_COUNT+1),NEUTRAL_ROUND);
  for(const bad of [{nope:1},{lootValue:-1},{bossHp:'2'},{rounds:{11:{}}},{rounds:{2:{speed:2}}},{all:{siegeShare:2}},{rounds:[]}])
    assert.throws(()=>cityBalanceFrom(bad),undefined,JSON.stringify(bad));
  assert.equal(cityCrateValue(3,1),3);assert.equal(cityCrateValue(3,1.5),5);assert.equal(cityCrateValue(9,.5),5);assert.equal(cityCrateValue(3,0),0);
});

// ---------- 3. the director on the real city ----------
type FakeCtx=SimContext&{tick:number;ids:number;events:SimEvent[];sentAt:number[]};
function fakeCtx(seed:number,terrain:SimContext['terrain']):FakeCtx{
  const ctx:FakeCtx={
    tick:0,runStartTick:0,ids:0,terrain,rng:new Rng(seed),events:[],sentAt:[],
    players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:5},offers:new Map(),round:{index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0},
    enemyIndex:{rebuild(){},query:()=>[],nearest:()=>undefined},
    nextId:prefix=>`${prefix}-${++ctx.ids}`,
    emit(event){ctx.events.push(event);ctx.sentAt.push(ctx.tick);},
    damageEnemy(id,amount){
      const e=ctx.enemies.get(id);if(!e)return false;
      e.hp-=amount;if(e.hp>0)return false;
      ctx.enemies.delete(id);ctx.emit({type:'kill',enemy:id,kind:e.kind,x:e.x,y:e.y});return true;
    },
    damagePlayer(){},
  } as FakeCtx;
  return ctx;
}
function addPlayer(ctx:FakeCtx,id:string,p:Point){
  ctx.players.set(id,{id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},x:p.x,y:p.y});
}
interface Body {id:string;tick:number;round:number;kind:string;scale:number;siege:boolean}
/**
 * The director as assemble.ts wires it in the city (catalog bodies, citySpeed, siege share 1/4 from round 2, the
 * tutorial on or off), the team in the plaza, every body killed 2 s after it spawns. Digest of the events, spawns,
 * round summaries and state; the bodies with their round and siege flag.
 */
function cityRun(seed:number,rounds:number,tutorial:boolean,extra:Partial<DirectorOptions>={},terrain:SimContext['terrain']=city){
  const ctx=fakeCtx(seed,terrain),created:unknown[]=[],ends:unknown[]=[],bodies:Body[]=[],seen=new Set<string>(),scales=new Map<string,number>();
  const inCity=terrain===city;
  addPlayer(ctx,'a',inCity?P.plazaCenter:worldSpawn(terrain));addPlayer(ctx,'b',inCity?city.asset.points.praca:{x:worldSpawn(terrain).x+3,y:worldSpawn(terrain).y});
  const director=createDirector({
    createEnemy(c,kind,point,scale){
      if(!isEnemyKind(kind))return undefined;
      const e=catalogEnemy(c,kind,point,scale);scales.set(e.id,scale);created.push([e.id,c.tick,c.round.index,kind,point.x,point.y,scale]);return e;
    },
    spawnBoss(c,point){
      const e:EnemyState={id:c.nextId('boss'),kind:'chefe',boss:true,x:point.x,y:point.y,hp:500,maxHp:500,speed:1.6,damage:10,radius:.9,xp:50,spawnTick:c.tick,readyTick:c.tick};
      c.enemies.set(e.id,e);created.push([e.id,c.tick,'boss']);return e;
    },
    onRoundEnd:(_c,r)=>{ends.push(r);},
    rounds,siegeShare:.25,siegeFromRound:2,
    ...(inCity?{avenues:P,speedMap:citySpeed,enemySpeedOf:(k:string)=>isEnemyKind(k)?enemyDef(k).speed:undefined,cityTutorial:tutorial}:{}),
    ...extra,
  });
  for(let i=0;i<ticks(250*rounds);i++){
    ctx.tick++;director.step(ctx);
    for(const e of ctx.enemies.values())if(!seen.has(e.id)){
      seen.add(e.id);
      bodies.push({id:e.id,tick:ctx.tick,round:ctx.round.index,kind:e.kind,scale:scales.get(e.id)??0,siege:e.memory?.siege===1});
    }
    for(const e of [...ctx.enemies.values()])if(ctx.tick-e.spawnTick>=ticks(2))ctx.damageEnemy(e.id,1e9);
    if(director.state.stage==='done')break;
  }
  return {hash:digest({events:ctx.events,sentAt:ctx.sentAt,created,ends,state:director.state,round:ctx.round}),ends:ends.length,bodies,plan:director.state.plan};
}
/** Recorded on 4906ef9 (before cidade-11) with cityRun's scenario and no cityBalance option. */
const CITY_BASELINE:Readonly<Record<string,string>>={
  'tutorial seed 3 r4':'6e26ca9cb09c90d1','tutorial seed 8 r4':'88c195c76b062ff1','plain seed 21 r10':'5861426c3ece3a1a',
};

test('city director: no option and CITY_BALANCE give the plans and output recorded before cidade-11',()=>{
  const got:Record<string,string>={},explicit:Record<string,string>={};
  for(const [key,seed,rounds,tutorial] of [['tutorial seed 3 r4',3,4,true],['tutorial seed 8 r4',8,4,true],['plain seed 21 r10',21,10,false]] as const){
    const plain=cityRun(seed,rounds,tutorial);
    assert.equal(plain.ends,rounds,`${key}: every round played`);
    got[key]=plain.hash;
    explicit[key]=cityRun(seed,rounds,tutorial,{cityBalance:CITY_BALANCE}).hash;
  }
  console.log(`[cidade-11] city director digests: ${JSON.stringify(got)}`);
  assert.deepEqual(got,CITY_BASELINE,'city director output differs from the pre-cidade-11 baseline');
  assert.deepEqual(explicit,CITY_BASELINE,'CITY_BALANCE passed explicitly changes the city');
});

test('city director: knobs change rounds 2+ only; round 1 (tutorial) spawns the same bodies; siegeShare per round',()=>{
  const base=cityRun(3,4,true);
  const knobs=cityBalanceFrom({all:{hp:1.25},rounds:{2:{count:2},3:{siegeShare:1}}});
  const tuned=cityRun(3,4,true,{cityBalance:knobs});
  assert.equal(tuned.ends,4);
  const r1=(b:Body[])=>b.filter(x=>x.round===1).map(x=>[x.id,x.tick,x.kind,x.scale,x.siege]);
  assert.ok(r1(base.bodies).length>0,'the tutorial spawned');
  assert.deepEqual(r1(tuned.bodies),r1(base.bodies),'round 1 identical');
  const inRound=(b:Body[],r:number)=>b.filter(x=>x.round===r&&x.kind!=='chefe');
  const b2=inRound(base.bodies,2),t2=inRound(tuned.bodies,2);
  console.log(`[cidade-11] round 2 bodies: ${b2.length} → ${t2.length} (count ×2)`);
  assert.ok(t2.length>=Math.round(b2.length*1.8),`count ×2 in round 2: ${b2.length} → ${t2.length}`);
  // hp ×1.25 from round 2 on: the bodies' scale is the plan's hp, the same for every regular body of a round.
  const scaleOf=(b:Body[],r:number)=>[...new Set(inRound(b,r).map(x=>x.scale.toFixed(9)))];
  for(const r of [2,3,4]){
    const was=scaleOf(base.bodies,r),now=scaleOf(tuned.bodies,r);
    assert.equal(was.length,1,`round ${r}: one hp scale before`);assert.equal(now.length,1,`round ${r}: one hp scale after`);
    assert.ok(Math.abs(Number(now[0])-Number(was[0])*1.25)<1e-6,`round ${r}: hp ${was[0]} → ${now[0]}`);
  }
  // siegeShare 1 in round 3: every regular body besieges; round 2 keeps the director's 1/4.
  const s3=inRound(tuned.bodies,3);
  assert.ok(s3.length>0&&s3.every(b=>b.siege),'round 3: all siege');
  const s2=inRound(tuned.bodies,2);
  assert.ok(s2.some(b=>b.siege)&&s2.some(b=>!b.siege),'round 2: the 1/4 share');
});

// ---------- 4. island and endless untouched ----------
test('island and endless director: strong city knobs change nothing (with or without a planner passed in)',()=>{
  for(const terrain of [new TerrainField(3),new TerrainField(3,{world:'infinito'})]){
    const plain=cityRun(0,3,false,{},terrain);
    assert.ok(plain.bodies.length>0);
    assert.equal(cityRun(0,3,false,{cityBalance:STRONG},terrain).hash,plain.hash,`${terrain.world??'ilha'}: knobs ignored`);
    assert.equal(cityRun(0,3,false,{cityBalance:STRONG,avenues:P},terrain).hash,plain.hash,`${terrain.world??'ilha'}: knobs + planner ignored`);
  }
});

/** createRunSystems run, two standing players (no weapons, huge hp), `n` ticks: digest of the systems' state. */
function assembled(terrain:SimWorld['terrain'],seed:number,n:number,cityBalance?:CityBalance){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},...(cityBalance?{cityBalance}:{})});
  const s=terrain===city?P.plazaCenter:{x:12,y:12};
  for(const [id,dx] of [['a',0],['b',1]] as const)players.set(id,{id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:s.x+dx,y:s.y,ack:0,score:0} as SimPlayer);
  for(let i=0;i<n;i++)world.step();
  return {hash:digest({state:sys.state(),round:world.round,enemies:[...world.enemies.values()]}),round:world.round.index,sys};
}
/** Recorded on 4906ef9 (before cidade-11) with `assembled` and no cityBalance option. */
const ASSEMBLED_BASELINE:Readonly<Record<string,string>>={cidade:'760ded62dba03be0',ilha:'0d4d774d9e279384',infinito:'e155870fac9620e5'};

test('assembled run: the city default (and CITY_BALANCE) as before cidade-11; island and endless ignore strong knobs',()=>{
  const c=assembled(city,4,4000);
  console.log(`[cidade-11] assembled city default: ${c.hash} (round ${c.round} at tick 4000)`);
  assert.equal(c.hash,ASSEMBLED_BASELINE.cidade,'assembled city default differs from the pre-cidade-11 baseline');
  assert.equal(assembled(city,4,4000,CITY_BALANCE).hash,c.hash,'explicit CITY_BALANCE');
  for(const [name,terrain] of [['ilha',new TerrainField(3)],['infinito',new TerrainField(3,{world:'infinito'})]] as const){
    assert.equal(assembled(terrain,4,1500).hash,ASSEMBLED_BASELINE[name],`${name}: as before cidade-11`);
    assert.equal(assembled(terrain,4,1500,STRONG).hash,ASSEMBLED_BASELINE[name],`${name}: strong knobs ignored`);
  }
});

test('bossHp: the city boss only (createRunSystems and the Simulation option); the island boss keeps BOSS_TUNING',()=>{
  const spawn=(terrain:SimWorld['terrain'],cityBalance?:CityBalance)=>{
    const players=new Map<string,SimPlayer>(),world=new SimWorld({terrain,seed:2,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},...(cityBalance?{cityBalance}:{})});
    const s=terrain===city?P.plazaCenter:worldSpawn(terrain);
    players.set('a',{id:'a',classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},x:s.x+8,y:s.y});
    return sys.boss.spawnBoss(world,{x:s.x,y:s.y})!.maxHp;
  };
  assert.equal(spawn(city),bossMaxHp(1));
  assert.equal(spawn(city,STRONG),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*1.5}));
  assert.equal(spawn(new TerrainField(3),STRONG),bossMaxHp(1),'island ignores bossHp');
  const sim=new Simulation(7,{world:'cidade',terrain:city,cityBalance:STRONG});
  assert.equal(sim.run.boss.tuning.baseHp,BOSS_TUNING.baseHp*1.5,'Simulation passes cityBalance to the run');
  sim.resetRun();
  assert.equal(sim.run.boss.tuning.baseHp,BOSS_TUNING.baseHp*1.5,'and to every new run');
  assert.equal(new Simulation(7,{world:'cidade',terrain:city}).run.boss.tuning.baseHp,BOSS_TUNING.baseHp,'default city boss');
  assert.equal(new Simulation(7,{cityBalance:STRONG}).run.boss.tuning.baseHp,BOSS_TUNING.baseHp,'island Simulation ignores it');
});

// ---------- 5. stonewards: loot value and intermission ----------
type StoneCtx=SimContext&{tick:number;events:SimEvent[];round:{index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number}};
function stoneCtx(players:SimPlayer[],terrain:SimContext['terrain']):StoneCtx{
  const events:SimEvent[]=[];let id=0;
  const unused=()=>{throw new Error('not used by stonewards');};
  const ctx:StoneCtx={
    tick:0,events,terrain,rng:new Rng(1),players:new Map(players.map(p=>[p.id,p])),
    enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),team:{xp:0,level:1,nextXp:5},
    round:{index:1,total:10,phase:'prepare',phaseEndsTick:ticks(20),remaining:0},
    enemyIndex:{rebuild:unused,query:unused,nearest:()=>undefined},
    nextId:prefix=>`${prefix}${++id}`,emit:e=>{events.push(e);},damageEnemy:()=>false,damagePlayer:unused,
  } as StoneCtx;
  return ctx;
}
const hero=(id:string,p:Point):SimPlayer=>({id,x:p.x,y:p.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{}});
const stretcher:Pick<StonewardsOptions,'extendPrepare'>={extendPrepare:(c,endsTick)=>{
  if(c.round.phase==='prepare'&&Number.isSafeInteger(endsTick)&&endsTick>c.round.phaseEndsTick)c.round.phaseEndsTick=endsTick;
}};
/** An intermission (round `index`, 30 s at the director) with heroes standing on `spots`, `n` ticks of stonewards. */
function intermission(terrain:SimContext['terrain'],spots:readonly Point[],n:number,cityBalance?:StonewardsOptions['cityBalance']){
  const ctx=stoneCtx(spots.map((p,i)=>hero(`h${i}`,p)),terrain);
  const sys:StonewardsSystem=createStonewardsSystem({terrain,...stretcher,...(cityBalance?{cityBalance}:{})});
  ctx.tick=100;Object.assign(ctx.round,{index:2,phase:'prepare',phaseEndsTick:ctx.tick+1+ticks(30)});
  let firstEnd=-1;
  for(let i=0;i<n&&ctx.round.phase==='prepare';i++){ctx.tick++;sys.step(ctx);if(i===0)firstEnd=ctx.round.phaseEndsTick;}
  return {sys,ctx,firstEnd,length:firstEnd-101};
}

test('lootValue pays whole units per crate (balance and credits); intermissionExtraSeconds lengthens the city intermission',()=>{
  const crates=nodesNear(city,P.plazaCenter,1e4);
  const spots=[crates[0],crates[Math.floor(crates.length/2)],crates[crates.length-1]].map(n=>({x:n.x,y:n.y}));
  const plain=intermission(city,spots,ticks(6)),rich=intermission(city,spots,ticks(6),{lootValue:1.5,intermissionExtraSeconds:7});
  const emptied=plain.sys.state.nodes.filter(n=>n.remaining<=0);
  assert.ok(emptied.length>=spots.length,'each hero emptied a crate');
  assert.deepEqual(rich.sys.state.nodes.map(n=>n.id),plain.sys.state.nodes.map(n=>n.id),'the same crates worked');
  for(const kind of ['coco','pedra'] as const){
    const raw=emptied.filter(n=>n.kind===kind).reduce((s,n)=>s+n.value,0),paid=emptied.filter(n=>n.kind===kind).reduce((s,n)=>s+cityCrateValue(n.value,1.5),0);
    assert.equal(plain.sys.state.balance[kind],raw,`${kind}: neutral pays the crates' values`);
    assert.equal(rich.sys.state.balance[kind],paid,`${kind}: ×1.5 pays whole units per crate`);
  }
  const total=(g:Record<string,number>)=>Object.values(g).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(total(rich.sys.state.gathered)-(rich.sys.state.balance.coco+rich.sys.state.balance.pedra))<1e-9,'credits add up to the balance');
  console.log(`[cidade-11] city loot ×1.5: balance ${JSON.stringify(plain.sys.state.balance)} → ${JSON.stringify(rich.sys.state.balance)}`);
  // Timing with the team home (no horn stretch for a straggler): the trip-sized intermission plus the extra seconds.
  const home=intermission(city,[P.plazaCenter],2),later=intermission(city,[P.plazaCenter],2,{lootValue:1,intermissionExtraSeconds:7});
  assert.ok(home.length>ticks(30),`trip-sized city intermission ${home.length/20} s`);
  assert.equal(later.firstEnd,Math.min(home.firstEnd+ticks(7),101+MAX_PREPARE_TICKS),'extra seconds after the trip sizing, within the cap');
  console.log(`[cidade-11] city intermission (team home) ${home.length/20} s → ${later.length/20} s with +7 s`);
  // The island: the same state, keys and intermission with or without the knobs.
  const near=[{x:obstacles[12].x+obstacles[12].radius+.3,y:obstacles[12].y}];
  const i0=intermission(defaultTerrain,near,ticks(35)),i1=intermission(defaultTerrain,near,ticks(35),{lootValue:3,intermissionExtraSeconds:20});
  assert.ok(i0.sys.state.balance.coco+i0.sys.state.balance.pedra>0,'the island hero gathered');
  assert.equal(JSON.stringify(i1.sys.state),JSON.stringify(i0.sys.state),'island state untouched');
  assert.deepEqual(Object.keys(i1.sys.state),Object.keys(i0.sys.state));
  assert.equal(i1.firstEnd,i0.firstEnd,'island intermission untouched');
  assert.deepEqual(i1.ctx.events,i0.ctx.events);
});
