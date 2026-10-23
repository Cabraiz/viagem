// bau-mostra-o-premio: the crate shows what it gave (sticker + name in the rarity colour), found from the views alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ChestPrizes,PRIZE_CLAIM_MS,PRIZE_GLOW,RARITY_COLOR,inventoryGains,prizeLook} from '../../src/client/render/arsenal-rules.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {KIT_IDS} from '../../src/rules/index.ts';

const hero=(id:string,weapons:{id:string;level:number}[])=>({id,weapons});

test('inventoryGains: a new slot, a second copy, a grown stack; never a weapon levelling up', () => {
  assert.deepEqual(inventoryGains(undefined,[{id:'faca',level:1}]),[],'the first view is no gain');
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:1},{id:'pistola',level:2}]),['pistola']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:1},{id:'faca',level:3}]),['faca']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1},{id:'coxinha',level:1}],[{id:'faca',level:1},{id:'coxinha',level:3}]),['coxinha']);
  assert.deepEqual(inventoryGains([{id:'faca',level:1}],[{id:'faca',level:2}]),[]);
  assert.deepEqual(inventoryGains([{id:'faca',level:1},{id:'pistola',level:1}],[{id:'faca',level:1}]),[],'a drop is no gain');
});

test('ChestPrizes: the opener claims its gain of the same view, once; other heroes keep theirs', () => {
  const prizes=new ChestPrizes();
  prizes.observe([hero('a',[{id:'faca',level:1}]),hero('b',[{id:'faca',level:1}])],[],0);
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:2}]),hero('b',[{id:'faca',level:1},{id:KIT_IDS[0],level:1}])],[],50);
  assert.equal(prizes.claim('a',{x:0,y:0},50),'pistola');
  assert.equal(prizes.claim('a',{x:0,y:0},50),undefined,'claimed once');
  assert.equal(prizes.claim('b',undefined,60),KIT_IDS[0]);
});

test('ChestPrizes: a full inventory: the item that fell at the crate; a stale gain is not the prize', () => {
  const prizes=new ChestPrizes();
  prizes.observe([hero('a',[{id:'faca',level:1}])],[{id:'item-9',kind:'item',resource:'escopeta',x:20,y:20}],0);
  prizes.observe([hero('a',[{id:'faca',level:1}])],[{id:'item-9',kind:'item',resource:'escopeta',x:20,y:20},{id:'item-10',kind:'item',resource:'rifle',x:5,y:5}],50);
  assert.equal(prizes.claim('a',{x:30,y:30},50),undefined,'no item near that crate');
  assert.equal(prizes.claim('a',{x:5.2,y:5.1},50),'rifle');
  prizes.observe([hero('a',[{id:'faca',level:1},{id:'pistola',level:1}])],[],100);
  assert.equal(prizes.claim('a',undefined,100+PRIZE_CLAIM_MS+1),undefined,'too old to be this crate');
});

test('prizeLook: the inventory sticker and name, the crate colour, a stronger glow on the gold and legendary', () => {
  const look=prizeLook('pistola',4);
  assert.equal(look.name,'Trinta-e-Oitão do Vô');
  assert.equal(look.icon,itemDisplay('pistola').icon);
  assert.equal(look.color,RARITY_COLOR[4]);
  assert.ok(!/verde|azul|roxa|dourada|lendária/i.test(look.name),'no rarity word');
  const kit=prizeLook(KIT_IDS.find(id=>id.includes('vigia'))??KIT_IDS[0],1);
  assert.equal(kit.name,itemDisplay(kit.id).name);
  assert.ok(PRIZE_GLOW[4]>PRIZE_GLOW[3]&&PRIZE_GLOW[5]>=PRIZE_GLOW[4]&&PRIZE_GLOW[1]<PRIZE_GLOW[3]);
});
