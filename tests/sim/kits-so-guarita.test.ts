/**
 * NEW-20261031-ORQ-kits-so-torres-boas-sem-barricada (the user, 31/10: "remova temporariamente o spawn de barricada no
 * jogo"; "o tamanho maximo que deveria ser era para ser o guarita"). rules/kits-off.ts:
 *  1. BARRICADA_OFF: no crate prize, starter, reroll or slot reel ever gives a kit:barricada; the id stays in KIT_IDS
 *     and the DICT (the protocol unchanged);
 *  2. TOWERS_SHOWN: every kit a crate gives is the guarita (or the muro), whatever its rarity;
 *  3. the upgrade tree (childrenOf/pickChild) leads to no hidden tower; a hidden tower already built (a checkpoint, a
 *     live room) is still a defense, it just evolves no further.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BARRICADA_OFF,DEFENSES,DEFENSE_IDS,KIT_IDS,KIT_POOL,TOWERS_SHOWN,childrenOf,isDefenseId,isKitId,kitId,pickChild,towerShown,type DefenseId} from '../../src/rules/index.ts';
import {DICT} from '../../src/protocol/protocol4.ts';
import {drawPrize,otherPrize,prizePools,rollCrate,rollPrize,rollStarter} from '../../src/sim/crates.ts';
import {Rng} from '../../src/contract/rng.ts';

const RARITIES=[1,2,3,4,5] as const;
const APPROVED=new Set([...TOWERS_SHOWN,'muro'].map(p=>kitId(p as never)));

test('KIT_POOL: no barricada, only the guarita (and the verde muro) in every tier', ()=>{
  assert.equal(BARRICADA_OFF,true);
  assert.deepEqual([...TOWERS_SHOWN],['vigia-do-predio']);
  for(const r of RARITIES){
    assert.ok(!KIT_POOL[r].includes('barricada'),`pool ${r}`);
    for(const p of KIT_POOL[r])assert.ok(APPROVED.has(kitId(p)),`${p} in pool ${r}`);
  }
  assert.ok(KIT_IDS.includes('kit:barricada')&&DICT.includes('kit:barricada'),'the id stays on the wire');
});

test('N draws of every crate path and the slot reel never give a barricada nor a hidden tower', ()=>{
  const seen=new Set<string>();
  const check=(ids:readonly string[],where:string)=>{
    for(const id of ids){
      if(!isKitId(id))continue;
      seen.add(id);
      assert.ok(APPROVED.has(id),`${id} from ${where}`);
    }
  };
  for(const r of RARITIES){
    for(let s=0;s<2000;s++){
      const rng=()=>new Rng(s*7+r).fork('kits');
      check(rollCrate(rng(),r).items.map(i=>i.id),`rollCrate ${r}`);
      check(rollPrize(rng(),r).items.map(i=>i.id),`rollPrize ${r}`);
      check(rollStarter(rng(),r).items.map(i=>i.id),`rollStarter ${r}`);
      check(otherPrize(rng(),r,s%2===0,'pistola').items.map(i=>i.id),`otherPrize ${r}`);
      check(drawPrize(rng(),r,s%3===0).items.map(i=>i.id),`drawPrize ${r}`);
    }
    for(const start of [false,true])check(prizePools(r,start).flat(),`prizePools ${r}`);
  }
  assert.ok(seen.has(kitId('vigia-do-predio')),'the guarita still comes out of the crates');
});

test('the upgrade tree leads to no hidden tower; a hidden one already built stays a defense', ()=>{
  for(const id of DEFENSE_IDS)for(const child of childrenOf(id))assert.ok(towerShown(child.id),`${id} → ${child.id}`);
  assert.deepEqual(childrenOf('vigia-do-predio'),[]);
  for(const b of ['A','B','C'])assert.equal(pickChild('vigia-do-predio',b),undefined,b);
  // Legacy: still in DEFENSES (art, combat, checkpoints); it evolves no further (the sim answers 'max').
  for(const id of ['ninho-de-metralhadora','morteiro','obuseiro','holofote'] as DefenseId[]){
    assert.ok(isDefenseId(id)&&DEFENSES[id]);
    assert.deepEqual(childrenOf(id),[]);
  }
});
