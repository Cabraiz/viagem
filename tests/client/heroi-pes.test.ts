// BUG sombra/silhueta (20/10): the detailed hero clips stand on their figure's bottom, not on the 0.875 anchor, and the
// silhouette of a city copy is drawn from the bare frame (no rims).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DETAILED_CELL,clipFeetY,detailedFeetY,heroFeetY} from '../../src/client/sprites/hero-feet.ts';
import {HERO_FEET} from '../../src/client/sprites/hero-feet-data.ts';

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
  // (minus the run's foot shift within a pose, passo-3x-mais-lento)
  assert.match(src,/ay=\(clipFeetY\(detailed\.original\)\?\?this\.feetY\(id\)\?\?detailedFeetY\(detailed\)\)/);
  assert.match(src,/setBareFrame\(sprite,copy\?\{key:detailed\.key/);
  assert.match(src,/setBareFrame\(sprite,copy\?\{key:sheet\.key/);
  assert.match(read('src/client/render/silhouette.ts'),/const plain=b&&b\.key!==body\.texture\.key/);
});

// Card passo-sem-deslizar (21/10): each clip stands on its own measured feet row (scripts/hero-feet.mjs).
test('a clip stands on its own measured feet row; a sheet the table does not know falls back', ()=>{
  const table={'x.walk16-w.abc.webp':70,'x.bad.webp':20};
  assert.equal(clipFeetY('/art/lite/sprites/x.walk16-w.abc.webp',table),70/96);
  assert.equal(clipFeetY('/art/sprites/x.walk16-w.abc.webp?v=3',table),70/96);
  assert.equal(clipFeetY('/art/sprites/x.idle16-w.new.webp',table),undefined);
  assert.equal(clipFeetY('/art/sprites/x.bad.webp',table),undefined);
});

test('the feet table knows every detailed hero clip in the manifest (rerun scripts/hero-feet.mjs after an import)', ()=>{
  const pieces=JSON.parse(read('public/art/manifest.json')).groups.personagens.pieces as Record<string,{files:Record<string,{file:string;cell?:number[]}>}>;
  let n=0;
  for(const piece of Object.values(pieces))for(const [name,f] of Object.entries(piece.files)){
    if(!/^(walk|attack|idle)(16|128)-[A-Z]+$|^idle8$/.test(name)||f.cell?.[0]!==96)continue;n++;
    assert.ok(typeof HERO_FEET[f.file]==='number',`${f.file} has no feet row`);
  }
  assert.ok(n>=200,`detailed clips: ${n}`);
  // The case that floated: the viciado walks on row 69–71 and rests on 72–74 (the class line put both at ~74).
  const viciado=Object.entries(HERO_FEET).filter(([k])=>k.startsWith('viciado-em-bet.'));
  const walk=viciado.filter(([k])=>k.includes('.walk16-')).map(([,v])=>v),idle=viciado.filter(([k])=>k.includes('.idle16-')).map(([,v])=>v);
  assert.ok(Math.max(...walk)<=71&&Math.min(...idle)>=72,`walk ${walk} idle ${idle}`);
});
