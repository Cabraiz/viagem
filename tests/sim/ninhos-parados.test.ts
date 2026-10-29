/**
 * Card NEW-20261028-ORQ-bot-parceiro-e-bichos-parados, item 2 (the quick net, sono.ts STILL_S): on the REAL Cidade
 * Nevada, mode 'ninhos' (chaveiro), an awake body still for STILL_S with its nearest hero past STILL_NEAR (and within
 * STUCK_FAR) is pushed sideways; a plan body pushed more than STILL_SLEEP times sleeps again; a group body keeps being
 * pushed; one by a hero is left alone. D-031: sim ticks only.
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
import {MODE,STILL_NEAR,STILL_S,STILL_SLEEP,STUCK_FAR,STUCK_MOVE} from '../../src/sim/ninhos/sono.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
NEST_PACE.minerva=0;

function run(seed=1):{world:SimWorld;sys:RunSystems}{
  const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos',nestPopulation:1});
  world.step();
  return {world,sys};
}
function addPlayer(world:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}

test('the quick net: still STILL_S with its hero out of reach, a plan body is pushed, then sleeps again; a group body is pushed; one by the hero is not',()=>{
  const alive=NEST_PACE.alive;NEST_PACE.alive=[0,0];
  try{
    const {world,sys}=run();
    const car=sys.chaveiro!.state.car,sono=sys.sono()!;
    // A hero 40 u off the car (out of its kept reach), pinned bodies around it: none can walk (speed 0).
    const hero=addPlayer(world,'p1',car.x,car.y-40);
    assert.equal(sono.wakeAround(world,sono.bodies[0].home.x,sono.bodies[0].home.y,.01,'ruido'),1);
    const body=world.enemies.get(sono.bodies[0].id)!;
    body.x=hero.x+12;body.y=hero.y;body.readyTick=world.tick;body.speed=0;
    Object.assign(body.memory!,{sono:MODE.cacando,seen:world.tick});
    const group=createEnemy(world,'bebado',{x:hero.x-12,y:hero.y},1);group.speed=0;
    const close=createEnemy(world,'bebado',{x:hero.x,y:hero.y+STILL_NEAR-.5},1);close.speed=0;
    assert.ok(12<STUCK_FAR);
    const start={x:body.x,y:body.y},closeAt={x:close.x,y:close.y};
    for(let i=0;i<ticks(STILL_S)-ticks(1);i++)world.step();
    assert.equal(body.memory?.qn,undefined,'not before STILL_S');
    for(let i=0;i<ticks(3);i++)world.step();
    assert.equal(body.memory?.qn,1,'pushed once');
    assert.ok(Math.hypot(body.x-start.x,body.y-start.y)>=STUCK_MOVE,`moved by the push (${Math.hypot(body.x-start.x,body.y-start.y).toFixed(2)} u)`);
    for(let i=0;i<ticks((STILL_SLEEP+1)*(STILL_S+2));i++){world.step();if(!world.enemies.has(body.id))break;}
    assert.equal(world.enemies.has(body.id),false,'the plan body left the world');
    assert.ok(world.sleepers!.has(body.id),'… asleep again');
    assert.ok(world.enemies.has(group.id)&&(group.memory?.qn??0)>=1,'the group body is still here, pushed');
    assert.equal(close.memory?.qn,undefined,'the one by the hero: never pushed');
    assert.ok(Math.hypot(close.x-closeAt.x,close.y-closeAt.y)<STUCK_MOVE);
    sys.dispose();
  }finally{NEST_PACE.alive=alive;}
});
