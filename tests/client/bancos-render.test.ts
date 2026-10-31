// Bancos in the world (card bancos-e-veiculos): what the render reads from ObjectiveView.banks. A withdrawal is a saldo
// drop of whole notes between two views (no event on the wire): the hero's notes beep, the critter's do not; the screen
// and the tag follow the state; the kiosk's figure keeps the bank's colour and the screen's look.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SIM_HZ,type BankView} from '../../src/contract/index.ts';
import {BANCO,BANK_BEEP,BANK_LINES} from '../../src/rules/bancos.ts';
import {BankTracker,LINE_EVERY,NOTE_MS,NOTES_PER_VIEW,clock,emptySeconds,lineAt,notesBetween,saldoShare,screenOf} from '../../src/client/render/bancos/rules.ts';
import {BANK_COLORS,atmBoxes} from '../../src/client/render/bancos/figures.ts';

const bank=(extra:Partial<BankView>={}):BankView=>({id:'banco-0',x:10,y:20,name:'pao-duro',saldo:40,state:'aberto',...extra});

test('notes: whole notes of a saldo drop, capped per view; the critter\'s while it robs; a refill is none',()=>{
  assert.deepEqual(notesBetween(undefined,bank()),{count:0,by:'hero'});
  assert.deepEqual(notesBetween(bank({saldo:40}),bank({saldo:38,state:'sacando'})),{count:1,by:'hero'});
  assert.deepEqual(notesBetween(bank({saldo:20,state:'bicho'}),bank({saldo:16,state:'bicho'})),{count:2,by:'enemy'});
  assert.equal(notesBetween(bank({saldo:40}),bank({saldo:0,state:'sem-cedulas'})).count,NOTES_PER_VIEW);
  assert.equal(notesBetween(bank({saldo:0,state:'sem-cedulas'}),bank({saldo:BANCO.saldo})).count,0,'the refill');
  // The last note before it emptied, taken by the critter: still the critter's.
  assert.equal(notesBetween(bank({saldo:2,state:'bicho'}),bank({saldo:0,state:'sem-cedulas'})).by,'enemy');
});

test('the screen and the clocks: blue 24h, green R$ 2, red SAQUE blinking (steady when reduced), dark SEM CÉDULAS m:ss',()=>{
  assert.deepEqual(screenOf(bank(),0,0,false),{look:'azul',text:'24h'});
  assert.deepEqual(screenOf(bank({state:'sacando'}),0,0,false),{look:'verde',text:`R$ ${BANCO.nota}`});
  assert.equal(screenOf(bank({state:'bicho'}),0,0,false).look,'vermelho');
  assert.equal(screenOf(bank({state:'bicho'}),0,300,false).look,'apagado');
  assert.equal(screenOf(bank({state:'bicho'}),0,300,true).look,'vermelho');
  const empty=bank({state:'sem-cedulas',saldo:0,until:100+130*SIM_HZ});
  assert.equal(emptySeconds(empty,100),130);assert.equal(screenOf(empty,100,0,false).text,'SEM CÉDULAS 2:10');
  assert.equal(emptySeconds(empty,1e9),0);assert.equal(emptySeconds(bank(),0),0);
  assert.equal(clock(65),'1:05');assert.equal(saldoShare(bank({saldo:BANCO.saldo/2})),.5);assert.equal(saldoShare(bank({saldo:-3})),0);
});

test('the tracker: notes fly NOTE_MS, the hero\'s beep, a screen line on every LINE_EVERY-th hero note, none for the critter',()=>{
  const t=new BankTracker();
  t.push([bank()],0,0);
  t.push([bank({saldo:38,state:'sacando'})],60,1000);
  assert.equal(t.notes.length,1);assert.equal(t.balloons[0].text,lineAt('banco-0',0),'the first hero note brings a line');
  assert.deepEqual(t.paid,[{bank:'banco-0',count:1}],'the PIX swarm pops one +R$ per hero note');
  t.push([bank({saldo:36,state:'sacando'})],120,4000);
  assert.equal(t.balloons.length,1);assert.equal(t.balloons[0].text,BANK_BEEP);assert.ok(t.balloons[0].beep);
  t.push([bank({saldo:34,state:'bicho'})],160,6000);
  assert.equal(t.balloons[0].text,BANK_BEEP,'a robbed note does not beep');assert.equal(t.notes.at(-1)!.by,'enemy');
  t.settle(6000+NOTE_MS);assert.equal(t.notes.length,0);
  assert.ok(BANK_LINES.includes(lineAt('banco-7',LINE_EVERY)!));assert.equal(lineAt('banco-7',1),undefined);
  // A bank that leaves the view is forgotten (its count starts over).
  t.push([],200,7000);assert.equal(t.banks.length,0);
});

test('the tracker with the room\'s events: bank-cash says who took the note (the saldo and the state do not)',()=>{
  const t=new BankTracker(),cash=(eventId:number,by:'hero'|'enemy',bankId='banco-0')=>({type:'bank-cash' as const,bank:bankId,amount:BANCO.nota,by,eventId});
  t.push([bank()],0,0,[]);
  // A critter takes the last note without the bank ever showing 'bicho': a dark note, no beep (review 1, M3).
  t.push([bank({saldo:0,state:'sem-cedulas'})],60,1000,[cash(1,'enemy')]);
  assert.deepEqual(t.notes.map(n=>n.by),['enemy']);assert.equal(t.balloons.length,0);
  // The same events again (a view repeats them) fire nothing; a hero and a critter in one view: the hero's first.
  t.push([bank({saldo:0,state:'sem-cedulas'})],61,1100,[cash(1,'enemy')]);assert.equal(t.notes.length,1);
  t.push([bank({saldo:36,state:'sacando'})],120,2000,[cash(1,'enemy'),cash(2,'enemy'),cash(3,'hero'),cash(4,'hero','outro')]);
  assert.deepEqual(t.notes.slice(1).map(n=>n.by),['hero','enemy']);assert.equal(t.balloons.length,1);
  assert.deepEqual(t.paid,[{bank:'banco-0',count:1}],'only the hero notes, of a bank in view');
  // A refill (saldo up) with no event: no note.
  t.push([bank({saldo:40,state:'aberto'})],180,3000,[]);assert.equal(t.notes.length,3);
});

test('the kiosk: its sign in the bank\'s colour, the screen in its look, standing on the slab',()=>{
  const boxes=atmBoxes('juros','vermelho');
  assert.ok(boxes.some(b=>b.color===BANK_COLORS.sign.juros));
  assert.ok(boxes.some(b=>b.color===BANK_COLORS.screen.vermelho));
  assert.ok(!atmBoxes('posto','azul').some(b=>b.color===BANK_COLORS.screen.vermelho));
  assert.ok(boxes.every(b=>b.z>=0&&b.h>0));
});
