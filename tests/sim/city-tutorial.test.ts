/**
 * cidade-08 (início no helicóptero): the city's round 1 is the guided walk from the crashed "Helicóptero da Firma"
 * (asset `inicio`, where the heroes spawn) to the plaza (src/sim/city/tutorial.ts, DirectorOptions.cityTutorial).
 *  1. ACCEPTANCE: real Simulation on the real Cidade Nevada, one novice per seed (5 seeds) and one run with three. The
 *     novice steers by FlowField(cityFlowGrid(city),[praca]).directionAt with imperfections: 4 s standing still at the
 *     start (reading the screen), ±25° jitter redrawn every 0.5 s, random 1–3 s pauses, and a 1.5–3 s stop to pick
 *     each offer when it appears. ≥ 4 of 5 reach the plaza (cityPlanner(city).insideBase) without any `downed` event in
 *     round 1; arrival times and falls are logged. Round 1 critters never appear on the road ahead of the team.
 *  2. The `round` events of round 1 carry CIDADE_TUTORIAL's name and line; the intro and arrival `say` lines are emitted
 *     once each, from the tables, by a hero; the wave ends only after a hero reached the plaza.
 *  3. Island and endless untouched: the director with cityTutorial on gives the digests recorded before cidade-05
 *     (city-director.test.ts BASELINE), and assembled island/endless runs are identical with the option on or off.
 *  4. The opt-out (RunSystemsOptions.cityTutorial false) plays the round table's round 1, as the older city tests use.
 *  5. The tutorial state is JSON-safe: a checkpoint mid-walk replays the same spawns, lines and round end.
 * D-031: results only (positions, events, ticks); no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {SPAWN,walkable,worldSpawn,type Point} from '../../src/maps/world.ts';
import {FlowField,STRAIGHT_COST,UNREACHABLE} from '../../src/maps/flowfield.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type RoundState,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createDirector,type DirectorOptions,type RoundSummary} from '../../src/sim/director.ts';
import {MOUTHS,type Mouth} from '../../src/sim/city/avenues.ts';
import {cityFlowGrid,cityPlanner} from '../../src/sim/city/grid.ts';
import {TUTORIAL_PLAN} from '../../src/sim/city/tutorial.ts';
import {CIDADE_TUTORIAL,CIDADE_TUTORIAL_SAY,CIDADE_VEHICLE} from '../../src/rules/zueira-cidade.ts';
import {ROUNDS,ROUND_NAMES,countMult} from '../../src/rules/waves.ts';
import {SCALE_PROFILES,enemySpeed} from '../../src/rules/scale.ts';
import {BOSS_TUNING} from '../../src/sim/boss.ts';

// ---------- The real city ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,POINTS=city.asset.points;
/** The judge: an independent planner on the real city ("in the plaza" = insideBase) and the novice's route field. */
const JUDGE=cityPlanner(city);
const ROUTE=new FlowField(cityFlowGrid(city),[POINTS.praca]);
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;
const fmt=(p:Point)=>`(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
/** Path distance (u) from p to the plaza on the judge's plaza field. */
const toPlaza=(p:Point)=>{const c=JUDGE.plazaField.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*JUDGE.plazaField.cellSize;};
/** The plaza mouth nearest to p (the avenue a body is on, near the plaza). */
const mouthOf=(p:Point):Mouth=>MOUTHS.reduce((a,b)=>Math.hypot(POINTS.bocas[b].x-p.x,POINTS.bocas[b].y-p.y)<Math.hypot(POINTS.bocas[a].x-p.x,POINTS.bocas[a].y-p.y)?b:a);

// ---------- The novice ----------
const READ_SECONDS=4,JITTER=25*Math.PI/180,JITTER_EVERY=ticks(.5),PAUSE_CHANCE=.1,PAUSE=[1,3] as const,OFFER_READ=[1.5,3] as const;
interface Novice {id:string;r:Rng;jitter:number;pauseUntil:number;offerAt?:number;arrived?:number;downed:number;minHp:number;hits:number;pauses:number;offers:number}
const dir={x:0,y:0};
/** One tick of a novice's thumb (bot input): read, pick offers, pause, follow the route with a shaky thumb. */
function drive(sim:Simulation,n:Novice){
  const p=sim.players.get(n.id)!,t=sim.tick,stand=()=>sim.setBotInput(n.id,{x:0,y:0});
  const offer=sim.offers(n.id)[0];
  if(offer){
    n.offerAt??=t+ticks(n.r.range(OFFER_READ[0],OFFER_READ[1]));
    if(t<n.offerAt){stand();return;}
    sim.choose(n.id,offer.id,n.r.int(0,offer.choices.length-1));n.offerAt=undefined;n.offers++;
  }
  if(t<ticks(READ_SECONDS)||p.downed){stand();return;}
  if(t%SIM_HZ===0&&t>=n.pauseUntil&&n.r.chance(PAUSE_CHANCE)){n.pauseUntil=t+ticks(n.r.range(PAUSE[0],PAUSE[1]));if(n.arrived===undefined)n.pauses++;}
  if(t<n.pauseUntil){stand();return;}
  if(t%JITTER_EVERY===0)n.jitter=n.r.range(-JITTER,JITTER);
  ROUTE.directionAt(p.x,p.y,dir);
  if(!dir.x&&!dir.y){stand();return;}
  const c=Math.cos(n.jitter),s=Math.sin(n.jitter);
  sim.setBotInput(n.id,{x:dir.x*c-dir.y*s,y:dir.x*s+dir.y*c});
}
interface Spawned {id:string;tick:number;x:number;y:number;behind:boolean;mouth:Mouth;killed?:number;killedAt?:Point}
interface RunResult {
  novices:Novice[];events:{tick:number;e:SimEvent}[];spawns:Spawned[];
  waveTick:number;endTick:number;timedOut:boolean;plan:{total:number}|undefined;arrived?:string;arrivedTick?:number;
}
const CLASSES=['cidadao-comum','clt-cansado','feirante'];
/** A real Simulation of the city with `count` novice bots, until round 1 ended (or `seconds`). */
function walk(seed:number,count:number,seconds=150):RunResult{
  const sim=new Simulation(seed,{world:'cidade',terrain:city});
  const novices:Novice[]=Array.from({length:count},(_,i)=>{
    const id=`novato${i}`;sim.addBot(id,id,CLASSES[i%CLASSES.length]);
    return {id,r:new Rng(seed*7919+i*104729+1),jitter:0,pauseUntil:0,downed:0,minHp:Infinity,hits:0,pauses:0,offers:0};
  });
  sim.resetRun();
  const director=sim.run.director,events:{tick:number;e:SimEvent}[]=[],spawns:Spawned[]=[],seen=new Set<string>();
  let waveTick=-1,endTick=-1;
  for(let i=0;i<ticks(seconds)&&endTick<0;i++){
    for(const n of novices)drive(sim,n);
    for(const e of sim.step()){
      events.push({tick:sim.tick,e});
      if(e.type==='round'&&e.index===1&&e.phase==='wave')waveTick=sim.tick;
      if(e.type==='round'&&e.index===1&&e.phase==='end')endTick=sim.tick;
      if(e.type==='downed'&&sim.world.round.index===1){const n=novices.find(x=>x.id===e.player);if(n)n.downed++;}
      if(e.type==='damage'){const n=novices.find(x=>x.id===e.target);if(n)n.hits++;}
      if(e.type==='kill'){const s=spawns.find(x=>x.id===e.enemy);if(s){s.killed=sim.tick;s.killedAt={x:e.x,y:e.y};}}
    }
    for(const e of sim.world.enemies.values()){
      if(seen.has(e.id)||e.memory?.round!==1)continue;
      seen.add(e.id);
      const walking=novices.filter(n=>n.arrived===undefined).map(n=>sim.players.get(n.id)!);
      spawns.push({id:e.id,tick:sim.tick,x:e.x,y:e.y,mouth:mouthOf(e),behind:walking.every(p=>toPlaza(e)>toPlaza(p))});
    }
    for(const n of novices){
      const p=sim.players.get(n.id)!;n.minHp=Math.min(n.minHp,p.hp);
      if(n.arrived===undefined&&!p.downed&&JUDGE.insideBase(p))n.arrived=sim.tick;
    }
  }
  const s=director.state;
  return {novices,events,spawns,waveTick,endTick,timedOut:s.timedOut&&endTick>=0,plan:s.plan&&{total:s.plan.total},arrived:s.tutorial?.arrived,arrivedTick:s.tutorial?.arrivedTick};
}
/** Round-1 checks shared by every acceptance run (results only). */
function checkRound1(seed:number,r:RunResult){
  const at=`seed ${seed}`;
  const round1=r.events.filter(x=>x.e.type==='round'&&x.e.index===1).map(x=>x.e as Extract<SimEvent,{type:'round'}>);
  assert.deepEqual(round1.map(e=>e.phase),['prepare','wave','end'].slice(0,round1.length),`${at}: round 1 phases`);
  for(const e of round1){
    assert.equal(e.name,CIDADE_TUTORIAL.roundName,`${at}: round 1 ${e.phase} carries the tutorial name`);
    assert.equal(e.modifier,CIDADE_TUTORIAL.modifier,`${at}: round 1 ${e.phase} carries the tutorial line`);
  }
  const ids=new Set(r.novices.map(n=>n.id));
  const says=r.events.filter(x=>x.e.type==='say').map(x=>({tick:x.tick,...(x.e as Extract<SimEvent,{type:'say'}>)}));
  const intro=says.filter(s=>s.key===CIDADE_TUTORIAL_SAY.intro),arrival=says.filter(s=>s.key===CIDADE_TUTORIAL_SAY.arrival);
  assert.equal(intro.length,1,`${at}: one intro line`);
  assert.ok(ids.has(intro[0].source)&&CIDADE_VEHICLE.intro.includes(intro[0].line),`${at}: intro "${intro[0].line}" by ${intro[0].source}`);
  assert.ok(intro[0].tick<=2,`${at}: the intro comes right after the crash (tick ${intro[0].tick})`);
  assert.ok(arrival.length<=1,`${at}: at most one arrival line`);
  if(arrival.length){
    const a=arrival[0],n=r.novices.find(x=>x.id===a.source);
    assert.ok(n&&CIDADE_TUTORIAL.arrival.includes(a.line),`${at}: arrival "${a.line}" by ${a.source}`);
    assert.equal(a.tick,Math.min(...r.novices.map(x=>x.arrived??Infinity)),`${at}: the arrival line comes when the first hero enters the plaza`);
  }
  // The wave ends only once a hero reached the plaza (or at the cap).
  if(r.endTick>=0&&!r.timedOut){
    assert.ok(arrival.length===1&&arrival[0].tick<=r.endTick,`${at}: round 1 ended at ${secs(r.endTick)} before anyone reached the plaza`);
  }
  assert.ok(r.endTick<0||r.endTick-r.waveTick<=ticks(TUTORIAL_PLAN.capSeconds)+1,`${at}: round 1 within its cap`);
  // A few weak critters, never on the road ahead of the team: behind every walking hero, or on another avenue.
  const n=r.novices.length,want=Math.round(TUTORIAL_PLAN.behind*countMult(n))+Math.round(TUTORIAL_PLAN.welcome*countMult(n));
  assert.equal(r.plan?.total,want,`${at}: ${want} critters planned for ${n} player(s)`);
  if(n===1)assert.ok(want<10,'single digits for one player');
  for(const s of r.spawns){
    assert.ok(s.tick-r.waveTick>=ticks(TUTORIAL_PLAN.behindAt),`${at}: ${s.id} at ${secs(s.tick-r.waveTick)} into the wave: too early`);
    assert.ok(s.behind||s.mouth!=='S',`${at}: ${s.id} born at ${fmt(s)} ahead of the team on the S road (${secs(s.tick-r.waveTick)})`);
  }
}

test('ACCEPTANCE: one novice per seed (5 seeds) walks from the wreck to the plaza; ≥ 4 of 5 arrive with no fall in round 1',()=>{
  const report:string[]=[];let ok=0;
  for(let seed=1;seed<=5;seed++){
    const r=walk(seed,1),[n]=r.novices;
    checkRound1(seed,r);
    const good=n.arrived!==undefined&&n.downed===0;
    if(good)ok++;
    report.push(`seed ${seed}: ${n.arrived===undefined?'never arrived':`plaza at ${secs(n.arrived)}`}, falls ${n.downed}, hits ${n.hits}, min hp ${Math.round(n.minHp)}, ${n.pauses} pauses, ${n.offers} offers; `
      +`round 1 ${r.endTick<0?'still on':`ended ${secs(r.endTick)}${r.timedOut?' (cap)':''}`}; critters ${r.spawns.map(s=>`${secs(s.tick)} ${s.behind?"behind":s.mouth} ${fmt(s)}${s.killed===undefined?"":` †${secs(s.killed)} ${fmt(s.killedAt!)}`}`).join(", ")}`);
  }
  console.log(`[cidade-08] novice walk, 1 player, ${ok}/5 reached the plaza without a fall:\n  ${report.join('\n  ')}`);
  assert.ok(ok>=4,`${ok}/5 novices reached the plaza without falling`);
});

test('ACCEPTANCE: three novices (seed 11) all reach the plaza with no fall in round 1; critters scale with the team',()=>{
  const r=walk(11,3);
  checkRound1(11,r);
  const line=r.novices.map(n=>`${n.id} ${n.arrived===undefined?'never':secs(n.arrived)} falls ${n.downed} min hp ${Math.round(n.minHp)}`).join('; ');
  console.log(`[cidade-08] three novices: ${line}; round 1 ended ${r.endTick<0?'-':secs(r.endTick)}; ${r.spawns.length} critters`);
  for(const n of r.novices){
    assert.ok(n.arrived!==undefined,`${n.id} reached the plaza`);
    assert.equal(n.downed,0,`${n.id} never fell in round 1`);
  }
  assert.ok(r.endTick>=0,'round 1 ended');
});

test('the same seed gives the same tutorial (determinism: events and arrival)',()=>{
  const a=walk(3,1,60),b=walk(3,1,60);
  assert.deepEqual(b.events,a.events);
  assert.equal(b.novices[0].arrived,a.novices[0].arrived);
});

// ---------- Opt-out: the round table's round 1 (what the older city tests read) ----------
type RunPlayer=SimPlayer&{ack:number;score:number};
function assembled(terrain:SimWorld['terrain'],seed:number,cityTutorial?:boolean){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},...(cityTutorial===undefined?{}:{cityTutorial})});
  const add=(id:string,p:Point)=>{
    const player:RunPlayer={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
      stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0};
    players.set(id,player);
  };
  return {world,sys,players,add};
}
test('opt-out: cityTutorial false plays the round table\'s round 1 in the city (the older round-1 tests); default is the tutorial',()=>{
  for(const flag of [false,undefined,true]){
    const rig=assembled(city,4,flag);rig.add('a',POINTS.inicio);
    const rounds:Extract<SimEvent,{type:'round'}>[]=[];
    for(let i=0;i<ticks(5);i++)for(const e of rig.world.step())if(e.type==='round')rounds.push(e);
    const s=rig.sys.director.state,tutorial=flag!==false;
    assert.equal(s.stage,'wave',`${flag}: the wave started`);
    assert.equal(rounds[0].name===CIDADE_TUTORIAL.roundName,tutorial,`${flag}: round 1 name "${rounds[0].name}"`);
    assert.equal(s.tutorial!==undefined,tutorial,`${flag}: tutorial state`);
    if(tutorial)assert.equal(s.plan!.total,TUTORIAL_PLAN.behind+TUTORIAL_PLAN.welcome);
    else{
      assert.ok(ROUND_NAMES.includes(rounds[0].name!),'the drawn round name');
      assert.equal(s.plan!.total,ROUNDS[0].budget,'the table\'s round 1 budget for one player');
    }
  }
});

// ---------- Island and endless untouched ----------
/** Copy of city-director.test.ts's fake context (director-level runs). */
type FakeCtx=SimContext&{tick:number;ids:number;events:SimEvent[];sentAt:number[];round:RoundState;players:Map<string,SimPlayer>};
function fakeCtx(seed:number,terrain:SimContext['terrain']):FakeCtx{
  const round:RoundState={index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0};
  const ctx:FakeCtx={
    tick:0,runStartTick:0,ids:0,terrain,rng:new Rng(seed),events:[],sentAt:[],
    players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:5},offers:new Map(),round,
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
interface Log {created:{id:string;tick:number;round:number;kind:string;x:number;y:number;scale:number}[];bosses:{id:string;tick:number;x:number;y:number}[];ends:RoundSummary[]}
const newLog=():Log=>({created:[],bosses:[],ends:[]});
function options(log:Log,extra:Partial<DirectorOptions>={}):DirectorOptions{
  return {
    createEnemy(ctx,kind,point,scale){
      const e:EnemyState={id:ctx.nextId('e'),kind,x:point.x,y:point.y,hp:10*scale,maxHp:10*scale,speed:enemySpeed(SCALE_PROFILES['cidade-nevada']),damage:5,radius:.32,xp:1,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);log.created.push({id:e.id,tick:ctx.tick,round:ctx.round.index,kind,x:point.x,y:point.y,scale});return e;
    },
    spawnBoss(ctx,point){
      const e:EnemyState={id:ctx.nextId('boss'),kind:'chefe',boss:true,x:point.x,y:point.y,hp:500,maxHp:500,speed:BOSS_TUNING.speed,damage:10,radius:BOSS_TUNING.radius,xp:50,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);log.bosses.push({id:e.id,tick:ctx.tick,x:point.x,y:point.y});return e;
    },
    onRoundEnd:(_ctx,r)=>{log.ends.push(r);},
    ...extra,
  };
}
function run(ctx:FakeCtx,director:{step(ctx:SimContext):void},maxTicks:number,after?:(ctx:FakeCtx)=>void,stop?:()=>boolean){
  for(let i=0;i<maxTicks;i++){ctx.tick++;director.step(ctx);after?.(ctx);if(stop?.())break;}
}
/** city-director.test.ts islandDigest with cityTutorial on (and a planner passed in, as assemble never does there). */
function islandDigest(world:'ilha'|'infinito',seed:number,kill:number){
  const terrain=world==='ilha'?new TerrainField(3):new TerrainField(3,{world:'infinito'});
  const ctx=fakeCtx(seed,terrain),log=newLog();
  addPlayer(ctx,'a',SPAWN);addPlayer(ctx,'b',{x:SPAWN.x+3,y:SPAWN.y-2});
  const director=createDirector(options(log,{rounds:10,siegeShare:.25,siegeFromRound:2,cityTutorial:true,...(seed===0?{avenues:JUDGE}:{})}));
  run(ctx,director,ticks(kill===Infinity?400:1500),c=>{
    for(const e of [...c.enemies.values()]){
      if(c.tick-e.spawnTick>=kill)c.damageEnemy(e.id,1e9);
      else if(e.memory?.retreat!==1){e.x+=(SPAWN.x-e.x)*.002;e.y+=(SPAWN.y-e.y)*.002;}
    }
    const p=c.players.get('b')!;p.x=SPAWN.x+3+Math.sin(c.tick/200)*6;p.y=SPAWN.y-2+Math.cos(c.tick/170)*4;
  },()=>director.state.stage==='done');
  assert.equal(director.state.tutorial,undefined,`${world}: no tutorial state`);
  const json=JSON.stringify({events:ctx.events,sentAt:ctx.sentAt,created:log.created,ends:log.ends,state:director.state,round:ctx.round});
  return createHash('sha256').update(json).digest('hex').slice(0,16);
}
/** city-director.test.ts BASELINE (recorded before cidade-05). */
const BASELINE:Readonly<Record<string,string>>={
  'ilha kill=40 seed 0':'d98b496235de6e81','ilha kill=40 seed 1':'7ae1e2388b5d42c3',
  'ilha kill=Infinity seed 0':'6b50e7fb7d8c36ee',
  'infinito kill=40 seed 0':'2dba07886dacfe7a','infinito kill=40 seed 1':'93c150d8da968569',
  'infinito kill=Infinity seed 0':'b2b533356079e5ed',
};
test('island and endless untouched: the director with cityTutorial on matches the pre-cidade-05 digests',()=>{
  const got:Record<string,string>={};
  for(const world of ['ilha','infinito'] as const)for(const [kill,seed] of [[ticks(2),0],[ticks(2),1],[Infinity,0]])got[`${world} kill=${kill} seed ${seed}`]=islandDigest(world,seed,kill);
  assert.deepEqual(got,BASELINE);
});
test('island and endless untouched: assembled runs are identical with RunSystemsOptions.cityTutorial on and off',()=>{
  for(const world of ['ilha','infinito'] as const){
    const terrain=world==='ilha'?new TerrainField(3):new TerrainField(3,{world:'infinito'});
    const trace=(flag:boolean)=>{
      const rig=assembled(terrain,6,flag),s=worldSpawn(terrain);rig.add('a',s);rig.add('b',{x:s.x+2,y:s.y+1});
      const events:SimEvent[]=[];
      for(let i=0;i<ticks(60);i++)events.push(...rig.world.step());
      return JSON.stringify({events,state:rig.sys.state(),world:rig.world.state()});
    };
    const on=trace(true),off=trace(false);
    assert.ok(on.includes('"type":"round"'),`${world}: rounds ran`);
    assert.equal(createHash('sha256').update(on).digest('hex'),createHash('sha256').update(off).digest('hex'),`${world}: identical`);
  }
});

// ---------- Checkpoint ----------
/** Director-level city run with the tutorial: heroes walk the route at the hero speed, bodies die 3 s after spawning. */
function tutorialCtx(seed:number){
  const ctx=fakeCtx(seed,city),log=newLog();
  addPlayer(ctx,'a',POINTS.inicio);addPlayer(ctx,'b',{x:POINTS.inicio.x-.6,y:POINTS.inicio.y});
  return {ctx,log};
}
const step=(c:FakeCtx)=>{
  for(const e of [...c.enemies.values()])if(c.tick-e.spawnTick>=ticks(3))c.damageEnemy(e.id,1e9);
  if(c.tick<ticks(READ_SECONDS))return;
  for(const p of c.players.values()){ROUTE.directionAt(p.x,p.y,dir);const v=1.99/SIM_HZ*.8;if(walkable({x:p.x+dir.x*v,y:p.y+dir.y*v},city)){p.x+=dir.x*v;p.y+=dir.y*v;}}
};
test('checkpoint: DirectorState with the tutorial survives a JSON round-trip mid-walk and after the arrival; the copy replays the same',()=>{
  for(const at of [ticks(12),ticks(60)]){
    const a=tutorialCtx(5),da=createDirector(options(a.log,{rounds:2,avenues:cityPlanner(city),cityTutorial:true}));
    run(a.ctx,da,at,step);
    assert.ok(da.state.tutorial,`tick ${at}: tutorial state present`);
    const copy=JSON.parse(JSON.stringify(da.state));
    assert.deepEqual(copy.tutorial,da.state.tutorial,'tutorial state is JSON-safe');
    const b=tutorialCtx(5);
    b.ctx.tick=a.ctx.tick;b.ctx.ids=a.ctx.ids;(b.ctx as {rng:Rng}).rng=new Rng(999);
    for(const [id,p] of a.ctx.players)b.ctx.players.set(id,structuredClone(p));
    for(const e of a.ctx.enemies.values())b.ctx.enemies.set(e.id,structuredClone(e));
    const restored=createDirector(options(b.log,{rounds:2,avenues:cityPlanner(city),cityTutorial:true}),copy);
    const events=a.ctx.events.length,created=a.log.created.length;
    run(a.ctx,da,ticks(150),step);run(b.ctx,restored,ticks(150),step);
    assert.ok(a.log.ends.length>=1,`tick ${at}: round 1 ended`);
    assert.deepEqual(b.log.created,a.log.created.slice(created),'identical spawns');
    assert.deepEqual(b.ctx.events,a.ctx.events.slice(events),'identical events');
    assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(da.state)));
  }
});

