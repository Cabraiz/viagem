import test from 'node:test';
import assert from 'node:assert/strict';
import {RunLifecycle,RUN_COUNTDOWN_TICKS,RUN_DURATION_TICKS,RUN_HZ} from '../../src/sim/run.ts';

function start(run:RunLifecycle,ids=['a']){
  for(const id of ids)run.join(id);
  for(const id of ids)assert.equal(run.ready(id,1,true),true);
  let starts=0;for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)starts+=Number(run.step().started);
  assert.equal(starts,1);assert.equal(run.snapshot().phase,'combat');
}
test('six players ready once, repeated packets do not restart countdown',()=>{
  const run=new RunLifecycle('room');const ids=['a','b','c','d','e','f'];ids.forEach(id=>run.join(id));
  assert.throws(()=>run.join('g'));
  ids.slice(0,5).forEach(id=>run.ready(id,1,true));assert.equal(run.snapshot().phase,'lobby');
  run.ready('f',1,true);run.step();run.ready('f',1,true);
  assert.equal(run.snapshot().remaining,RUN_COUNTDOWN_TICKS-1);
  for(let i=1;i<RUN_COUNTDOWN_TICKS;i++)run.step();
  assert.equal(run.snapshot().phase,'combat');assert.equal(run.ready('a',1,true),false);
});
test('countdown cancels on disconnect; reconnect requires ready again',()=>{
  const run=new RunLifecycle('room');run.join('a');run.join('b');run.ready('a',1,true);run.ready('b',1,true);run.step();
  run.setOnline('b',false);assert.equal(run.snapshot().phase,'lobby');
  run.join('b');assert.equal(run.snapshot().members.length,2);assert.equal(run.snapshot().phase,'lobby');
  run.ready('b',1,true);assert.equal(run.snapshot().remaining,RUN_COUNTDOWN_TICKS);
});
test('late arrival spectates while disconnected combat member keeps its slot',()=>{
  const run=new RunLifecycle('room');start(run);run.step();run.setOnline('a',false);run.step();run.join('b');run.join('a');
  const state=run.snapshot();assert.equal(state.phase,'combat');assert.equal(state.elapsed,2);
  assert.equal(state.members.find(p=>p.id==='a')?.spectator,false);assert.equal(state.members.find(p=>p.id==='b')?.spectator,true);
  assert.equal(run.ready('b',1,true),false);
});
test('victory and defeat emit one result and rematch rejects stale requests',()=>{
  for(const outcome of ['victory','defeat'] as const){
    const run=new RunLifecycle('room');start(run);run.step();assert.equal(run.finish(outcome),true);
    const result=run.snapshot();assert.equal(run.finish('timeout'),false);run.step();assert.deepEqual(run.snapshot(),result);
    assert.equal(result.resultId,'room:1');assert.equal(run.rematch('a',1),true);assert.equal(run.rematch('a',1),false);
    assert.equal(run.ready('a',1,true),false);assert.equal(run.snapshot().elapsed,0);assert.equal(run.snapshot().outcome,undefined);
    // The only person voted: the new run's countdown starts at once (UX-resultado-revanche).
    assert.equal(run.snapshot().round,2);assert.equal(run.snapshot().members[0].ready,true);assert.equal(run.snapshot().phase,'countdown');
  }
});
test('server ticks end duration exactly and snapshots cannot mutate state',()=>{
  const run=new RunLifecycle('room',5);start(run);
  const external=run.snapshot();external.members[0].online=false;
  assert.equal(run.snapshot().members[0].online,true);
  for(let i=0;i<4;i++)assert.equal(run.step().finished,false);
  assert.equal(run.step().finished,true);assert.equal(run.snapshot().outcome,'timeout');assert.equal(run.snapshot().remaining,0);
  assert.equal(run.step().finished,false);
});
test('finish accepts exactly one outcome per run and nothing outside combat',()=>{
  const run=new RunLifecycle('room',3);run.join('a');
  assert.equal(run.finish('victory'),false);run.ready('a',1,true);assert.equal(run.finish('victory'),false);
  for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)run.step();
  run.step();run.step();assert.equal(run.step().finished,true);
  for(const outcome of ['victory','defeat','timeout'] as const)assert.equal(run.finish(outcome),false);
  assert.equal(run.snapshot().outcome,'timeout');
  assert.equal(run.rematch('a',1),true);run.ready('a',2,true);for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)run.step();
  assert.equal(run.finish('defeat'),true);assert.equal(run.finish('victory'),false);assert.equal(run.snapshot().resultId,'room:2');
});
test('the safety limit leaves room for a full horde run',()=>{
  assert.equal(RUN_DURATION_TICKS,20*60*RUN_HZ);assert.ok(RUN_DURATION_TICKS>14*60*RUN_HZ);
  const run=new RunLifecycle('room');start(run);assert.equal(run.snapshot().remaining,RUN_DURATION_TICKS);
});
test('a member away from the lobby for LOBBY_AWAY_TICKS stops holding the start and watches that run (VGM-047)',async()=>{
  const {LOBBY_AWAY_TICKS}=await import('../../src/sim/run.ts');
  const run=new RunLifecycle('room');run.join('a');run.join('b');run.ready('a',1,true);
  run.setOnline('b',false);
  for(let i=0;i<LOBBY_AWAY_TICKS-1;i++)run.step();
  assert.equal(run.snapshot().phase,'lobby','still waiting for b');
  run.step();assert.equal(run.snapshot().phase,'countdown');
  for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)run.step();
  const state=run.snapshot();assert.equal(state.phase,'combat');
  assert.equal(state.members.find(m=>m.id==='b')?.spectator,true);assert.equal(state.members.find(m=>m.id==='a')?.spectator,false);
  // Back during the run: watching, seat kept; the rematch brings b back in.
  run.join('b');assert.equal(run.snapshot().members.find(m=>m.id==='b')?.online,true);
  run.finish('defeat');assert.equal(run.rematch('a',1),false);assert.equal(run.rematch('b',1),true);
  assert.equal(run.snapshot().members.find(m=>m.id==='b')?.spectator,false);
});
test('the rematch is collective: everyone online, or the majority after 10 s (UX-resultado-revanche)',async()=>{
  const {REMATCH_MAJORITY_TICKS}=await import('../../src/sim/run.ts');
  const run=new RunLifecycle('room');start(run,['a','b','c']);run.join('bot',{bot:true});run.finish('defeat');
  assert.deepEqual(run.snapshot().rematchVotes,[]);
  assert.equal(run.rematch('a',1),false,'one of three waits');assert.equal(run.rematch('a',1),false,'a repeated tap is no second vote');
  assert.equal(run.rematch('bot',1),false,'bots never vote');
  assert.deepEqual(run.snapshot().rematchVotes,['a']);assert.equal(run.snapshot().rematchLeft,undefined,'no majority yet');
  for(let i=0;i<REMATCH_MAJORITY_TICKS;i++)assert.equal(run.step().rematch,undefined);
  const late=new RunLifecycle('room');start(late,['a','b','c']);late.finish('defeat');late.rematch('a',1);late.rematch('b',1);
  assert.equal(late.snapshot().rematchLeft,REMATCH_MAJORITY_TICKS,'a majority shows its clock');
  for(let i=1;i<REMATCH_MAJORITY_TICKS;i++)assert.equal(late.step().rematch,undefined);
  assert.equal(late.snapshot().rematchLeft,1);assert.equal(late.step().rematch,true);
  assert.equal(run.snapshot().rematchLeft,undefined);
  assert.equal(run.rematch('b',1),true,'2 of 3 after 10 s: starts now');
  const next=run.snapshot();assert.equal(next.round,2);assert.equal(next.phase,'countdown');assert.equal(next.rematchVotes,undefined);
  assert.equal(next.members.find(m=>m.id==='c')?.spectator,true,'who did not vote watches');
  assert.equal(next.members.find(m=>m.id==='a')?.spectator,false);assert.equal(next.members.find(m=>m.id==='bot')?.spectator,false);
});
test('all people voting start the rematch at once; one leaving counts for the rest',()=>{
  const run=new RunLifecycle('room');start(run,['a','b']);run.finish('victory');
  run.rematch('a',1);assert.equal(run.snapshot().rematchLeft,undefined,'half is no majority');
  run.setOnline('b',false);assert.deepEqual(run.snapshot().rematchVotes,['a']);
  assert.equal(run.step().rematch,true,'b left: a is everyone online');
  // Everyone online voted: nobody is benched; the away b is the lobby's rule (LOBBY_AWAY_TICKS), as before.
  assert.equal(run.snapshot().members.find(m=>m.id==='b')?.spectator,false);assert.equal(run.snapshot().phase,'lobby');
  const two=new RunLifecycle('room');start(two,['a','b']);two.finish('defeat');
  assert.equal(two.rematch('b',1),false);assert.equal(two.rematch('a',1),true);
  assert.equal(two.snapshot().phase,'countdown');assert.ok(two.snapshot().members.every(m=>!m.spectator&&m.ready));
});
