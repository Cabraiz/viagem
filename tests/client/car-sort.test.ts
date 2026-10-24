/**
 * Card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima: the figures near the Uno sort against its footprint
 * (render/chaveiro/car-sort.ts), not its centre: behind the far side near an end (in front of the centre's depth line)
 * one was drawn over the lataria. Every camera view; far figures keep their plain depth; the box is the renderer's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_HALF_LENGTH,CAR_HALF_WIDTH} from '../../src/contract/index.ts';
import {viewDepth} from '../../src/client/projection.ts';
import {CAR_SORT_GAP,CAR_SORT_REACH,carSortDepth,inFrontOfCar,towardViewer,type CarSort} from '../../src/client/render/chaveiro/car-sort.ts';
import {CAR_HALF} from '../../src/client/render/chaveiro/figures.ts';

const sortOf=(x:number,y:number,heading:number,view:number):CarSort=>({x,y,heading,depth:viewDepth({x,y},view),toward:towardViewer(view)});
/** A point in the car's frame: `l` along its heading, `w` across it. */
const at=(car:CarSort,l:number,w:number)=>{const c=Math.cos(car.heading),s=Math.sin(car.heading);return {x:car.x+l*c-w*s,y:car.y+l*s+w*c};};

test('the collision box is the drawn Uno\'s footprint (figures.ts CAR_HALF) to the centimetre',()=>{
  assert.ok(Math.abs(CAR_HALF.l-CAR_HALF_LENGTH)<.01,`${CAR_HALF.l} vs ${CAR_HALF_LENGTH}`);
  assert.ok(Math.abs(CAR_HALF.w-CAR_HALF_WIDTH)<.01,`${CAR_HALF.w} vs ${CAR_HALF_WIDTH}`);
});

test('behind the far side near an end: the centre said "in front" (drawn over the car), the footprint says behind',()=>{
  for(const view of [0,1,2,3]){
    for(let k=0;k<16;k++){
      const car=sortOf(20,30,k/16*Math.PI*2,view),t=car.toward;
      // The far side is the one whose outward normal points away from the viewer.
      const c=Math.cos(car.heading),s=Math.sin(car.heading),sideFar=(-s*t.x+c*t.y)>0?-1:1;
      for(const l of [-1.2,-.6,0,.6,1.2]){
        const p=at(car,l,sideFar*(CAR_HALF_WIDTH+.3)),natural=viewDepth(p,view);
        if(Math.abs(sideFar*(-s*t.x+c*t.y))<1e-6)continue;
        assert.equal(inFrontOfCar(p,car),false,`view ${view} heading ${k}/16 l ${l}`);
        assert.ok(carSortDepth(p,natural,car)<=car.depth-CAR_SORT_GAP+1e-9,`view ${view} heading ${k}/16 l ${l}: under the car`);
        // And the near side's mirror stands over it.
        const q=at(car,l,-sideFar*(CAR_HALF_WIDTH+.3));
        assert.ok(carSortDepth(q,viewDepth(q,view),car)>=car.depth+CAR_SORT_GAP-1e-9,`view ${view} heading ${k}/16 l ${l}: over the car`);
      }
    }
  }
  // The very case of the print: the centre's depth put the figure in front.
  const car=sortOf(20,30,0,0),p=at(car,1.2,-(CAR_HALF_WIDTH+.3)),natural=viewDepth(p,0);
  assert.ok(natural>car.depth,'the old sort drew it over the car');
  assert.ok(carSortDepth(p,natural,car)<car.depth,'now under it');
});

test('bumpers: behind the rear one under the car, in front of the front one over it (the car pointing at the viewer)',()=>{
  for(const view of [0,1,2,3]){
    const t=towardViewer(view),car=sortOf(5,5,Math.atan2(t.y,t.x),view);
    const front=at(car,CAR_HALF_LENGTH+.3,0),rear=at(car,-CAR_HALF_LENGTH-.3,0);
    assert.ok(carSortDepth(front,viewDepth(front,view),car)>car.depth);
    assert.ok(carSortDepth(rear,viewDepth(rear,view),car)<car.depth);
  }
});

test('far figures and no car: the plain depth',()=>{
  const car=sortOf(0,0,.4,1),p=at(car,0,CAR_HALF_WIDTH+CAR_SORT_REACH+.1);
  assert.equal(inFrontOfCar(p,car),undefined);
  assert.equal(carSortDepth(p,123.4,car),123.4);
  assert.equal(carSortDepth(p,123.4,undefined),123.4);
  // A figure already on its side of the car keeps its own depth (only the wrong side is clamped).
  const t=car.toward,ahead={x:car.x+t.x*2,y:car.y+t.y*2},d=viewDepth(ahead,1);
  assert.ok(d>car.depth+CAR_SORT_GAP);
  assert.equal(carSortDepth(ahead,d,car),d);
});
