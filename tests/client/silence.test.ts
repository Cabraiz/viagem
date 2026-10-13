// 3g-socket-morto: the silence limit comes from the link's own longest recent gaps (3-8 s), never from a drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SilenceWatch,DEAD_MIN_MS,DEAD_MAX_MS,SAFETY,GAP_HALF_LIFE_MS} from '../../src/client/net/silence.ts';

const feed=(w:SilenceWatch,gaps:number[],from=0)=>{let t=from;w.heard(t);for(const g of gaps){t+=g;w.heard(t);}return t;};

test('a steady link (frames every 100 ms, the 1.3 s TCP stalls measured on 3G) stays near the 3 s floor',()=>{
  const w=new SilenceWatch();
  const t=feed(w,[...Array(300).fill(100),1300,...Array(50).fill(100),1030]);
  const limit=w.limit(t);
  assert.ok(limit>=DEAD_MIN_MS&&limit<=SAFETY*1300,`${limit} ms`);
  // With only frames every 100 ms: the floor.
  const calm=new SilenceWatch();assert.equal(calm.limit(feed(calm,Array(300).fill(100))),DEAD_MIN_MS);
});

test('a link with longer stalls earns a longer limit (2.5×), never past the old 8 s',()=>{
  const w=new SilenceWatch();
  let t=feed(w,[100,100,2000,100]);
  assert.ok(Math.abs(w.limit(t)-SAFETY*2000)<SAFETY*2000*.01,`${w.limit(t)}`);
  t=feed(w,[100,6000],t);
  assert.equal(w.limit(t),DEAD_MAX_MS);
});

test('an old stall stops counting (half-life), and a drop is never learned as a stall',()=>{
  const w=new SilenceWatch();
  let t=feed(w,[2400]);
  assert.equal(w.limit(t),6000);
  t=feed(w,Array(Math.round(2*GAP_HALF_LIFE_MS/100)).fill(100),t);
  assert.equal(w.limit(t),DEAD_MIN_MS,'two half-lives later: 600 ms × 2.5 under the floor');
  // A socket that died: the time until the next one is not the link's.
  w.cut();t+=9000;w.heard(t);w.heard(t+100);
  assert.equal(w.limit(t+100),DEAD_MIN_MS);
  // A gap past DEAD_MAX_MS on a living socket (the page was stalled) is not learned either.
  feed(w,[DEAD_MAX_MS+1],t+100);
  assert.equal(w.limit(t+100+DEAD_MAX_MS+1),DEAD_MIN_MS);
});
