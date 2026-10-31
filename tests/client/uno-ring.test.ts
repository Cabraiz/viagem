// Card legivel-uno-e-inimigo-na-rocha (parte 1): the Uno's ring on the ground, in the hero ring's idiom, in Cartolina.
import test from 'node:test';
import assert from 'node:assert/strict';
import {UNO_BEAK,UNO_RING,UNO_RING_DEPTH,unoBeakAngle,unoRingBands,unoRingEllipse,unoRingKey,unoRingShown} from '../../src/client/render/chaveiro/uno-ring-rules.ts';
import {CAR_HALF} from '../../src/client/render/chaveiro/figures.ts';
import {isoOffset} from '../../src/client/render/chaveiro/iso.ts';
import {RING_CSS,beakPoints} from '../../src/client/render/you-rules.ts';
import {token} from '../../src/client/ui/tokens.ts';

const HEADINGS=Array.from({length:16},(_,i)=>i/16*Math.PI*2),VIEWS=[0,1,2,3];
/** (x, y) in the ellipse's own frame, normalized: 1 on the rim. */
const radius=(e:{rx:number;ry:number;rotation:number},x:number,y:number)=>{
  const c=Math.cos(-e.rotation),s=Math.sin(-e.rotation),u=x*c-y*s,v=x*s+y*c;
  return Math.hypot(u/e.rx,v/e.ry);
};

test('Cartolina: not the hero\'s Lilás, the allies\' Breu, the touch Amarelo nor the danger Cone', () => {
  assert.equal(UNO_RING.token,'--c-cartolina');
  const color=token(UNO_RING.token).toLowerCase();
  for(const other of ['--c-voce','--c-lilas','--c-breu','--c-amarelo','--c-cone'] as const)assert.notEqual(color,token(other).toLowerCase(),other);
});

test('the ring goes round the whole footprint, corners included, on every heading and view', () => {
  for(const view of VIEWS)for(const h of HEADINGS){
    const e=unoRingEllipse(CAR_HALF.l,CAR_HALF.w,h,view),c=Math.cos(h),s=Math.sin(h);
    for(const [l,w] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
      const p=isoOffset(l*CAR_HALF.l*c-w*CAR_HALF.w*s,l*CAR_HALF.l*s+w*CAR_HALF.w*c,0,view);
      assert.ok(radius(e,p.x,p.y)<1,`corner ${l},${w} at h=${h.toFixed(2)} view ${view}`);
    }
    // Not a huge halo: the nose's tip sits within 1/1.4 of the rim.
    const nose=isoOffset(CAR_HALF.l*c,CAR_HALF.l*s,0,view);
    assert.ok(radius(e,nose.x,nose.y)>1/1.5-1e-9,`nose h=${h.toFixed(2)}`);
  }
});

test('the beak leaves the ellipse where the nose points', () => {
  for(const view of VIEWS)for(const h of HEADINGS){
    const e=unoRingEllipse(CAR_HALF.l,CAR_HALF.w,h,view),t=unoBeakAngle(e.rx,e.ry,e.rotation,h,view);
    const tip=beakPoints(0,0,e.rx,e.ry,t,UNO_BEAK.length,UNO_BEAK.half)[2],base={x:e.rx*Math.cos(t),y:e.ry*Math.sin(t)};
    // Back to the screen: turn by the Graphics' rotation.
    const turn=(p:{x:number;y:number})=>({x:p.x*Math.cos(e.rotation)-p.y*Math.sin(e.rotation),y:p.x*Math.sin(e.rotation)+p.y*Math.cos(e.rotation)});
    const b=turn(base),n=isoOffset(Math.cos(h),Math.sin(h),0,view);
    const cross=(b.x*n.y-b.y*n.x)/Math.hypot(b.x,b.y)/Math.hypot(n.x,n.y),dot=b.x*n.x+b.y*n.y;
    assert.ok(Math.abs(cross)<1e-9&&dot>0,`beak base on the nose's ray h=${h.toFixed(2)} view ${view}`);
    const tp=turn(tip);assert.ok(Math.hypot(tp.x,tp.y)>Math.hypot(b.x,b.y),'tip out of the ring');
  }
});

test('the hero\'s bands and beak: Breu edge, Papel, colour, Breu inside, hard and nested', () => {
  const bands=unoRingBands();
  assert.deepEqual(bands.map(b=>b.color),['breu','papel','cor','breu']);
  const total=RING_CSS.breu+RING_CSS.voce+RING_CSS.papel;
  assert.equal(bands[1].band.width,total);
  assert.equal(bands[2].band.width,RING_CSS.voce);
  assert.equal(bands[3].band.width,RING_CSS.breu);
  // Each band's outer edge is no further out than the one before's (outer to inner).
  const outerEdge=(b:{width:number;offset:number})=>b.offset+b.width/2;
  for(let i=1;i<bands.length;i++)assert.ok(outerEdge(bands[i].band)<=outerEdge(bands[i-1].band)+1e-9,`band ${i}`);
  assert.deepEqual(UNO_BEAK,{length:RING_CSS.beak,half:RING_CSS.beak*.6,papel:RING_CSS.papel});
});

test('on the ground: over the car\'s shadow, under the fallen parts', () => {
  assert.ok(UNO_RING_DEPTH>-9979&&UNO_RING_DEPTH<-9978.999);
});

test('shown only while the run is on', () => {
  assert.equal(unoRingShown(undefined),false);
  assert.equal(unoRingShown({}),true);
  assert.equal(unoRingShown({ended:'victory'}),false);
  assert.equal(unoRingShown({ended:'defeat'}),false);
});

test('redrawn only when its shape changes', () => {
  assert.equal(unoRingKey(3,1,.5),unoRingKey(3,1,.501));
  assert.notEqual(unoRingKey(3,1,.5),unoRingKey(4,1,.5));
  assert.notEqual(unoRingKey(3,1,.5),unoRingKey(3,2,.5));
  assert.notEqual(unoRingKey(3,1,.5),unoRingKey(3,1,.6));
});
