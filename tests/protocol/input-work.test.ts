// Bicos (card NEW-20261024-ORQ-bancos-viram-bicos): Trabalhar on the 10 Hz input (segment flag bit 8). Holding it does
// not keep the room stepping (a worker stands still): a change of it is one step, like a new tap target, so the sim
// hears the clock-in and the clock-out even standing still. Style of input-attack.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {InputBatcher,InputTrack,SEGMENT_AIM_SHIFT,SEGMENT_ATTACK,SEGMENT_WORK,segmentOf,segmentWire} from '../../src/protocol/input-track.ts';
import type {PlayerInput,SimPlayer} from '../../src/contract/types.ts';

const body={x:0,y:0} as SimPlayer;
function steps(t:InputTrack,n:number,t0:number){const out:(PlayerInput|undefined)[]=[];for(let i=1;i<=n;i++)out.push(t.next(body,t0+i*50));return out;}

test('segment flags: bit 8 is Trabalhar, alone or with the others; the aim bits stay 2-7; past 387 or an aim past 32 is refused',()=>{
  assert.equal(SEGMENT_WORK,256);
  assert.deepEqual(segmentOf([5,0,0,SEGMENT_WORK]),{from:5,x:0,y:0,skill:false,work:true});
  assert.deepEqual(segmentOf([5,0,0,SEGMENT_WORK|SEGMENT_ATTACK|(4<<SEGMENT_AIM_SHIFT)]),{from:5,x:0,y:0,skill:false,attack:true,aim:3,work:true});
  for(const flags of [388,512,SEGMENT_WORK|(33<<SEGMENT_AIM_SHIFT)])assert.equal(segmentOf([5,0,0,flags]),undefined,String(flags));
  for(const w of [[5,0,0,SEGMENT_WORK],[5,1,0,SEGMENT_WORK|SEGMENT_ATTACK,'e1']])assert.deepEqual(segmentWire(segmentOf(w)!),w);
  assert.equal('work' in segmentOf([5,1,0,0])!,false,'no Trabalhar: no key (the replay hash as before)');
});

test('batcher: pressing and letting go of Trabalhar are changes, but holding it is not active (no keepalives)',()=>{
  const b=new InputBatcher();b.reset(0);
  let r=b.step({x:0,y:0},false,undefined,false,undefined,true);
  assert.equal(r.input.work,true);assert.equal(r.active,false,'a worker stands still');
  assert.deepEqual(b.take(0)!.steps,[[1,0,0,SEGMENT_WORK]]);
  r=b.step({x:0,y:0},false,undefined,false,undefined,true);assert.equal(b.take(100),undefined,'held: no change, no message');
  b.step({x:0,y:0},false);assert.deepEqual(b.take(200)!.steps,[[3,0,0,0]]);
});

test('track: the clock-in and the clock-out standing still are one step each; holding it in between costs none',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:9,steps:[[2,0,0,SEGMENT_WORK],[9,0,0,0]]},0));
  const out=steps(t,14,1000);
  const given=out.filter((i):i is PlayerInput=>!!i);
  assert.deepEqual(given.map(i=>[i.seq,!!i.work]),[[2,true],[9,false]],'one step at the press, one at the release');
  assert.equal(t.state().appliedWork,undefined,'let go: nothing held in the state');
  // Walking away while holding it: every step carries it (the sim reads the movement as the clock-out).
  const u=new InputTrack();u.reset(0);
  assert.ok(u.accept({seq:3,steps:[[1,0,0,SEGMENT_WORK],[2,1,0,SEGMENT_WORK]]},0));
  const walk=steps(u,3,1000);
  assert.deepEqual(walk.map(i=>i&&[i.x,!!i.work]),[[0,true],[1,true],[1,true]]);
  assert.equal(u.state().appliedWork,true);
});
