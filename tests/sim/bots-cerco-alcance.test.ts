// NEW-20261018-ORQ-carro-cedo-1p: at the car (mode 'ninhos') a bot stands within reach of its weapons. A solo with only
// the faca (range 1.3) stood at DANGER+.2 = 2.8 u from the siege and never cut one; the car took its 120 hits by minute 5.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DANGER,siegeStand} from '../../src/sim/bot-brain.ts';
import {weaponCatalog,weaponLevel} from '../../src/sim/weapons/catalog.ts';

const reach=(id:string)=>weaponLevel(weaponCatalog.get(id)!,1).range;

test('only the faca: the bot stands inside its range, not at DANGER+.2', () => {
  const stand=siegeStand([{id:'faca',level:1}]);
  assert.ok(stand<reach('faca'),`stand ${stand} ≥ faca range ${reach('faca')}`);
  assert.ok(stand>=.8);
});
test('a firearm keeps the stand-off at DANGER+.2', () => {
  assert.equal(siegeStand([{id:'faca',level:1},{id:'pistola',level:1}]),DANGER+.2);
});
test('consumables are not weapons; no weapon at all keeps DANGER+.2', () => {
  assert.equal(siegeStand([{id:'faca',level:1},{id:'coxinha',level:1}]),siegeStand([{id:'faca',level:1}]));
  assert.equal(siegeStand([]),DANGER+.2);
});
test('only the chinelo (orbit): inside its ring, as before', () => {
  const ring=weaponLevel(weaponCatalog.get('chinelo')!,1).area;
  assert.equal(siegeStand([{id:'chinelo',level:1}]),Math.max(.8,ring-.2));
});
