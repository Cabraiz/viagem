import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,type SimOutcome} from '../src/game/net/shared.ts';
import type {StampedEvent} from '../src/game/sim/core.ts';
import {KITS} from '../src/game/sim/kits.ts';
import {SIM_HZ} from '../src/game/sim/types.ts';

/** Safety cap of a run: 20 minutes of ticks (RUN_DURATION_TICKS). */
const CAP=20*60*SIM_HZ;
const SEED=0x042a5eed;
const KIT_CLASSES=KITS.map(k=>k.classId);

interface Script {
  /** Bots walk a deterministic circle; otherwise they stand still and send nothing. */
  move:boolean;
  /** Bots accept the head offer with its defaultIndex every tick. */
  choose:boolean;
  /** Test-only killer (installKiller): every N ticks every live enemy takes 1e6 damage (0 = off). */
  killEvery:number;
  /** Clears every bot's weapons after resetRun and whenever an offer gives one back. */
  unarmed?:boolean;
}

interface RunResult {
  sim:Simulation;
  ticks:number;
  outcome?:SimOutcome;
  outcomeTick?:number;
  /** Every distinct value sim.outcome took, in order (undefined excluded). */
  outcomeHistory:SimOutcome[];
  roundEnds:{index:number;tick:number}[];
  roundWaves:{index:number;tick:number}[];
  bossKillTick?:number;
  killEvents:number;
  helperKills:number;
  chosen:number;
  chooseFailures:string[];
  hashes:string[];
  scoresAtEnd:Map<string,number>;
  ms:number;
}

function setup(seed:number,bots:number,classes:readonly string[]=KIT_CLASSES){
  const sim=new Simulation(seed);
  const ids=Array.from({length:bots},(_,i)=>`bot${i}`);
  ids.forEach((id,i)=>sim.add(id,`Bot ${i}`,classes[i%classes.length]));
  sim.resetRun();
  return {sim,ids};
}

/**
 * Drives bots for up to maxTicks, then `after` more ticks once an outcome appears (the Room would stop there;
 * the extra ticks check that the outcome stays and let the director close round 10).
 */
function drive(sim:Simulation,ids:readonly string[],script:Script,options:{maxTicks:number;after?:number;hashEvery?:number}):RunResult{
  const {maxTicks,after=0,hashEvery=0}=options;
  const seq=new Map(ids.map(id=>[id,0]));
  const r:RunResult={sim,ticks:0,outcomeHistory:[],roundEnds:[],roundWaves:[],killEvents:0,helperKills:0,chosen:0,chooseFailures:[],hashes:[],scoresAtEnd:new Map(),ms:0};
  const disarm=()=>{for(const id of ids){const p=sim.players.get(id)!;if(p.build.weapons.length){p.build.weapons=[];p.weaponReady={};}}};
  if(script.unarmed)disarm();
  const watch=()=>{
    const o=sim.outcome;
    assert.equal(sim.victory,o==='victory','victory must mirror outcome');
    if(o!==undefined&&o!==r.outcomeHistory.at(-1)){r.outcomeHistory.push(o);r.outcome??=o;r.outcomeTick??=sim.tick;}
    if(o===undefined)assert.equal(r.outcomeHistory.length,0,'outcome must never be cleared inside a run');
  };
  installKiller(sim,ids,script.killEvery,(boss)=>{r.helperKills++;if(boss)r.bossKillTick??=sim.tick;});
  const started=performance.now();
  let stopAt=maxTicks;
  for(let t=1;t<=stopAt;t++){
    if(script.move)ids.forEach((id,i)=>{
      const a=2*Math.PI*(sim.tick/160+i/ids.length),next=seq.get(id)!+1;
      // Only advance seq when accepted, so a downed/stalled bot never runs ahead of ack + 40.
      if(sim.input(id,{seq:next,x:Math.cos(a),y:Math.sin(a),attack:false}))seq.set(id,next);
    });
    const events:StampedEvent[]=sim.step();
    r.ticks++;
    for(const e of events){
      if(e.type==='round'&&e.phase==='end')r.roundEnds.push({index:e.index,tick:sim.tick});
      if(e.type==='round'&&e.phase==='wave')r.roundWaves.push({index:e.index,tick:sim.tick});
      if(e.type==='kill')r.killEvents++;
    }
    watch();
    if(script.choose&&sim.outcome===undefined)for(const id of ids){
      const offer=sim.offers(id)[0];
      if(!offer)continue;
      const res=sim.choose(id,offer.id,offer.defaultIndex);
      if(res.ok)r.chosen++;else r.chooseFailures.push(`${sim.tick}:${id}:${offer.id}:${res.reason}`);
    }
    if(script.unarmed)disarm();
    watch();
    if(hashEvery&&t%hashEvery===0)r.hashes.push(sim.stateHash());
    if(r.outcome!==undefined&&stopAt===maxTicks)stopAt=Math.min(maxTicks,t+after);
  }
  r.ms=performance.now()-started;
  for(const id of ids)r.scoresAtEnd.set(id,sim.players.get(id)!.score);
  return r;
}

/**
 * Test-only killer: runs inside the tick right after the 'boss' system (where weapons would hit), so kills go
 * through world.damageEnemy with the same hooks as real ones (loot, kill score, boss victory on the killing blow).
 * Kills sent between ticks would be outside a step, where Simulation ignores onOutcome.
 */
function installKiller(sim:Simulation,ids:readonly string[],every:number,onKill:(boss:boolean)=>void){
  if(!every)return;
  const boss=sim.run.boss,original=boss.step.bind(boss);
  (boss as {step:typeof boss.step}).step=ctx=>{
    original(ctx);
    if(ctx.tick%every!==0)return;
    const killer=ids[(ctx.tick/every)%ids.length];
    for(const e of [...ctx.enemies.values()]){const isBoss=!!e.boss;if(ctx.damageEnemy(e.id,1e6,killer))onKill(isBoss);}
  };
}

const VICTORY:Script={move:true,choose:true,killEvery:10};
const runs=new Map<string,RunResult>();
/** Each scripted run is played once per test file and shared across assertions. */
function scripted(key:string,make:()=>RunResult){let r=runs.get(key);if(!r){r=make();runs.set(key,r);}return r;}
const victoryRun=(bots:number,copy='')=>scripted(`victory-${bots}${copy}`,()=>{
  const {sim,ids}=setup(SEED,bots);
  return drive(sim,ids,VICTORY,{maxTicks:CAP,after:200,hashEvery:10});
});
const report=(t:{diagnostic(m:string):void},label:string,r:RunResult)=>
  t.diagnostic(`${label}: outcome=${r.outcome} at tick ${r.outcomeTick} (${((r.outcomeTick??r.ticks)/SIM_HZ/60).toFixed(1)} min), ${r.ticks} ticks in ${r.ms.toFixed(0)} ms = ${(r.ms/r.ticks).toFixed(3)} ms/tick, kills=${r.killEvents}, chosen=${r.chosen}`);

function assertScriptedVictory(r:RunResult,bots:number){
  assert.deepEqual(r.outcomeHistory,['victory'],'outcome is set once and never changes');
  assert.equal(r.sim.outcome,'victory');assert.equal(r.sim.victory,true);
  assert.ok(r.outcomeTick!<=CAP,'ends within the 20 min cap');
  // Victory comes from the boss: the helper's boss kill is what set it, during round 10.
  assert.equal(r.bossKillTick,r.outcomeTick,'victory is set by the boss kill itself (onKill), not later');
  assert.ok(r.sim.run.boss.bossDefeated(r.sim.world));
  assert.deepEqual(r.roundWaves.map(w=>w.index),[1,2,3,4,5,6,7,8,9,10]);
  const beforeOutcome=r.roundEnds.filter(e=>e.tick<=r.outcomeTick!).map(e=>e.index);
  assert.deepEqual(beforeOutcome,[1,2,3,4,5,6,7,8,9],'rounds 1-9 end before the boss falls');
  assert.ok(r.roundWaves[9].tick<=r.outcomeTick!,'round 10 wave was running');
  // Escorts retreat or die once the boss falls, so round 10 closes right after.
  assert.deepEqual(r.roundEnds.map(e=>e.index),[1,2,3,4,5,6,7,8,9,10],'exactly 10 round ends, in order');
  assert.equal(r.sim.run.director.state.stage,'done');
  assert.equal(r.sim.world.round.index,10);
  assert.deepEqual(r.chooseFailures,[],'defaultIndex of the head offer is always accepted');
  assert.ok(r.chosen>=9*bots,`every bot picks at least the 9 round offers (chosen ${r.chosen})`);
  // Score: +10 per kill for every non-spectator (all bots joined before the run).
  const scores=[...r.scoresAtEnd.values()];
  assert.ok(scores.every(s=>s===scores[0]),'every bot gets the team kill score');
  assert.equal(scores[0],10*r.killEvents,'score is 10 per kill event');
  assert.ok(r.killEvents>=r.helperKills&&r.helperKills>0);
}

test('scripted victory with 1 bot: 10 rounds, boss victory set exactly once, within 20 min',t=>{
  const r=victoryRun(1);report(t,'1 bot',r);
  assertScriptedVictory(r,1);
});

test('scripted victory with 6 bots: 10 rounds, boss victory set exactly once, within 20 min',t=>{
  const r=victoryRun(6);report(t,'6 bots',r);
  assertScriptedVictory(r,6);
  assert.equal(r.sim.run.boss.boss(r.sim.world),undefined);
});

test('defeat: unarmed bots standing still are overrun and the run ends in defeat exactly once',t=>{
  const {sim,ids}=setup(SEED,3,['cidadao-comum']);
  for(const id of ids)assert.equal(sim.players.get(id)!.hp,sim.players.get(id)!.stats.maxHp);
  const r=drive(sim,ids,{move:false,choose:false,killEvery:0,unarmed:true},{maxTicks:CAP,after:200});
  report(t,'defeat',r);
  assert.deepEqual(r.outcomeHistory,['defeat']);
  assert.equal(sim.outcome,'defeat');assert.equal(sim.victory,false);
  assert.equal(sim.run.revive.defeated,true);
  for(const id of ids){const p=sim.players.get(id)!;assert.ok(p.downed||p.eliminated,`${id} is out`);assert.equal(p.hp,0);}
  assert.ok(r.roundEnds.every(e=>e.index<10),'defeat comes before the final round ends');
  assert.equal(r.bossKillTick,undefined);
});

test('determinism: same seed and commands give the same stateHash, outcome and rematch',t=>{
  const a=victoryRun(6),b=victoryRun(6,'#copy');
  assert.ok(a.hashes.length>100);
  assert.deepEqual(b.hashes,a.hashes,'stateHash every 10 ticks matches');
  assert.equal(b.outcome,a.outcome);assert.equal(b.outcomeTick,a.outcomeTick);
  assert.deepEqual(b.roundEnds,a.roundEnds);
  assert.equal(b.sim.stateHash(),a.sim.stateHash());
  assert.deepEqual(b.sim.snapshot(),a.sim.snapshot());
  // Rematch on both: outcome cleared, and the new run replays identically tick by tick.
  const ids=[...a.sim.players.keys()];
  a.sim.resetRun();b.sim.resetRun();
  for(const s of [a.sim,b.sim]){
    assert.equal(s.outcome,undefined);assert.equal(s.victory,false);assert.equal(s.tick,0);
    assert.equal(s.run.revive.defeated,false);assert.equal(s.run.director.state.stage,'idle');
    for(const p of s.players.values()){assert.equal(p.hp,p.stats.maxHp);assert.equal(p.score,0);assert.ok(!p.downed&&!p.eliminated);}
  }
  assert.equal(b.sim.stateHash(),a.sim.stateHash());
  const ra=drive(a.sim,ids,VICTORY,{maxTicks:1500,hashEvery:1}),rb=drive(b.sim,ids,VICTORY,{maxTicks:1500,hashEvery:1});
  assert.deepEqual(rb.hashes,ra.hashes,'rematch stateHash matches every tick');
  t.diagnostic(`rematch 1500 ticks x2 hashed every tick: ${(ra.ms+rb.ms).toFixed(0)} ms`);
  // A different seed is a different run.
  const other=setup(SEED+1,6);
  const rc=drive(other.sim,other.ids,VICTORY,{maxTicks:1500,hashEvery:1});
  assert.notEqual(rc.hashes.at(-1),ra.hashes.at(-1));
});

test('unassisted run (bots move and take defaults, no kill helper) ends with exactly one outcome',t=>{
  const {sim,ids}=setup(SEED,3);
  const r=drive(sim,ids,{move:true,choose:true,killEvery:0},{maxTicks:CAP,after:100});
  report(t,'unassisted 3 bots',r);
  assert.deepEqual(r.chooseFailures,[]);
  assert.ok(r.outcomeHistory.length<=1,`outcome changed: ${r.outcomeHistory.join(' -> ')}`);
  if(r.outcome===undefined){
    // The Room adds the timeout; the simulation itself must still be consistent.
    t.diagnostic(`no outcome after ${r.ticks} ticks; round ${sim.world.round.index} ${sim.world.round.phase}`);
    assert.equal(r.ticks,CAP);assert.ok(sim.world.round.index<=10);
  }else{
    assert.ok(r.outcome==='victory'||r.outcome==='defeat');
    assert.equal(sim.outcome,r.outcome);
    if(r.outcome==='victory')assert.ok(sim.run.boss.bossDefeated(sim.world));
    else assert.equal(sim.run.revive.defeated,true);
  }
});

test('victory beats defeat when the boss dies in the same tick the last player falls',t=>{
  const {sim,ids}=setup(SEED,1,['cidadao-comum']);
  const boss=sim.run.boss,original=boss.step.bind(boss);
  let sameTick:number|undefined;
  (boss as {step:typeof boss.step}).step=ctx=>{
    original(ctx);
    const chefe=[...ctx.enemies.values()].find(e=>e.boss);
    if(chefe&&ctx.tick-chefe.spawnTick>=40&&sameTick===undefined){
      // Weapons phase of the same tick: the killing blow lands, then the last player drops (revive runs later this tick).
      ctx.damageEnemy(chefe.id,1e6,ids[0]);ctx.damagePlayer(ids[0],1e6,'test');sameTick=ctx.tick;return;
    }
    if(ctx.tick%10===0)for(const e of [...ctx.enemies.values()])if(!e.boss)ctx.damageEnemy(e.id,1e6,ids[0]);
  };
  const r=drive(sim,ids,{move:true,choose:true,killEvery:0},{maxTicks:CAP,after:100});
  report(t,'same-tick',r);
  assert.ok(sameTick!==undefined,'the boss was reached');
  assert.ok(sim.players.get(ids[0])!.downed||sim.players.get(ids[0])!.eliminated,'the last player is down');
  assert.deepEqual(r.outcomeHistory,['victory']);
  assert.equal(r.outcomeTick,sameTick);
  assert.equal(sim.run.revive.defeated,false,'D-016: the boss killing blow ends the run, so revive never calls a defeat');
});
