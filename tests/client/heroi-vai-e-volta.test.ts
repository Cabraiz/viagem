/**
 * BUG heroi-vai-e-volta ("estou sentindo, jogando o jogo, eu indo e voltando rapidamente"): the local hero drawn on a
 * phone link never walks backwards against the stick. scripts/lab-recuo.ts runs the real room simulation and the real
 * client pieces (batcher, reconcile, SelfCorrection, StepLerp) with latency, jitter, spikes, long phone frames and a busy
 * room; a recuo is a frame whose drawn hero moves against the stick's direction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runLab,PHONE_4G,type LinkOptions} from '../../scripts/lab-recuo.ts';
import {stepClock,STEP_CLOCK_MAX_S} from '../../src/client/framing.ts';
import {SelfCorrection,CORRECTION_MIN_FORWARD} from '../../src/client/net/smoothing.ts';

const CASES:[string,Partial<LinkOptions>][]=[
  ['4G 200 ms RTT + jitter, walking straight',{latency:80,jitter:80}],
  ['4G + a thumb turning at random',{latency:60,jitter:60,turns:true}],
  ['4G spikes (200 ms) + turns',{latency:60,jitter:60,turns:true,spikeChance:.05,spikeMs:200}],
  ['slow phone (300 ms frames) + turns',{latency:80,jitter:80,turns:true,longFrameChance:.05,longFrameMs:300}],
  ['all of it + a busy room',{latency:80,jitter:80,turns:true,longFrameChance:.03,longFrameMs:300,spikeChance:.03,spikeMs:200,busyChance:.02,busyMs:100}],
];

// A visible step back (half a CSS px at 46 px per unit). Under it: a critter's shove the phone did not predict, faded in
// along a wall a hair at a time (sem-arma-girando-no-chao: no orbit weapon keeps the critters off the hero any more;
// slow phone seed 1 drew three of 0.005 u).
const RECUO_VISIBLE=.01;
test('no recuo: the drawn hero never walks back against the stick, up to 200 ms RTT with jitter, spikes and long frames',()=>{
  for(const seed of [1,2]){
    for(const [name,c] of CASES){
      const r=runLab({...PHONE_4G,seconds:20,seed,...c});
      assert.ok(r.walkingFrames>300,name);
      assert.ok(r.worstBack<RECUO_VISIBLE,`${name} (seed ${seed}): ${r.recuos} recuos, worst ${r.worstBack.toFixed(3)} u, ${r.corrections} corrections up to ${r.worstCorrection.toFixed(2)} u`);
    }
  }
});

test('the old step clock (Phaser delta, 200 ms cap) on a slow phone fell behind the room: large corrections',()=>{
  const old=runLab({...PHONE_4G,seconds:20,seed:1,latency:80,jitter:80,turns:true,longFrameChance:.05,longFrameMs:300,phaserClock:true});
  const now=runLab({...PHONE_4G,seconds:20,seed:1,latency:80,jitter:80,turns:true,longFrameChance:.05,longFrameMs:300});
  assert.ok(old.worstCorrection>1,`old clock: worst correction ${old.worstCorrection.toFixed(2)} u`);
  assert.ok(now.worstCorrection<.5,`rAF clock: worst correction ${now.worstCorrection.toFixed(2)} u`);
});

test('stepClock: counts the rAF time in full (no 200 ms cap), drops a freeze over STEP_CLOCK_MAX_S',()=>{
  assert.equal(stepClock(0,300),.3);
  assert.ok(Math.abs(stepClock(.02,16)-.036)<1e-12);
  assert.equal(stepClock(.01,STEP_CLOCK_MAX_S*1000+1),.01);
  assert.equal(stepClock(.01,NaN),.01);assert.equal(stepClock(.01,-5),.01);
});

test('SelfCorrection: a correction behind a walking hero slows the drawing down, never turns it back',()=>{
  const c=new SelfCorrection();
  // The room put the prediction 0.6 u behind (west of) where the hero is drawn while it walks east.
  c.absorb({x:10,y:0},{x:9.4,y:0});
  let drawn=10,predicted=9.4;const motion={x:.033,y:0};
  for(let i=0;i<120;i++){
    predicted+=motion.x;c.step(16.7,40,motion);
    const next=predicted+c.x;
    assert.ok(next-drawn>=CORRECTION_MIN_FORWARD*motion.x-1e-9,`frame ${i}: ${(next-drawn).toFixed(4)} u`);
    drawn=next;
  }
  assert.ok(c.size<1e-2,`absorbed in 2 s (${c.size.toFixed(3)} u left)`);
  // Standing still, the same correction fades as before (no motion to keep).
  const still=new SelfCorrection();still.absorb({x:10,y:0},{x:9.4,y:0});
  for(let i=0;i<30;i++)still.step(16.7,40);
  assert.ok(still.size<.01);
});
