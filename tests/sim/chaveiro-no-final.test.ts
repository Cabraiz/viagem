// NEW-20261021-ORQ-chaveiro-no-final: the chaveiro is the match's end (the user, 21/10: "importante é o chaveiro vir no
// final"). The real match (multiplayer/worker.ts createOptions + room.ts CITY_OBJECTIVE_DEFAULT): Cidade Nevada, the
// chaveiro objective, the nests, the manual combat. A whole run, two players riding along the moto (they push every dead
// moto) and keeping the car's yard clear: the boss comes before he opens the car and the run's outcome is victory on that
// very tick (the room stops the sim there: nothing is born after him).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {BOSS_ETA_SECONDS} from '../../src/sim/chaveiro/system.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:0,y:0,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}

test('the chaveiro ends the match: the boss comes before he opens the car, the run ends on that tick',()=>{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city.fork(),seed:11,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const outcomes:{outcome:string;tick:number}[]=[];
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:o=>outcomes.push({outcome:o,tick:world.tick}),cityTutorial:false,
    objective:'chaveiro',mode:'ninhos',combat:'manual'});
  const ch=sys.chaveiro!;assert.ok(ch,'the objective is wired');
  const team=[addPlayer(world,'p1'),addPlayer(world,'p2')];
  const car=ch.state.car,born=new Set<string>();
  let bossTick:number|null=null;
  for(let i=0;i<ticks(25*60)&&ch.state.ended===undefined;i++){
    // The team rides beside the moto (2 standing players push a dead one in 4 s) and the car's yard is kept clear
    // (the boss stays: he is what this test waits for).
    // (Topped up every tick: the manual combat's first tick refreshes their stats to the class's own hp.)
    const m=ch.moto();team.forEach((p,k)=>{p.x=m.x+(k?1:-1);p.y=m.y;p.hp=p.stats.maxHp;});
    for(const [id,e] of world.enemies)if(!e.boss&&Math.hypot(e.x-car.x,e.y-car.y)<6)world.enemies.delete(id);
    world.step();
    for(const e of world.enemies.values()){born.add(e.id);if(e.boss&&bossTick===null)bossTick=world.tick;}
  }
  const end=ch.state.endTick!;
  assert.equal(ch.state.ended,'victory',`he opened the car (ended ${ch.state.ended}, outcomes ${JSON.stringify(outcomes)})`);
  // The run's outcome is victory on the very tick he opens the car: the room (multiplayer/room.ts) steps the sim only in
  // combat and moves to the result on that outcome, so nothing is born after him (the sim alone would go on spawning).
  assert.deepEqual(outcomes,[{outcome:'victory',tick:end}],`the run ends once, with him: ${JSON.stringify(outcomes)}`);
  assert.ok(bossTick!==null&&bossTick<end,`the boss came before the end (boss ${bossTick}, end ${end})`);
  // Called at ETA < BOSS_ETA_SECONDS: about that long before the end (the ETA may only grow after the call).
  assert.ok((end-bossTick!)/SIM_HZ>=BOSS_ETA_SECONDS-5,`the boss came ${((end-bossTick!)/SIM_HZ).toFixed(1)} s before the end`);
  console.log(`chaveiro-no-final: boss at ${(bossTick!/SIM_HZ).toFixed(0)} s, opened at ${(end/SIM_HZ).toFixed(0)} s (${(end/SIM_HZ/60).toFixed(1)} min), ${born.size} enemies born`);
});
