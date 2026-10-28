// Card NEW-20261021-ORQ-passo-sem-deslizar (21/10): the walk cycle follows the ground walked, so the planted foot keeps
// pace with the ground (the clock-driven cycle drew a foot going back ~7× slower than the city's ground went by).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FACING_TELEPORT,HERO_GAIT,RUN_STRIDE,WALK_STRIDE,WALK_TUNE,cycleFrame,screenMotion,walkCycles} from '../../src/client/sprites/sprite-motion.ts';
import {movementPlan,phaseStride,runPhase} from '../../src/client/sprites/movement128.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
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

test('the city hero at full speed across the screen: ~4.4 cycles a second with the foot locked, as shipped (the hero at the Uno ruler)', ()=>{
  const speed=CITY_HERO_SPEED*HERO_SPEED_MULT,dt=1/60,lock=WALK_TUNE.lock;
  const second=()=>{let cycles=0;for(let i=0;i<60;i++)cycles+=walkCycles(speed*dt/Math.SQRT2,-speed*dt/Math.SQRT2,0,FIGURE);return cycles;};
  try{
    WALK_TUNE.lock=1;const locked=second();
    assert.ok(locked>4&&locked<5,`cycles in 1 s, foot locked: ${locked}`);
    WALK_TUNE.lock=.5;near(second(),locked/2);
  }finally{WALK_TUNE.lock=lock;}
  // passo-3x-mais-lento: the user keeps the hero's speed and wants ~4 cycles a second; the hero drawn at the Uno's
  // ruler (escala-heroi-uno-inimigo) walks that with the foot locked.
  assert.equal(WALK_TUNE.lock,1,'the game ships the walk with the foot locked');
});

test('cycleFrame wraps over the cycle and never leaves the clip', ()=>{
  assert.equal(cycleFrame(0,16),0);
  assert.equal(cycleFrame(.5,16),8);
  assert.equal(cycleFrame(1.999999,16),15);
  assert.equal(cycleFrame(2,16),0);
  assert.equal(cycleFrame(3.25,6),1);
});

test('the run without a phase table (RUN_STRIDE): ~2.4 cycles a second across the screen, the foot locked', ()=>{
  const speed=CITY_HERO_SPEED*HERO_SPEED_MULT,dt=1/60;let cycles=0;
  for(let i=0;i<60;i++)cycles+=walkCycles(speed*dt/Math.SQRT2,-speed*dt/Math.SQRT2,0,FIGURE,RUN_STRIDE,1);
  assert.ok(cycles>2.2&&cycles<2.7,`run cycles in 1 s: ${cycles}`);
  assert.ok(RUN_STRIDE>1.6*WALK_STRIDE,'the run is drawn with a longer stride than the walk');
  assert.equal(HERO_GAIT.run,true,'a class with a run runs by default');
});

test('runPhase: the pose by the ground walked, and the sprite shifted by the planted foot\'s travel walked in the pose', ()=>{
  // 4 poses: two stance poses (the foot goes back 4 and 2 cell px) and two flight poses.
  const phase={d:[.1,.05,.2,.15],v:[[4,0],[2,1],[0,0],[0,0]] as [number,number][]};
  assert.equal(phaseStride(phase),.5);
  assert.deepEqual(runPhase(phase,0),{frame:0,shift:[0,0]});
  const mid=runPhase(phase,.05/.5);assert.equal(mid.frame,0);near(mid.shift[0],2);
  const second=runPhase(phase,(.1+.025)/.5);assert.equal(second.frame,1);near(second.shift[0],1);near(second.shift[1],.5);
  assert.deepEqual(runPhase(phase,(.1+.05+.1)/.5),{frame:2,shift:[0,0]},'flight: nothing to keep on the ground');
  assert.equal(runPhase(phase,1.99999).frame,3);assert.equal(runPhase(phase,2).frame,0);
});

test('the viciado\'s run tables (passo-3x-mais-lento): ~3 cycles a second or less at the city speed, with stance poses', ()=>{
  setArtIndex(parseArtIndex(JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8'))));
  const speed=CITY_HERO_SPEED*HERO_SPEED_MULT,R=Math.SQRT1_2;
  // each drawn direction's world heading in camera view 0
  for(const [d,[ux,uy]] of [['W',[-R,R]],['SE',[1,0]],['NW',[-1,0]],['S',[R,R]],['N',[-R,-R]]] as const){
    const plan=movementPlan('viciado-em-bet','walk',d);assert.ok(plan?.phase,`${d}: run16 with a phase table`);
    let cycles=0;for(let i=0;i<60;i++)cycles+=walkCycles(ux*speed/60,uy*speed/60,0,FIGURE,phaseStride(plan.phase),1);
    // the clip holds two of the run's cycles
    assert.ok(cycles*2<=3.2,`${d}: ${cycles*2} cycles a second`);
    assert.ok(plan.phase.v.some(v=>v[0]||v[1]),`${d}: stance poses`);
  }
  setArtIndex(parseArtIndex(undefined));
});
