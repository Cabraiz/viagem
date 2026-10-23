import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVE_LEASH,leashMoving,type Anchor} from '../../src/client/render/motion.ts';

// inimigos-animacao-auditoria: the bêbado pressed on the hero (real match, 30 s) jiggled ±0.05 u a tick around one
// point and was drawn walking the whole time, its facing flipping about once a second.
test('a jiggle against a player is standing; a walk walks every tick; a stop stops at once',()=>{
  const a:Anchor={ax:NaN,ay:NaN};
  assert.equal(leashMoving(a,10,10),false,'placed: still');
  let walked=0;
  for(let i=0;i<60;i++)if(leashMoving(a,10+(i%2?.05:-.05),10+(i%3-1)*.04))walked++;
  assert.equal(walked,0,'the sim pushing it to and fro: never walking');
  // A steady walk at 1.4 u/s (0.07 u a tick at 20 Hz): walking from the 2nd tick on, every tick after.
  const w:Anchor={ax:NaN,ay:NaN};leashMoving(w,0,0);
  const seq=[...Array(20)].map((_,i)=>leashMoving(w,(i+1)*.07,0));
  assert.deepEqual(seq.slice(0,2),[false,true]);assert.ok(seq.slice(1).every(Boolean),'no flicker while it walks');
  assert.equal(leashMoving(w,20*.07,0),false,'stopped: standing at once');
  // A slow push through a crowd (0.6 u/s, 0.03 u a tick) still walks, after MOVE_LEASH.
  const c:Anchor={ax:NaN,ay:NaN};leashMoving(c,0,0);
  const slow=[...Array(30)].map((_,i)=>leashMoving(c,(i+1)*.03,0));
  assert.equal(slow.indexOf(true),Math.floor(MOVE_LEASH/.03));assert.ok(slow.slice(slow.indexOf(true)).every(Boolean));
  // Walking then jiggling where it stopped: standing again.
  assert.ok(![...Array(20)].map((_,i)=>leashMoving(c,30*.03+(i%2?-.05:0),0)).some(Boolean));
});
