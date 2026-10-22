/**
 * The "Minuto de Minerva" clock (card NEW-20261022-ORQ-relogio-minerva, src/client/hud/minerva.ts): it shows while the
 * sim tick is before RunState.minervaAteTick, its seconds hand follows the sim time (not the local clock), the last
 * 5 s are urgent, "Os monstros acordaram!" shows right after and then the clock goes away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ} from '../../src/contract/index.ts';
import {MINERVA_SECONDS,WAKE_MS,minervaOf,minervaView} from '../../src/client/hud/minerva.ts';

const START=40,END=START+MINERVA_SECONDS*SIM_HZ;

test('the room field: a positive tick is the minute, absent/0/garbage is none',()=>{
  assert.equal(minervaOf({phase:'combat',minervaAteTick:END}),END);
  assert.equal(minervaOf({phase:'combat'}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:0}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:Number.NaN}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:'12'}),undefined);
});

test('field in the future: the clock shows 60 s with the hand at 12',()=>{
  const v=minervaView(START,END);
  assert.deepEqual(v,{phase:'clock',seconds:60,angle:0,urgent:false});
});

test('the hand walks by the sim tick: a quarter at 15 s, half at 30 s, seconds rounded up',()=>{
  assert.equal(minervaView(START+15*SIM_HZ,END)?.angle,90);
  assert.equal(minervaView(START+30*SIM_HZ,END)?.angle,180);
  assert.equal(minervaView(START+30*SIM_HZ,END)?.seconds,30);
  assert.equal(minervaView(START+30*SIM_HZ+1,END)?.seconds,30);
  assert.equal(minervaView(END-1,END)?.seconds,1);
  // A player who joins late sees the same hand as everyone (same ticks, same angle).
  assert.equal(minervaView(START+45*SIM_HZ,END)?.angle,minervaView(START+45*SIM_HZ,END,false)?.angle);
});

test('the last 5 s are urgent, the 6th is not',()=>{
  assert.equal(minervaView(END-6*SIM_HZ,END)?.urgent,false);
  assert.equal(minervaView(END-5*SIM_HZ,END)?.urgent,true);
  assert.equal(minervaView(END-1,END)?.urgent,true);
});

test('at zero "acordaram" for WAKE_MS, then nothing',()=>{
  assert.equal(minervaView(END,END)?.phase,'wake');
  const wakeTicks=Math.round(WAKE_MS/1000*SIM_HZ);
  assert.equal(minervaView(END+wakeTicks-1,END)?.phase,'wake');
  assert.equal(minervaView(END+wakeTicks,END),undefined);
  assert.equal(minervaView(END+10*SIM_HZ,END),undefined);
});

test('who never saw the clock (joined after the minute) gets no notice; no field, no clock',()=>{
  assert.equal(minervaView(END+1,END,false),undefined);
  assert.equal(minervaView(START,undefined),undefined);
});

test('more than a minute left (a longer room minute) keeps the hand at 12 and the count at 60',()=>{
  assert.deepEqual(minervaView(START,END+20*SIM_HZ),{phase:'clock',seconds:60,angle:0,urgent:false});
});

test('the HUD mounts the clock first in the announcement slot and the explore wires the room field',()=>{
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/stack\.append\(minerva\.el,/);
  assert.match(hud,/import '\.\/minerva\.css';/);
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/setMinerva\(run\.phase==='combat'\?minervaOf\(run\):undefined\)/);
  // It never takes taps (the joystick and Atacar keep working under it).
  const css=readFileSync(new URL('../../src/client/hud/minerva.css',import.meta.url),'utf8');
  assert.match(css,/\.rh-minerva\{[^}]*pointer-events:none/);
});
