// Kits de torre (card NEW-20261020-ORQ-torre-pela-caixa): the inventory's kit slot and the "pôr torre" mode's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {KIT_REACH,KIT_TURN_DRAG,KitPlace,kitRefusalText} from '../../src/client/hud/kit-place/model.ts';
import {inventorySlots,slotLabel,tapCommand} from '../../src/client/hud/inventory.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {BUILD_REACH} from '../../src/sim/towers/system.ts';
import {KIT_CHARGES,KIT_PLACE_REACH,kitItem} from '../../src/rules/index.ts';
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

test('barricada-tocar-no-mapa: no ghost until the map is pressed; there, with the room footprint; green, red when taken or out of reach',()=>{
  assert.equal(KIT_REACH,KIT_PLACE_REACH,'the reach is the room one');
  assert.ok(KIT_REACH>BUILD_REACH,'farther than the build menu: the hero does not walk there');
  const k=new KitPlace(()=>0),hero={x:20,y:20};
  assert.equal(k.start(0,'pistola'),false,'no kit, no mode');
  assert.equal(k.start(1,'kit:vigia-do-predio'),true);
  assert.equal(k.ghost({cell:CELL,structures:[]},hero),null,'nothing before the tap');
  const p={x:24.3,y:22.1};
  k.press(p,CELL);
  assert.deepEqual(k.footprint(),[1,1],'the root takes one cell, as in the sim');
  const g=k.ghost({cell:CELL,structures:[]},hero)!;
  assert.equal(g.look,'ok');assert.deepEqual([g.w,g.h],[1,1]);
  assert.ok(Math.abs((g.c+.5)*CELL-p.x)<=CELL/2&&Math.abs((g.r+.5)*CELL-p.y)<=CELL/2,'where the finger is');
  // A standing structure on that cell, or a cell beyond the reach: red.
  assert.equal(k.ghost({cell:CELL,structures:[{id:'s',kind:'muro',x:0,y:0,hp:10,c:g.c,r:g.r}]},hero)!.look,'bloqueado');
  k.release();k.move({x:hero.x+KIT_REACH+2,y:hero.y},CELL);
  assert.equal(k.ghost({cell:CELL,structures:[]},hero)!.look,'bloqueado','the mouse hovering past the reach');
  assert.equal(kitRefusalText(k.blocked),'Longe demais, chega mais perto');
  k.move({x:hero.x+KIT_REACH-1,y:hero.y},CELL);
  assert.equal(k.ghost({cell:CELL,structures:[]},hero)!.look,'ok',`${KIT_REACH-1} u away, no walking`);
  // A 3×2 tower takes its 3×3 square and never turns.
  k.start(1,'kit:lanca-foguetes');assert.deepEqual(k.footprint(),[3,3]);assert.equal(k.canTurn(),false);
  k.press({x:10,y:10},CELL);k.move({x:10,y:14},CELL);assert.equal(k.rot,0);
});

test('barricada-tocar-no-mapa: press, drag to turn (snaps to the 2 axes, stays on the press), release builds; R turns too',()=>{
  const k=new KitPlace(()=>0),sent:unknown[][]=[];
  const net={place:(...a:unknown[])=>{sent.push(a);return sent.length;}};
  k.start(0,'kit:barricada');
  assert.deepEqual(k.footprint(),[2,1],'2 cells long, 1 thick');
  const p={x:30,y:30};
  k.press(p,CELL);
  const first=k.cell;
  k.move({x:30+KIT_TURN_DRAG*.5,y:30+KIT_TURN_DRAG*.6},CELL);assert.equal(k.rot,0,'a short wobble does not turn it');
  k.move({x:30.1,y:31.5},CELL);assert.equal(k.rot,1,'dragged along y: along y');assert.deepEqual(k.footprint(),[1,2]);
  const r=k.rect(CELL)!;assert.ok(Math.abs(r.cx-p.x)<=CELL/2&&Math.abs(r.cy-p.y)<=CELL/2,'turned on the press, not on the finger');
  k.move({x:28,y:30.4},CELL);assert.equal(k.rot,0,'dragged back along x');assert.deepEqual(k.cell,first);
  k.move({x:30.2,y:33},CELL);
  assert.equal(k.release(),true,'let go: build');assert.equal(k.pressing,false);
  assert.equal(k.confirm(net),'sent');
  assert.deepEqual(sent[0],[0,'barricada',k.cell!.c,k.cell!.r,1]);
  assert.equal(k.release(),false,'nothing held, nothing to build');
  // R on the PC: the other axis, still centred on the ghost.
  const before=k.rect(CELL)!;k.turn(CELL);const after=k.rect(CELL)!;
  assert.equal(k.rot,0);assert.ok(Math.abs(after.cx-before.cx)<=CELL*.51&&Math.abs(after.cy-before.cy)<=CELL*.51);
  k.cancel();assert.equal(k.pressing,false);assert.equal(k.active,false);
});

test('confirm sends {t:place} once per cell; the answer: a tower kit ends the mode, a wall kit stays; refusals in words',()=>{
  let t=0;const k=new KitPlace(()=>t),sent:unknown[][]=[];
  const net={place:(...a:unknown[])=>{sent.push(a);return sent.length;}};
  assert.equal(k.confirm(net),'none');
  k.start(2,'kit:holofote');k.press({x:10,y:10},CELL);
  assert.equal(k.confirm(net),'sent');assert.equal(k.confirm(net),'pending','the same cell waits for its answer');
  assert.deepEqual(sent[0].slice(0,2),[2,'holofote']);
  assert.equal(k.answer({req:1,ok:false,reason:'tranca'}),'Isso tranca o chaveiro, chefe');
  assert.equal(k.ghost({cell:CELL,structures:[]},{x:10,y:10})!.look,'bloqueado','the room said no for that cell');
  t=5000;assert.equal(k.confirm(net),'sent');
  assert.equal(k.answer({req:2,ok:true}),undefined);assert.equal(k.active,false,'a tower kit is done');
  k.start(0,'kit:muro');k.press({x:10,y:10},CELL);k.confirm(net);
  assert.equal(k.answer({req:3,ok:true}),undefined);assert.equal(k.active,true,'a muro kit keeps laying');
  assert.equal(k.ghost({cell:CELL,structures:[]},{x:10,y:10})!.look,'bloqueado','the wall it just laid takes that cell');
  assert.equal(kitRefusalText(k.blocked),'Já tem coisa aí');
  assert.equal(kitRefusalText('away'),'Longe demais, chega mais perto');assert.equal(kitRefusalText('limite'),'Chegou no limite');
  assert.equal(k.answer({req:99,ok:false}),undefined,'not ours');
});

test('sync: the kit follows its id when the slots shift, the mode ends when it is gone',()=>{
  const k=new KitPlace(()=>0);
  k.start(2,'kit:morteiro');
  k.sync([{id:'faca'},{id:'kit:morteiro'}]);assert.equal(k.kit?.slot,1);
  k.sync([{id:'faca'}]);assert.equal(k.active,false);
});

test('construir-no-botao: the selected kit is the slot in the hand and the button says Construir with the kit sticker',()=>{
  const player={weapons:[{id:'faca',level:1},kitItem('morteiro'),kitItem('muro')],hand:0};
  const picked=inventorySlots(player,1)!;
  assert.deepEqual(picked.map(s=>s.hand),[false,true,false],'the kit, not the knife, is marked');
  assert.match(slotLabel(picked[1]),/escolhido: toque no mapa/);
  assert.deepEqual(inventorySlots(player)!.map(s=>s.hand),[true,false,false],'no kit: the weapon again');
  // The button's face for each selection.
  const kit=actionFace('manual','cidadao-comum','faca','kit:morteiro');
  assert.deepEqual([kit.word,kit.icon],[BUILD_WORD,itemDisplay('kit:morteiro').icon]);
  assert.equal(BUILD_WORD,'Construir');assert.match(kit.label,/Construir Kit Morteiro/);
  assert.equal(actionFace('manual','cidadao-comum','faca',kitItem('muro').id).icon,itemDisplay('kit:muro').icon);
  assert.deepEqual([actionFace('manual','cidadao-comum','faca').word,actionFace('manual','cidadao-comum','faca').icon],[ATTACK_WORD,'faca'],'back to Atacar with the weapon');
  assert.equal(actionFace('auto','cidadao-comum','').word,SKILL_WORD);
});

test('barricada-tocar-no-mapa: a red ghost says why (no confirm sent); the hero walking never moves it',()=>{
  const k=new KitPlace(()=>0),hero={x:30,y:30};
  k.start(1,'kit:muro');k.press({x:33,y:30},CELL);
  const g=k.ghost({cell:CELL,structures:[]},hero)!;
  assert.equal(g.look,'ok');assert.equal(k.blocked,undefined);
  k.ghost({cell:CELL,structures:[{id:'s',kind:'muro',x:0,y:0,hp:10,c:g.c,r:g.r}]},hero);
  assert.equal(kitRefusalText(k.blocked),'Já tem coisa aí');
  // Off walkable ground (the room's onGround, kitGround): red, 'fora'; the room's own refusal is the word after it.
  k.ghost({cell:CELL,structures:[],ground:()=>false},hero);assert.equal(kitRefusalText(k.blocked),'Aí não dá pra construir');
  // A friend or a critter standing on it: red, as the room's 'taken' (the builder itself never counts).
  k.ghost({cell:CELL,structures:[],bodies:[{x:(g.c+.5)*CELL,y:(g.r+.5)*CELL}]},hero);assert.equal(kitRefusalText(k.blocked),'Já tem coisa aí');
  // The hero walks away: the ghost stays where the finger put it.
  const moved=k.ghost({cell:CELL,structures:[]},{x:36,y:34})!;
  assert.deepEqual([moved.c,moved.r],[g.c,g.r]);
  k.cancel();assert.equal(k.ghost({cell:CELL,structures:[]},hero),null,'no kit, no ghost');
});
