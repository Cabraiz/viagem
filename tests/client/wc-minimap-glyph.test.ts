/**
 * BUG-20261025-ORQ-celular-travando: the minimap's paint never sets a canvas `font` (it made the page recompute its
 * styles for every bank, every paint); the bank's "$" is one pre-drawn glyph per size.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dollarGlyph} from '../../src/client/hud/wc-minimap/minimap.ts';

test('the minimap paints text only inside dollarGlyph',()=>{
  const src=readFileSync(new URL('../../src/client/hud/wc-minimap/minimap.ts',import.meta.url),'utf8');
  const body=src.replace(/export function dollarGlyph[\s\S]*?\n}\n/,'');
  assert.doesNotMatch(body,/\.font=|fillText\(/);
});

test('dollarGlyph is cached per size and safe without OffscreenCanvas',()=>{
  assert.equal(dollarGlyph(9),dollarGlyph(9));
  if(typeof OffscreenCanvas!=='function')assert.equal(dollarGlyph(10),null);
});
