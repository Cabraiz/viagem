/**
 * Card NEW-20261018-ORQ-bichos-travados (E6's bench, main aace59d, 1 player: ~15 awake critters stuck a run, holding
 * the nests' cap). On the REAL Cidade Nevada, mode 'ninhos' (chaveiro), the three causes and the net:
 *  - an alerta walks its own field to the noise (the planner's flow led it to the plaza, where it turned back and forth
 *    at the edge for good: seed 1's band at (140, 138) with its noise at (138.38, 49.17));
 *  - a body walking through a nest's ring of sleepers gets through (their push stays under its walk);
 *  - the safety net: an awake body that does not move for STUCK_S, with no hero within STUCK_FAR, leaves the world (a
 *    plan body sleeps again; a group's body is gone); near a hero or the car it stays.
 * D-031: sim ticks only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {GOAL_REACH,MODE,STUCK_FAR,STUCK_S} from '../../src/sim/ninhos/sono.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function run(population=1,seed=1):{world:SimWorld;sys:RunSystems}{
  const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos',nestPopulation:population});
  world.step();
  return {world,sys};
}
function addPlayer(world:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
/** An awake body of the run's plan (the sono's), placed at (x, y), in mode alerta toward (gx, gy). */
function alerta(world:SimWorld,sys:RunSystems,x:number,y:number,gx:number,gy:number){
  const sono=sys.sono()!,id=sono.bodies[0].id;
  assert.equal(sono.wakeAround(world,sono.bodies[0].home.x,sono.bodies[0].home.y,.01,'ruido'),1);
  const e=world.enemies.get(id)!;
  // Wake only that one: its band back to sleep is not needed, the test only follows `e`.
  e.x=x;e.y=y;e.readyTick=world.tick;
  Object.assign(e.memory!,{sono:MODE.alerta,gx,gy,seen:world.tick});
  return e;
}

test('alerta: from the plaza\'s edge (seed 1\'s stuck band) it walks the city to its noise 90 u north, instead of standing there',()=>{
  // Card monstros-espalhados: no wave (NEST_PACE.alive 0): the first one walks in down this very avenue, against it.
  const alive=NEST_PACE.alive;NEST_PACE.alive=[0,0];
  try{
    const {world,sys}=run();
    const e=alerta(world,sys,144.16,139.17,138.38,49.17);
    const start={x:e.x,y:e.y};
    let reached=false;
    for(let i=0;i<ticks(120)&&!reached;i++){
      world.step();
      if(!world.enemies.has(e.id))break;
      if(Math.hypot(e.x-138.38,e.y-49.17)<=GOAL_REACH+.5||e.memory?.sono===MODE.cacando)reached=true;
    }
    assert.ok(Math.hypot(e.x-start.x,e.y-start.y)>40,`it walked away from the edge (${Math.hypot(e.x-start.x,e.y-start.y).toFixed(1)} u)`);
    assert.ok(reached,`it reached the noise (at ${e.x.toFixed(1)}, ${e.y.toFixed(1)})`);
    sys.dispose();
  }finally{NEST_PACE.alive=alive;}
});

test('a group body walks through a nest\'s ring of sleepers (×20: the push off them stays under its walk)',()=>{
  const {world,sys}=run(20,3);
  const plan=sys.nests!.plan()!,nest=plan.nests.find(n=>n.size==='G')!;
  // A hero on the far side of the ring; the body starts at the nest's centre and must cross the ring to reach it.
  const ring=Math.max(...nest.sleepers.map(p=>Math.hypot(p.x-nest.x,p.y-nest.y)));
  const out=nest.sleepers.reduce((a,p)=>Math.hypot(p.x-nest.x,p.y-nest.y)>Math.hypot(a.x-nest.x,a.y-nest.y)?p:a);
  const dx=(out.x-nest.x)/ring,dy=(out.y-nest.y)/ring;
  addPlayer(world,'p1',nest.x+dx*(ring+12),nest.y+dy*(ring+12));
  const inner=nest.sleepers.reduce((a,p)=>Math.hypot(p.x-nest.x,p.y-nest.y)<Math.hypot(a.x-nest.x,a.y-nest.y)?p:a);
  const e=createEnemy(world,'estagiario-imortal',{x:inner.x+dx*.6,y:inner.y+dy*.6},1);
  const start=Math.hypot(e.x-nest.x,e.y-nest.y);
  for(let i=0;i<ticks(60);i++){world.step();if(!world.enemies.has(e.id))break;}
  const now=Math.hypot(e.x-nest.x,e.y-nest.y);
  assert.ok(now>ring||!world.enemies.has(e.id),`out of the ring: ${start.toFixed(1)} → ${now.toFixed(1)} u (ring ${ring.toFixed(1)})`);
  sys.dispose();
});

test('the safety net: still for STUCK_S with no hero within STUCK_FAR, a plan body sleeps again and a group body is gone; near a hero or the car both stay',()=>{
  const {world,sys}=run();
  const car=sys.chaveiro!.state.car;
  const sono=sys.sono()!;
  // A plan body awake far from everyone (90 u north of the car), pinned in place.
  const body=alerta(world,sys,car.x,car.y-90,car.x,car.y-90);body.speed=0;
  Object.assign(body.memory!,{sono:MODE.cacando});
  const group=createEnemy(world,'bebado',{x:car.x+60,y:car.y-60},1);group.speed=0;
  const byCar=createEnemy(world,'bebado',{x:car.x+3,y:car.y},1);byCar.speed=0;
  const hero=addPlayer(world,'p1',car.x-60,car.y+60);
  const byHero=createEnemy(world,'bebado',{x:hero.x+STUCK_FAR-5,y:hero.y},1);byHero.speed=0;
  for(let i=0;i<ticks(STUCK_S)-ticks(2);i++)world.step();
  assert.ok(world.enemies.has(body.id)&&world.enemies.has(group.id),'not before STUCK_S');
  for(let i=0;i<ticks(4);i++)world.step();
  assert.equal(world.enemies.has(body.id),false,'the plan body left the world');
  assert.ok(world.sleepers!.has(body.id),'… asleep again');
  assert.equal(sono.state.life[sono.bodies.findIndex(b=>b.id===body.id)][0],1);
  assert.equal(world.enemies.has(group.id),false,'the group body is gone');
  assert.ok(world.enemies.has(byCar.id),'by the car: kept');
  assert.ok(world.enemies.has(byHero.id),'by a hero: kept');
  sys.dispose();
});
