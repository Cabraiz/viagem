/**
 * cidade-11 (balanço da run): the city's balance knobs (src/sim/city/balance.ts) on top of the shared tables.
 *  1. applyCityBalance on real plans (planRound, every round, 1..6 players): neutral knobs keep the plan itself, round
 *     1 is never touched, and each knob does what it says (count, hp, cadence) and nothing else.
 *  2. cityBalanceFrom (a runner's --knobs JSON) and roundKnobs (all × round).
 *  3. The director on the REAL city: no option and NEUTRAL_CITY_BALANCE give the digests recorded before this card; a
 *     knob changes rounds 2+ only (round 1, the tutorial, spawns the same bodies); siegeShare per round.
 *  4. Island and endless untouched: the director and the assembled run with strong knobs give the same output as
 *     without them (assembled digests recorded before this card); the city's assembled run with NEUTRAL_CITY_BALANCE
 *     too, and its default is CITY_BALANCE (the tuning).
 *  5. Stonewards: lootValue pays whole units per crate, intermissionExtraSeconds lengthens the city intermission;
 *     the island ignores both (same state, same keys). bossHp: the city boss only (assemble and Simulation option).
 *  6. Team-size knobs (CityBalance.players): JSON validation; a knob for 1 player changes only the 1-player city
 *     (keyed by RoundPlan.players), round 1 untouched; loot by the team standing at the intermission start.
 *  7. Team damage and boss hp (players[n].damage, players[n].bossHp): damage ×0.5 for a team of 1 halves the contact,
 *     hostile projectile and telegraph hits on a solo city hero (the real systems through the core's damagePlayer)
 *     and changes nothing for 2 heroes, before round 2 nor on the island; bossHp for 1 changes only the solo city boss.
 *  8. CITY_BALANCE (the tuned default): team entries for 1, 3 and 6 players only, and cityBalanceFrom round-trips it.
 * "Neutral" tests build their knobs over NEUTRAL_CITY_BALANCE, never over the tuned default.
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
import {CITY_BALANCE,CITY_TEAM_SIZES,NEUTRAL_CITY_BALANCE,NEUTRAL_ROUND,applyCityBalance,cityBalanceFrom,cityCrateValue,hasTeamBossHp,hasTeamDamage,hasTeamLoot,isNeutralRound,roundKnobs,teamBossHp,teamDamage,type CityBalance} from '../../src/sim/city/balance.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {BOSS_TUNING,bossMaxHp} from '../../src/sim/boss.ts';
import {createStonewardsSystem,MAX_PREPARE_TICKS,type StonewardsOptions,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {nodesNear} from '../../src/sim/stonewards/resources.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,addTelegraph,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import type {ProjectileState} from '../../src/contract/types.ts';
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
const STRONG:CityBalance=cityBalanceFrom({all:{count:1.6,hp:1.4,cadence:.7,siegeShare:.5},rounds:{2:{count:2},10:{hp:2}},lootValue:2,intermissionExtraSeconds:9,bossHp:1.5},NEUTRAL_CITY_BALANCE);

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
test('defaults: NEUTRAL_CITY_BALANCE is neutral on every round and team, and applyCityBalance keeps the plan object itself',()=>{
  for(let index=1;index<=ROUND_COUNT;index++)for(const team of [undefined,...CITY_TEAM_SIZES])
    assert.ok(isNeutralRound(roundKnobs(NEUTRAL_CITY_BALANCE,index,team)),`round ${index} team ${team} neutral`);
  for(const seed of [1,2,3])for(const players of [1,3,6])for(const plan of plans(seed,players)){
    const before=JSON.stringify(plan);
    assert.equal(applyCityBalance(plan,roundKnobs(NEUTRAL_CITY_BALANCE,plan.index,plan.players)),plan,`seed ${seed} ${players}p round ${plan.index}: same object`);
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
function cityRun(seed:number,rounds:number,tutorial:boolean,extra:Partial<DirectorOptions>={},terrain:SimContext['terrain']=city,heroes=2){
  const ctx=fakeCtx(seed,terrain),created:unknown[]=[],ends:unknown[]=[],bodies:Body[]=[],seen=new Set<string>(),scales=new Map<string,number>();
  const inCity=terrain===city;
  addPlayer(ctx,'a',inCity?P.plazaCenter:worldSpawn(terrain));
  if(heroes>=2)addPlayer(ctx,'b',inCity?city.asset.points.praca:{x:worldSpawn(terrain).x+3,y:worldSpawn(terrain).y});
  for(let i=2;i<heroes;i++)addPlayer(ctx,`p${i}`,inCity?{x:P.plazaCenter.x+i*.5,y:P.plazaCenter.y+.5}:{x:worldSpawn(terrain).x+i,y:worldSpawn(terrain).y+1});
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
/**
 * cityRun's scenario with neutral knobs (= the city without cidade-11): first recorded on 4906ef9, re-recorded on df2bf97
 * because main's P1 cast (18575e8, ff1954e) changed the waves' enemy pool, again for D-046 (cityVisible follows the
 * contract's widest camera, so the avenue spawn spots move out; late parts run in, CITY_RUN_IN_SPEED, 2 u/s since the merge with
 * BUG-20261013-E8-tio-preso-cidade), and for velocidade-heroi-e-projetil (the city spawn lead CITY_VIEW_LEAD follows the
 * 2× walk; the city tutorial's welcome follows it too, CITY_TUTORIAL welcomeArrival 40 / HERO_SPEED_MULT).
 */
const CITY_BASELINE:Readonly<Record<string,string>>={
  'tutorial seed 3 r4':'180e3d8bac9b28f1','tutorial seed 8 r4':'159b49ca7e04eccd','plain seed 21 r10':'ca261ba76e3068c2',
};

test('city director: no option and NEUTRAL_CITY_BALANCE give the plans and output recorded before cidade-11',()=>{
  const got:Record<string,string>={},explicit:Record<string,string>={};
  for(const [key,seed,rounds,tutorial] of [['tutorial seed 3 r4',3,4,true],['tutorial seed 8 r4',8,4,true],['plain seed 21 r10',21,10,false]] as const){
    const plain=cityRun(seed,rounds,tutorial);
    assert.equal(plain.ends,rounds,`${key}: every round played`);
    got[key]=plain.hash;
    explicit[key]=cityRun(seed,rounds,tutorial,{cityBalance:NEUTRAL_CITY_BALANCE}).hash;
  }
  console.log(`[cidade-11] city director digests: ${JSON.stringify(got)}`);
  assert.deepEqual(got,CITY_BASELINE,'city director output differs from the pre-cidade-11 baseline');
  assert.deepEqual(explicit,CITY_BASELINE,'NEUTRAL_CITY_BALANCE passed explicitly changes the city');
  // The tuning has no entry for 2 players (the recorded scenario): the 2-player city director plays as before.
  assert.equal(cityRun(3,4,true,{cityBalance:CITY_BALANCE}).hash,CITY_BASELINE['tutorial seed 3 r4'],'CITY_BALANCE, 2 players');
});

test('city director: knobs change rounds 2+ only; round 1 (tutorial) spawns the same bodies; siegeShare per round',()=>{
  const base=cityRun(3,4,true);
  const knobs=cityBalanceFrom({all:{hp:1.25},rounds:{2:{count:2},3:{siegeShare:1}}},NEUTRAL_CITY_BALANCE);
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
  // The baselines were recorded with the round table's nine kinds (before the D-040 rotation).
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},rotation:false,...(cityBalance?{cityBalance}:{})});
  const s=terrain===city?P.plazaCenter:{x:12,y:12};
  for(const [id,dx] of [['a',0],['b',1]] as const)players.set(id,{id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:s.x+dx,y:s.y,ack:0,score:0} as SimPlayer);
  for(let i=0;i<n;i++)world.step();
  return {hash:digest({state:sys.state(),round:world.round,enemies:[...world.enemies.values()]}),round:world.round.index,sys};
}
/**
 * Recorded with `assembled` and no cityBalance option: island/endless on 4906ef9, the city on 11793fb (cidade-06 merged,
 * before cidade-11), re-recorded for BUG-20261013-E8 (16a84cd56d5977cb before): on the hero-size planner flow, a wide
 * body whose own disc clips a wall one step ahead now squeezes by the hero rule (grid.ts citySteer); in this run that
 * is seven bêbados (0.32 u) for 1–4 ticks each; then the city and the endless map again for D-046 (the widest-camera
 * contract widens cityVisible and the spawn ring; the director paces the run-in at the default camera). Re-recorded
 * (cidade, infinito) for velocidade-heroi-e-projetil: 2× walk lead, endless spawn ring, half-speed shots, the city
 * tutorial's welcome at 40 / HERO_SPEED_MULT s and citySteer rebuilding a field after an idle tick; the island is unchanged.
 * Re-recorded (all three) for ficha-de-torre (D-048): the team balance is one pile {units} instead of {coco, pedra}; with the
 * old state's balance read as {units: coco + pedra}, the old code gives these same digests (nothing else moved).
 */
// cidade re-recorded by ataque-fora-do-alcance (straight shots no longer fire into the air with nobody in reach); all three
// again by ficha-de-torre (D-048): only the balance's shape moved ({units} for {coco, pedra}), checked against the old code.
const ASSEMBLED_BASELINE:Readonly<Record<string,string>>={cidade:'f1ecdedb6e14509c',ilha:'9f21ca75237bc017',infinito:'8777c5135c0dc37a'};

test('assembled run: the city with NEUTRAL_CITY_BALANCE as before cidade-11, its default is CITY_BALANCE; island and endless ignore strong knobs',()=>{
  const c=assembled(city,4,4000,NEUTRAL_CITY_BALANCE);
  console.log(`[cidade-11] assembled city neutral: ${c.hash} (round ${c.round} at tick 4000)`);
  assert.equal(c.hash,ASSEMBLED_BASELINE.cidade,'assembled city with neutral knobs differs from the pre-cidade-11 baseline');
  const tuned=assembled(city,4,4000);
  assert.equal(assembled(city,4,4000,CITY_BALANCE).hash,tuned.hash,'no option: CITY_BALANCE');
  assert.notEqual(tuned.hash,c.hash,'CITY_BALANCE is not neutral in the city');
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
  assert.equal(spawn(city,NEUTRAL_CITY_BALANCE),bossMaxHp(1));
  assert.equal(spawn(city),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*teamBossHp(CITY_BALANCE,1)}),'default: CITY_BALANCE (solo team bossHp)');
  assert.equal(spawn(city,STRONG),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*1.5}));
  assert.equal(spawn(new TerrainField(3),STRONG),bossMaxHp(1),'island ignores bossHp');
  const sim=new Simulation(7,{world:'cidade',terrain:city,cityBalance:STRONG});
  assert.equal(sim.run.boss.tuning.baseHp,BOSS_TUNING.baseHp*1.5,'Simulation passes cityBalance to the run');
  sim.resetRun();
  assert.equal(sim.run.boss.tuning.baseHp,BOSS_TUNING.baseHp*1.5,'and to every new run');
  assert.equal(new Simulation(7,{world:'cidade',terrain:city}).run.boss.tuning.baseHp,BOSS_TUNING.baseHp*CITY_BALANCE.bossHp,'default city boss (global knob of CITY_BALANCE)');
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
  // D-048: coco and pedra crates alike pay into the one pile.
  const raw=emptied.reduce((s,n)=>s+n.value,0),paid=emptied.reduce((s,n)=>s+cityCrateValue(n.value,1.5),0);
  assert.equal(plain.sys.state.balance.units,raw,"neutral pays the crates' values");
  assert.equal(rich.sys.state.balance.units,paid,'×1.5 pays whole units per crate');
  const total=(g:Record<string,number>)=>Object.values(g).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(total(rich.sys.state.gathered)-rich.sys.state.balance.units)<1e-9,'credits add up to the balance');
  console.log(`[cidade-11] city loot ×1.5: balance ${JSON.stringify(plain.sys.state.balance)} → ${JSON.stringify(rich.sys.state.balance)}`);
  // Timing with the team home (no horn stretch for a straggler): the trip-sized intermission plus the extra seconds.
  const home=intermission(city,[P.plazaCenter],2),later=intermission(city,[P.plazaCenter],2,{lootValue:1,intermissionExtraSeconds:7});
  assert.ok(home.length>ticks(30),`trip-sized city intermission ${home.length/20} s`);
  assert.equal(later.firstEnd,Math.min(home.firstEnd+ticks(7),101+MAX_PREPARE_TICKS),'extra seconds after the trip sizing, within the cap');
  console.log(`[cidade-11] city intermission (team home) ${home.length/20} s → ${later.length/20} s with +7 s`);
  // The island: the same state, keys and intermission with or without the knobs.
  const near=[{x:obstacles[12].x+obstacles[12].radius+.3,y:obstacles[12].y}];
  const i0=intermission(defaultTerrain,near,ticks(35)),i1=intermission(defaultTerrain,near,ticks(35),{lootValue:3,intermissionExtraSeconds:20});
  assert.ok(i0.sys.state.balance.units>0,'the island hero gathered');
  assert.equal(JSON.stringify(i1.sys.state),JSON.stringify(i0.sys.state),'island state untouched');
  assert.deepEqual(Object.keys(i1.sys.state),Object.keys(i0.sys.state));
  assert.equal(i1.firstEnd,i0.firstEnd,'island intermission untouched');
  assert.deepEqual(i1.ctx.events,i0.ctx.events);
});

// ---------- 6. team-size knobs (CityBalance.players) ----------
test('players knobs: JSON validation (sizes 1..6, numbers > 0); roundKnobs multiplies all × round × team, rounds 2..10 only',()=>{
  assert.equal(NEUTRAL_CITY_BALANCE.players,undefined,'NEUTRAL_CITY_BALANCE has no team knobs');
  const b=cityBalanceFrom({all:{hp:1.2},rounds:{3:{count:.8,siegeShare:.5}},players:{1:{count:.5,hp:.5,cadence:1.5,siegeShare:.25,lootValue:2},3:{hp:.8}}},NEUTRAL_CITY_BALANCE);
  assert.deepEqual(roundKnobs(b,3),{count:.8,hp:1.2,cadence:1,siegeShare:.5},'no team: as before');
  assert.deepEqual(roundKnobs(b,3,1),{count:.8*.5,hp:1.2*.5,cadence:1.5,siegeShare:.25},'team 1: × its knobs, its siegeShare first');
  assert.deepEqual(roundKnobs(b,3,3),{count:.8,hp:1.2*.8,cadence:1,siegeShare:.5},'team 3: hp only');
  assert.deepEqual(roundKnobs(b,3,2),roundKnobs(b,3),'team 2 has no entry: neutral');
  assert.deepEqual(roundKnobs(b,1,1),NEUTRAL_ROUND,'round 1 (tutorial) untouched by the team knobs');
  assert.deepEqual(roundKnobs(b,ROUND_COUNT+1,1),NEUTRAL_ROUND);
  // A later JSON over `b`: the sizes it names are replaced, the others kept.
  const c=cityBalanceFrom({players:{3:{count:1.1}}},b);
  assert.deepEqual(c.players,{1:b.players![1],3:{count:1.1}});
  for(const bad of [{players:{0:{}}},{players:{7:{hp:1}}},{players:{'1.0':{}}},{players:{1:{count:0}}},{players:{1:{hp:-1}}},
    {players:{1:{lootValue:Infinity}}},{players:{1:{speed:2}}},{players:{1:{siegeShare:2}}},{players:[]},{players:{1:[]}},{players:{1:{count:'2'}}}])
    assert.throws(()=>cityBalanceFrom(bad),undefined,JSON.stringify(bad));
});

test('players knobs on the city director: a knob for 1 player changes only 1-player runs (rounds 2+, keyed by RoundPlan.players)',()=>{
  const knobs=cityBalanceFrom({players:{1:{count:2,hp:1.5,siegeShare:1}}},NEUTRAL_CITY_BALANCE);
  // Two heroes (the recorded scenario) and three: byte-identical to no knobs.
  assert.equal(cityRun(3,4,true,{cityBalance:knobs}).hash,CITY_BASELINE['tutorial seed 3 r4'],'2 players: the pre-cidade-11 digest');
  const three=cityRun(3,3,true,{},city,3);
  assert.equal(three.plan?.players,3);
  assert.equal(cityRun(3,3,true,{cityBalance:knobs},city,3).hash,three.hash,'3 players: unchanged');
  // One hero: round 1 identical; rounds 2+ count ×2, hp ×1.5 and every regular body besieging.
  const solo=cityRun(3,3,true,{},city,1),tuned=cityRun(3,3,true,{cityBalance:knobs},city,1);
  assert.equal(solo.ends,3);assert.equal(tuned.ends,3);
  assert.equal(tuned.plan?.players,1,'the 1-player plan');
  assert.notEqual(tuned.hash,solo.hash,'1 player: changed');
  const r1=(b:Body[])=>b.filter(x=>x.round===1).map(x=>[x.id,x.tick,x.kind,x.scale,x.siege]);
  assert.ok(r1(solo.bodies).length>0,'the tutorial spawned');
  assert.deepEqual(r1(tuned.bodies),r1(solo.bodies),'round 1 identical');
  const inRound=(b:Body[],r:number)=>b.filter(x=>x.round===r&&x.kind!=='chefe');
  const scale=(b:Body[])=>[...new Set(b.map(x=>x.scale.toFixed(9)))];
  // Round 2 has the same theme and table plan in both runs (count and hp compare); from round 3 on the run's rng has
  // moved apart (round 2 drew differently), so only the siege share is compared there.
  const was=inRound(solo.bodies,2),now=inRound(tuned.bodies,2);
  console.log(`[cidade-11] 1 player round 2: ${was.length} → ${now.length} bodies (players[1].count ×2)`);
  assert.ok(now.length>=Math.round(was.length*1.8),`round 2: count ×2 (${was.length} → ${now.length})`);
  assert.equal(scale(was).length,1);assert.equal(scale(now).length,1);
  assert.ok(Math.abs(Number(scale(now)[0])-Number(scale(was)[0])*1.5)<1e-6,'round 2: hp ×1.5');
  for(const r of [2,3]){
    const bodies=inRound(tuned.bodies,r);
    assert.ok(bodies.length>0&&bodies.every(x=>x.siege),`round ${r}: players[1].siegeShare 1`);
    assert.ok(inRound(solo.bodies,r).some(x=>!x.siege),`round ${r}: without the knob, the director's 1/4`);
  }
});

test('loot by team size: × players[n].lootValue × the global lootValue, n = heroes standing at the intermission start',()=>{
  const crates=nodesNear(city,P.plazaCenter,1e4);
  const spot=(i:number)=>({x:crates[i].x,y:crates[i].y});
  const spots3=[spot(0),spot(Math.floor(crates.length/2)),spot(crates.length-1)];
  const knobs:StonewardsOptions['cityBalance']={lootValue:1,intermissionExtraSeconds:0,players:{1:{lootValue:2},3:{lootValue:1.5}}};
  const balanceOf=(sys:StonewardsSystem)=>sys.state.balance.units;
  /** What the emptied crates pay at `mult` (whole units per crate). */
  const paidAt=(sys:StonewardsSystem,mult:number)=>{
    const emptied=sys.state.nodes.filter(n=>n.remaining<=0);
    assert.ok(emptied.length>0,'a crate was emptied');
    return emptied.reduce((s,n)=>s+cityCrateValue(n.value,mult),0);
  };
  // 3 standing: ×1.5; 1 standing: ×2; 2 standing (no entry): the crates' own values, as without knobs.
  const t3=intermission(city,spots3,ticks(6),knobs).sys;
  assert.equal(t3.state.cityLootTeam,3);assert.deepEqual(balanceOf(t3),paidAt(t3,1.5),'3 players ×1.5');
  const t1=intermission(city,[spot(0)],ticks(6),knobs).sys;
  assert.equal(t1.state.cityLootTeam,1);assert.deepEqual(balanceOf(t1),paidAt(t1,2),'1 player ×2');
  const plain2=intermission(city,spots3.slice(0,2),ticks(6)).sys,t2=intermission(city,spots3.slice(0,2),ticks(6),knobs).sys;
  assert.equal(t2.state.cityLootTeam,2);
  assert.deepEqual(balanceOf(t2),balanceOf(plain2),'2 players: no entry, neutral');
  assert.deepEqual(balanceOf(t2),paidAt(t2,1));
  // × the global lootValue.
  const g1=intermission(city,[spot(0)],ticks(6),{...knobs,lootValue:1.5}).sys;
  assert.deepEqual(balanceOf(g1),paidAt(g1,3),'1 player: 1.5 × 2');
  console.log(`[cidade-11] team loot: 1p ${JSON.stringify(balanceOf(t1))}, 2p ${JSON.stringify(balanceOf(t2))}, 3p ${JSON.stringify(balanceOf(t3))}`);
  // A downed hero at the intermission start does not count: two heroes, one down → the team of 1 (×2).
  const ctx=stoneCtx([hero('h0',spot(0)),{...hero('h1',P.plazaCenter),hp:0,downed:true}],city);
  const sys=createStonewardsSystem({terrain:city,...stretcher,cityBalance:knobs});
  ctx.tick=100;Object.assign(ctx.round,{index:2,phase:'prepare',phaseEndsTick:ctx.tick+1+ticks(30)});
  for(let i=0;i<ticks(6);i++){ctx.tick++;sys.step(ctx);}
  assert.equal(sys.state.cityLootTeam,1,'standing heroes only');
  assert.deepEqual(balanceOf(sys),paidAt(sys,2));
  // No team lootValue anywhere: no cityLootTeam key (other tunings' state hashes do not move); the island ignores it.
  assert.ok(!('cityLootTeam' in intermission(city,[spot(0)],ticks(2),{lootValue:1,intermissionExtraSeconds:0,players:{1:{hp:.5}}}).sys.state));
  const near=[{x:obstacles[12].x+obstacles[12].radius+.3,y:obstacles[12].y}];
  const i0=intermission(defaultTerrain,near,ticks(35)),i1=intermission(defaultTerrain,near,ticks(35),{...knobs,players:{1:{lootValue:3}}});
  assert.equal(JSON.stringify(i1.sys.state),JSON.stringify(i0.sys.state),'island state untouched');
});

// ---------- 7. team damage and boss hp (players[n].damage, players[n].bossHp) ----------
test('damage and bossHp team knobs: JSON validation (> 0), neutral before round 2, not round knobs',()=>{
  assert.ok(!hasTeamDamage(NEUTRAL_CITY_BALANCE)&&!hasTeamBossHp(NEUTRAL_CITY_BALANCE),'NEUTRAL_CITY_BALANCE: neither');
  assert.ok(hasTeamDamage(CITY_BALANCE)&&hasTeamBossHp(CITY_BALANCE),'CITY_BALANCE: both');
  const b=cityBalanceFrom({players:{1:{damage:.5,bossHp:.6},3:{damage:1}}},NEUTRAL_CITY_BALANCE);
  assert.ok(hasTeamDamage(b)&&hasTeamBossHp(b));
  assert.ok(!hasTeamDamage(cityBalanceFrom({players:{3:{damage:1}}},NEUTRAL_CITY_BALANCE)),'damage 1 everywhere: no hook');
  assert.deepEqual(roundKnobs(b,3,1),NEUTRAL_ROUND,'damage/bossHp are not round knobs');
  const plan=(index:number,players:number)=>({index,players});
  assert.equal(teamDamage(b,plan(3,1)),.5);assert.equal(teamDamage(b,plan(ROUND_COUNT,1)),.5);
  assert.equal(teamDamage(b,plan(3,2)),1,'team 2 has no entry');assert.equal(teamDamage(b,plan(3,3)),1);
  assert.equal(teamDamage(b,plan(1,1)),1,'round 1 (the tutorial) and its intermission: neutral');
  assert.equal(teamDamage(b,undefined),1,'before the first wave: neutral');
  assert.equal(teamDamage(b,plan(ROUND_COUNT+1,1)),1);
  assert.equal(teamBossHp(b,1),.6);assert.equal(teamBossHp(b,2),1);assert.equal(teamBossHp(b,undefined),1);
  for(const bad of [{players:{1:{damage:0}}},{players:{1:{damage:-.5}}},{players:{1:{damage:Infinity}}},{players:{1:{damage:'1'}}},
    {players:{1:{bossHp:0}}},{players:{1:{bossHp:-1}}},{players:{1:{bossHp:Number.NaN}}},{players:{1:{bossHp:null}}}])
    assert.throws(()=>cityBalanceFrom(bad),undefined,JSON.stringify(bad));
});

type Source='contact'|'projectile'|'telegraph';
/**
 * One hit of each hostile source on hero 'a' (armor 0, hp 1000) through the real systems (enemy-ai contact of a pombo,
 * the projectile system's hostile shot, the telegraph system), on a world wired by createRunSystems on `terrain` with
 * `heroes` heroes (the others 10 u away) and the director's plan for `round` drawn for them, as a checkpoint restores it
 * (round 0: no plan yet). Returns the hp each source took and the world.
 */
function hostileHits(terrain:SimWorld['terrain'],heroes:number,cityBalance?:CityBalance,round=3){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain,seed:5,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},...(cityBalance?{cityBalance}:{})});
  const s=terrain===city?P.plazaCenter:worldSpawn(terrain);
  for(let i=0;i<heroes;i++){
    const h=hero(i?`h${i}`:'a',{x:s.x+10*i,y:s.y});
    players.set(h.id,{...h,hp:1000,stats:{...h.stats,maxHp:1000}});
  }
  if(round){
    const rng=new Rng(9);
    sys.director.state.plan=planRound(round,heroes,drawTheme(round,rng,[]),rng);
    assert.equal(sys.director.state.plan.players,heroes);
  }
  const a=players.get('a')!,taken={} as Record<Source,number>;
  const hit=(source:Source,step:()=>void,max:number)=>{
    a.hp=1000;
    for(let i=0;i<max&&a.hp===1000;i++){world.tick++;step();}
    taken[source]=1000-a.hp;
  };
  const ai=createEnemyAi({}),pombo=catalogEnemy(world,'pombos',{x:a.x+.4,y:a.y},1);
  hit('contact',()=>{world.enemyIndex.rebuild(world.enemies.values());ai.step(world);},ticks(10));
  world.enemies.delete(pombo.id);
  const shots=createProjectileSystem();
  world.projectiles.set('p-test',{id:'p-test',owner:'env:test',source:'test',x:a.x-1.5,y:a.y,vx:6,vy:0,radius:.2,damage:12,pierce:0,untilTick:world.tick+ticks(3),hostile:true,hit:[]} as ProjectileState);
  hit('projectile',()=>shots.step(world),ticks(3));
  const zones=createTelegraphSystem();
  addTelegraph(world,{shape:'circle',x:a.x,y:a.y,radius:1,damage:20,owner:'env:test'},0);
  hit('telegraph',()=>zones.step(world),MIN_TELEGRAPH_TICKS+2);
  return {taken,world,sys,pomboDamage:pombo.damage};
}

test('damage per team: ×0.5 for 1 player halves contact, projectile and telegraph hits on a solo city hero; 2 heroes, round 1 and the island untouched',()=>{
  const half=cityBalanceFrom({players:{1:{damage:.5}}},NEUTRAL_CITY_BALANCE);
  const solo=hostileHits(city,1,NEUTRAL_CITY_BALANCE);
  assert.deepEqual(solo.taken,{contact:solo.pomboDamage,projectile:12,telegraph:20},'every source hit at its raw damage');
  assert.equal(solo.world.playerDamageScale,undefined,'neutral city knobs: no hook');
  // The default city is CITY_BALANCE: hooked, the same hits as passing it explicitly.
  const byDefault=hostileHits(city,1);
  assert.notEqual(byDefault.world.playerDamageScale,undefined,'default city (CITY_BALANCE): hooked');
  assert.deepEqual(byDefault.taken,hostileHits(city,1,CITY_BALANCE).taken,'default city: CITY_BALANCE');
  const tuned=hostileHits(city,1,half);
  console.log(`[cidade-11] solo city hits ${JSON.stringify(solo.taken)} → ${JSON.stringify(tuned.taken)} (players[1].damage ×0.5)`);
  for(const source of ['contact','projectile','telegraph'] as const)assert.equal(tuned.taken[source],solo.taken[source]*.5,`solo city ${source} ×0.5`);
  // Two heroes (the plan for 2): the same hits as without the knob.
  assert.deepEqual(hostileHits(city,2,half).taken,hostileHits(city,2,NEUTRAL_CITY_BALANCE).taken,'2 heroes: unchanged');
  // Before round 2: round 1's plan (the tutorial; also its intermission, which keeps it) and no plan yet.
  assert.deepEqual(hostileHits(city,1,half,1).taken,solo.taken,'round 1: neutral');
  assert.deepEqual(hostileHits(city,1,half,0).taken,solo.taken,'no plan yet: neutral');
  // The island: no hook, the same hits.
  const island=hostileHits(new TerrainField(3),1),islandTuned=hostileHits(new TerrainField(3),1,half);
  assert.equal(islandTuned.world.playerDamageScale,undefined,'island: no hook');
  assert.deepEqual(islandTuned.taken,island.taken,'island: unchanged');
  assert.deepEqual(island.taken,{contact:island.pomboDamage,projectile:12,telegraph:20});
  // The run's dispose removes its hook (a rematch wires its own).
  tuned.sys.dispose();
  assert.equal(tuned.world.playerDamageScale,undefined,'disposed');
});

test('bossHp per team: × the global bossHp for the plan count at the spawn; only the solo city boss changes',()=>{
  const spawn=(terrain:SimWorld['terrain'],heroes:number,cityBalance?:CityBalance)=>{
    const players=new Map<string,SimPlayer>(),world=new SimWorld({terrain,seed:2,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},...(cityBalance?{cityBalance}:{})});
    const s=terrain===city?P.plazaCenter:worldSpawn(terrain);
    for(let i=0;i<heroes;i++)players.set(`h${i}`,hero(`h${i}`,{x:s.x+8,y:s.y+i}));
    const rng=new Rng(4);
    sys.director.state.plan=planRound(ROUND_COUNT,heroes,drawTheme(ROUND_COUNT,rng,[]),rng);
    const boss=sys.boss.spawnBoss(world,{x:s.x,y:s.y})!;
    assert.equal(sys.boss.tuning.baseHp,BOSS_TUNING.baseHp*(cityBalance&&terrain===city?cityBalance.bossHp:1),'the controller tuning keeps the global knob only');
    return boss.maxHp;
  };
  const team=cityBalanceFrom({players:{1:{bossHp:.6}}},NEUTRAL_CITY_BALANCE),both=cityBalanceFrom({bossHp:1.5,players:{1:{bossHp:.6}}},NEUTRAL_CITY_BALANCE);
  assert.equal(spawn(city,1,team),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*.6}),'solo city: ×0.6');
  assert.equal(spawn(city,1,both),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*1.5*.6}),'solo city: × the global 1.5');
  assert.equal(spawn(city,2,team),spawn(city,2,NEUTRAL_CITY_BALANCE),'2 heroes: unchanged');
  assert.equal(spawn(city,2,both),bossMaxHp(2,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*1.5}),'2 heroes: the global knob only');
  assert.equal(spawn(city,1,NEUTRAL_CITY_BALANCE),bossMaxHp(1),'neutral city boss');
  assert.equal(spawn(city,1),bossMaxHp(1,{...BOSS_TUNING,baseHp:BOSS_TUNING.baseHp*teamBossHp(CITY_BALANCE,1)}),'default city boss: CITY_BALANCE');
  assert.equal(spawn(new TerrainField(3),1,both),bossMaxHp(1),'island ignores both');
  console.log(`[cidade-11] solo city boss hp ${bossMaxHp(1)} → ${spawn(city,1,team)} (players[1].bossHp ×0.6)`);
});

// ---------- 8. CITY_BALANCE, the tuned default ----------
test('CITY_BALANCE: team entries for 1, 3 and 6 players on neutral globals; cityBalanceFrom round-trips it',()=>{
  assert.deepEqual(Object.keys(CITY_BALANCE.players??{}),['1','3','6'],'team entries 1, 3 and 6');
  const {players,roleCap,...globals}=CITY_BALANCE;
  assert.deepEqual(globals,NEUTRAL_CITY_BALANCE,'the global knobs are neutral');
  // balanco-cidade-so-arte: the rats at most half of an art-only round's bodies.
  assert.deepEqual(roleCap,{enxame:.5});
  assert.throws(()=>cityBalanceFrom({roleCap:{rato:.5}}),/not a role/);assert.throws(()=>cityBalanceFrom({roleCap:{enxame:2}}),/0..1/);
  for(const team of [1,3,6])assert.ok(Object.keys(players![team]).length>0,`players[${team}] tunes something`);
  assert.ok(hasTeamLoot(CITY_BALANCE)&&hasTeamDamage(CITY_BALANCE)&&hasTeamBossHp(CITY_BALANCE));
  // Its JSON read back (over the neutral knobs, and over itself) gives CITY_BALANCE again.
  const json=JSON.parse(JSON.stringify(CITY_BALANCE));
  assert.deepEqual(cityBalanceFrom(json,NEUTRAL_CITY_BALANCE),CITY_BALANCE,'over NEUTRAL_CITY_BALANCE');
  assert.deepEqual(cityBalanceFrom(json),CITY_BALANCE,'over the default');
  assert.equal(cityBalanceFrom(undefined),CITY_BALANCE,'no JSON: the default itself');
});
