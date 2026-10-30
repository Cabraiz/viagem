/**
 * auditoria-legibilidade L5: on the minimap each ally colour has its own shape (never the enemies' square), and a downed
 * ally gets a white cross instead of the enemies' red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALLY_COLORS,ALLY_SHAPES,allyShape} from '../../src/client/hud/wc-minimap/minimap.ts';

test('minimap: one shape per ally colour, none of them a square',()=>{
  const shapes=ALLY_COLORS.map(allyShape);
  assert.equal(new Set(shapes).size,ALLY_COLORS.length);
  assert.ok(!(ALLY_SHAPES as readonly string[]).includes('square'));
  assert.equal(allyShape('#123456'),'circle');
});

test('minimap: a downed ally is never painted in the enemies\' red',()=>{
  const src=readFileSync('src/client/hud/wc-minimap/minimap.ts','utf8');
  const allies=src.slice(src.indexOf('for(const al of input.allies)'),src.indexOf('const me=input.self'));
  assert.ok(allies.includes('downedCross('));
  assert.ok(!allies.includes('#ff3b30'));
});
