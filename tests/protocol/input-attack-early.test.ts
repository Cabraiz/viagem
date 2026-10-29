// BUG-20261027-ORQ-tiro-delay-1s-predicao: the attack press fires on the tick its batch arrives, not LEAD_STEPS
// (100 ms) later like the stick; its own step does not fire it again and the release keeps its step.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTIONS,InputBatcher,InputTrack,LEAD_STEPS,SEGMENT_AIM_SHIFT,SEGMENT_ATTACK} from '../../src/protocol/input-track.ts';
import type {SimPlayer} from '../../src/contract/types.ts';

const body={x:0,y:0} as SimPlayer;

test('standing: the attack press goes on the next tick, in place; its step then holds it until the release',()=>{
  const t=new InputTrack();t.reset(0);
  // The client walked steps 1-9 standing and pressed on 10 (reported at once, clock at step 10).
  assert.ok(t.accept({seq:10,steps:[[10,0,0,SEGMENT_ATTACK,'e3']]},1000));
  const first=t.next(body,1050);
  assert.equal(first?.attack,true,'fired on arrival');assert.equal(first?.target,'e3');
  assert.equal(first?.seq,9,'in place: no step spent');
  assert.equal(t.state().earlyFrom,10);
  // Ticks while the lead holds the step: no second press.
  const waiting=[t.next(body,1100)];
  assert.ok(waiting.every(i=>i===undefined||i.attack===true&&i.seq===10),'its own step, held');
  assert.ok(t.accept({seq:12,steps:[[12,0,0,0]]},1150));
  const rest=[1150,1200,1250,1300].map(now=>t.next(body,now));
  const seqs=rest.filter(i=>i).map(i=>[i!.seq,i!.attack]);
  assert.deepEqual(seqs.slice(-2),[[11,true],[12,false]],'held until the release on step 12');
  assert.equal(t.state().earlyFrom,undefined,'gone from the state once stepped');
});

test('walking: the press rides the current step LEAD_STEPS ahead of its own, with its aim',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:4,steps:[[1,1,0,0]]},0));
  const before=[50,100,150].map(now=>t.next(body,now));
  assert.ok(before.every(i=>!i||!i.attack));
  const applied=t.applied;
  const aim=8;
  assert.ok(t.accept({seq:7,steps:[[7,1,0,SEGMENT_ATTACK|(aim+1)<<SEGMENT_AIM_SHIFT]]},200));
  const now=t.next(body,250)!;
  assert.ok(now.seq<7&&now.seq===applied+1,`a walking step before the press's own (${now.seq})`);
  assert.equal(now.attack,true);assert.deepEqual(now.aim,DIRECTIONS[aim]);
  assert.equal(now.x,1,'still walking');
  const next=t.next(body,300)!;
  assert.equal(next.attack,false,'not again before its step');
  assert.ok(LEAD_STEPS>0);
});

test('a second press after a release fires early too; one press never fires twice early',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:2,steps:[[1,0,0,SEGMENT_ATTACK],[2,0,0,0]]},0));
  const a=[50,100,150,200,250,300].map(now=>t.next(body,now)).filter(i=>i?.attack).length;
  assert.equal(a,1,'its step is not behind the clock: one attack, no early copy');
  assert.ok(t.accept({seq:9,steps:[[9,0,0,SEGMENT_ATTACK]]},400));
  assert.equal(t.next(body,450)?.attack,true,'the new press goes on arrival');
});

test('batcher: the attack press goes at once, outside the 10 Hz slot; the release and the stick still wait for it',()=>{
  const b=new InputBatcher();b.reset(0);
  b.step({x:1,y:0},false);assert.ok(b.take(0),'first walk');
  b.step({x:0,y:1},false);assert.equal(b.take(50),undefined,'a turn waits for the slot');
  b.step({x:0,y:1},false,undefined,true);
  assert.deepEqual(b.take(60)!.steps.map(w=>w[3]),[0,SEGMENT_ATTACK],'the press goes now, with the turn before it');
  b.step({x:0,y:1},false,undefined,false);assert.equal(b.take(110),undefined,'the release waits for the slot');
  assert.equal(b.waitingUntil,160);
  assert.ok(b.take(160));
  b.step({x:0,y:1},false,undefined,true);assert.ok(b.take(170),'the next press goes at once again');
});
