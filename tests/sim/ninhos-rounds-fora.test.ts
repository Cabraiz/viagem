/**
 * D-051 mode 'ninhos' without rounds (card NEW-20261014-ORQ-ninhos-rounds-fora, the sim and the bots; rules/calma.ts
 * CALMA, sim/ninhos/calma.ts) on the REAL Cidade Nevada:
 *  - the calm rule (pure) and the bots' own round (bot-brain calmRound);
 *  - an assembled run in mode 'ninhos': the forge and the towers' orders refuse 'phase' with a critter awake within
 *    CALMA.forgeR and open without one (the rounds mode keeps the intermission), the crates refill on the clock, the
 *    boss enrages CALMA.bossEnrageS after it arrives (not at once), the zueira fires on the clock;
 *  - the Simulation's calm checkpoint (calmCheckpointDue).
 * D-031: sim ticks only, no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import type {Point} from '../../src/maps/world.ts';
import {BASE_STATS,ticks,type EnemyState,type RunView,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {CALM_WINDOW_S,calmRound} from '../../src/sim/bot-brain.ts';
import {CALMA,calmAround} from '../../src/rules/calma.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PLAZA=city.asset.points.praca;

function addPlayer(world:SimWorld,id:string,p:Point){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}
interface Run {world:SimWorld;sys:RunSystems}
function run(mode:'ninhos'|'rounds',seed=11):Run{
  const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode});
  return {world,sys};
}
/** A critter awake at `at` (in ctx.enemies and the index, as after a step). */
function awake(world:SimWorld,at:Point,id='e-near'){
  const e=createEnemy(world,'bebado',at,1);e.id=id;world.enemies.set(id,e);world.enemyIndex.rebuild(world.enemies.values());return e;
}

// ---------- The rule ----------
test('calm: no critter alive and awake within r (inclusive); a sleeper or a dead one does not count',()=>{
  const at={x:0,y:0};
  assert.equal(calmAround([],at,12),true);
  assert.equal(calmAround([{x:12,y:0,hp:5}],at,12),false,'r inclusive');
  assert.equal(calmAround([{x:12.01,y:0,hp:5}],at,12),true);
  assert.equal(calmAround([{x:1,y:0,hp:5,asleep:true}],at,12),true,'asleep');
  assert.equal(calmAround([{x:1,y:0,hp:0}],at,12),true,'dead');
  assert.deepEqual([CALMA.forgeR,CALMA.botR,CALMA.checkpointR,CALMA.checkpointEveryS,CALMA.refillS,CALMA.bossEnrageS],[12,15,20,90,60,90]);
});

test('bots: the own round of a bot in the nests is a prepare of CALM_WINDOW_S when calm (botR), else a wave that never times out',()=>{
  const base={tick:1000,round:{index:1,total:1,phase:'wave',phaseEndsTick:1000,remaining:3},enemies:[] as RunView['enemies']} as unknown as RunView;
  const calm=calmRound(base,{x:0,y:0});
  assert.equal(calm.round!.phase,'prepare');assert.equal(calm.round!.phaseEndsTick,1000+ticks(CALM_WINDOW_S));
  const near={...base,enemies:[{id:'e',kind:'bebado',x:CALMA.botR-1,y:0,hp:5,maxHp:5}]} as unknown as RunView;
  const fight=calmRound(near,{x:0,y:0});
  assert.equal(fight.round!.phase,'wave');assert.ok(fight.round!.phaseEndsTick>1000+ticks(600),'no retreat clock');
  const sleeper={...base,enemies:[{id:'e',kind:'bebado',x:1,y:0,hp:5,maxHp:5,asleep:true}]} as unknown as RunView;
  assert.equal(calmRound(sleeper,{x:0,y:0}).round!.phase,'prepare','a sleeper does not break the calm');
  assert.equal(base.round!.phase,'wave','the view is not touched');
});

// ---------- In a run ----------
test('forge and towers in the nests: refused (phase) with a critter awake within 12 u of who asks, open without one; the rounds mode keeps the intermission',()=>{
  const r=run('ninhos');
  r.world.step();
  const wall=r.sys.stonewards.state.wall,p=addPlayer(r.world,'p1',{x:wall.x+1,y:wall.y});
  assert.equal(r.world.round.phase,'wave','one open wave in the nests');
  const why=(x:{ok:boolean;reason?:string})=>x.ok?'ok':x.reason;
  const forge=()=>why(r.sys.stonewards.buy(r.world,'p1','reparo') as {ok:boolean;reason?:string});
  const repair=()=>why(r.sys.stonewards.repair(r.world,'p1','nope') as {ok:boolean;reason?:string});
  assert.notEqual(forge(),'phase','calm: the forge opens');
  assert.equal(repair(),'defense','calm: the order gets past the gate');
  const e=awake(r.world,{x:p.x+CALMA.forgeR-1,y:p.y});
  assert.equal(forge(),'phase');
  assert.equal(repair(),'phase');
  e.x=p.x+CALMA.forgeR+1;r.world.enemyIndex.rebuild(r.world.enemies.values());
  assert.notEqual(forge(),'phase','out of reach: open again');
  // The rounds mode: the same critter-free forge is refused in the wave ('phase'), as before.
  const q=run('rounds');
  for(let i=0;i<ticks(120)&&q.world.round.phase!=='wave';i++)q.world.step();
  assert.equal(q.world.round.phase,'wave');
  const w2=q.sys.stonewards.state.wall;addPlayer(q.world,'p1',{x:w2.x+1,y:w2.y});
  assert.equal((q.sys.stonewards.buy(q.world,'p1','reparo') as {reason:string}).reason,'phase');
  r.sys.dispose();q.sys.dispose();
});

test('crates in the nests: the nodes refill every 60 s on the clock (no intermission)',()=>{
  const r=run('ninhos'),st=r.sys.stonewards.state;
  r.world.step();
  const first=st.refilledTick;
  assert.equal(first,r.world.tick,'refilled at the first step');
  for(let i=0;i<ticks(CALMA.refillS)-1;i++)r.world.step();
  assert.equal(st.refilledTick,first);
  r.world.step();
  assert.equal(st.refilledTick,first!+ticks(CALMA.refillS),'again 60 s later');
  r.sys.dispose();
});

test('boss in the nests: it enrages 90 s after it arrives, not at once (the wave clock is always "over" there)',()=>{
  const r=run('ninhos');
  r.world.step();
  r.sys.boss.spawnBoss(r.world,{x:PLAZA.x+30,y:PLAZA.y});
  const id=r.sys.boss.state.bossId!;
  const phase=()=>r.world.enemies.get(id)?.phase;
  r.world.step();
  const born=r.world.enemies.get(id)!.spawnTick;
  assert.notEqual(phase(),3,'not enraged on arrival');
  while(r.world.tick<born+ticks(CALMA.bossEnrageS)-1){r.world.step();if(!r.world.enemies.has(id))break;}
  assert.ok(r.world.enemies.has(id));
  assert.notEqual(phase(),3,'not before 90 s');
  r.world.step();r.world.step();
  assert.equal(phase(),3,'enraged at 90 s');
  r.sys.dispose();
});

test('zueira in the nests: on the clock, the first after 60 s, then 100–140 s apart, at most 4; none in the rounds mode\'s round 1',()=>{
  const r=run('ninhos',5);addPlayer(r.world,'p1',PLAZA);
  const fired:number[]=[];
  for(let i=0;i<ticks(12*60);i++){for(const e of r.world.step())if(e.type==='happening')fired.push(r.world.tick);}
  assert.ok(fired.length>=3&&fired.length<=CALMA.zueiraMax,`${fired.length} events`);
  assert.ok(fired[0]>=ticks(CALMA.zueiraFirstS),`the first at ${fired[0]}`);
  for(let i=1;i<fired.length;i++){
    const gap=fired[i]-fired[i-1];
    assert.ok(gap>=ticks(CALMA.zueiraEveryS[0])&&gap<=ticks(CALMA.zueiraEveryS[1])+ticks(16),`gap ${gap}`);
  }
  r.sys.dispose();
});

// ---------- The room's calm checkpoint ----------
test('calm checkpoint: every 90 s of calm with no boss, right after a nest falls, never with a critter awake within 20 u of a standing hero, never in the rounds mode',()=>{
  // Seed 1 (was 7) since the viaduct (mapa-175-com-viaduto): with the hero on the deck at the start, seed 7 sends a
  // critter along the street under it, 19 u away, on the tick the second checkpoint was due.
  const sim=new Simulation(1,{world:'cidade',terrain:city,objective:'chaveiro',mode:'ninhos'});
  sim.add('p1','Ana','cidadao-comum');
  const due:number[]=[];
  const step=(n:number)=>{for(let i=0;i<n;i++){sim.world.step();if(sim.calmCheckpointDue())due.push(sim.world.tick);}};
  // Keep the hero clear of every critter the run sends (a calm run).
  const clear=()=>{sim.world.enemies.clear();sim.world.enemyIndex.rebuild([]);};
  for(let i=0;i<ticks(200);i++){clear();step(1);}
  assert.equal(due.length,2,`every 90 s: ${due}`);
  assert.equal(due[1]-due[0],ticks(CALMA.checkpointEveryS));
  // A critter awake by the hero: the 90 s pass and nothing.
  const p=sim.players.get('p1')!;
  due.length=0;
  for(let i=0;i<ticks(100);i++){clear();const e=awake(sim.world,{x:p.x+CALMA.checkpointR-2,y:p.y});void e;step(1);}
  assert.deepEqual(due,[],'not with a critter near');
  clear();step(1);
  assert.equal(due.length,1,'the calm is back: due at once (past 90 s)');
  // A nest falls: due right away.
  due.length=0;
  const nest=sim.run.nests!.state.nests.find(n=>!n.down)!;
  nest.down=true;
  step(1);
  assert.equal(due.length,1,'after a fallen nest');
  // The rounds mode: never.
  const rounds=new Simulation(7,{world:'cidade',terrain:city,objective:'chaveiro'});
  rounds.add('p1','Ana','cidadao-comum');
  for(let i=0;i<ticks(200);i++){rounds.world.step();assert.equal(rounds.calmCheckpointDue(),false);}
});
