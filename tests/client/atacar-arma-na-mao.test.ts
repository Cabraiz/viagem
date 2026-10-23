import test from 'node:test';
import assert from 'node:assert/strict';
import {attackIconOf} from '../../src/client/hud/skill.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';

// atacar-arma-na-mao (the user, 23/10): "a arma selecionada deve ficar no atacar".
test('the attack button shows the sticker of the weapon in the hand', () => {
  const weapons=[{id:'faca',level:1},{id:'submetralhadora',level:2},{id:'pistola',level:1}];
  assert.equal(attackIconOf({weapons,hand:1}),itemDisplay('submetralhadora').icon);
  assert.equal(attackIconOf({weapons,hand:0}),itemDisplay('faca').icon);
  assert.equal(attackIconOf({weapons,hand:2}),itemDisplay('pistola').icon);
});

test('no hand, an empty hand or no player: the generic attack sticker', () => {
  assert.equal(attackIconOf(undefined),undefined);
  assert.equal(attackIconOf({weapons:[{id:'faca',level:1}]}),undefined);
  assert.equal(attackIconOf({weapons:[{id:'faca',level:1}],hand:4}),undefined);
});
