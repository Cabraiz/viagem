// pacote-bugs-ux (design review): a result card shows the whole name in up to two lines; shortened, it is cut at a
// word with "…" (then the first word with "…"), never inside a word without it. The DOM fitting (fitCardName) picks the
// first candidate that fits; this pins the candidates down.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nameCandidates} from '../../src/client/hud/result.ts';

test('result card names: whole name first, then whole words with "…", then the first word cut with "…"',()=>{
  assert.deepEqual(nameCandidates('Seu Jorge do Pastel'),['Seu Jorge do Pastel','Seu Jorge do…','Seu Jorge…','Seu…','Se…','S…']);
  assert.deepEqual(nameCandidates('Concurseira Eterna d').slice(0,3),['Concurseira Eterna d','Concurseira Eterna…','Concurseira…']);
  assert.equal(nameCandidates('Zé')[0],'Zé');
  for(const name of ['Maria Aparecida dos','Wagner Washington Mo','Zé do Pix Parcelado'])
    for(const c of nameCandidates(name).slice(1))assert.ok(c.endsWith('…'),c);
});

test('result card names: a bot\'s number stays when the class name is cut ("Viciado em… 2"), as on the rail',()=>{
  assert.deepEqual(nameCandidates('Viciado em Bet 2').slice(0,3),['Viciado em Bet 2','Viciado em… 2','Viciado… 2']);
  assert.deepEqual(nameCandidates('CLT 2').slice(0,2),['CLT 2','CL… 2']);
  assert.notEqual(nameCandidates('Viciado em Bet').at(1),nameCandidates('Viciado em Bet 2').at(1));
  assert.deepEqual(nameCandidates('Mendigo 22').slice(0,2),['Mendigo 22','Mendigo…'],'only one digit is a bot number');
});
