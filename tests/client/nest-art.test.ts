import test from 'node:test';
import assert from 'node:assert/strict';
import {NEST_THEMES,nestArtId,nestState,nestTheme,nestsFromStructures} from '../../src/client/render/city/live/nests.ts';

test('nest theme is seeded by the id, the state follows hp and sleep', ()=>{
  assert.equal(nestTheme('n1'),nestTheme('n1'));
  assert.ok(new Set(Array.from({length:40},(_,i)=>nestTheme(`n${i}`))).size>2,'the ids spread over the themes');
  assert.equal(nestState({hp:0}),'destruido');
  assert.equal(nestState({hp:0,awake:false}),'destruido');
  assert.equal(nestState({hp:5,awake:false}),'dormindo');
  assert.equal(nestState({hp:5,awake:true}),'ativo');
  assert.equal(nestState({hp:5}),'ativo');
});

// E8 rejected every ninho-boteco-* and ninho-escritorio-destruido (16/10): the art that exists today.
const DELIVERED=new Set(NEST_THEMES.filter(t=>t!=='boteco').flatMap(t=>['ativo','dormindo','destruido'].map(s=>`ninho-${t}-${s}`)));
DELIVERED.delete('ninho-escritorio-destruido');
const has=(id:string)=>DELIVERED.has(id);

test('missing art falls back to the same state of another theme, never another state', ()=>{
  for(let i=0;i<200;i++){
    for(const n of [{id:`n${i}`,hp:10,awake:true},{id:`n${i}`,hp:10,awake:false},{id:`n${i}`,hp:0}]){
      const art=nestArtId(n,has)!;
      assert.ok(has(art),art);
      assert.ok(art.endsWith(`-${nestState(n)}`),art);
      // a nest whose own piece exists keeps it
      const own=`ninho-${nestTheme(n.id)}-${nestState(n)}`;
      if(has(own))assert.equal(art,own);
    }
  }
  assert.equal(nestArtId({id:'x',hp:1},()=>false),undefined);
  // without a lookup, the nest's own piece
  assert.match(nestArtId({id:'x',hp:1})!,/^ninho-(bichos|boteco|escritorio|festa)-ativo$/);
});

test('the snapshot nests: structures of kind ninho, size P|M|G (M when unknown), asleep in phase dormindo', ()=>{
  const nests=nestsFromStructures([
    {id:'a',kind:'ninho',x:1,y:2,hp:600,size:'G',phase:'dormindo'},
    {id:'t',kind:'torre-chinelo',x:0,y:0,hp:5},
    {id:'b',kind:'ninho',x:3,y:4,hp:0,size:'X'},
  ]);
  assert.deepEqual(nests,[{id:'a',x:1,y:2,size:'G',hp:600,awake:false},{id:'b',x:3,y:4,size:'M',hp:0,awake:true}]);
  assert.equal(nestState(nests[0]),'dormindo');
  assert.equal(nestState(nests[1]),'destruido');
});
