// NEW-20261009-N5-resultado-nomes-longos item 3: the prizes a crowded result leaves out (125% with 5-6 cards, a low
// landscape, a bot's card, the shamed card) are folded, not display:none: a screen reader still reads them, and a tap on
// the card (.is-open) shows them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../../src/client/hud/hud.css',import.meta.url),'utf8');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({sel:m[1].replace(/\/\*[\s\S]*?\*\//g,'').trim(),body:m[2]}));

test('result prizes: none is display:none; the folded ones stay readable and open with a tap',()=>{
  const prize=rules.filter(r=>/\.rh-award(:nth-child|-folded)/.test(r.sel));
  assert.ok(prize.length>=4,prize.map(r=>r.sel).join('\n'));
  for(const r of prize){
    assert.doesNotMatch(r.body,/display:\s*none/,r.sel);
    assert.match(r.body,/clip-path:inset\(50%\)/,r.sel);
    for(const s of r.sel.split(/,(?![^(]*\))/))assert.match(s,/:not\(\.is-open\)/,s);
  }
  const ts=readFileSync(new URL('../../src/client/hud/result.ts',import.meta.url),'utf8');
  assert.doesNotMatch(ts,/for\(const a of extra\)a\.hidden/,'the shamed card folds, never hides');
});
