/**
 * NEW-20261021-ORQ-muralha-tralha-no-jogo (render/muralha-rules.ts): what each free barricade square draws from the junk
 * wall sheets: a whole piece in a straight run or alone, halves + a pillar at ends, corners and Ts; the piece seeded by
 * the cell (same for every player, never the previous neighbour's in a run); column, half and scale from the projection;
 * the height in one constant. The imported sheets match what the rules ask for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MURALHA_ALTURA,MURALHA_ESTADOS,MURALHA_PILARES,MURALHA_RETOS,cellKey,muralhaColumn,muralhaEstado,muralhaHalf,muralhaPlan,muralhaScale,retoOf,type MuralhaSquare} from '../../src/client/render/muralha-rules.ts';
import {Projector} from '../../src/client/render/projector.ts';
import {BARRICADA_CELLS} from '../../src/rules/towers.ts';
import {BASE_ART} from '../../src/client/art/base-art.ts';
import {DAMAGE,KINDS,SOURCE_CELL,sheetRows} from '../../scripts/import-muralha-tralha.mjs';

const set=(sq:MuralhaSquare[])=>new Set(sq.map(s=>cellKey(s.c,s.r)));
/** barricada-2x: squares are N cells wide, so neighbours (and these helpers' squares) sit N cells apart. */
const N=BARRICADA_CELLS;
const row=(n:number,c0=0,r=0)=>Array.from({length:n},(_,i)=>({c:c0+i*N,r}));
const at=(c:number,r:number,rot?:number)=>({c:c*N,r:r*N,...(rot!==undefined?{rot}:{})});

test('a row of 5: the ends draw a half toward the row + a pillar, the 3 in between one whole piece along the row',()=>{
  const sq=row(5,10,4),cells=set(sq),plans=sq.map(s=>muralhaPlan(s,cells));
  assert.deepEqual(plans[0].map(d=>[d.kind,d.axis,d.toward]),[['reto','c',1],['pilar',undefined,undefined]]);
  assert.deepEqual(plans[4].map(d=>[d.kind,d.axis,d.toward]),[['reto','c',-1],['pilar',undefined,undefined]]);
  for(const p of plans.slice(1,4))assert.deepEqual(p.map(d=>[d.kind,d.axis,d.toward]),[['reto','c',undefined]]);
  // Along r the same, on the other axis.
  const col=row(3).map(s=>({c:4,r:s.c})),cc=set(col);
  // Squares one cell apart are not neighbours (they overlap: the room never lets that stand).
  assert.equal(N,2);
  assert.deepEqual(muralhaPlan({c:0,r:0},set([{c:0,r:0},{c:1,r:0}])).map(d=>[d.kind,d.toward]),[['reto',undefined]]);
  assert.deepEqual(muralhaPlan(col[1],cc).map(d=>[d.kind,d.axis]),[['reto','r']]);
});

test('corner, T, cross and a lone square',()=>{
  const L=[at(0,0),at(1,0),at(0,1)],cl=set(L);
  assert.deepEqual(muralhaPlan(L[0],cl).map(d=>[d.kind,d.axis,d.toward]),[['reto','c',1],['reto','r',1],['pilar',undefined,undefined]]);
  const T=[at(0,0),at(-1,0),at(1,0),at(0,1)];
  assert.equal(muralhaPlan(T[0],set(T)).length,4,'3 halves + pillar');
  const X=[...T,at(0,-1)];
  assert.equal(muralhaPlan(X[0],set(X)).length,5,'4 halves + pillar');
  assert.deepEqual(muralhaPlan({c:7,r:7},new Set([cellKey(7,7)])).map(d=>[d.kind,d.axis]),[['reto','c']],'alone: whole, along x');
  assert.deepEqual(muralhaPlan({c:7,r:7,rot:1},new Set([cellKey(7,7)])).map(d=>[d.kind,d.axis]),[['reto','r']],'alone, rot 1: along y');
});

test('pieces: seeded by the cell (the same on every client), all of them used, never the previous one along a run',()=>{
  const sq=row(400,-200,3),cells=set(sq);
  const a=sq.map(s=>muralhaPlan(s,cells)),b=sq.map(s=>muralhaPlan({...s},new Set(cells)));
  assert.deepEqual(a,b,'deterministic');
  const pieces=a.slice(1,-1).map(p=>p[0].piece);
  assert.equal(new Set(pieces).size,MURALHA_RETOS,'every straight piece shows up');
  for(let i=1;i<pieces.length;i++)assert.notEqual(pieces[i],pieces[i-1],`cells ${i-1},${i}`);
  for(const p of a)for(const d of p)assert.ok(Number.isInteger(d.piece)&&d.piece>=0&&d.piece<(d.kind==='reto'?MURALHA_RETOS:MURALHA_PILARES));
  assert.equal(retoOf(3,5,'c'),retoOf(3,5,'c'));
});

test('column and half from the projection, in the 4 camera views; scale: the cell across, the height × MURALHA_ALTURA',()=>{
  const pr=new Projector(0),o={x:0,y:0},q={x:0,y:0};
  const step=(view:number,dx:number,dy:number)=>{pr.view=view;const a={...pr.project(10,10,o)},b=pr.project(10+dx,10+dy,q);return {dx:b.x-a.x,dy:b.y-a.y};};
  // View 0: +x goes down-right on screen (the mirrored column), +y down-left (the piece as drawn).
  let s=step(0,1,0);assert.equal(muralhaColumn(s.dx,s.dy),1);assert.equal(muralhaHalf(1,s.dx),1);assert.equal(muralhaHalf(-1,s.dx),-1);
  s=step(0,0,1);assert.equal(muralhaColumn(s.dx,s.dy),0);assert.equal(muralhaHalf(1,s.dx),-1);
  // A quarter turn swaps them; the two axes always take different columns.
  for(const v of [0,1,2,3]){const x=step(v,1,0),y=step(v,0,1);assert.notEqual(muralhaColumn(x.dx,x.dy),muralhaColumn(y.dx,y.dy),`view ${v}`);}
  s=step(1,1,0);assert.equal(muralhaColumn(s.dx,s.dy),0);
  assert.deepEqual(muralhaScale(-37,127.5,1),{x:37/127.5,y:37/127.5});
  assert.deepEqual(muralhaScale(37,127.5,1.5),{x:37/127.5,y:37/127.5*1.5},'height only');
  assert.equal(MURALHA_ALTURA,1,'the delivered art (1.5× the stone wall, card muralha-mais-alta) as is');
});

test('damage row by life; a fallen square draws nothing',()=>{
  assert.deepEqual([[200,200],[130,200],[60,200],[1,200],[0,200]].map(([h,m])=>muralhaEstado(h,m)),['inteira','avariada','quase-caindo','quase-caindo',undefined]);
});

test('the imported sheets (base/muralha-tralha, base/muralha-tralha-pilar) have every row the rules ask for, 2 views, one page',()=>{
  const base=JSON.parse(readFileSync('public/art/city/base/manifest.json','utf8')).pieces;
  assert.deepEqual([...MURALHA_ESTADOS],DAMAGE);
  for(const [kind,id,n] of [['reto',BASE_ART.muralha,MURALHA_RETOS],['pilar',BASE_ART.pilar,MURALHA_PILARES]] as const){
    const p=base[id],f=p.files.sheet,k=KINDS[kind];
    assert.equal(p.meta.pecas.length,n,id);assert.deepEqual(p.meta.pecas,k.ids);
    assert.deepEqual(f.rows,sheetRows(k.ids));assert.equal(f.views,2);assert.deepEqual(f.cell,k.cell);
    assert.ok(p.meta.celula>100&&p.meta.celula<SOURCE_CELL,`${id}: ${p.meta.celula} art px per cell`);
    assert.equal(f.pages.length,1);assert.equal(f.pages[0].frameCount,f.rows.length*2);
    assert.ok(f.pages[0].columns*f.cell[0]<=4096&&f.pages[0].rows*f.cell[1]<=4096,'under 4096 px');
    assert.deepEqual(f.liteCell,f.cell,'lite copy at the same cell');
  }
});
