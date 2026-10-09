import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {SYSTEM_ORDER,BASE_STATS,ticks} from '../src/game/sim/types.ts';

test('rng replays the same sequence from the same seed and forks independently',()=>{
  const a=new Rng(42),b=new Rng(42);
  const seqA=Array.from({length:50},()=>a.next()),seqB=Array.from({length:50},()=>b.next());
  assert.deepEqual(seqA,seqB);
  assert.ok(seqA.every(n=>n>=0&&n<1));
  assert.notDeepEqual(new Rng(1).fork('director').next(),new Rng(1).fork('weapons').next());
  const r=new Rng(7);for(let i=0;i<200;i++){const n=r.int(2,5);assert.ok(n>=2&&n<=5&&Number.isInteger(n));}
  assert.throws(()=>new Rng(1).pick([]));
});
test('contract constants are stable',()=>{
  assert.equal(ticks(1),20);
  assert.equal(new Set(SYSTEM_ORDER).size,SYSTEM_ORDER.length);
  assert.equal(BASE_STATS.might,1);assert.throws(()=>{(BASE_STATS as {might:number}).might=2;});
});
