// auditoria-primeira-partida-30-10 item 9: the defeat says what to do differently ("Da próxima: …").
import test from 'node:test';
import assert from 'node:assert/strict';
import {IDLE_GRANA,nextTip} from '../../src/client/hud/result.ts';
import type {ObjectiveResult} from '../../src/contract/objective.ts';

const bill=(over:Partial<ObjectiveResult>):ObjectiveResult=>({kind:'chaveiro',outcome:'defeat',cause:'team',wave:3,extraWaves:0,eta:60,seconds:300,
  hits:0,limit:40,budget:500,grana:0,paid:0,debt:0,parts:0,...over} as ObjectiveResult);

test('pc-20: the Uno fell with R$ 288 in the pocket and 0/5 nests: guard the Uno and build, two tips at most',()=>{
  assert.equal(nextTip({victory:false,objective:bill({cause:'car',hits:40,grana:288})},{down:0,total:5}),
    'Da próxima: proteja ou conserte o Uno e construa com a grana (sobrou R$ 288).');
});

test('cel-19: the Uno fell, R$ 23 left (above the idle line), no nests',()=>{
  assert.ok(23>=IDLE_GRANA);
  assert.equal(nextTip({victory:false,objective:bill({cause:'car',grana:23})},{down:0,total:5}),'Da próxima: proteja ou conserte o Uno e construa com a grana (sobrou R$ 23).');
});

test('each reason alone',()=>{
  assert.equal(nextTip({victory:false,objective:bill({hits:20})}),'Da próxima: proteja ou conserte o Uno.','half the limit: the Uno took a beating');
  assert.equal(nextTip({victory:false,objective:bill({hits:19})}),undefined,'less than half: not the lesson');
  assert.equal(nextTip({victory:false,objective:bill({grana:IDLE_GRANA})}),`Da próxima: construa com a grana (sobrou R$ ${IDLE_GRANA}).`);
  assert.equal(nextTip({victory:false,objective:bill({grana:IDLE_GRANA-1})}),undefined,'small change is not idle grana');
  assert.equal(nextTip({victory:false,objective:bill({})},{down:0,total:5}),'Da próxima: derrube ninhos.');
  assert.equal(nextTip({victory:false,objective:bill({})},{down:1,total:5}),undefined,'a nest fell: not the lesson');
});

test('no tip on a win, nor on an old room without the chaveiro and nests',()=>{
  assert.equal(nextTip({victory:true,objective:bill({outcome:'victory',cause:'opened',grana:300})},{down:0,total:5}),undefined);
  assert.equal(nextTip({victory:false}),undefined);
});

