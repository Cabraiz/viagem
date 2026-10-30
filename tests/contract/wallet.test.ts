import test from 'node:test';
import assert from 'node:assert/strict';
import {PIX_MEMOS,PIX_REFUSALS} from '../../src/contract/wallet.ts';

test('wallet: player-facing texts write Pix, never PIX (texto-carteira-pix)',()=>{
  assert.equal(PIX_REFUSALS.self,'Pix pra você mesmo não rola.');
  assert.equal(PIX_REFUSALS.rate,'Calma, um Pix de cada vez.');
  assert.equal(PIX_REFUSALS.duplicate,'Esse Pix já foi.');
  for(const t of [...Object.values(PIX_REFUSALS),...PIX_MEMOS])assert.doesNotMatch(t,/PIX/,t);
});
