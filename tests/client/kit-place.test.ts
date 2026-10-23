// Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa): the inventory's kit slot and the "pôr torre" mode's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {KIT_AHEAD,KIT_REACH,KitPlace,kitRefusalText} from '../../src/client/hud/kit-place/model.ts';
import {inventorySlots,slotLabel,tapCommand} from '../../src/client/hud/inventory.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {BUILD_REACH} from '../../src/sim/towers/system.ts';
import {KIT_CHARGES,kitItem} from '../../src/rules/index.ts';
import {ATTACK_WORD,BUILD_WORD,SKILL_WORD,actionFace} from '../../src/client/hud/skill.ts';

const CELL=.88;

test('the kit slot: its tier is the border, a tap starts the mode (nothing to the room), a wall kit shows its charges',()=>{
  const slots=inventorySlots({weapons:[{id:'faca',level:1},kitItem('morteiro'),kitItem('muro')],hand:0})!;
  assert.deepEqual([slots[1].kind,slots[1].rarity,slots[1].hand],['kit',3,false]);
  assert.equal(slots[1].name,'Kit Morteiro');assert.equal(itemDisplay('kit:morteiro').icon,'torre-morteiro');
  assert.deepEqual(tapCommand(slots[1]),{t:'kit',slot:1});
  assert.equal(slots[2].rarity,1);assert.equal(slots[2].stack,KIT_CHARGES.muro);
  assert.match(slotLabel(slots[1]),/Kit Morteiro \(roxa\): tocar para construir/);
});

test('the ghost starts ahead of the hero with the room\'s footprint; green, red when taken or out of reach',()=>{
  assert.equal(KIT_REACH,BUILD_REACH,'the reach is the room\'s');
  const k=new KitPlace(()=>0),hero={x:20,y:20};
  assert.equal(k.start(0,'pistola',hero,CELL),false,'no kit, no mode');
  k.hero({x:20,y:19});k.hero(hero);
  assert.equal(k.start(1,'kit:vigia-do-predio',hero,CELL),true);
  assert.deepEqual(k.footprint(),[1,1],'the root takes one cell, as in the sim');
  const g=k.ghost({cell:CELL,structures:[]},hero)!;
  assert.equal(g.look,'ok');assert.deepEqual([g.w,g.h],[1,1]);
  assert.ok(Math.abs((g.c+.5)*CELL-hero.x)<CELL&&Math.abs((g.r+.5)*CELL-(hero.y+KIT_AHEAD))<CELL,'ahead, the way it walked');
  // A standing structure on that cell, or a cell beyond the reach: red.
  assert.equal(k.ghost({cell:CELL,structures:[{id:'s',kind:'muro',x:0,y:0,hp:10,c:g.c,r:g.r}]},hero)!.look,'bloqueado');
  k.point({x:hero.x+KIT_REACH+2,y:hero.y},CELL);
  assert.equal(k.ghost({cell:CELL,structures:[]},hero)!.look,'bloqueado');
  // A 3×2 tower takes its 3×3 square.
  k.start(1,'kit:lanca-foguetes',hero,CELL);assert.deepEqual(k.footprint(),[3,3]);assert.equal(k.canTurn(),false);
  k.start(1,'kit:barricada',hero,CELL);k.turn();assert.deepEqual(k.footprint(),[2,2],'a barricade square, 2×2 since barricada-2x (turning changes nothing)');
});

test('confirm sends {t:place} once per cell; the answer: a tower kit ends the mode, a wall kit stays; refusals in words',()=>{
  let t=0;const k=new KitPlace(()=>t),sent:unknown[][]=[];
  const net={place:(...a:unknown[])=>{sent.push(a);return sent.length;}};
  assert.equal(k.confirm(net),'none');
  k.start(2,'kit:holofote',{x:10,y:10},CELL);
  assert.equal(k.confirm(net),'sent');assert.equal(k.confirm(net),'pending','the same cell waits for its answer');
  assert.deepEqual(sent[0].slice(0,2),[2,'holofote']);
  assert.equal(k.answer({req:1,ok:false,reason:'tranca'}),'Isso tranca o chaveiro, chefe');
  assert.equal(k.ghost({cell:CELL,structures:[]},{x:10,y:10})!.look,'bloqueado','the room said no for that cell');
  t=5000;assert.equal(k.confirm(net),'sent');
  assert.equal(k.answer({req:2,ok:true}),undefined);assert.equal(k.active,false,'a tower kit is done');
  k.start(0,'kit:muro',{x:10,y:10},CELL);k.confirm(net);
  assert.equal(k.answer({req:3,ok:true}),undefined);assert.equal(k.active,true,'a muro kit keeps laying');
  assert.equal(kitRefusalText('away'),'Longe demais, chega mais perto');assert.equal(kitRefusalText('limite'),'Chegou no limite');
  assert.equal(k.answer({req:99,ok:false}),undefined,'not ours');
});

test('sync: the kit follows its id when the slots shift, the mode ends when it is gone',()=>{
  const k=new KitPlace(()=>0);
  k.start(2,'kit:morteiro',{x:0,y:0},CELL);
  k.sync([{id:'faca'},{id:'kit:morteiro'}]);assert.equal(k.kit?.slot,1);
  k.sync([{id:'faca'}]);assert.equal(k.active,false);
});

test('construir-no-botao: the selected kit is the slot in the hand and the button says Construir with the kit sticker',()=>{
  const player={weapons:[{id:'faca',level:1},kitItem('morteiro'),kitItem('muro')],hand:0};
  const picked=inventorySlots(player,1)!;
  assert.deepEqual(picked.map(s=>s.hand),[false,true,false],'the kit, not the knife, is marked');
  assert.match(slotLabel(picked[1]),/na mão: Construir/);
  assert.deepEqual(inventorySlots(player)!.map(s=>s.hand),[true,false,false],'no kit: the weapon again');
  // The button's face for each selection.
  const kit=actionFace('manual','cidadao-comum','faca','kit:morteiro');
  assert.deepEqual([kit.word,kit.icon],[BUILD_WORD,itemDisplay('kit:morteiro').icon]);
  assert.equal(BUILD_WORD,'Construir');assert.match(kit.label,/Construir Kit Morteiro/);
  assert.equal(actionFace('manual','cidadao-comum','faca',kitItem('muro').id).icon,itemDisplay('kit:muro').icon);
  assert.deepEqual([actionFace('manual','cidadao-comum','faca').word,actionFace('manual','cidadao-comum','faca').icon],[ATTACK_WORD,'faca'],'back to Atacar with the weapon');
  assert.equal(actionFace('auto','cidadao-comum','').word,SKILL_WORD);
});

test('construir-no-botao: the ghost walks KIT_AHEAD in front of the hero; red says why (no confirm sent)',()=>{
  const k=new KitPlace(()=>0);let hero={x:30,y:30};
  k.hero(hero);k.start(1,'kit:muro',hero,CELL);
  for(const step of [{x:31,y:30},{x:32,y:30},{x:33,y:30}]){hero=step;k.hero(hero);k.follow(hero,CELL);}
  const g=k.ghost({cell:CELL,structures:[]},hero)!;
  assert.ok(Math.abs((g.c+.5)*CELL-(hero.x+KIT_AHEAD))<CELL&&Math.abs((g.r+.5)*CELL-hero.y)<CELL,'ahead, the way it walks');
  assert.equal(g.look,'ok');assert.equal(k.blocked,undefined);
  k.ghost({cell:CELL,structures:[{id:'s',kind:'muro',x:0,y:0,hp:10,c:g.c,r:g.r}]},hero);
  assert.equal(kitRefusalText(k.blocked),'Já tem coisa aí');
  k.cancel();k.follow(hero,CELL);assert.equal(k.ghost({cell:CELL,structures:[]},hero),null,'no kit, no ghost');
});
