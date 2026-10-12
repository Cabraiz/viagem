// NEW-ORQ-fim-de-round-no-infinito: in the endless world a round ends at its last kill, not by the clock, even with the
// team waiting by the base (the last call: LAST_CALL_SECONDS, LAST_CALL_NEAR in director.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,Simulation} from '../src/game/net/shared.ts';
import {ticks} from '../src/game/sim/types.ts';
import {LAST_CALL_NEAR,LAST_CALL_SECONDS} from '../src/game/sim/director.ts';
import {ROUNDS} from '../src/game/sim/waves.ts';

interface RoundEnd {round:number;waveTicks:number;timedOut:boolean;fled:number;spawned:number;calledAt?:number;endsAtCall?:number}
/** Six heroes that never move (by the base, where they spawn) and take the default offers at once. */
function standStill(seed:number,rounds:number){
  const sim=new Simulation(seed,{world:DEFAULT_WORLD});
  const ids=Array.from({length:6},(_,i)=>`p${i}`);ids.forEach(id=>sim.add(id,id,'cidadao-comum'));sim.resetRun();
  const director=(sim as unknown as {systems:{director:{state:{timedOut:boolean;retreated:number;spawned:number;called?:boolean}}}}).systems.director;
  const ends:RoundEnd[]=[];let waveAt=0,calledAt:number|undefined,endsAtCall:number|undefined;
  const hurried:number[]=[];
  for(let t=0;t<ticks(4*80)&&ends.length<rounds;t++){
    const before=director.state.called;
    for(const e of sim.step()){
      if(e.type==='round'&&e.phase==='wave'){waveAt=sim.tick;calledAt=undefined;endsAtCall=undefined;}
      if(e.type==='round'&&e.phase==='end'){const s=director.state;ends.push({round:e.index,waveTicks:sim.tick-waveAt,timedOut:s.timedOut,fled:s.retreated,spawned:s.spawned,calledAt,endsAtCall});}
    }
    if(!before&&director.state.called){calledAt=sim.tick;endsAtCall=sim.world.round.phaseEndsTick;}
    for(const id of ids){const head=sim.offers(id)[0];if(head)sim.choose(id,head.id,head.defaultIndex);}
  }
  return {ends,hurried,sim};
}

// (Before: every round timed out, 13-49 bichos of rounds 1-2 fled. A siege group chewing the wall 6 u from the heroes
// may still outlast round 2's clock, which is the game: the HUD counts it and the wall notice shows where it is.)
test('endless world, team waiting by the base: round 1 ends at the last kill and nobody flees in rounds 1-2',()=>{
  for(const seed of [1,2]){
    const {ends}=standStill(seed,2);
    assert.equal(ends.length,2,`seed ${seed}: two rounds`);
    for(const end of ends){
      if(end.round===1)assert.equal(end.timedOut,false,`seed ${seed} round 1: ended by the clock (${JSON.stringify(end)})`);
      assert.equal(end.fled,0,`seed ${seed} round ${end.round}: ${end.fled} fled`);
      assert.ok(end.waveTicks<=ticks(ROUNDS[end.round-1].maxDuration+LAST_CALL_SECONDS),`seed ${seed} round ${end.round}: ${end.waveTicks/20} s`);
    }
  }
});

test('the last call starts once every group is out and gives the round at least LAST_CALL_SECONDS more',()=>{
  const {ends}=standStill(3,1);
  const [first]=ends;
  assert.ok(first.calledAt!==undefined,'the last call started');
  assert.ok(first.endsAtCall!>=first.calledAt!+ticks(LAST_CALL_SECONDS),'deadline pushed');
  assert.ok(LAST_CALL_NEAR>=6,'the last stretch in is at the bicho\'s own pace (≥ 6 u: over 4 s for a gosma)');
});

test('the last call is deterministic: the same seed ends its rounds on the same ticks',()=>{
  const a=standStill(2,1).ends,b=standStill(2,1).ends;
  assert.deepEqual(a,b);
});
