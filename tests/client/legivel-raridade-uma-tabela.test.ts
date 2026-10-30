import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RARITY_TOKEN} from '../../src/client/render/arsenal-rules.ts';
import {rarityBorder,rarityPips} from '../../src/client/hud/inventory.ts';

const css=readFileSync(new URL('../../src/client/hud/inventory.css',import.meta.url),'utf8');
const inv=readFileSync(new URL('../../src/client/hud/inventory.ts',import.meta.url),'utf8');
const fx=readFileSync(new URL('../../src/client/render/arsenal-fx.ts',import.meta.url),'utf8');

test('one table: the slot border is the world ring token of the rarity (4 laranja, 5 dourada)', ()=>{
  for(const r of [1,2,3,4,5] as const)assert.equal(rarityBorder(r),`var(${RARITY_TOKEN[r]})`);
  assert.equal(RARITY_TOKEN[4],'--arte-dourado');
  assert.equal(RARITY_TOKEN[5],'--c-amarelo');
  assert.equal(rarityBorder(undefined),undefined);
  assert.match(inv,/style\.setProperty\('--raridade',border\)/);
});

test('the inventory CSS keeps no colour table of its own', ()=>{
  assert.doesNotMatch(css,/data-rarity/);
});

test('second sign: one dot per rarity level, in the slot and under the ring on the ground', ()=>{
  for(const r of [1,2,3,4,5])assert.equal(rarityPips(r).match(/<i><\/i>/g)?.length,r);
  assert.equal(rarityPips(undefined),'');
  assert.equal(rarityPips(9).match(/<i><\/i>/g)?.length,5);
  assert.match(inv,/class="rh-inv-pips" aria-hidden="true"/);
  assert.match(css,/\.rh-inv-pips i\{[^}]*border-radius:50%/);
  assert.match(css,/\.rh-inv-slot\[data-pilha=true\] \.rh-inv-pips\{/);
  assert.match(fx,/ringBand\(`i\|\$\{rarity\}\|\$\{color\}\|/);
  assert.match(fx,/for\(let i=0;i<rarity;i\+\+\)/);
});
