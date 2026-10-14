// NEW-20261013-ORQ-ficha-de-torre (D-048): a round checkpoint written by the build before the single pile of material
// (balance {coco, pedra}, that build's fingerprint) resumes on this build with {units: coco + pedra}; any other shape is
// still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {UNITS_PER_TOKEN,tokensOf,tokenProgress} from '../../src/rules/index.ts';

const SEED=4242,BOTS=[['bot-1','Robô do Gás','mendigo'],['bot-2','Robô da Feira','cidadao-comum']] as const;
const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
function playTo(round:number){
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0,before=sim.world.round.index;i<20*60*6;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===round)return sim;
    before=sim.world.round.index;
  }
  throw new Error(`never reached round ${round}`);
}
const balanceOf=(sim:Simulation)=>(sim.run.state().stonewards as {balance:{units:number}}).balance;

test('a pre-ficha checkpoint (two piles, the old fingerprint) resumes with one pile of coco + pedra units',()=>{
  const sim=playTo(2);
  balanceOf(sim).units=57;
  const cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint&{shape:string};
  // What the older build wrote for the same run: two piles and its own fingerprint.
  const legacy=JSON.parse(JSON.stringify(cp));
  legacy.systems.stonewards.balance={coco:25,pedra:32};legacy.shape=sim.freshShape().legacy;
  assert.notEqual(sim.freshShape().legacy,sim.freshShape().fingerprint,'the pile shape is in the fingerprint');
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.checkpointShapeOk(legacy),true,'migrated before the shape check');
  assert.deepEqual(legacy.systems.stonewards.balance,{units:57});assert.equal(legacy.shape,fresh.freshShape().fingerprint);
  assert.equal(fresh.resume(legacy),true);
  assert.equal(balanceOf(fresh).units,57);
  assert.equal(tokensOf(57),1);assert.ok(Math.abs(tokenProgress(57)-17/UNITS_PER_TOKEN)<1e-9);
  // Idempotent: a second pass changes nothing.
  fresh.migrateCheckpoint(legacy);assert.deepEqual(legacy.systems.stonewards.balance,{units:57});
});

test('only that shape is migrated: two piles under another fingerprint, or a current checkpoint, are left as they are',()=>{
  const sim=playTo(2),cp=JSON.parse(JSON.stringify(sim.checkpoint()));
  const odd=JSON.parse(JSON.stringify(cp));odd.systems.stonewards.balance={coco:1,pedra:2};odd.shape='something-else';
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.checkpointShapeOk(odd),false,'another build: refused');
  assert.deepEqual(odd.systems.stonewards.balance,{coco:1,pedra:2},'not touched');
  const now=JSON.parse(JSON.stringify(cp));fresh.migrateCheckpoint(now);assert.deepEqual(now,cp,'a current checkpoint is untouched');
  assert.equal(fresh.checkpointShapeOk(now),true);
});
