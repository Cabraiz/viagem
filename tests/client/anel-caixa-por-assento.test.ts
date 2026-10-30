// NEW-20261029-E4-anel-caixa-por-assento: the saldo ring is whole at the shift of the room's seats (bicoSaldo: 1p 40,
// 2p 25, 3–4p 20, 5–6p 15), not at the solo's 40; the renderer, the game scene and the city sandbox pass the seats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BANCO,bicoSaldo} from '../../src/rules/index.ts';
import {groundKeys,saldoShare} from '../../src/client/render/bancos/rules.ts';
import {fakeBanks,sandboxSeats} from '../../src/client/sandboxes/sandbox-bancos.ts';

const src=(p:string)=>readFileSync(new URL(`../../src/client/${p}`,import.meta.url),'utf8');

test('a full shop shows a whole ring in 1p, 3p and 6p; half its shift shows half',()=>{
  for(const seats of [1,3,6]){
    const full=bicoSaldo(seats);
    assert.equal(saldoShare({saldo:full},full),1,`${seats}p full`);
    assert.equal(saldoShare({saldo:full/2},full),.5,`${seats}p half`);
    assert.equal(saldoShare({saldo:0},full),0,`${seats}p empty`);
  }
  assert.deepEqual([1,3,6].map(bicoSaldo),[40,20,15]);
  assert.equal(saldoShare({saldo:bicoSaldo(3)},BANCO.saldo),.5,'the old ring: half in 3p');
  assert.equal(saldoShare({saldo:BANCO.saldo}),1,'no seats: the solo\'s shift');
});

test('the ring\'s key follows the seats: the same saldo redraws when the shift changes',()=>{
  const b={saldo:15,state:'aberto' as const};
  assert.notEqual(groundKeys(b,1,0,bicoSaldo(1)).ring,groundKeys(b,1,0,bicoSaldo(6)).ring);
  assert.equal(groundKeys(b,1,0,bicoSaldo(3)).ring,groundKeys(b,1,0,bicoSaldo(4)).ring,'3p and 4p share the shift');
  assert.equal(groundKeys(b,1,0).hold,groundKeys(b,1,0,bicoSaldo(6)).hold);
});

test('the renderer reads its seats; the scene passes the room\'s players, the sandbox its assentos=',()=>{
  const r=src('render/bancos/renderer.ts');
  assert.match(r,/full=bicoSaldo\(this\.options\.seats\?\.\(\)\?\?1\)/);
  assert.match(r,/share=saldoShare\(b,full\)/);
  assert.match(src('scene.ts'),/seats:\(\)=>this\.hooks\.net\?\.players\.size\?\?1/);
  assert.match(src('sandboxes/sandbox-cidade.ts'),/seats:\(\)=>sandboxSeats\(params\)/);
  const p=(q:string)=>new URLSearchParams(q);
  assert.deepEqual(['','assentos=3','assentos=6','assentos=9','assentos=x'].map(q=>sandboxSeats(p(q))),[1,3,6,6,1]);
  const open=fakeBanks(p('banco=aberto&assentos=3'),{x:0,y:0}).view(0).banks;
  assert.ok(open.every(b=>b.saldo===bicoSaldo(3)),'the sandbox\'s open shops hold the 3p shift');
});
