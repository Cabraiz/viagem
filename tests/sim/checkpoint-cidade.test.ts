// NEW-20261013-E5-checkpoint-por-round on the Cidade Nevada: the round-2 intermission (the plaza barricades just rose)
// checkpointed and resumed on a fresh room simulation of the same city: the barricade blockers, the avenue planner and
// the director's avenue memory come back, and the run plays on exactly like the original into the round-2 wave.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {CHECKPOINT_MAX_BYTES} from '../../multiplayer/room.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {stateHash} from '../../src/sim/core.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const SEED=11,BOTS=[['bot-1','cidadao-comum'],['bot-2','clt-cansado'],['bot-3','feirante']] as const;
const seat=(sim:Simulation)=>{for(const [id,classId] of BOTS)sim.addBot(id,id,classId);return sim;};
const cityRoom=()=>seat(new Simulation(SEED,{world:'cidade',terrain:city,cityStructures:true}));

test('city: the round-2 checkpoint resumes with the barricades standing (blockers too) and plays on like the original',()=>{
  const sim=cityRoom(),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0,before=0;i<20*60*8;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===2)break;
    before=sim.world.round.index;assert.equal(sim.outcome,undefined);
  }
  assert.equal(sim.world.round.index,2);assert.equal(sim.world.round.phase,'prepare');
  const json=JSON.stringify(sim.checkpoint());
  assert.ok(json.length<CHECKPOINT_MAX_BYTES,`${json.length} chars`);
  const fresh=cityRoom();
  assert.equal(fresh.resume(JSON.parse(json) as SimCheckpoint),true);
  assert.equal(stateHash(fresh.run.state()),stateHash(sim.run.state()));
  const blockers=(s:Simulation)=>JSON.stringify((s.terrain as unknown as {blockers():unknown[]}).blockers());
  assert.equal(blockers(fresh),blockers(sim),'the same barricade blockers on the terrain');
  // Both play on with nobody on the sticks, the original without what the checkpoint drops.
  for(const m of [sim.world.enemies,sim.world.projectiles,sim.world.telegraphs])m.clear();
  (sim as unknown as {botInputs:Map<string,unknown>}).botInputs.clear();
  for(const p of sim.players.values()){p.ack=0;delete p.target;}
  const end=sim.world.round.phaseEndsTick+20*10;
  while(sim.tick<end){sim.step(sim.tick*50);fresh.step(fresh.tick*50);}
  assert.equal(sim.world.round.phase,'wave');
  assert.equal(stateHash({world:fresh.world.state(),systems:fresh.run.state()}),stateHash({world:sim.world.state(),systems:sim.run.state()}));
});
