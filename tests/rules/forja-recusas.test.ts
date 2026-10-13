// Every reason the forge can refuse with has a pt-BR line for the phone (FORGE_REFUSALS), and the forge tap's target
// shape (FORGE_TARGET) is exactly the wall plus the 4 city barricades (NEW-20261012-ORQ-cidade-06-base-praca).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FORGE_REFUSALS,isForgeTarget} from '../../src/rules/index.ts';
import {BARRICADE_MOUTHS,barricadeId} from '../../src/sim/stonewards/barricades.ts';

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('FORGE_REFUSALS has a short line for every refusal the forge and the room simulation can return',()=>{
  const forge=source('../../src/sim/stonewards/forge.ts'),sim=source('../../multiplayer/simulation.ts');
  const union=/reason:((?:'[^']+'\|?)+)\}/.exec(forge);
  assert.ok(union,'BuyResult declares its reasons');
  const declared=[...union[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  const returned=[...forge.matchAll(/reason:'([^']+)'/g),...sim.matchAll(/forge\([^)]*\):BuyResult\{[\s\S]*?reason:'([^']+)'/g)].map(m=>m[1]);
  const reasons=[...new Set([...declared,...returned])];
  for(const r of ['blocked','target','full','away','player'])assert.ok(reasons.includes(r),`found ${r} in the sources`);
  for(const reason of reasons){
    const line=FORGE_REFUSALS[reason];
    assert.ok(typeof line==='string'&&line.length>0,`no line for '${reason}'`);
    assert.ok(line.length<=64,`'${reason}' fits a phone balloon: ${line}`);
    assert.doesNotMatch(line,/ — | · |→/,`house voice, no "A · B" nor "PALAVRA — fragmento": ${line}`);
  }
});

test('the forge target shape is the wall and the 4 barricade ids, nothing else',()=>{
  for(const ok of ['muralha',...BARRICADE_MOUTHS.map(barricadeId)])assert.equal(isForgeTarget(ok),true,ok);
  for(const bad of [undefined,null,7,{},'','barricada-X','barricada-n','barricada-NN','muralha\n','barricada-N\n','torre-1','__proto__'])
    assert.equal(isForgeTarget(bad),false,String(bad));
});
