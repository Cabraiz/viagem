/**
 * Card chaveiro-chegou-e-relogio: the clock's stop ("Moto tombou: +4 s", hud/chaveiro.ts ClockStopTracker) and the
 * "chegou" band (arrivalBand). Only the HUD reads the room's ETA; nothing here changes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SIM_HZ} from '../../src/contract/types.ts';
import {ARRIVAL_SECONDS,CLOCK_ADDED_HOLD_S,CLOCK_ADDED_MIN_S,ClockStopTracker,arrivalBand} from '../../src/client/hud/chaveiro.ts';
import {ABRINDO_SECONDS} from '../../src/sim/chaveiro/system.ts';

test('a tombo freezes the clock: the time it adds shows, grows, and stays a moment after he rides again',()=>{
  const t=new ClockStopTracker();
  assert.equal(t.step('anda',300,0),undefined);
  // He falls at 300 s; the ETA stays put while the moto is down.
  assert.equal(t.step('tombo',300,SIM_HZ),undefined);
  assert.equal(t.step('tombo',300,SIM_HZ*(1+CLOCK_ADDED_MIN_S)-1),undefined,'under the minimum: rounding noise');
  const shown=t.step('tombo',300,SIM_HZ*5);
  assert.deepEqual(shown,{mode:'tombo',text:'Moto tombou: +4 s',added:4,urgent:true});
  // Rides again: the last line stays CLOCK_ADDED_HOLD_S, then goes.
  assert.equal(t.step('anda',299,SIM_HZ*6)?.text,'Moto tombou: +4 s');
  assert.equal(t.step('anda',290,SIM_HZ*(5+CLOCK_ADDED_HOLD_S)+1),undefined);
});

test('a lombada adds what the crawl costs; a stop the clock already counts says nothing',()=>{
  const t=new ClockStopTracker();
  // Half pace: the ETA falls half a second per second.
  for(let s=0;s<=6;s++)t.step('lombada',200-s/2,s*SIM_HZ);
  assert.deepEqual(t.step('lombada',196,8*SIM_HZ),{mode:'lombada',text:'Lombada: +4 s',added:4,urgent:false});
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
