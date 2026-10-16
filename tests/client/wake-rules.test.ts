import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WAKE_RADIUS,isAsleep,isWakeEvent,sleepOrAct,wakeTargets} from '../../src/client/render/wake-rules.ts';

test('a sleeper loops sleep over any acting pose; awake keeps the pose', ()=>{
  assert.equal(sleepOrAct(true,'lecture'),'sleep');
  assert.equal(sleepOrAct(false,'lecture'),'lecture');
  assert.equal(sleepOrAct(false,undefined),undefined);
  assert.ok(isAsleep({asleep:true})&&!isAsleep({asleep:1})&&!isAsleep({}));
});

test('acordou: the n nearest new actors within the radius wake, the same pick on every client', ()=>{
  const e={type:'acordou' as const,x:10,y:10,n:2};
  assert.ok(isWakeEvent(e)&&!isWakeEvent({type:'damage'}));
  const fresh=[{id:'far',x:10+WAKE_RADIUS+.1,y:10},{id:'b',x:11,y:10},{id:'a',x:9,y:10},{id:'c',x:10,y:13}];
  assert.deepEqual(wakeTargets(e,fresh),['a','b'],'ties by id');
  assert.deepEqual(wakeTargets({...e,n:9},fresh),['a','b','c']);
  assert.deepEqual(wakeTargets({...e,n:0},fresh),[]);
  assert.deepEqual(wakeTargets(e,[]),[]);
});

test('the horde renderer wires sleep and wake (layers.ts)', ()=>{
  const src=readFileSync(new URL('../../src/client/render/layers.ts',import.meta.url),'utf8');
  assert.match(src,/a\.act=sleepOrAct\(asleep,actAnim\(/);
  assert.match(src,/if\(!used\.fresh&&a\.asleep&&!asleep\)this\.woken\.push/);
  assert.match(src,/wakeTargets\(/);
  assert.match(src,/playEnemyAction\(a\.image,a\.art,'wake',this\.now\)/);
});
