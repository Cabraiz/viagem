/**
 * NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3: the viaduct's pieces on screen (render/city/viaduct.ts), pure part.
 * The deck in strips one cell deep with their parapets, the ramp rising from 0 at its foot to the deck's height, the
 * pillars under the slab, and which sides of a box face the camera in each view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DECK_SLAB,PARAPET,frontSides,viaductPieces} from '../../src/client/render/city/viaduct.ts';
import type {CityViaduct} from '../../src/maps/index.ts';

const V:CityViaduct={id:'v',deck:[10,4,4,8],ramp:{rect:[10,12,4,6],up:'N'},pillars:[[10,6],[13,6]],height:3.5};

test('a viaduct is drawn cell by cell (deck and ramp), parapets on both outer sides, pillars and its shadow',()=>{
  const p=viaductPieces(V,1.5);
  const deck=p.filter(q=>q.kind==='deck'),ramp=p.filter(q=>q.kind==='ramp');
  assert.equal(deck.length,8*4,'one piece per deck cell');assert.equal(ramp.length,6*4,'one piece per ramp cell');
  assert.equal(p.filter(q=>q.kind==='parapet').length,2*(8+6),'a parapet on each outer cell of every row');
  assert.equal(new Set([...deck,...ramp].map(q=>q.strip)).size,deck.length+ramp.length,'each cell draws on its own');
  assert.equal(p.filter(q=>q.kind==='pillar').length,2);assert.equal(p.filter(q=>q.kind==='shadow').length,1);
  for(const q of deck){assert.deepEqual([...q.top],[3.5,3.5,3.5,3.5]);assert.deepEqual([...q.bottom],[3.5-DECK_SLAB,3.5-DECK_SLAB,3.5-DECK_SLAB,3.5-DECK_SLAB]);}
  // The ramp goes up toward the deck (north): its foot strip touches the ground, its top strip the deck.
  const foot=ramp.reduce((a,b)=>a.y0>b.y0?a:b),top=ramp.reduce((a,b)=>a.y0<b.y0?a:b);
  assert.ok(Math.abs(foot.top[2])<1e-5&&Math.abs(foot.top[3])<1e-5,'the foot edge is on the ground');
  assert.ok(Math.abs(top.top[0]-3.5)<1e-5&&Math.abs(top.top[1]-3.5)<1e-5,'the top edge meets the deck');
  for(const q of ramp)assert.ok(q.top[0]>q.top[3],'each strip is higher on its north edge');
  const parapet=p.find(q=>q.kind==='parapet'&&q.strip===deck[0].strip)!;
  assert.ok(Math.abs(parapet.top[0]-(3.5+PARAPET))<1e-9);
  for(const q of p.filter(q=>q.kind==='pillar'))assert.ok(Math.abs(q.top[0]-(3.5-DECK_SLAB))<1e-9&&q.bottom[0]===0);
});

test('the camera sees two sides of a box in every view, opposite ones after half a turn',()=>{
  for(const view of [0,1,2,3])assert.equal(frontSides(view).length,2,`view ${view}`);
  assert.deepEqual(frontSides(0).sort(),['e','s']);
  assert.deepEqual(frontSides(2).sort(),['n','w']);
});
