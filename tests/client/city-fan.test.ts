// NEW-20261018-ORQ-chunks-cidade-sem-pico: the city's small shapes as triangle fans, not Phaser's earcut.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CIRCLE_MAX_SIDES,CIRCLE_MIN_SIDES,CIRCLE_SAGITTA_PX,circlePolygon,circleSides,fanTriangles,isConvex} from '../../src/client/render/city/fan.ts';
import {SPECKS} from '../../src/client/render/city/decor.ts';

const area=(t:number[])=>Math.abs((t[2]-t[0])*(t[5]-t[1])-(t[3]-t[1])*(t[4]-t[0]))/2;
const polyArea=(ps:{x:number;y:number}[])=>Math.abs(ps.reduce((a,p,i)=>{const q=ps[(i+1)%ps.length];return a+p.x*q.y-q.x*p.y;},0))/2;

test('a speck is a regular polygon within CIRCLE_SAGITTA_PX of its circle: 8 sides at the specks\' sizes',()=>{
  for(const r of [SPECKS.px[0],SPECKS.px[1],1.4])assert.equal(circleSides(r),CIRCLE_MIN_SIDES,`r ${r}`);
  for(const r of [0.5,1,2,3,5,8,13,21,40]){
    const n=circleSides(r);
    assert.ok(n>=CIRCLE_MIN_SIDES&&n<=CIRCLE_MAX_SIDES,`r ${r}: ${n}`);
    assert.ok(r*(1-Math.cos(Math.PI/n))<=CIRCLE_SAGITTA_PX+1e-12,`r ${r}: the edge stays within the sagitta`);
    const ring=circlePolygon(10,-4,r);
    assert.equal(ring.length,n);
    for(const p of ring)assert.ok(Math.abs(Math.hypot(p.x-10,p.y+4)-r)<1e-9,'corners on the circle');
    assert.ok(isConvex(ring));
  }
  assert.equal(circleSides(500),0,'a big circle goes back to Phaser');
  assert.deepEqual(circlePolygon(0,0,500),[]);
  for(const r of [0,-1,NaN,Infinity])assert.equal(circleSides(r),0);
});

test('isConvex: quads, triangles and the speck rings yes; concave, straight, degenerate or too short no',()=>{
  assert.ok(isConvex([{x:0,y:0},{x:4,y:0},{x:4,y:3}]));
  assert.ok(isConvex([{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}]));
  assert.ok(isConvex([{x:0,y:3},{x:4,y:3},{x:4,y:0},{x:0,y:0}]),'either winding');
  assert.ok(!isConvex([{x:0,y:0},{x:4,y:0},{x:1,y:1},{x:0,y:4}]),'a dart');
  assert.ok(!isConvex([{x:0,y:0},{x:2,y:0},{x:4,y:0},{x:4,y:3}]),'a straight corner');
  assert.ok(!isConvex([{x:0,y:0},{x:4,y:0}]));
  assert.ok(!isConvex([{x:0,y:0},{x:0,y:0},{x:0,y:0}]));
  assert.ok(!isConvex([{x:0,y:0},{x:4,y:0},{x:4,y:NaN}]));
  assert.ok(!isConvex([{x:0,y:0},{x:4,y:0},{x:0,y:4},{x:4,y:4}]),'a bow tie');
});

test('fanTriangles cover a convex polygon exactly: n−2 triangles, the same area',()=>{
  for(const ps of [[{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}],circlePolygon(3,3,2.5),circlePolygon(0,0,30)]){
    const tris=fanTriangles(ps);
    assert.equal(tris.length,ps.length-2);
    assert.ok(Math.abs(tris.reduce((a,t)=>a+area(t),0)-polyArea(ps))<1e-9);
  }
});

test('city-layer: decor, ground quads and block faces fill through fillShape (fan when convex), circles through circlePolygon',()=>{
  const src=readFileSync(new URL('../../src/client/render/city/city-layer.ts',import.meta.url),'utf8');
  const fill=src.slice(src.indexOf('function fillShape('),src.indexOf('/** prefers-reduced-motion'));
  assert.match(fill,/if\(!isConvex\(points\)\)\{g\.fillPoints\(points as Pt\[\],true\);return;\}/);
  assert.match(fill,/for\(const t of fanTriangles\(points\)\)g\.fillTriangle\(/);
  assert.match(fill,/const ring=circlePolygon\(p\.cx,p\.cy,p\.r\);\s*if\(ring\.length\)fillShape\(g,ring\);else g\.fillCircle/);
  const bake=src.slice(src.indexOf('  private bakeGround('),src.indexOf('  private decorOverFlat('));
  assert.ok(!/\.fillPoints\(|\.fillCircle\(/.test(bake),'the baked ground calls no earcut path of its own');
  assert.match(src,/for\(const face of geo\.faces\)fillShape\(gr\.fillStyle\(colors\[face\.kind\],1\),face\.points\);/);
});
