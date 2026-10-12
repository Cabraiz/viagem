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
