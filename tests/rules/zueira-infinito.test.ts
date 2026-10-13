/**
 * BUG infinito-placas: the endless map's points of interest show their own names (D-033), never the island's. Result
 * asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {INFINITO_POI_NAMES,infinitoPoiName} from '../../src/rules/index.ts';
import {landmarks} from '../../src/maps/index.ts';

const all=INFINITO_POI_NAMES.flat();

test('three kinds, several names each, short enough for a map label, no duplicates and none of the island names', () => {
  assert.equal(INFINITO_POI_NAMES.length,3);
  for(const list of INFINITO_POI_NAMES)assert.ok(list.length>=5);
  assert.equal(new Set(all).size,all.length);
  for(const s of all){
    assert.ok(s.length>=6&&s.length<=30&&s===s.trim(),`"${s}" fits a label`);
    for(const l of landmarks)assert.notEqual(s,l.name);
  }
});

test('D-033 limits: no brand, drug, slur or sexual term; real pt-BR accents', () => {
  const banned=['coca-cola','ifood','whatsapp','instagram','netflix','maconha','cocaína','crack','sexo','pelad','safad','viado','retardad'];
  const unaccented=['nao','voce','ninguem','agua','ja','so','tres','cafe'];
  for(const s of all){
    const low=s.toLocaleLowerCase('pt-BR');
    for(const b of banned)assert.ok(!low.includes(b),`"${s}" mentions ${b}`);
    const words=low.split(/[^\p{L}]+/u);
    for(const w of unaccented)assert.ok(!words.includes(w),`"${s}" has unaccented "${w}"`);
  }
});

test('a chunk always shows the same name per kind, the names vary over the map, and an unknown kind falls back to the stall', () => {
  assert.equal(infinitoPoiName(1,-7,12),infinitoPoiName(1,-7,12));
  for(const kind of [0,1,2]){
    const seen=new Set<string>();
    for(let cx=-6;cx<6;cx++)for(let cy=-6;cy<6;cy++){const n=infinitoPoiName(kind,cx,cy);assert.ok(INFINITO_POI_NAMES[kind].includes(n));seen.add(n);}
    assert.equal(seen.size,INFINITO_POI_NAMES[kind].length,`kind ${kind}: every name shows up somewhere`);
  }
  assert.ok(INFINITO_POI_NAMES[0].includes(infinitoPoiName(9,3,4)));
});

test('the tables are deep-frozen', () => {
  assert.throws(()=>{(INFINITO_POI_NAMES as string[][]).push([]);});
  assert.throws(()=>{(INFINITO_POI_NAMES[0] as string[])[0]='x';});
});
