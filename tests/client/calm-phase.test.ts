// D-051 mode 'ninhos' without rounds: the client's phase is calm around the hero (src/client/calm-phase.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {effectivePhase,nestsRun} from '../../src/client/calm-phase.ts';
import {CALMA} from '../../src/rules/index.ts';

const nest={kind:'ninho'};
const hero={x:10,y:10};

test('rounds mode: the room\'s round phase as it is',()=>{
  assert.equal(effectivePhase({round:{phase:'wave'},structures:[],enemies:[]},hero),'wave');
  assert.equal(effectivePhase({round:{phase:'prepare'},structures:[{kind:'muralha'}],enemies:[{x:10,y:11,hp:5}]},hero),'prepare');
  assert.equal(effectivePhase({structures:[],enemies:[]},hero),undefined);
});

test('nests mode: prepare while no critter awake is within CALMA.forgeR of the hero, wave otherwise',()=>{
  const base={round:{phase:'wave'},structures:[nest]};
  assert.equal(nestsRun(base),true);
  assert.equal(effectivePhase({...base,enemies:[]},hero),'prepare');
  assert.equal(effectivePhase({...base,enemies:[{x:10+CALMA.forgeR,y:10,hp:5}]},hero),'wave','at the radius: not calm');
  assert.equal(effectivePhase({...base,enemies:[{x:10+CALMA.forgeR+.5,y:10,hp:5}]},hero),'prepare','just outside');
  assert.equal(effectivePhase({...base,enemies:[{x:11,y:10,hp:5,asleep:true}]},hero),'prepare','a sleeper does not count');
  assert.equal(effectivePhase({...base,enemies:[{x:11,y:10,hp:0}]},hero),'prepare','a dead one does not count');
  assert.equal(effectivePhase({...base,enemies:[]},undefined),'wave','no hero spot: nothing opens');
});
