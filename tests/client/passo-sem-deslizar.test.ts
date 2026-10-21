// Card NEW-20261021-ORQ-passo-sem-deslizar (21/10): the walk cycle follows the ground walked, so the planted foot keeps
// pace with the ground (the clock-driven cycle drew a foot going back ~7× slower than the city's ground went by).
import test from 'node:test';
import assert from 'node:assert/strict';
import {FACING_TELEPORT,HERO_GAIT,RUN_STRIDE,WALK_STRIDE,WALK_TUNE,cycleFrame,screenMotion,walkCycles} from '../../src/client/sprites/sprite-motion.ts';
import {CITY_HERO_SPEED,HERO_SPEED_MULT} from '../../src/maps/index.ts';
import {HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';

const FIGURE=96*.5444722215136416*HERO_DRAW_SCALE; // a hero's drawn height in the city (world px)
const near=(a:number,b:number,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b}`);

test('locked, the drawn stride per cycle × cycles = the screen distance walked; at lock k, k of it', ()=>{
  const lock=WALK_TUNE.lock;
  try{
    for(const [dx,dy] of [[.05,0],[0,.05],[.03,-.04],[-.05,.05],[.035,.035]]){
      const s=screenMotion(dx,dy,0);
      WALK_TUNE.lock=1;near(walkCycles(dx,dy,0,FIGURE)*WALK_STRIDE*FIGURE,Math.hypot(s.x,s.y));
      WALK_TUNE.lock=.5;near(walkCycles(dx,dy,0,FIGURE)*WALK_STRIDE*FIGURE,Math.hypot(s.x,s.y)/2);
    }
  }finally{WALK_TUNE.lock=lock;}
});

test('the foreshortening: the same world step across the screen plays twice the cycle of one up the screen', ()=>{
  const across=walkCycles(.05,-.05,0,FIGURE),up=walkCycles(-.05,-.05,0,FIGURE);
  near(across/up,2);
  // Every camera view sees the same screen distance for the same screen heading.
  for(let view=1;view<4;view++)near(walkCycles(.05,0,view,FIGURE)+walkCycles(0,.05,view,FIGURE),walkCycles(.05,0,0,FIGURE)+walkCycles(0,.05,0,FIGURE));
});

test('standing still never treads, a teleport adds nothing, and a bigger figure takes longer strides', ()=>{
  assert.equal(walkCycles(0,0,0,FIGURE),0);
  assert.equal(walkCycles(FACING_TELEPORT+.1,0,0,FIGURE),0);
  assert.equal(walkCycles(.1,0,0,0),0);
  near(walkCycles(.1,0,0,FIGURE)/walkCycles(.1,0,0,2*FIGURE),2);
});

test('the city hero at full speed across the screen: ~8 cycles a second with the foot locked, ~4 as shipped', ()=>{
  const speed=CITY_HERO_SPEED*HERO_SPEED_MULT,dt=1/60,lock=WALK_TUNE.lock;
  const second=()=>{let cycles=0;for(let i=0;i<60;i++)cycles+=walkCycles(speed*dt/Math.SQRT2,-speed*dt/Math.SQRT2,0,FIGURE);return cycles;};
  try{
    WALK_TUNE.lock=1;const locked=second();
    assert.ok(locked>7.5&&locked<9,`cycles in 1 s, foot locked: ${locked}`);
    WALK_TUNE.lock=.5;near(second(),locked/2);
  }finally{WALK_TUNE.lock=lock;}
  // passo-3x-mais-lento: the user keeps the hero's speed and wants a slower walk; half until the viciado gets a run.
  assert.equal(WALK_TUNE.lock,.5,'the game ships the walk at half the ground');
});

test('cycleFrame wraps over the cycle and never leaves the clip', ()=>{
  assert.equal(cycleFrame(0,16),0);
  assert.equal(cycleFrame(.5,16),8);
  assert.equal(cycleFrame(1.999999,16),15);
  assert.equal(cycleFrame(2,16),0);
  assert.equal(cycleFrame(3.25,6),1);
});

test('the run (passo-3x-mais-lento): its longer drawn stride keeps the foot locked at ~4.6 cycles a second across the screen', ()=>{
  const speed=CITY_HERO_SPEED*HERO_SPEED_MULT,dt=1/60;let cycles=0;
  for(let i=0;i<60;i++)cycles+=walkCycles(speed*dt/Math.SQRT2,-speed*dt/Math.SQRT2,0,FIGURE,RUN_STRIDE,1);
  assert.ok(cycles>4.2&&cycles<5,`run cycles in 1 s: ${cycles}`);
  assert.ok(RUN_STRIDE>1.6*WALK_STRIDE,'the run is drawn with a longer stride than the walk');
  assert.equal(HERO_GAIT.run,true,'a class with a run runs by default');
});
