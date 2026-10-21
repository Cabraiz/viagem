import test from 'node:test';
import assert from 'node:assert/strict';
import {HEART_CSS,LOW_GAP_CSS,crackPoints,heartPoints,lowHpText,lowMarkLayout,lowMarkOn} from '../../src/client/render/low-hp-mark.ts';
import {LOW_HP} from '../../src/client/render/you-rules.ts';

const box=(pts:readonly {x:number;y:number}[])=>({
  left:Math.min(...pts.map(p=>p.x)),right:Math.max(...pts.map(p=>p.x)),top:Math.min(...pts.map(p=>p.y)),bottom:Math.max(...pts.map(p=>p.y))});
/** Point in polygon (even-odd). */
function inside(p:{x:number;y:number},poly:readonly {x:number;y:number}[]){
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }
  return hit;
}

test('heart: closed, about `width` wide around its center, notch on top and tip at the bottom',()=>{
  const pts=heartPoints(100,50,32);
  assert.deepEqual(pts[0],pts[pts.length-1]);
  const b=box(pts);
  assert.ok(Math.abs(b.right-b.left-32)<2,`width ${b.right-b.left}`);
  assert.ok(Math.abs((b.left+b.right)/2-100)<.01);
  // The tip is the lowest point, on the center line; the notch (start of the 2nd curve's end) is below the lobes' tops.
  const tip=pts.reduce((m,p)=>p.y>m.y?p:m);assert.ok(Math.abs(tip.x-100)<.01);
  const notch=pts.find(p=>Math.abs(p.x-100)<.01&&p.y<tip.y)!;assert.ok(notch.y>b.top+3);
  // Scales with the width.
  const small=box(heartPoints(0,0,HEART_CSS.width));assert.ok(Math.abs(small.right-small.left-HEART_CSS.width)<1);
});

test('crack: zigzags from the notch to near the tip, every point inside the heart',()=>{
  const heart=heartPoints(0,0,64),crack=crackPoints(0,0,64);
  assert.ok(crack.length>=4);
  for(const p of crack.slice(1,-1))assert.ok(inside(p,heart),`crack point ${p.x},${p.y} outside`);
  // Turns left and right (a crack, not a straight cut).
  const sides=crack.slice(1,-1).map(p=>Math.sign(p.x));
  assert.ok(sides.includes(-1)&&sides.includes(1));
  // Goes downwards.
  for(let i=1;i<crack.length;i++)assert.ok(crack[i].y>crack[i-1].y);
});

test('low mark: only while the bar shows, the hero is up and below LOW_HP; never reads 0',()=>{
  assert.equal(lowMarkOn(true,.1),true);
  assert.equal(lowMarkOn(true,LOW_HP-.001),true);
  assert.equal(lowMarkOn(true,LOW_HP),false);
  assert.equal(lowMarkOn(false,.1),false);
  assert.equal(lowMarkOn(true,.1,true),false);
  assert.equal(lowMarkOn(true,0),false);
  assert.equal(lowHpText(7),'7');assert.equal(lowHpText(2.2),'3');assert.equal(lowHpText(.3),'1');assert.equal(lowHpText(NaN),'1');
});

test('low mark layout: heart left of the bar, number right of it, both on the bar\'s height, at any zoom',()=>{
  for(const s of [.5,1,2]){
    const left=100,top=200,w=28.8*s,h=4.8*s,l=lowMarkLayout(left,top,w,h,s);
    assert.equal(l.heart.y,top+h/2);assert.equal(l.number.y,top+h/2);
    assert.equal(l.heart.width,HEART_CSS.width*s);
    // Heart's right edge (Breu edge included) is LOW_GAP_CSS clear of the bar's Papel edge (1 CSS px outside the track).
    const heartRight=l.heart.x+l.heart.width/2+HEART_CSS.edge*s;
    assert.ok(Math.abs(left-s-heartRight-LOW_GAP_CSS*s)<1e-9);
    assert.ok(Math.abs(l.number.x-(left+w+s+LOW_GAP_CSS*s))<1e-9);
  }
});
