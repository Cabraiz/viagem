/**
 * Card chaveiro-chegou-e-relogio: the clock's stop ("Moto tombou: +4 s", hud/chaveiro.ts ClockStopTracker) and the
 * "chegou" band (arrivalBand). Only the HUD reads the room's ETA; nothing here changes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SIM_HZ} from '../../src/contract/types.ts';
import {ARRIVAL_SECONDS,CLOCK_ADDED_HOLD_S,CLOCK_ADDED_MIN_S,CLOCK_HIT_LABEL,CLOCK_HIT_FIRST_LABEL,ClockHitTracker,ClockStopTracker,ClockTag,arrivalBand} from '../../src/client/hud/chaveiro.ts';
import {ABRINDO_SECONDS} from '../../src/sim/chaveiro/system.ts';

test('a tombo freezes the clock: the time it adds shows, grows, and stays a moment after he rides again',()=>{
  const t=new ClockStopTracker();
  assert.equal(t.step('anda',300,0),undefined);
  // He falls at 300 s; the ETA stays put while the moto is down.
  assert.equal(t.step('tombo',300,SIM_HZ),undefined);
  assert.equal(t.step('tombo',300,SIM_HZ*(1+CLOCK_ADDED_MIN_S)-1),undefined,'under the minimum: rounding noise');
  const shown=t.step('tombo',300,SIM_HZ*5);
  assert.deepEqual(shown,{mode:'tombo',label:'Moto tombou',text:'Moto tombou: +4 s',added:4,urgent:true});
  // Rides again: the last line stays CLOCK_ADDED_HOLD_S, then goes.
  assert.equal(t.step('anda',299,SIM_HZ*6)?.text,'Moto tombou: +4 s');
  assert.equal(t.step('anda',290,SIM_HZ*(5+CLOCK_ADDED_HOLD_S)+1),undefined);
});

test('a lombada adds what the crawl costs; a stop the clock already counts says nothing',()=>{
  const t=new ClockStopTracker();
  // Half pace: the ETA falls half a second per second.
  for(let s=0;s<=6;s++)t.step('lombada',200-s/2,s*SIM_HZ);
  assert.deepEqual(t.step('lombada',196,8*SIM_HZ),{mode:'lombada',label:'Lombada',text:'Lombada: +4 s',added:4,urgent:false});
  const planned=new ClockStopTracker();
  for(let s=0;s<=20;s++)assert.equal(planned.step('entrega',100-s,s*SIM_HZ),undefined);
});

test('arrival and the end clear it at once; the abrindo band counts down and fills',()=>{
  const t=new ClockStopTracker();
  t.step('morta',60,0);assert.equal(t.step('morta',60,4*SIM_HZ)?.text,'Moto morta: +4 s');
  assert.equal(t.step('abrindo',15,5*SIM_HZ),undefined);
  assert.equal(ARRIVAL_SECONDS,ABRINDO_SECONDS,'the band lasts what the sim opens for');
  assert.equal(arrivalBand({etaS:9,moto:{x:0,y:0,mode:'anda'}}),undefined);
  assert.equal(arrivalBand(undefined),undefined);
  const start=arrivalBand({etaS:15,moto:{x:0,y:0,mode:'abrindo'}})!;
  assert.equal(start.title,'O chaveiro chegou!');assert.equal(start.hold,'Segurem 15 s');assert.equal(start.fraction,0);
  const mid=arrivalBand({etaS:5.2,moto:{x:0,y:0,mode:'abrindo'}})!;
  assert.equal(mid.hold,'Segurem 6 s');assert.ok(Math.abs(mid.fraction-(1-5.2/15))<1e-9);
  assert.equal(arrivalBand({etaS:0,moto:{x:0,y:0,mode:'abrindo'}})!.fraction,1);
});

test('card missao-proteger-uno-tempo: a hit on the Uno says what it added; a burst adds up; then it goes',()=>{
  const t=new ClockHitTracker();
  assert.equal(t.step('anda',300,0,0),undefined);
  assert.equal(t.step('anda',299,SIM_HZ,0),undefined,'the clock falling is no news');
  // A hit: one second on, the clock reads 301 where it should read 298.
  assert.deepEqual(t.step('anda',301,2*SIM_HZ,1),{mode:'anda',label:CLOCK_HIT_FIRST_LABEL,text:'Uno apanhou: chaveiro +3 s',added:3,urgent:true});
  // Two more hits within the hold: one number, from the clock before the first.
  assert.equal(t.step('anda',303,2*SIM_HZ+1,2)?.text,'Uno apanhou: chaveiro +5 s');
  assert.equal(t.step('anda',302,3*SIM_HZ,2)?.added,5,'it stays while held');
  assert.equal(t.step('anda',290,2*SIM_HZ+1+CLOCK_ADDED_HOLD_S*SIM_HZ+1,2),undefined,'then goes');
  // A hit that added nothing (the last stretch) says nothing; a stop mode is the stop tracker's.
  const u=new ClockHitTracker();
  u.step('anda',20,0,4);assert.equal(u.step('anda',19,SIM_HZ,5),undefined);
  assert.equal(u.step('tombo',19,2*SIM_HZ,6),undefined);
  // While he opens the car a hit adds a second.
  const v=new ClockHitTracker();
  v.step('abrindo',10,0,0);assert.equal(v.step('abrindo',10,SIM_HZ,1)?.text,'Uno apanhou: chaveiro +1 s');
});

test('ClockTag (the round chip and the phone bar clock): a stop first, else a hit; none held, and it starts over',()=>{
  const o=(mode:'anda'|'tombo',etaS:number,hits:number)=>({moto:{x:0,y:0,mode},etaS,car:{x:0,y:0,hits,limit:120,parts:0}});
  const t=new ClockTag();
  assert.equal(t.step(o('anda',300,0),0),undefined);
  assert.equal(t.step(o('anda',301,1),SIM_HZ)?.text,'Uno apanhou: chaveiro +2 s','a hit on the phone too, not only on the desktop chip');
  assert.equal(t.step(undefined,SIM_HZ+1),undefined,'held by the chefão (or no objective): nothing');
  assert.equal(t.step(o('anda',301,2),SIM_HZ+2),undefined,'and it starts over: the first view after is no news');
  t.step(o('tombo',300,2),2*SIM_HZ);
  assert.equal(t.step(o('tombo',302,2),3*SIM_HZ)?.text,'Moto tombou: +3 s','a stop of the moto is said first');
});

test('card relogio-do-chaveiro-com-legenda: the first burst says why ("chaveiro atrasa"), the next ones say it short, also after the chefão',()=>{
  const t=new ClockTag();
  const o=(etaS:number,hits:number)=>({moto:{x:0,y:0,mode:'anda' as const},etaS,car:{x:0,y:0,hits,limit:120,parts:0}});
  t.step(o(300,0),0);
  const first=t.step(o(302,1),SIM_HZ)!;
  assert.equal(first.label,CLOCK_HIT_FIRST_LABEL);assert.equal(`${first.label}: +${first.added} s`,'Uno apanhou, chaveiro atrasa: +3 s');
  assert.equal(t.step(o(303,2),SIM_HZ+1)?.label,CLOCK_HIT_FIRST_LABEL,'the same burst keeps its words');
  const later=10*SIM_HZ;
  t.step(o(290,2),later);
  assert.equal(t.step(o(292,3),later+SIM_HZ)?.label,CLOCK_HIT_LABEL,'the next burst: short');
  // The chefão holds the clock (the tag starts over) and lets it go: still short.
  t.step(undefined,later+2*SIM_HZ);t.step(o(280,3),later+3*SIM_HZ);
  const after=t.step(o(282,4),later+4*SIM_HZ)!;
  assert.equal(after.label,CLOCK_HIT_LABEL);assert.equal(after.text,'Uno apanhou: chaveiro +3 s','the title and the screen reader keep the whole sentence');
});
