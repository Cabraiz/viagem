/**
 * BUG-20261023-ORQ-hud-tirar-nivel-e-ninhos: the top of the HUD shows neither the level ("Nv 3") nor the nests left
 * ("8/8"); the clock and the bar stay. Only what is drawn goes: the level still counts (the level-up pause) and the
 * nests count still reaches screen readers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('the level badge is built hidden and hud.css keeps it out of the layout',()=>{
  assert.match(read('src/client/hud/topbar.ts'),/\bxp\.hidden=true;/);
  assert.match(read('src/client/hud/hud.css'),/\.rh-xp\[hidden\]\{display:none\}/);
});

test('no nests count drawn next to the clock (chip nor the base bar); the words stay for screen readers',()=>{
  for(const file of ['src/client/hud/topbar.ts','src/client/hud/camp.ts']){
    const src=read(file);
    assert.doesNotMatch(src,/rh-ninhos/,`${file}: the "8/8" markup is gone`);
  }
  assert.match(read('src/client/hud/topbar.ts'),/count\.aria/,'the chip still reads the nests left aloud');
});
