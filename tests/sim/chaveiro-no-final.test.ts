// NEW-20261021-ORQ-chaveiro-no-final: the chaveiro is the match's end (the user, 21/10: "importante é o chaveiro vir no
// final"; option B). The real match (multiplayer/worker.ts createOptions + room.ts CITY_OBJECTIVE_DEFAULT): Cidade
// Nevada, the chaveiro objective, the nests, the manual combat. A perfect team rides along the moto (every dead moto
// pushed in 4 s) and keeps him and the car clear (clean deliveries, no fall, no alarm): the fastest he can come. He still
// leaves his last delivery only once the nests' ramp is over (NEST_PACE.ramp), the boss comes before he opens the car,
// and the run's outcome is victory on that very tick (the room stops the sim there: nothing is born after him).
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
import {ABRINDO_SECONDS,BOSS_ETA_SECONDS,ENTREGA_RADIUS} from '../../src/sim/chaveiro/system.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function addPlayer(world:SimWorld,id:string){
  const player={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:0,y:0,ack:0,score:0} as SimPlayer;
  world.players.set(id,player);return player;
}

/** A whole run with a perfect team: the moments (s) the boss came, he left the last delivery and opened the car. */
function perfectRun(seed:number){
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city.fork(),seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const outcomes:{outcome:string;tick:number}[]=[];
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:o=>outcomes.push({outcome:o,tick:world.tick}),cityTutorial:false,
    objective:'chaveiro',mode:'ninhos',combat:'manual'});
  const ch=sys.chaveiro!;assert.ok(ch,'the objective is wired');
  const team=[addPlayer(world,'p1'),addPlayer(world,'p2')];
  const car=ch.state.car,lastEntrega=ch.stops.map(o=>o.kind).lastIndexOf('entrega');
  let bossTick:number|null=null,leftLast:number|null=null,firstEta=0;
  for(let i=0;i<ticks(25*60)&&ch.state.ended===undefined;i++){
    // Beside the moto (topped up every tick: the manual combat's first tick refreshes their stats to the class's hp);
    // the moto's and the car's surroundings cleared, but never the boss (he is what the test waits for).
    const m=ch.moto();team.forEach((p,k)=>{p.x=m.x+(k?1:-1);p.y=m.y;p.hp=p.stats.maxHp;});
    for(const [id,e] of world.enemies){
      if(!e.boss&&(Math.hypot(e.x-car.x,e.y-car.y)<6||Math.hypot(e.x-m.x,e.y-m.y)<ENTREGA_RADIUS+2))world.enemies.delete(id);
    }
    const wasAt=ch.state.moto.stop;
    world.step();
    if(world.tick===1)firstEta=ch.eta(world.tick);
    if(wasAt===lastEntrega&&ch.state.moto.stop>lastEntrega&&leftLast===null)leftLast=world.tick;
    if(bossTick===null&&[...world.enemies.values()].some(e=>e.boss))bossTick=world.tick;
  }
  return {ch,outcomes,bossTick,leftLast,firstEta,end:ch.state.endTick};
}

test('the chaveiro ends the match: a perfect team brings him only after the nests\' ramp, the boss first, victory on that tick',()=>{
  const {ch,outcomes,bossTick,leftLast,firstEta,end}=perfectRun(11);
  assert.equal(ch.state.ended,'victory',`he opened the car (ended ${ch.state.ended}, outcomes ${JSON.stringify(outcomes)})`);
  const ramp=ticks(NEST_PACE.ramp);
  // He waited at the last delivery's door: left it on the ramp's tick (the run started on tick 1), not before.
  assert.ok(leftLast!==null&&leftLast>=ramp&&leftLast<=ramp+2,`left the last delivery at ${leftLast} (ramp ${ramp})`);
  assert.ok(end!/SIM_HZ>=NEST_PACE.ramp+ABRINDO_SECONDS,`opened at ${(end!/SIM_HZ).toFixed(0)} s, after the ramp (${NEST_PACE.ramp} s)`);
  // The ETA counted the wait from the start (the boss is called by it).
  assert.ok(firstEta>=NEST_PACE.ramp,`ETA at the start ${firstEta.toFixed(0)} s ≥ ${NEST_PACE.ramp} s`);
  // The run's outcome is victory on the very tick he opens the car: the room (multiplayer/room.ts) steps the sim only in
  // combat and moves to the result on that outcome, so nothing is born after him (the sim alone would go on spawning).
  assert.deepEqual(outcomes,[{outcome:'victory',tick:end}],`the run ends once, with him: ${JSON.stringify(outcomes)}`);
  assert.ok(bossTick!==null&&bossTick<end!,`the boss came before the end (boss ${bossTick}, end ${end})`);
  // Called at ETA < BOSS_ETA_SECONDS: about that long before the end (the ETA may only grow after the call).
  assert.ok((end!-bossTick!)/SIM_HZ>=BOSS_ETA_SECONDS-5,`the boss came ${((end!-bossTick!)/SIM_HZ).toFixed(1)} s before the end`);
  console.log(`chaveiro-no-final: boss at ${(bossTick!/SIM_HZ).toFixed(0)} s, left the last delivery at ${(leftLast!/SIM_HZ).toFixed(0)} s, opened at ${(end!/SIM_HZ).toFixed(0)} s`);
});
