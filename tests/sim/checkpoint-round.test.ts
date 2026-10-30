// NEW-20261013-E5-checkpoint-por-round: a run checkpointed at a round's intermission and resumed on a fresh Simulation
// (the restarted room's) comes back with the same world, systems and players, and plays on exactly like the original.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,shapeFingerprint,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {DEFAULT_SEED} from '../../src/maps/index.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {CHECKPOINT_MAX_BYTES} from '../../multiplayer/room.ts';
import {stateHash} from '../../src/sim/core.ts';

const SEED=4242,BOTS=[['bot-1','Robô do Gás','tio-do-churrasco'],['bot-2','Robô da Feira','cidadao-comum'],['bot-3','Robô do Bar','cidadao-comum']] as const;
const seat=(sim:Simulation)=>{for(const [id,name,classId] of BOTS)sim.addBot(id,name,classId);return sim;};
/** Every number that JSON would not keep (Infinity, NaN), with its path: a stored checkpoint must have none. */
function nonFinite(v:unknown,path='cp'):string[]{
  if(typeof v==='number')return Number.isFinite(v)?[]:[path];
  if(!v||typeof v!=='object')return [];
  return Object.entries(v).flatMap(([k,x])=>nonFinite(x,`${path}.${k}`));
}
/** Bots play a run until the intermission of `round` starts (the tick the director's round changes), like the room's capture. */
function playTo(round:number){
  const sim=seat(new Simulation(SEED,{world:'infinito'})),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
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
/** The world's state without what a checkpoint drops (live enemies, projectiles, telegraphs) and the seats' connection fields. */
const worldPart=(sim:Simulation)=>{
  const {enemies:_e,projectiles:_p,telegraphs:_t,players:_pl,rng:_r,...rest}=sim.world.state();
  return JSON.parse(JSON.stringify(rest));
};
const runOf=(sim:Simulation)=>[...sim.players.values()].map(p=>({id:p.id,x:p.x,y:p.y,hp:p.hp,maxHp:p.stats.maxHp,stats:p.stats,build:p.build,weaponReady:p.weaponReady,
  facing:p.facing,score:p.score,downed:p.downed,eliminated:p.eliminated,skillReadyTick:p.skillReadyTick}));

test('checkpoint at a round start: JSON-safe, small, and resumed on a fresh simulation with the same world, systems and players',()=>{
  const sim=playTo(2);
  const cp=sim.checkpoint();
  assert.deepEqual(nonFinite(cp),[],'storage keeps it as JSON');
  const json=JSON.stringify(cp);
  assert.ok(json.length<CHECKPOINT_MAX_BYTES,`${json.length} chars`);
  assert.equal(cp.world.round.index,2);assert.equal(cp.world.round.phase,'prepare');
  assert.ok(cp.players.some(p=>(p.run.build as {weapons:unknown[]}).weapons.length+(p.run.build as {passives:unknown[]}).passives.length>1),'the bots earned items in round 1');
  assert.ok(cp.world.team.level>1,'and levels');
  const stored=JSON.parse(json) as SimCheckpoint;
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.resume(stored),true);
  assert.deepEqual(worldPart(fresh),worldPart(sim));
  assert.equal(fresh.world.enemies.size,0);assert.equal(fresh.world.projectiles.size,0);assert.equal(fresh.world.telegraphs.size,0);
  assert.equal(stateHash(fresh.run.state()),stateHash(sim.run.state()),'director, progression, boss, enemy-ai, revives, stonewards, zueira');
  assert.deepEqual(JSON.parse(JSON.stringify(runOf(fresh))),JSON.parse(JSON.stringify(runOf(sim))));
  for(const p of sim.players.values())assert.deepEqual(fresh.statsOf(p.id),sim.statsOf(p.id));
  assert.equal(fresh.world.seed,sim.world.seed);assert.equal(fresh.outcome,undefined);
});

test('a resumed run plays on exactly like the original (same enemies, rolls and offers ten seconds into the next wave)',()=>{
  const sim=playTo(2);
  const fresh=seat(new Simulation(SEED,{world:'infinito'}));
  assert.equal(fresh.resume(JSON.parse(JSON.stringify(sim.checkpoint()))),true);
  // The original drops what the checkpoint drops, and nobody touches a stick from here on (bots' held sticks, acks).
  for(const m of [sim.world.enemies,sim.world.projectiles,sim.world.telegraphs])m.clear();
  (sim as unknown as {botInputs:Map<string,unknown>}).botInputs.clear();
  for(const p of sim.players.values()){p.ack=0;delete p.target;}
  const end=sim.world.round.phaseEndsTick+20*10;
  while(sim.tick<end){sim.step(sim.tick*50);fresh.step(fresh.tick*50);}
  assert.equal(sim.world.round.phase,'wave');assert.ok(sim.world.enemies.size>0,'the wave is on');
  assert.equal(stateHash({world:fresh.world.state(),systems:fresh.run.state()}),stateHash({world:sim.world.state(),systems:sim.run.state()}));
});

test('resume refuses junk, another room seed and a seat played with another class, and changes nothing then',()=>{
  const sim=playTo(2),cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint;
  const fresh=()=>seat(new Simulation(SEED,{world:'infinito'}));
  const bad:unknown[]=[undefined,null,{},{...cp,runs:-1},{...cp,world:{...cp.world,tick:-5}},{...cp,systems:{...cp.systems,director:null}},
    {...cp,players:[{...cp.players[0],run:{...cp.players[0].run,build:{weapons:[{id:'arma-que-nao-existe',level:1}],passives:[]}}}]},
    {...cp,players:[{...cp.players[0],run:{...cp.players[0].run,hp:Number.NaN}}]}];
  for(const value of bad){const f=fresh(),before=f.stateHash();assert.equal(f.resume(value),false,JSON.stringify(value)?.slice(0,80));assert.equal(f.stateHash(),before);}
  const other=seat(new Simulation(SEED+1,{world:'infinito'}));assert.equal(other.resume(cp),false,'another room seed');
  const swapped=new Simulation(SEED,{world:'infinito'});swapped.addBot('bot-1','Robô do Gás','cidadao-comum');
  assert.equal(swapped.resume(cp),false,'bot-1 played the run as tio-do-churrasco');
});

test('shape fingerprint: a checkpoint from a build whose fresh run had another shape (extra, renamed or retyped field) is refused; late fields in the data are fine',()=>{
  const sim=playTo(2),cp=JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint;
  // The code's fingerprint is its fresh run's (a throwaway seat, never stepped), whatever this run went through.
  const throwaway=new Simulation(DEFAULT_SEED,{world:'infinito'});throwaway.add('shape','cidadao-comum','cidadao-comum');
  const {shape:_shape,...fresh}=throwaway.checkpoint();
  assert.equal(shapeFingerprint(fresh),cp.shape);assert.equal(sim.freshShape().fingerprint,cp.shape);
  const resumes=(value:unknown)=>{const f=seat(new Simulation(SEED,{world:'infinito'}));return f.checkpointShapeOk(value)&&f.resume(value);};
  assert.equal(resumes(cp),true,'a checkpoint of this build');
  // As an older build would have written it: its fresh run had a field more, a field under another name, another type.
  const olderBuild=(edit:(f:any)=>void)=>{const f=structuredClone(fresh) as any;edit(f);return {...cp,shape:shapeFingerprint(f)};};
  const extra=olderBuild(f=>{f.systems.stonewards.legado=0;});
  const renamed=olderBuild(f=>{f.systems.director.amostras=f.systems.director.samples;delete f.systems.director.samples;});
  const retyped=olderBuild(f=>{f.world.team.level=String(f.world.team.level);});
  for(const [why,value] of [['extra',extra],['renamed',renamed],['retyped',retyped]] as const)assert.equal(resumes(value),false,why);
  // The right fingerprint but data missing a field this build's fresh run has (renamed in the stored state): refused.
  const data=structuredClone(cp) as any;data.systems.stonewards.reabastecido=data.systems.stonewards.refilledRound;delete data.systems.stonewards.refilledRound;
  assert.equal(resumes(data),false,'a field of the fresh run missing from the data');
  // A field only in the data (like the defenses or a plan, which appear later in a run): resumed.
  const late=structuredClone(cp) as any;late.systems.stonewards.maisTarde={x:1};
  assert.equal(resumes(late),true,'late fields are not in a fresh run');
});
