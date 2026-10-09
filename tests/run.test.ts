import test from 'node:test';
import assert from 'node:assert/strict';
import {RunLifecycle,RUN_COUNTDOWN_TICKS,RUN_DURATION_TICKS,RUN_HZ} from '../src/game/net/run.ts';

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
    assert.equal(run.snapshot().round,2);assert.equal(run.snapshot().members[0].ready,false);
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
