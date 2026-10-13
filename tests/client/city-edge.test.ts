/**
 * Cidade Nevada Breu edges on the ground marks (card NEW-20261012-E8-cidade-contorno-breu): the "você" ring and its
 * beak, the map fichas (with the caído's Cone ring), the destination mark and the contact shadows. Off the city every
 * rule returns main's exact values (the island and the endless map draw what they drew).
 * Run: node --experimental-strip-types --test tests/client/city-edge.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RING_CSS,RING_CITY_BREU_CSS,beakPoints,grownBeak,ringBands} from '../../src/client/render/you-rules.ts';
import {plateRings} from '../../src/client/render/map-label-rules.ts';
import {BREU,CITY_BREU_EDGE_CSS,CITY_CONTACT_SHADOW,CITY_SHADOW_KEY,CITY_SHADOW_TEXTURE,ISLAND_HERO_SHADOW,destinationMark,heroShadow,hordeShadowKey} from '../../src/client/render/city-edge-rules.ts';

const edges=(band:{width:number;offset:number})=>[band.offset-band.width/2,band.offset+band.width/2];

test('você ring: main\'s bands off the city; in the city a Breu band of 2 CSS px right outside the Papel',()=>{
  // main's ringBands(), literally.
  assert.deepEqual(ringBands(),{papel:{width:8,offset:0},voce:{width:4,offset:0},breu:{width:2,offset:-3}});
  assert.deepEqual(ringBands(false),ringBands());
  const city=ringBands(true);
  assert.deepEqual({papel:city.papel,voce:city.voce,breu:city.breu},ringBands(),'the inner bands do not move');
  const total=RING_CSS.papel+RING_CSS.voce+RING_CSS.breu;
  assert.equal(RING_CITY_BREU_CSS,2);
  assert.deepEqual(edges(city.outer!),[total/2,total/2+2],'touches the Papel, 2 CSS px wide');
});

test('você beak: the city\'s Breu beak keeps a 2 px edge along both slanted sides of the Papel beak',()=>{
  const length=RING_CSS.beak+2,half=RING_CSS.beak*.6+2,e=2,g=grownBeak(length,half,e);
  const inner=beakPoints(0,0,30,15,0,length,half),outer=beakPoints(0,0,30,15,0,g.length,g.half);
  // Facing right: distance from the Papel side line to the Breu side line is e.
  const side=(p:{x:number;y:number}[],k:number)=>({a:p[k],b:p[2]});
  for(const k of [0,1]){
    const s=side(outer,k),q=inner[k],dx=s.b.x-s.a.x,dy=s.b.y-s.a.y;
    const tipIn=inner[2],dist=(p:{x:number;y:number})=>Math.abs((p.x-s.a.x)*dy-(p.y-s.a.y)*dx)/Math.hypot(dx,dy);
    assert.ok(Math.abs(dist(tipIn)-e)<1e-9,`side ${k}: tip`);
    assert.ok(Math.abs(dist(q)-e)<1e-9,`side ${k}: base corner`);
  }
  assert.ok(g.length>length+e&&g.half>half+e*.99);
});

test('map fichas: the caído\'s Cone ring off the city (main); a Breu ring outermost in the city',()=>{
  assert.deepEqual(plateRings(false,false),[]);
  assert.deepEqual(plateRings(true,false),[{color:'cone',out:.5}]);
  assert.deepEqual(plateRings(false,true),[{color:'breu',out:.5}]);
  assert.deepEqual(plateRings(true,true),[{color:'breu',out:1.5},{color:'cone',out:.5}],'Breu outside the Cone signal');
  // Rings are one border wide and touch: [0,b] outside the body is the first, [b,2b] the next.
  for(const rings of [plateRings(true,true),plateRings(false,true)])rings.forEach((r,i)=>assert.equal(r.out,rings.length-i-.5));
  // main drew the caído ring at (-w/2-b/2, -b/2, w+b, h+b) with radius (RADIUS+1)·s: the rule gives the same floats.
  const RADIUS=6,BORDER=2;
  for(const s of [.5,.933,1,1.72,3.4]){
    const b=BORDER*s,o=.5*b,w=81.37*s,h=23.9*s;
    assert.deepEqual([-w/2-o,-o,w+2*o,h+2*o,(RADIUS+.5*BORDER)*s],[-w/2-b/2,-b/2,w+b,h+b,(RADIUS+1)*s]);
  }
});

test('destination mark: main\'s sizes off the city; Breu 2 CSS px edges in the city',()=>{
  for(const k of [1,.5445,1.3])assert.deepEqual(destinationMark(k,1/(.6*k),false),{width:28*k,height:14*k,breu:5*k,papel:2*k,breuAlpha:.9,dotBreu:4.5*k,dotPapel:3*k});
  for(const css of [.5,.933,1.4]){
    const k=.5445,m=destinationMark(k,css,true);
    assert.equal(m.width,28*k);assert.equal(m.height,14*k);
    assert.ok(Math.abs((m.breu-m.papel)/2-CITY_BREU_EDGE_CSS*css)<1e-12,'Breu shows 2 CSS px on each side of the Papel');
    assert.ok(Math.abs(m.papel-2*css)<1e-12);
    assert.ok(Math.abs(m.dotBreu-m.dotPapel-2*css)<1e-12);
    assert.equal(m.breuAlpha,1);
  }
});

test('contact shadows: Breu 38% in the city, main\'s looks elsewhere',()=>{
  assert.equal(BREU,0x1e1530);
  assert.deepEqual(heroShadow(false),{color:0x3d756a,alpha:.2});
  assert.equal(heroShadow(false),ISLAND_HERO_SHADOW);
  assert.deepEqual(heroShadow(true),{color:0x1e1530,alpha:.38});
  assert.equal(hordeShadowKey(false,'horde:fx:shadow'),'horde:fx:shadow');
  assert.equal(hordeShadowKey(true,'horde:fx:shadow'),CITY_SHADOW_KEY);
  assert.notEqual(CITY_SHADOW_KEY,'horde:fx:shadow');
  // Same frame as FX.shadow (layers.ts scales it by SHADOW_W/H = 46×16 of 48×18).
  assert.deepEqual(CITY_SHADOW_TEXTURE,{width:48,height:18,ellipse:{x:24,y:9,width:46,height:16}});
  assert.deepEqual(CITY_CONTACT_SHADOW,{color:BREU,alpha:.38});
});
