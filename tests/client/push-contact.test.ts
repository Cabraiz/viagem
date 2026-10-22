/**
 * Card empurrar-uno (src/client/render/chaveiro/push-contact.ts): a pusher is drawn with its palms PUSH_REACH ahead of it
 * on the Uno's footprint (CAR_HALF at the drawn heading), from any side and heading; the shift eases in and back out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PUSH_REACH,PUSH_SHIFT_MAX,PushShifts,pushContact} from '../../src/client/render/chaveiro/push-contact.ts';
import {CAR_HALF} from '../../src/client/render/chaveiro/figures.ts';

const near=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<eps;
/** The palms of a hero drawn with its shift: PUSH_REACH ahead of it along its push. */
const palms=(hero:{x:number;y:number},c:NonNullable<ReturnType<typeof pushContact>>)=>({x:hero.x+c.shift.x+c.dir.x*PUSH_REACH,y:hero.y+c.shift.y+c.dir.y*PUSH_REACH});
/** Where a world point lies in the car's frame (along its length, across it). */
const local=(p:{x:number;y:number},car:{x:number;y:number;heading:number})=>{
  const c=Math.cos(car.heading),s=Math.sin(car.heading),x=p.x-car.x,y=p.y-car.y;return {l:x*c+y*s,w:-x*s+y*c};
};

test('pushing from behind: the palms land on the back bumper, whatever the gap the room left', ()=>{
  const car={x:10,y:5,heading:0};
  for(const gap of [1.05,1.6,2.2]){
    const hero={x:car.x-gap,y:car.y},c=pushContact(hero,car,{x:1,y:0})!;
    assert.deepEqual(c.dir,{x:1,y:0});
    const p=local(palms(hero,c),car);
    assert.ok(near(p.l,-CAR_HALF.l)&&near(p.w,0),`gap ${gap}: palms at ${JSON.stringify(p)}`);
  }
});

test('every heading and side (8 × 4): the palms are on the footprint\'s edge, the hero outside it facing in', ()=>{
  for(let h=0;h<8;h++)for(const side of [0,1,2,3]){
    const car={x:0,y:0,heading:h*Math.PI/4},a=car.heading+side*Math.PI/2,dist=side%2?CAR_HALF.w+.9:CAR_HALF.l+.9;
    const hero={x:-Math.cos(a)*dist,y:-Math.sin(a)*dist},c=pushContact(hero,car,{x:Math.cos(a),y:Math.sin(a)})!;
    const p=local(palms(hero,c),car),edge=Math.max(Math.abs(p.l)/CAR_HALF.l,Math.abs(p.w)/CAR_HALF.w);
    assert.ok(near(edge,1,1e-6),`heading ${h} side ${side}: palms ${JSON.stringify(p)}`);
    const body=local({x:hero.x+c.shift.x,y:hero.y+c.shift.y},car);
    assert.ok(Math.max(Math.abs(body.l)/CAR_HALF.l,Math.abs(body.w)/CAR_HALF.w)>1,`heading ${h} side ${side}: the body outside the car`);
  }
});

test('a stick past the car\'s corner faces the centre instead; no stick too', ()=>{
  const car={x:0,y:0,heading:0},hero={x:-2,y:1.5};
  for(const along of [{x:0,y:1},undefined]){
    const c=pushContact(hero,car,along)!,d=Math.hypot(hero.x,hero.y);
    assert.ok(near(c.dir.x,-hero.x/d)&&near(c.dir.y,-hero.y/d),JSON.stringify(c.dir));
    const p=local(palms(hero,c),car);
    assert.ok(near(Math.max(Math.abs(p.l)/CAR_HALF.l,Math.abs(p.w)/CAR_HALF.w),1,1e-6),JSON.stringify(p));
  }
  assert.equal(pushContact({x:0,y:0},car),undefined,'on the centre: no push drawn');
});

test('the shift never passes PUSH_SHIFT_MAX (a hero far from the car is not dragged onto it)', ()=>{
  const c=pushContact({x:-9,y:0},{x:0,y:0,heading:0},{x:1,y:0})!;
  assert.ok(near(Math.hypot(c.shift.x,c.shift.y),PUSH_SHIFT_MAX));
});

test('PushShifts: eases toward the target (no jump), holds it, and eases back to none on letting go', ()=>{
  const s=new PushShifts(),to={x:.4,y:0};
  const first=s.step('a',to,16);
  assert.ok(first.x>0&&first.x<.1,`first frame ${first.x}`);
  let now=first;for(let i=0;i<60;i++)now=s.step('a',to,16);
  assert.ok(near(now.x,.4,1e-3),`held ${now.x}`);
  const back=s.step('a',undefined,16);
  assert.ok(back.x<.4&&back.x>.3,`eases back ${back.x}`);
  for(let i=0;i<120;i++)now=s.step('a',undefined,16);
  assert.deepEqual(now,{x:0,y:0});
  assert.deepEqual(s.step('b',undefined,16),{x:0,y:0},'never pushed: none');
});
