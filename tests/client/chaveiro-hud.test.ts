/**
 * The chaveiro objective in the HUD (D-047, card NEW-20261014-ORQ-chaveiro-hud): the round chip's "Onda N" and clock,
 * why he stopped, the car's bar in the base ficha, Dona Cida's button and tray, and the result's bill. Pure models only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {ObjectiveResult,ObjectiveView} from '../../src/contract/objective.ts';
import {CIDA_ITEMS} from '../../src/contract/objective.ts';
import type {RunView} from '../../src/contract/view.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import {nestTally,nestsMode,roundInfo} from '../../src/client/hud/model.ts';
import {marqueeFor} from '../../src/client/hud/topbar.ts';
import {barClock,baseBar} from '../../src/client/hud/camp.ts';
import {resultHeadline,resultRoundLine} from '../../src/client/hud/result.ts';
import {computeZones} from '../../src/client/hud/zones.ts';
import {COVERING,WINDOWS} from '../../src/client/hud/edges.ts';
import {CAR_BAR_LOW,CIDA_LEAVE_U,CIDA_REACH_U,DEBT_VICTORY_TEXT,MOTO_REASONS,MotoReason,OBJECTIVE_CAUSE_TEXT,REASON_MS,carBar,chaveiroClock,cidaBought,cidaButtonShown,
  cidaOffers,cidaRefusal,cidaSells,etaClock,liveObjective,nearMoto,objectiveBill,reais} from '../../src/client/hud/chaveiro.ts';
import {CIDA_REACH} from '../../src/sim/chaveiro/system.ts';
import {CAR_LOW} from '../../src/client/render/chaveiro/rules.ts';

const objective=(over:Partial<ObjectiveView>={}):ObjectiveView=>({kind:'chaveiro',moto:{x:10,y:10,mode:'anda'},route:[],stops:[],etaS:588,alarmUntil:0,
  grana:40,budget:120,stock:[4,4,4],car:{x:0,y:0,hits:30,limit:120,parts:0},...over});
const withObjective=(o?:ObjectiveView):RunView=>({...fakeView('wave',1),...(o?{objective:o}:{})});

test('the chaveiro clock: whole seconds as m:ss, never negative',()=>{
  assert.equal(etaClock(600),'10:00');
  assert.equal(etaClock(588),'9:48');
  assert.equal(etaClock(7),'0:07');
  assert.equal(etaClock(6.2),'0:07');
  assert.equal(etaClock(-3),'0:00');
  assert.equal(etaClock(Number.NaN),'0:00');
  assert.equal(reais(120),'R$ 120');
  assert.equal(reais(-5),'R$ 0');
  assert.deepEqual(chaveiroClock({etaS:588,moto:{x:0,y:0,mode:'anda'}}),{clock:'9:48',seconds:588,aria:'Chaveiro chega em 9:48',held:false});
  assert.match(chaveiroClock({etaS:12,moto:{x:0,y:0,mode:'abrindo'}}).aria,/abrindo o carro: 0:12/);
});

test("the chefão up (boss-fim-onda-1): the clock is held, padlock and grey on the chip and on the phone's bar; the Síndico does not hold it",()=>{
  const chefao={id:'b1',kind:'mapinguari-do-shopping',x:0,y:0,hp:900,maxHp:1100,boss:true};
  const up=(enemy:object)=>({...withObjective(objective()),enemies:[enemy]}) as unknown as RunView;
  const held=roundInfo(up(chefao))!.chaveiro!;
  assert.equal(held.held,true);
  assert.match(held.aria,/parado até o chefão cair/);
  const bar=barClock(up(chefao))!;
  assert.deepEqual({icon:bar.icon,held:bar.held},{icon:'cadeado',held:true});
  assert.equal(roundInfo(up({...chefao,hp:0}))!.chaveiro!.held,false,'he fell: it runs');
  assert.equal(roundInfo(up({...chefao,kind:'sindico'}))!.chaveiro!.held,false,'the final boss does not hold it');
  assert.equal(barClock(up({...chefao,hp:0}))!.icon,undefined,'running: no sticker (topo-sem-icone-contagem-exploracao)');
});

test('the round chip: "Onda N" plus his clock while the objective runs, "Round N/10" without it or once it ended',()=>{
  const plain=roundInfo(withObjective());
  assert.equal(plain?.label,'Rodada 3 de 10');
  assert.equal(plain?.chaveiro,undefined);
  const live=roundInfo(withObjective(objective()));
  assert.equal(live?.label,'Onda 3');
  assert.equal(live?.chaveiro?.clock,'9:48');
  // The detail (critters left) stays.
  assert.equal(live?.detail,plain?.detail);
  // Past round 10 the waves go on: never "Onda 12/10".
  const late={...withObjective(objective()),round:{...withObjective().round!,index:12}};
  assert.equal(roundInfo(late)?.label,'Onda 12');
  const ended=roundInfo(withObjective(objective({ended:'victory'})));
  assert.equal(ended?.label,'Rodada 3 de 10');
  assert.equal(liveObjective(withObjective(objective({ended:'defeat'}))),undefined);
  // The interval keeps its countdown, with the clock.
  const prep=roundInfo({...withObjective(objective()),round:{...withObjective().round!,phase:'prepare',phaseEndsTick:withObjective().tick+60}});
  assert.equal(prep?.phase,'prepare');
  assert.equal(prep?.chaveiro?.clock,'9:48');
});

test('D-051 nests: the nests of the room (kind "ninho", a fallen one too) mark the mode; the chip keeps the clock and drops "Onda N"',()=>{
  const nest=(phase:string,hp=40)=>({id:`n-${phase}`,kind:'ninho',x:5,y:5,hp,maxHp:40,phase});
  const rounds=withObjective(objective());
  assert.equal(nestsMode(rounds),false);
  assert.equal(roundInfo(rounds)?.nests,undefined);
  const nests={...rounds,structures:[...rounds.structures,nest('dormindo')]} as RunView;
  assert.equal(nestsMode(nests),true);
  const chip=roundInfo(nests);
  assert.equal(chip?.nests,true);
  assert.equal(chip?.chaveiro?.clock,'9:48');
  // All nests down: still the nests mode (a fallen one stays in the view).
  assert.equal(nestsMode({...rounds,structures:[nest('destruido',0)]} as RunView),true);
  // Other structures are not nests.
  assert.equal(nestsMode({...rounds,structures:[{id:'w',kind:'muro',x:0,y:0,hp:1,maxHp:1}]} as RunView),false);
});

test('D-051 nests: the result counts the nests that fell instead of "Onda N"',()=>{
  const nest=(id:string,hp:number,phase:string)=>({id,kind:'ninho',x:0,y:0,hp,maxHp:40,phase});
  const view={structures:[nest('a',0,'destruido'),nest('b',12,'ativo'),nest('c',40,'dormindo'),{id:'w',kind:'muro',x:0,y:0,hp:1,maxHp:1}]};
  assert.deepEqual(nestTally(view),{down:1,total:3});
  assert.equal(nestTally({structures:[]}),undefined);
  assert.equal(nestTally(undefined),undefined);
  const objective={outcome:'defeat',cause:'timeout',wave:4,budget:120,grana:30,paid:30,debt:0} as unknown as ObjectiveResult;
  assert.equal(resultRoundLine({round:4,totalRounds:10,objective},{down:1,total:3}),'Ninhos 1/3');
  assert.equal(resultRoundLine({round:4,totalRounds:10,objective}),'Onda 4');
  assert.equal(resultRoundLine({round:4,totalRounds:10}),'Rodada 4 de 10');
});

test('the round banner with the chaveiro: "Onda N" and no boss line by the round number',()=>{
  assert.equal(marqueeFor({index:12,phase:'wave'},Infinity,'Onda')?.title,'Onda 12');
  assert.equal(marqueeFor({index:12,phase:'wave'},Infinity,'Onda')?.tone,'round');
  assert.equal(marqueeFor({index:10,phase:'wave'})?.tone,'boss');
  assert.equal(marqueeFor({index:4,phase:'wave'})?.title,'Rodada 4');
});

test('why he stopped: the card\'s words, one short line each, shown once per stop and dropped when he rides again',()=>{
  // The card: "dando a volta no quarteirão", "moto morta: empurra!", "entregando", "lombada".
  assert.equal(MOTO_REASONS.volta?.toLowerCase(),'dando a volta no quarteirão');
  assert.equal(MOTO_REASONS.morta?.toLowerCase(),'moto morta: empurra!');
  assert.equal(MOTO_REASONS.entrega?.toLowerCase(),'entregando');
  assert.equal(MOTO_REASONS.lombada?.toLowerCase(),'lombada');
  assert.equal(MOTO_REASONS.anda,undefined);
  // One line at 390 px: the slot's row is ≤ 320 px; 28 characters of 13 px bold plus the sticker fit (measured 189 px for "Moto morta: empurra!").
  for(const [mode,text] of Object.entries(MOTO_REASONS))if(text)assert.ok(text.length<=28,`${mode}: ${text}`);
  assert.ok(REASON_MS>=2000&&REASON_MS<=3000);
  const r=new MotoReason();
  assert.deepEqual(r.step('anda'),{drop:false});
  const dead=r.step('morta');
  assert.equal(dead.show?.text,'Moto morta: empurra!');
  assert.equal(dead.show?.urgent,true);
  assert.deepEqual(r.step('morta'),{drop:false},'the same stop never queues twice');
  assert.deepEqual(r.step('anda'),{drop:true});
  assert.equal(r.step('volta').show?.urgent,false);
  // A new stop replaces the old one at once (volta → lombada), and the end takes it off.
  assert.equal(r.step('lombada').show?.text,'Lombada');
  assert.deepEqual(r.step(undefined),{drop:true});
  assert.deepEqual(r.step(undefined),{drop:false});
  r.reset();
  assert.equal(r.step('entrega').show?.text,'Entregando');
});

test('the car in the base ficha: hits it still takes over the limit, Cone under 30% like the render',()=>{
  assert.equal(CAR_BAR_LOW,CAR_LOW);
  const bar=carBar(objective());
  assert.deepEqual({fraction:bar?.fraction,left:bar?.left,limit:bar?.limit,low:bar?.low},{fraction:.75,left:90,limit:120,low:false});
  assert.match(bar!.label,/aguenta mais 90 pancadas de 120/);
  assert.equal(carBar(objective({car:{x:0,y:0,hits:100,limit:120,parts:15}}))?.low,true);
  assert.equal(carBar(objective({car:{x:0,y:0,hits:130,limit:120,parts:15}}))?.left,0);
  assert.equal(carBar(objective({car:{x:0,y:0,hits:119,limit:120,parts:15}}))?.label,'O carro aguenta mais 1 pancada de 120');
  assert.equal(carBar(undefined),undefined);
  // The ficha: the car replaces the wall's bar and number; without the objective it is the wall as before.
  const v=withObjective(objective());
  assert.deepEqual(baseBar({...v,structures:[]}),{fraction:.75,value:90,low:false,label:bar!.label,car:true});
  const wall=baseBar({structures:[{id:'w',kind:'muralha',x:0,y:0,hp:150,maxHp:600}]});
  assert.deepEqual(wall,{fraction:.25,value:150,low:true,label:'Vida da muralha',car:false});
});

test('Dona Cida\'s reach: the sim\'s 3 u to show, a little more to hide (the predicted spot never blinks the button)',()=>{
  assert.equal(CIDA_REACH_U,CIDA_REACH);
  assert.ok(CIDA_LEAVE_U>CIDA_REACH_U);
  const moto={x:10,y:10};
  assert.equal(nearMoto({x:12.9,y:10},moto,false),true);
  assert.equal(nearMoto({x:13.2,y:10},moto,false),false);
  assert.equal(nearMoto({x:13.2,y:10},moto,true),true,'already shown: it stays until 3.4 u');
  assert.equal(nearMoto({x:13.5,y:10},moto,true),false);
  assert.equal(nearMoto(undefined,moto,true),false);
  assert.equal(nearMoto({x:10,y:10},undefined,false),false);
  const ok={live:true,standing:true,near:true,offerOpen:false,ended:false};
  assert.equal(cidaButtonShown(ok),true);
  for(const key of ['live','standing','near'] as const)assert.equal(cidaButtonShown({...ok,[key]:false}),false,key);
  assert.equal(cidaButtonShown({...ok,offerOpen:true}),false);
  assert.equal(cidaButtonShown({...ok,ended:true}),false);
});

test('Dona Cida\'s tray: the three sweets with price and stock; out of stock first, then short of Grana; refusals in one line',()=>{
  const offers=cidaOffers({grana:20,stock:[4,1,0]});
  assert.deepEqual(offers.map(o=>o.id),CIDA_ITEMS.map(i=>i.id));
  assert.deepEqual(offers.map(o=>o.priceText),['R$ 15','R$ 25','R$ 20']);
  assert.deepEqual(offers.map(o=>o.stockText),['sobram 4','último','acabou']);
  assert.deepEqual(offers.map(o=>o.blocked),[undefined,'grana','stock']);
  assert.equal(offers[1].short,5);
  assert.match(offers[1].label,/Falta R\$ 5\./);
  assert.match(offers[2].label,/Acabou\./);
  assert.equal(cidaSells(offers),true);
  assert.equal(cidaSells(cidaOffers({grana:10,stock:[4,4,4]})),false,'no Grana for any: the button goes dim');
  assert.equal(cidaSells(cidaOffers({grana:999,stock:[0,0,0]})),false,'an empty tray: dim too');
  assert.equal(cidaRefusal('grana',offers[1]),'Falta R$ 5.');
  assert.equal(cidaRefusal('stock'),'Acabou esse doce.');
  assert.equal(cidaRefusal('away'),'Chega mais perto da moto.');
  assert.equal(cidaRefusal('phase'),'Agora não dá.');
  assert.match(cidaRefusal('item'),/Tenta de novo/);
  assert.equal(cidaBought('Brigadeiro de Panela'),'Brigadeiro na mão!');
  // Short tags: every effect line stays within two lines of a 77 px column (~24 characters).
  for(const o of offers)assert.ok(o.effect.length<=20,o.effect);
});

const result=(over:Partial<ObjectiveResult>={}):ObjectiveResult=>({kind:'chaveiro',outcome:'victory',cause:'opened',wave:12,extraWaves:2,eta:0,seconds:1340,
  hits:42,limit:120,budget:456,grana:500,paid:456,debt:0,parts:3,...over});

test('the result\'s bill: why it ended, the budget, the Grana and "vitória com dívida (levou o volante)"',()=>{
  assert.deepEqual(Object.keys(OBJECTIVE_CAUSE_TEXT).sort(),['car','opened','team','timeout']);
  const paid=objectiveBill(result());
  assert.equal(paid.reason,OBJECTIVE_CAUSE_TEXT.opened);
  assert.equal(paid.budget,'R$ 456');assert.equal(paid.grana,'R$ 500');
  assert.equal(paid.debtVictory,false);assert.equal(paid.debt,undefined);
  assert.equal(paid.wave,'Onda 12');
  const owed=objectiveBill(result({grana:372,paid:372,debt:84}));
  assert.equal(owed.debtVictory,true);
  assert.equal(owed.debt,'R$ 84');
  assert.equal(owed.reason,DEBT_VICTORY_TEXT);
  assert.match(DEBT_VICTORY_TEXT,/Vitória com dívida/);assert.match(DEBT_VICTORY_TEXT,/levou o volante/);
  assert.match(owed.aria,/levou o volante/);
  // A defeat never says "com dívida": the bill is just shown.
  for(const [cause,outcome] of [['car','defeat'],['team','defeat'],['timeout','timeout']] as const){
    const b=objectiveBill(result({cause,outcome,debt:84,grana:372,paid:372}));
    assert.equal(b.debtVictory,false,cause);
    assert.equal(b.reason,OBJECTIVE_CAUSE_TEXT[cause]);
  }
  assert.equal(resultHeadline({victory:false,seed:'0',objective:result({cause:'car',outcome:'defeat'})}).subtitle,OBJECTIVE_CAUSE_TEXT.car);
  assert.equal(resultHeadline({victory:true,seed:'0',objective:result()}).title,'Vitória!');
  // Without the objective the old lines stay.
  assert.notEqual(resultHeadline({victory:true,seed:'0'}).subtitle,OBJECTIVE_CAUSE_TEXT.opened);
});

test('her button is a right-thumb control: the useful area leaves it out, and the arrows keep clear of the button and the tray',()=>{
  const viewport={width:390,height:844};
  const skill={x:284,y:738,width:82,height:82},joystick={x:14,y:718,width:112,height:112};
  const cida={x:297,y:658,width:56,height:56};
  const without=computeZones({viewport,status:[{x:8,y:8,width:316,height:86}],skill,joystick});
  const withIt=computeZones({viewport,status:[{x:8,y:8,width:316,height:86}],skill,joystick,cida});
  assert.ok(withIt.rightThumb!.y<=cida.y-24,'the thumb zone grows by her button and its 24 px');
  const u=withIt.useful;
  assert.ok(!(u.x<cida.x+cida.width&&u.x+u.width>cida.x&&u.y<cida.y+cida.height&&u.y+u.height>cida.y),'the useful area never holds her button');
  assert.notDeepEqual(withIt.useful,without.useful);
  assert.match(COVERING,/\.rh-cida:not\(\[hidden\]\)/);assert.match(COVERING,/\.rh-cida-btn/);
  assert.match(WINDOWS,/\.rh-cida:not\(\[hidden\]\)/);
});
