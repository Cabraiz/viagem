// BUG sombra/silhueta (20/10): the detailed hero clips stand on their figure's bottom, not on the 0.875 anchor, and the
// silhouette of a city copy is drawn from the bare frame (no rims).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DETAILED_CELL,detailedFeetY,heroFeetY} from '../../src/client/sprites/hero-feet.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');

test('a clip stands on its figure bottom; no figure (or a nonsense one) keeps the anchor', ()=>{
  assert.equal(detailedFeetY({anchor:[.5,.875],figure:{left:27,top:16,right:70,bottom:75}}),75/96);
  assert.equal(detailedFeetY({anchor:[.5,.875]}),.875);
  assert.equal(detailedFeetY({anchor:[.5,.875],figure:{left:0,top:0,right:96,bottom:20}}),.875);
  assert.equal(detailedFeetY({anchor:[.5,.875],figure:{left:0,top:0,right:96,bottom:200}}),.875);
});

test('one feet line per class: the median of idle + walks (a stray clip does not move it)', ()=>{
  const f=(bottom:number)=>({anchor:[.5,.875] as [number,number],figure:{left:0,top:0,right:96,bottom}});
  assert.equal(heroFeetY([f(74),f(73),f(84),f(74),undefined]),74/96);
  assert.equal(heroFeetY([]),undefined);
});

test('every hero class in the manifest stands above the old 0.875 anchor, at the feet of the art', ()=>{
  const pieces=JSON.parse(read('public/art/manifest.json')).groups.personagens.pieces as Record<string,{files:Record<string,{anchor?:[number,number];figure?:never}>}>;
  let n=0;
  for(const [id,piece] of Object.entries(pieces)){
    const clips=Object.entries(piece.files).filter(([k,v])=>/^(idle8|walk128-)/.test(k)&&Array.isArray(v.anchor)).map(([,v])=>v as never);
    if(!clips.length)continue;n++;
    const y=heroFeetY(clips)!;
    assert.ok(y>.6&&y<.85,`${id}: feet at ${y}`);
  }
  assert.ok(n>=10,`classes with detailed clips: ${n}`);
  assert.equal(DETAILED_CELL,96);
});

test('the hero sprite uses the feet and hands the silhouette its bare frame', ()=>{
  const src=read('src/client/sprites/character-sprites.ts');
  assert.match(src,/ay=this\.feetY\(id\)\?\?detailedFeetY\(detailed\)/);
  assert.match(src,/setBareFrame\(sprite,copy\?\{key:detailed\.key/);
  assert.match(src,/setBareFrame\(sprite,copy\?\{key:sheet\.key/);
  assert.match(read('src/client/render/silhouette.ts'),/const plain=b&&b\.key!==body\.texture\.key/);
});
