// 3g-rede-sem-teleporte: the local hero's correction, the others' buffer and extrapolation, the retry spread (pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SelfCorrection,ArrivalJitter,blendFactor,glideCeiling,along,CORRECTION_MAX_PX,CORRECTION_HIDE_UNITS,INTERP_MIN_MS,INTERP_MAX_MS,EXTRAPOLATE_MAX_MS,EXTRAPOLATE_MAX_UNITS} from '../../src/client/net/smoothing.ts';
import {StepLerp} from '../../src/client/framing.ts';

const sessionStore=new Map<string,string>();
(globalThis as any).sessionStorage??={getItem:(k:string)=>sessionStore.get(k)??null,setItem:(k:string,v:string)=>{sessionStore.set(k,v);},removeItem:(k:string)=>{sessionStore.delete(k);}};
const {jittered,retryWindow,RETRY_JITTER,RUN_RETRY_WINDOW_MS}=await import('../../src/client/net/client.ts');

/** Screen px of one unit at the game's zoom in the endless world (42·√2 world px × ~1 zoom). */
const UNIT_PX=60,FRAME=1000/60;

test('a small reconcile error fades in ~150-300 ms and never moves the hero more than 4 px in a frame',()=>{
  for(const size of [.05,.1,.25]){
    const c=new SelfCorrection();
    assert.equal(c.absorb({x:10,y:10},{x:10+size,y:10}),'smooth');
    // The drawing has not moved: drawn = new prediction + offset = the old spot.
    assert.ok(Math.abs(10+size+c.x-10)<1e-9&&Math.abs(c.y)<1e-9);
    let ms=0,peak=0;
    while(c.size>size*.05&&ms<2000){peak=Math.max(peak,c.step(FRAME,UNIT_PX));ms+=FRAME;}
    assert.ok(peak<=CORRECTION_MAX_PX+1e-9,`${size} u: ${peak.toFixed(2)} px in a frame`);
    assert.ok(ms<=320,`${size} u: 95% gone after ${ms.toFixed(0)} ms`);
  }
});

test('a medium error glides at the cap (still no jump); one over 3 units is hidden (the scene puffs)',()=>{
  const c=new SelfCorrection();
  c.absorb({x:0,y:0},{x:2,y:0});
  let frames=0,peak=0;
  while(c.size>0&&frames<600){peak=Math.max(peak,c.step(FRAME,UNIT_PX));frames++;}
  assert.equal(c.size,0);assert.ok(peak<=CORRECTION_MAX_PX+1e-9);assert.ok(frames>=30,'2 u at ≤4 px/frame takes ≥ 30 frames');
  const big=new SelfCorrection();
  assert.equal(big.absorb({x:0,y:0},{x:CORRECTION_HIDE_UNITS+.5,y:0}),'hide');assert.equal(big.size,0);
  // Errors add up: two smooth ones past the limit hide too.
  const twice=new SelfCorrection();
  assert.equal(twice.absorb({x:0,y:0},{x:2,y:0}),'smooth');assert.equal(twice.absorb({x:0,y:0},{x:1.5,y:0}),'hide');
  assert.equal(new SelfCorrection().absorb({x:1,y:1},{x:1,y:1}),'none');
});

test('the cap follows the zoom: a closer camera (more px per unit) glides slower in units, same px',()=>{
  const near=new SelfCorrection(),far=new SelfCorrection();
  near.absorb({x:0,y:0},{x:1,y:0});far.absorb({x:0,y:0},{x:1,y:0});
  assert.ok(near.step(FRAME,240)<=CORRECTION_MAX_PX+1e-9);far.step(FRAME,30);
  assert.ok(near.size>far.size);
});

test('StepLerp.shift moves the step in progress with the reconcile, so the drawing stays continuous',()=>{
  const s=new StepLerp();s.push({x:0,y:0});s.push({x:1,y:0});
  const before=s.at(.5);s.shift(.3,-.2);const after=s.at(.5);
  assert.ok(Math.abs(after.x-before.x-.3)<1e-9&&Math.abs(after.y-before.y+.2)<1e-9);
});

test('the others wait as long as the link jitters: 100 ms on a steady link, up to 250 ms on 3G',()=>{
  const steady=new ArrivalJitter();for(let t=0;t<3000;t+=100)steady.push(t);
  assert.equal(steady.delay(),INTERP_MIN_MS);
  const bad=new ArrivalJitter();let t=0;
  // Bunched frames: 30 ms, 30 ms, then 240 ms late (losses retransmitted under TCP).
  for(let i=0;i<60;i++){t+=i%3===2?240:30;bad.push(t);}
  assert.ok(bad.delay()>150,`delay ${bad.delay().toFixed(0)} ms`);assert.ok(bad.delay()<=INTERP_MAX_MS);
  // A drop (several seconds without frames) is not jitter.
  const dropped=new ArrivalJitter();for(let x=0;x<2000;x+=100)dropped.push(x);dropped.push(9000);
  assert.equal(dropped.delay(),INTERP_MIN_MS);
});

test('a late frame: the others go on along their last motion, capped, never frozen then jumping',()=>{
  // Between samples: plain interpolation.
  assert.equal(blendFactor(0,100,50),.5);
  // Past the newest (at 100, the one before at 0): along the motion, up to EXTRAPOLATE_MAX_MS.
  assert.equal(blendFactor(100,100,150,0),1.5);
  assert.equal(blendFactor(100,100,100+EXTRAPOLATE_MAX_MS*4,0),1+EXTRAPOLATE_MAX_MS/100);
  assert.deepEqual(along({x:0,y:0},{x:.2,y:.4},1.5),{x:.30000000000000004,y:.6000000000000001});
  // Frames handled in a burst (0.5 ms apart): the gap counts as one send period, not a speed of 600 u/s.
  assert.equal(blendFactor(1000.5,1000.5,1150.5,1000),1+EXTRAPOLATE_MAX_MS/INTERP_MIN_MS);
  // A dash between the last two frames is not extrapolated past EXTRAPOLATE_MAX_UNITS.
  const far=along({x:0,y:0},{x:8,y:0},2.5);assert.ok(Math.abs(far.x-8-EXTRAPOLATE_MAX_UNITS)<1e-9&&far.y===0);
  // Enemies: half a glide at most, and never past EXTRAPOLATE_MAX_MS.
  assert.equal(glideCeiling(100),1.5);assert.equal(glideCeiling(400),1+EXTRAPOLATE_MAX_MS/400);
});

test('retries are spread ±25% so phones dropped together do not knock together; a match keeps knocking for the run',()=>{
  assert.equal(jittered(1000,.5),1000);
  assert.equal(jittered(1000,0),1000*(1-RETRY_JITTER));assert.ok(jittered(1000,.999)<=1000*(1+RETRY_JITTER));
  assert.equal(retryWindow('combat'),RUN_RETRY_WINDOW_MS);assert.equal(retryWindow('countdown'),RUN_RETRY_WINDOW_MS);
  assert.ok(retryWindow('lobby')<RUN_RETRY_WINDOW_MS);assert.ok(retryWindow(undefined)<RUN_RETRY_WINDOW_MS);
});
