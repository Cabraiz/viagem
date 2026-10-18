// Card NEW-20261018-ORQ-setas-e-construir: only the downed ally keeps an edge arrow (the car's arrow is the objective's,
// not an edge arrow), and the fortify "Construir" button is off the HUD with a one-line switch back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EDGE_KINDS_SHOWN,FORT_BUILD_BUTTON,shownTargets} from '../../src/client/hud/arrows.ts';

test('only the caído is pointed at: nests\' obra sites, banks, the moto, the boss, groups, mouths and the base are off',()=>{
  assert.deepEqual([...EDGE_KINDS_SHOWN],['caido']);
  const kinds=['caido','chefe','grupo','spawn','base','aliado','bau','obra','moto','banco'] as const;
  assert.deepEqual(shownTargets(kinds.map(kind=>({kind}))).map(t=>t.kind),['caido']);
});

test('Construir is off the HUD (and with it the wall counter and the tray); the room code stays',()=>{
  assert.equal(FORT_BUILD_BUTTON,false);
  const src=readFileSync(new URL('../../src/client/hud/fortify/fortify.ts',import.meta.url),'utf8');
  assert.match(src,/this\.buildBtn\.hidden=!FORT_BUILD_BUTTON\|\|/);
  // The city and island arrows and the obra sites' arrows all go through the switch.
  const rescue=readFileSync(new URL('../../src/client/hud/rescue.ts',import.meta.url),'utf8');
  assert.equal((rescue.match(/shownTargets\(/g)??[]).length,3);
  assert.match(readFileSync(new URL('../../src/client/hud/towers/obra.ts',import.meta.url),'utf8'),/EDGE_KINDS_SHOWN\.has\('obra'\)/);
});
