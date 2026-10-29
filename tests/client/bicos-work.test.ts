/** Bicos on the client (card NEW-20261024-ORQ-bancos-viram-bicos, etapa 4): the Trabalhar button, its latch and the texts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BankView} from '../../src/contract/index.ts';
import {BANCO,BICOS,BICO_EXPULSO,BICO_FECHADO} from '../../src/rules/index.ts';
import {WORK_WAIT_MS,WorkLatch,bicoLine,bicoRobberyText,bicoTag,workShop,workingIn} from '../../src/client/hud/bicos.ts';

const shop=(id:string,o:Partial<BankView>={}):BankView=>({id,x:0,y:0,name:'posto',saldo:40,state:'aberto',bico:'telemarketing',...o});

test('workShop: the nearest open shop whose ring the hero stands in; a closed one takes nobody', ()=>{
  const a=shop('a'),b=shop('b',{x:3,y:0}),closed=shop('c',{x:1,y:0,state:'sem-cedulas'});
  assert.equal(workShop([a,b,closed],{x:2.5,y:0})?.id,'b');
  assert.equal(workShop([a,b,closed],{x:.9,y:0})?.id,'a');
  assert.equal(workShop([closed],{x:1,y:0}),undefined);
  assert.equal(workShop([a],{x:BANCO.holdR+.01,y:0}),undefined);
  assert.equal(workShop([shop('r',{state:'bicho'})],{x:1,y:0})?.id,'r','a robbed shop still takes a hero (he scares the critter off)');
  assert.equal(workingIn([a,shop('w',{workers:['me']})],'me')?.id,'w');
});

test('WorkLatch: a tap clocks in and nothing is held; moving, a second tap or the room letting us go clocks out', ()=>{
  const l=new WorkLatch(),still={x:0,y:0};
  assert.equal(l.step(still),false);
  l.tap(0);assert.equal(l.step(still),true);assert.equal(l.step(still),true);
  assert.equal(l.step({x:1,y:0}),false,'the stick quits');
  l.tap(0);l.tap(10);assert.equal(l.step(still),false,'a second tap quits');
  // The room took us in, then let us go (the shop closed, the manager): the latch does not clock us in again.
  l.tap(0);l.view(true,true,100);assert.equal(l.asked,true);l.view(false,true,200);assert.equal(l.step(still),false);
  // The room never took us in (banned): it lets go after WORK_WAIT_MS.
  l.tap(0);l.view(false,true,WORK_WAIT_MS-1);assert.equal(l.asked,true);l.view(false,true,WORK_WAIT_MS+1);assert.equal(l.asked,false);
  // Out of the ring: off at once.
  l.tap(0);l.view(false,false,1);assert.equal(l.asked,false);
});

test('bicoTag: gig and saldo, the shift with its name and queue, the robbery, the closed sign', ()=>{
  const nome=BICOS.telemarketing.nome,name=(id:string)=>id==='me'?'Você':'Zé';
  assert.deepEqual(bicoTag(shop('a'),0,name),{look:'normal',text:`${nome}: R$ 40`});
  assert.deepEqual(bicoTag(shop('a',{state:'sacando',workers:['me'],saldo:35}),0,name),{look:'turno',text:`${nome}
Você no turno: R$ 35`});
  assert.deepEqual(bicoTag(shop('a',{state:'sacando',workers:['me','z'],fila:2,saldo:30}),0,name),{look:'turno',text:`${nome}
2 no turno: R$ 30, 2 na fila`});
  assert.deepEqual(bicoTag(shop('a',{state:'bicho'}),0,name),{look:'bicho',text:`${nome}: bicho no caixa!`});
  assert.deepEqual(bicoTag(shop('a',{state:'sem-cedulas'}),130,name),{look:'vazio',text:`${BICO_FECHADO}: 2:10`});
  assert.equal(bicoRobberyText(shop('a',{bico:'aura-67'})),`Bicho no caixa do ${BICOS['aura-67'].nome}!`);
});

test('bicoLine: only the local player\'s own entering (the joke) and expulsion (the manager)', ()=>{
  const banks=[shop('a',{bico:'coach'})];
  assert.equal(bicoLine({type:'bico',bank:'a',player:'me',what:'entrou'},'me',banks),BICOS.coach.frase);
  assert.equal(bicoLine({type:'bico',bank:'a',player:'me',what:'expulso'},'me',banks),BICO_EXPULSO);
  assert.equal(bicoLine({type:'bico',bank:'a',player:'me',what:'saiu'},'me',banks),undefined);
  assert.equal(bicoLine({type:'bico',bank:'a',player:'zé',what:'entrou'},'me',banks),undefined);
});
