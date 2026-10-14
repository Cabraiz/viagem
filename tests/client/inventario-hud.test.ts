import test from 'node:test';
import assert from 'node:assert/strict';
import {INVENTORY_SLOTS as SIM_SLOTS,TAKE_REACH} from '../../src/sim/inventory.ts';
import {RARITY_NAME as SIM_RARITY} from '../../src/sim/weapons/arsenal.ts';
import {INVENTORY_SLOTS,SWAP_REACH,RARITY_NAME,inventorySlots,swapCandidate,inventoryRefusalText,inventoryKeyOf,tapCommand,slotLabel} from '../../src/client/hud/inventory.ts';
import type {PickupView} from '../../src/contract/index.ts';

const full=[{id:'faca',level:1},{id:'pistola',level:2},{id:'escopeta',level:3},{id:'rifle',level:4},{id:'coxinha',level:3},{id:'kit-torre',level:1}];

test('the client mirrors the sim: 6 slots, the reach of "Trocar", the rarity names', ()=>{
  assert.equal(INVENTORY_SLOTS,SIM_SLOTS);
  assert.equal(SWAP_REACH,TAKE_REACH);
  for(const r of [1,2,3,4,5] as const)assert.equal(RARITY_NAME[r],SIM_RARITY[r]);
});

test('no hand, no inventory (the automatic weapons)', ()=>{
  assert.equal(inventorySlots(undefined),undefined);
  assert.equal(inventorySlots({weapons:[{id:'chinelo',level:3}]}),undefined);
});

test('slots: weapon rarity on the border, consumable stack, the hand', ()=>{
  const slots=inventorySlots({weapons:full,hand:1})!;
  assert.equal(slots.length,6);
  assert.deepEqual(slots.map(s=>s.kind),['weapon','weapon','weapon','weapon','consumable','consumable']);
  assert.deepEqual(slots.map(s=>s.rarity),[1,2,3,4,undefined,undefined]);
  assert.equal(slots[4].stack,3);
  assert.deepEqual(slots.map(s=>s.hand),[false,true,false,false,false,false]);
  assert.equal(slots[1].name,'Trinta-e-Oitão do Vô');
  assert.match(slotLabel(slots[1]),/azul\), na mão/);
  assert.match(slotLabel(slots[4]),/^Coxinha, 3/);
  // A legendary is rarity 5 with the old weapon's name.
  assert.equal(inventorySlots({weapons:[{id:'chinelo-lendario',level:5}],hand:0})![0].rarity,5);
});

test('a tap equips a weapon, eats a consumable, and does nothing on the weapon in the hand', ()=>{
  const slots=inventorySlots({weapons:full,hand:1})!;
  assert.deepEqual(tapCommand(slots[0]),{t:'equip',slot:0});
  assert.equal(tapCommand(slots[1]),undefined);
  assert.deepEqual(tapCommand(slots[4]),{t:'use',slot:4});
});

test('"Trocar": only with the 6 slots full, the nearest ground item within reach', ()=>{
  const hero={x:10,y:10};
  const items:PickupView[]=[
    {id:'a',kind:'item',x:11,y:10,value:2,resource:'pistola'},
    {id:'b',kind:'item',x:10.5,y:10,value:4,resource:'rifle'},
    {id:'c',kind:'xp',x:10,y:10,value:1},
    {id:'d',kind:'item',x:12,y:10,value:5,resource:'rojao'},
  ];
  const fullSlots=inventorySlots({weapons:full,hand:0});
  assert.equal(swapCandidate(fullSlots,items,hero)?.id,'b');
  assert.equal(swapCandidate(fullSlots,[items[3]],hero),undefined,'2 u away is out of reach');
  assert.equal(swapCandidate(inventorySlots({weapons:full.slice(0,5),hand:0}),items,hero),undefined,'with room, walking over it picks it up');
  assert.equal(swapCandidate(fullSlots,items,undefined),undefined);
});

test('every refusal of the room has a short pt-BR line', ()=>{
  for(const reason of ['player','slot','not-weapon','not-consumable','last-weapon','full','far','pickup','unusable']){
    const text=inventoryRefusalText(reason);
    assert.notEqual(text,'Não deu',reason);
    assert.ok(text.length<=24,`${reason}: "${text}" is short`);
  }
  assert.equal(inventoryRefusalText('???'),'Não deu');
});

test('keys 1–6 pick a slot; Dona Cida keeps 1–3 with her tray open; typing and windows keep the key', ()=>{
  const key=(code:string,extra:object={})=>({code,key:code.slice(-1),...extra});
  assert.equal(inventoryKeyOf(key('Digit1'),false),0);
  assert.equal(inventoryKeyOf(key('Numpad6'),false),5);
  assert.equal(inventoryKeyOf(key('Digit7'),false),undefined);
  assert.equal(inventoryKeyOf(key('Digit2'),false,true),undefined);
  assert.equal(inventoryKeyOf(key('Digit4'),false,true),3);
  assert.equal(inventoryKeyOf(key('Digit1',{defaultPrevented:true}),false),undefined);
  assert.equal(inventoryKeyOf(key('Digit1',{repeat:true}),false),undefined);
  assert.equal(inventoryKeyOf(key('Digit1',{ctrlKey:true}),false),undefined);
  assert.equal(inventoryKeyOf(key('Digit1'),true),undefined);
  assert.equal(inventoryKeyOf(key('Digit1',{target:{tagName:'input'}}),false),undefined);
});
