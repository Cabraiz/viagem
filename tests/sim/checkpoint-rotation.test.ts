// NEW-20261013-ORQ-papeis-de-inimigo x E5-checkpoint-por-round: the run's D-040 rotation lives in the director's state
// (DirectorState.rotation, inside RunSystemsState), so a room cut at an intermission and resumed from its checkpoint keeps
// the SAME rotation, and the rounds after the resume spawn exactly what the uninterrupted run spawns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {isRotation,rotationIds} from '../../src/rules/index.ts';

const SEED=4242,BOTS=[['bot-1','Robô do Gás','mendigo'],['bot-2','Robô da Feira','cidadao-comum'],['bot-3','Robô do Bar','cidadao-comum']] as const;
const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
const botsFor=()=>{const bots=new RoomBots();BOTS.forEach(([id],i)=>bots.add(id,i));return bots;};

/** Bots play a run (rotation on: the room's default) until the intermission of `round` starts, like the room's capture. */
function playTo(round:number){
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=botsFor();
  sim.resetRun();
  for(let i=0,before=sim.world.round.index;i<20*60*6;i++){
    bots.think(sim);sim.step(sim.tick*50);
    const w=sim.world;
    if(w.round.index!==before&&w.round.index===round){assert.equal(w.round.phase,'prepare');return sim;}
    before=w.round.index;
    assert.equal(sim.outcome,undefined,`the bots lost before round ${round}`);
  }
  throw new Error(`never reached round ${round}`);
}

/** Every enemy that appears from here on, in order (id, kind, round), until `until` says stop (or the run ends). */
function spawnsUntil(sim:Simulation,until:(sim:Simulation)=>boolean){
  const bots=botsFor(),seen=new Set(sim.world.enemies.keys()),spawns:string[]=[];
  for(let i=0;i<20*60*6&&!until(sim)&&sim.outcome===undefined;i++){
    bots.think(sim);sim.step(sim.tick*50);
    for(const [id,e] of sim.world.enemies)if(!seen.has(id)){seen.add(id);spawns.push(`${sim.world.round.index}:${id}:${e.kind}`);}
  }
  return spawns;
}

test('the rotation survives a checkpoint: same rotation after resume, and the next rounds spawn the same enemies (ids and kinds)',()=>{
  const sim=playTo(2);
  const rotation=structuredClone(sim.run.director.state.rotation);
  assert.ok(isRotation(rotation),'the run drew a rotation on its first step');
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint;
  assert.deepEqual(cp.systems.director.rotation,rotation,'the checkpoint stores it (RunSystemsState.director.rotation)');

  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.checkpointShapeOk(cp),true);
  assert.equal(fresh.resume(cp),true);
  assert.deepEqual(fresh.run.director.state.rotation,rotation,'the resumed director plays the same rotation');
  assert.deepEqual(fresh.run.director.minionKinds(),sim.run.director.minionKinds(),'an invocador calls the same kinds');

  // The original drops what the checkpoint drops (live bodies, shots, telegraphs, held sticks, acks); both get new bots.
  for(const m of [sim.world.enemies,sim.world.projectiles,sim.world.telegraphs])m.clear();
  (sim as unknown as {botInputs:Map<string,unknown>}).botInputs.clear();
  for(const p of sim.players.values()){p.ack=0;delete p.target;}

  // Round 2's whole wave, the intermission and 15 s of round 3's wave.
  const stop=()=>{let since:number|undefined;return (s:Simulation)=>{
    if(s.world.round.index>=3&&s.world.round.phase==='wave')since??=s.tick;
    return since!==undefined&&s.tick>=since+20*15;
  };};
  const original=spawnsUntil(sim,stop()),resumed=spawnsUntil(fresh,stop());
  assert.ok(original.some(s=>s.startsWith('3:')),`the run reached round 3's wave (${original.length} spawns)`);
  assert.deepEqual(resumed,original);
  assert.deepEqual(fresh.run.director.state.rotation,rotation,'still the same rotation in round 3');

  // The next rounds draw from it: every regular member is one of the rotation's entries.
  const ids=new Set(rotationIds(rotation!)),kinds=new Set(original.map(s=>s.split(':')[2]));
  for(const kind of kinds)assert.ok(ids.has(kind),`${kind} is in the rotation`);
});

test('a stored rotation the roster refuses (an old or tampered checkpoint) is drawn again, valid, instead of planned',()=>{
  const sim=playTo(2);
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint;
  (cp.systems.director as {rotation?:unknown}).rotation={mini:['nao-existe','nem-este'],roles:{}};
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.resume(cp),true);
  assert.equal(fresh.run.director.state.rotation,undefined,'refused on restore (isRotation)');
  fresh.step(fresh.tick*50);
  assert.ok(isRotation(fresh.run.director.state.rotation),'a fresh rotation on the next step');
});
