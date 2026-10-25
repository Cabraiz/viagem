// NEW-20261025-ORQ-uno-caminho-caixas-vender, item 2: the crates of the frame on the WC3 minimap, in their rarity's colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CRATE_MM_KIND,crateExtras} from '../../src/client/hud/crate-extras.ts';
import {RARITY_COLOR} from '../../src/client/render/arsenal-rules.ts';

test('only the chests, one mark each, coloured by the rarity the pickup carries',()=>{
  const marks=crateExtras([{kind:'chest',x:1,y:2,value:1},{kind:'grana',x:5,y:5,value:3},{kind:'chest',x:3,y:4,value:5},{kind:'item',x:0,y:0,value:2}]);
  assert.equal(marks.length,2);
  assert.deepEqual(marks.map(m=>[m.kind,m.x,m.y]),[[CRATE_MM_KIND,1,2],[CRATE_MM_KIND,3,4]]);
  assert.equal(marks[0].color,'#'+RARITY_COLOR[1].toString(16).padStart(6,'0').toUpperCase());
  assert.equal(marks[1].color,'#'+RARITY_COLOR[5].toString(16).padStart(6,'0').toUpperCase());
  assert.notEqual(marks[0].color,marks[1].color);
});
test('no view, no marks; an odd rarity draws as the nearest colour',()=>{
  assert.deepEqual(crateExtras(undefined),[]);
  assert.equal(crateExtras([{kind:'chest',x:0,y:0,value:9}])[0].color,crateExtras([{kind:'chest',x:0,y:0,value:5}])[0].color);
});
