// NEW-20261029-E4-anel-caixa-por-assento wanted a team's full shop to show a whole saldo ring (it was whole at the solo's
// 40 while a 3p shift held 20). bico-sem-limite-pix-voando drops the shift: every shop carries BANCO.saldo in any room, so
// the ring is whole at the default `full` and the renderer needs no seats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BANCO} from '../../src/rules/index.ts';
import {groundKeys,saldoShare} from '../../src/client/render/bancos/rules.ts';
import {fakeBanks} from '../../src/client/sandboxes/sandbox-bancos.ts';

const src=(p:string)=>readFileSync(new URL(`../../src/client/${p}`,import.meta.url),'utf8');

test('a full shop shows a whole ring; `full` still scales it',()=>{
  assert.equal(saldoShare({saldo:BANCO.saldo}),1);
  assert.equal(saldoShare({saldo:10},20),.5);
  assert.equal(saldoShare({saldo:0}),0);
  const b={saldo:15,state:'aberto' as const};
  assert.notEqual(groundKeys(b,1,0).ring,groundKeys(b,1,0,15).ring,'the ring\'s key follows `full`');
});

test('the renderer and the sandbox read no seats: the shops hold BANCO.saldo',()=>{
  const r=src('render/bancos/renderer.ts');
  assert.match(r,/share=saldoShare\(b\)/);
  assert.doesNotMatch(r,/seats|bicoSaldo/);
  const open=fakeBanks(new URLSearchParams('banco=aberto'),{x:0,y:0}).view(0).banks;
  assert.ok(open.every(b=>b.saldo===BANCO.saldo));
});
