/**
 * D-052 (NEW-20261016-ORQ-oferta-so-heroi): the level-up and round offers carry only the hero's upgrades (weapons,
 * evolutions, passives) and the coxinha. Nothing that fortifies the base: no defense (towers, walls, barricades), no
 * forge recipe (Stonewards), no Gustavão. The base is the car now; its upgrades are bought or built, never drawn here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import type {OwnedItem,PlayerBuild} from '../../src/contract/types.ts';
import {HEAL_CHOICE,rollChoices} from '../../src/rules/offers.ts';
import {DEFENSE_IDS,RECIPE_IDS} from '../../src/rules/index.ts';
import {ITEMS} from '../../src/sim/items.ts';

const HERO_KINDS=new Set(['weapon','evolution','passive']);
const BASE_WORDS=/mural|barric|forj|stoneward|torre|tower|wall|gustav|defes|obra|reparo/i;
const BASE_IDS=new Set<string>([...DEFENSE_IDS,...RECIPE_IDS]);

test('the offer catalog (the one the run rolls from, sim/assemble.ts) is the hero\'s only',()=>{
  const all=ITEMS.all();
  assert.ok(all.length>0);
  for(const def of all){
    assert.ok(HERO_KINDS.has(def.kind),`${def.id} is a ${def.kind}`);
    assert.ok(!BASE_IDS.has(def.id),`${def.id} is a defense or a forge recipe`);
    assert.doesNotMatch(`${def.id} ${def.name}`,BASE_WORDS,`${def.id} (${def.name}) reads as a base upgrade`);
  }
  for(const id of BASE_IDS)assert.equal(ITEMS.get(id),undefined,`${id} never resolves as an offer item`);
});

test('rolled cards over many builds and seeds: only hero items or the coxinha, never a base card',()=>{
  const all=ITEMS.all(),weapons=all.filter(d=>d.kind==='weapon'),passives=all.filter(d=>d.kind==='passive');
  const seen=new Set<string>();
  for(let seed=1;seed<=400;seed++){
    const rng=new Rng(seed),take=(list:typeof all,n:number):OwnedItem[]=>list.slice(0,n).map(d=>({id:d.id,level:1+rng.int(0,d.maxLevel-1)}));
    const build:PlayerBuild={weapons:take(weapons,seed%(weapons.length+1)),passives:take(passives,(seed>>2)%(passives.length+1))};
    for(const choice of rollChoices(ITEMS,build,1+seed%4,new Rng(seed*7919))){
      seen.add(choice.itemId);
      if(choice.itemId===HEAL_CHOICE)continue;
      const def=ITEMS.get(choice.itemId);
      assert.ok(def&&HERO_KINDS.has(def.kind),`seed ${seed}: ${choice.itemId}`);
      assert.ok(!BASE_IDS.has(choice.itemId));
    }
  }
  assert.ok(seen.size>=weapons.length,'the roll covers the catalog (the test reaches real cards)');
});
