import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVE_LEASH,START_LEASH,leashMoving,type Anchor} from '../../src/client/render/motion.ts';

const fresh=():Anchor=>({ax:NaN,ay:NaN});
/** Ticks of a walk from (0,0) along x at `step` u a tick, from the first: whether each walked. */
const walk=(a:Anchor,step:number,ticks:number,from=0)=>[...Array(ticks)].map((_,i)=>leashMoving(a,from+(i+1)*step,0));

// inimigos-animacao-auditoria: the bêbado pressed on the hero (real match, 30 s) jiggled up to ±0.08 u a tick around
// one point and was drawn walking the whole time, its facing flipping about once a second.
test('a jiggle against a player is standing, also right after a walk',()=>{
  const a=fresh();
  assert.equal(leashMoving(a,10,10),false,'placed: standing');
  let walked=0;
  for(let i=0;i<200;i++)if(leashMoving(a,10+(i%2?.08:-.08),10+(i%3-1)*.08))walked++;
  assert.equal(walked,0,'the sim pushing it to and fro: never walking');
  // It walked up to the hero and stopped there: the jiggle where it stopped (towards where it came from too) stands.
  const b=fresh();leashMoving(b,0,0);walk(b,.07,20);
  const stop=20*.07,after=[...Array(200)].map((_,i)=>leashMoving(b,stop+(i%2?.08:-.08),(i%3-1)*.05));
  assert.equal(after.filter(Boolean).length,0,'pressed on the hero after the walk: standing');
});

test('a walk walks every tick once started; a stop stands at once; a slow push through a crowd still walks',()=>{
  // A steady walk at 1.4 u/s (0.07 u a tick at 20 Hz): walking from its 5th tick (0.25 s, START_LEASH), then every tick.
  const w=fresh();leashMoving(w,0,0);
  const seq=walk(w,.07,30),first=seq.indexOf(true);
  assert.ok(first>=0&&first<=4,`starts at tick ${first}`);assert.ok(seq.slice(first).every(Boolean),'no flicker while it walks');
  assert.equal(leashMoving(w,30*.07,0),false,'stopped: standing at once');
  // 0.6 u/s (0.03 u a tick): the anchor settles behind it farther than START_LEASH, so it starts and keeps walking.
  const c=fresh();leashMoving(c,0,0);
  const slow=walk(c,.03,60),s0=slow.indexOf(true);
  assert.ok(s0>0&&s0<20,`slow start at tick ${s0}`);assert.ok(slow.slice(s0).every(Boolean));
  assert.ok(START_LEASH>MOVE_LEASH);
});
