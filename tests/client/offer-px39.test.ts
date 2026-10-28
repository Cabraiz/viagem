// px39 (card NEW-20261025-ORQ-popup-levelup-12-variacoes): the popup's pixel icons, the fan and the gain box.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PX39_ICONS,fanSlots,px39Icon,px39IconUrl,splitGain} from '../../src/client/hud/offer-px39.ts';
import {offerGain} from '../../src/client/hud/offer-card.ts';

test('every px39 icon is on disk; an item without one keeps its sticker',()=>{
  for(const id of PX39_ICONS)assert.ok(existsSync(new URL(`../../public/art/ui-extra/px39/icones/${id}.webp`,import.meta.url)),id);
  assert.equal(px39IconUrl('cartao'),'/art/ui-extra/px39/icones/cartao.webp');
  assert.equal(px39IconUrl('torre-holofote'),undefined);
  assert.match(px39Icon('cafe-forte'),/src="\/art\/ui-extra\/px39\/icones\/cafe-forte\.webp"/);
  assert.doesNotMatch(px39Icon('banana'),/px39/);
});

test('the fan: the default pick in the middle, the others to the sides',()=>{
  assert.deepEqual(fanSlots(3,1),['l','m','r']);
  assert.deepEqual(fanSlots(3,0),['m','l','r']);
  assert.deepEqual(fanSlots(3,2),['l','r','m']);
  assert.deepEqual(fanSlots(4,3),['l2','r1','r2','l1']);
  assert.deepEqual(fanSlots(2,1),['r1','l1']);
  assert.deepEqual(fanSlots(1,0),['m']);
  assert.deepEqual(fanSlots(3,-1),['m','l','r']);
});

test('the gain splits into the number (big) and the words (small)',()=>{
  assert.deepEqual(splitGain('+40% velocidade do tiro'),{big:'+40%',small:'velocidade do tiro'});
  assert.deepEqual(splitGain('+R$ 3 por caixa'),{big:'+R$ 3',small:'por caixa'});
  assert.deepEqual(splitGain('Ataca 8% mais rápido'),{big:'Ataca 8%',small:'mais rápido'});
  assert.deepEqual(splitGain('+1 projétil'),{big:'+1',small:'projétil'});
  assert.deepEqual(splitGain('sem número'),{big:'sem número',small:''});
  assert.deepEqual(splitGain(offerGain('cartao',1)!),{big:'+R$ 3',small:'por caixa'});
});
