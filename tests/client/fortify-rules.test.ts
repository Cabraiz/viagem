// D-052 slice 4 (render): the free build's grid, the ghost's colour, the hints near the car and the rope to the bumper.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR_RADIUS,CAR_ROPE} from '../../src/contract/index.ts';
import {CITY_BUILD_CELL} from '../../src/maps/build-sites.ts';
import {NEST_BUILD_KEEP_OUT,buildHints,cellRect,cellUnder,footprintCells,ghostLook,ghostRefusal,isGridPiece,ropeLine,
  structureRect} from '../../src/client/render/fortify-rules.ts';

const cell=CITY_BUILD_CELL;

test('footprints: wall 1×1, barricade 2×1 (rot 1 turns it), the root from the catalog, unknown 1×1', ()=>{
  assert.deepEqual(footprintCells('muro'),[1,1]);
  assert.deepEqual(footprintCells('barricada'),[2,1]);
  assert.deepEqual(footprintCells('barricada',1),[1,2]);
  assert.deepEqual(footprintCells('vigia-do-predio'),[2,2]);
  assert.deepEqual(footprintCells('xyz'),[1,1]);
  assert.equal(isGridPiece('muro'),true);assert.equal(isGridPiece('ninho'),false);assert.equal(isGridPiece('muralha'),false);
});

test('the cell under a point centres the footprint on it, and the rect gives it back', ()=>{
  const at=cellUnder(10,10,2,1,cell),r=cellRect(at.c,at.r,2,1,cell);
  assert.ok(Math.abs(r.cx-10)<=cell/2&&Math.abs(r.cy-10)<=cell/2);
  assert.ok(Math.abs(r.x1-r.x0-2*cell)<1e-9&&Math.abs(r.y1-r.y0-cell)<1e-9);
  assert.deepEqual(cellUnder(cell/2,cell/2,1,1,cell),{c:0,r:0});
  assert.deepEqual(cellUnder(cell*3.5,cell*1.5,1,1,cell),{c:3,r:1});
});

test('ghost: red near the car, near a living nest and over a standing piece; green elsewhere; a dead nest frees it', ()=>{
  const r=cellRect(20,20,1,1,cell);
  assert.equal(ghostRefusal(r,{cell,structures:[]}),undefined);
  assert.equal(ghostRefusal(r,{cell,car:{x:r.cx+CAR_RADIUS-.1,y:r.cy},structures:[]}),'carro');
  assert.equal(ghostRefusal(r,{cell,car:{x:r.x1+CAR_RADIUS+.1,y:r.cy},structures:[]}),undefined);
  const nest={id:'n',kind:'ninho',x:r.cx+NEST_BUILD_KEEP_OUT-1,y:r.cy,hp:50};
  assert.equal(ghostRefusal(r,{cell,structures:[nest]}),'ninho');
  assert.equal(ghostRefusal(r,{cell,structures:[{...nest,hp:0}]}),undefined);
  const wall={id:'m',kind:'muro',x:0,y:0,hp:250,c:20,r:20};
  assert.equal(ghostRefusal(r,{cell,structures:[wall]}),'ocupado');
  assert.equal(ghostRefusal(cellRect(21,20,1,1,cell),{cell,structures:[wall]}),undefined);
  // A barricade lying across (rot 1) takes the cell below it, not the one beside.
  const bar={id:'b',kind:'barricada',x:0,y:0,hp:400,c:30,r:30,rot:1};
  assert.equal(ghostRefusal(cellRect(30,31,1,1,cell),{cell,structures:[bar]}),'ocupado');
  assert.equal(ghostRefusal(cellRect(31,30,1,1,cell),{cell,structures:[bar]}),undefined);
});

test('a tower without c/r (an older room) is placed by its centre', ()=>{
  const t={id:'t',kind:'vigia-do-predio',x:20,y:20,hp:400};
  const rect=structureRect(t,cell)!;
  assert.ok(rect.x0<20&&rect.x1>20&&rect.y0<20&&rect.y1>20);
});

test('ghost look: the room\'s answer wins over the local check', ()=>{
  assert.equal(ghostLook(undefined),'ok');
  assert.equal(ghostLook('carro'),'bloqueado');
  assert.equal(ghostLook(undefined,{ok:false}),'bloqueado');
  assert.equal(ghostLook('ocupado',{ok:true}),'ok');
});

test('hints: the 3 free sites nearest to the car, none without a car', ()=>{
  const car={x:50,y:50};
  const sites=[{x:50,y:50.5},{x:55,y:50},{x:60,y:50},{x:45,y:50},{x:80,y:80},{x:50,y:56}];
  const hints=buildHints('vigia-do-predio',sites,{cell,car,structures:[]});
  assert.equal(hints.length,3);
  // The site on the car is refused; the far one is never among the nearest three.
  assert.ok(hints.every(h=>Math.hypot(h.cx-car.x,h.cy-car.y)>=CAR_RADIUS));
  assert.ok(hints.every(h=>Math.hypot(h.cx-80,h.cy-80)>5));
  assert.deepEqual(buildHints('muro',sites,{cell,structures:[]}),[]);
});

test('rope: to the bumper on the hero\'s side, sagging by the slack, taut at CAR_ROPE', ()=>{
  const car={x:10,y:10},half=1.3;
  const front=ropeLine({x:13,y:10},car,half);
  assert.equal(front.bx,10+half);assert.equal(front.by,10);
  const back=ropeLine({x:7,y:10.5},car,half);
  assert.equal(back.bx,10-half);
  assert.ok(ropeLine({x:10+half+1,y:10},car,half).sag>0);
  assert.equal(ropeLine({x:10+half+CAR_ROPE,y:10},car,half).sag,0);
});
