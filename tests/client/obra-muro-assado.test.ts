// NEW-20261021-E2-obra-muro-assado: each wall segment of the obra (D-052) is frozen into triangles (TriBand) per
// wallKey and frozen again only when what it draws changes (damage, flash, bar, view, zoom, fallen).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wallKey} from '../../src/client/render/fortify-rules.ts';
import {damageStage,wallBar} from '../../src/client/render/stonewards-rules.ts';

const src=readFileSync(new URL('../../src/client/render/fortify.ts',import.meta.url),'utf8');

/** The renderer's rule, as drawWall applies it per segment: freeze again only when the key changed. */
function freezer(){
  let key:string|undefined,draws=0;
  return {at:(k:string)=>{if(k!==key){key=k;draws++;}return draws;}};
}
/** The key drawWall computes for a segment at hp/maxHp. */
function key(hp:number,maxHp:number,{flash=false,view=0,k=1}={}){
  const down=hp<=0,bar=wallBar(hp,maxHp),show=!down&&bar.fraction<1;
  return wallKey(damageStage(maxHp>0?hp/maxHp:0,down),flash,view,show?bar:undefined,k);
}

test('wall segment: two updates with the same state draw once; damage, flash, view, zoom or a fall draw again',()=>{
  const f=freezer();
  assert.equal(f.at(key(100,100)),1);
  assert.equal(f.at(key(100,100)),1,'same state: no redraw');
  assert.equal(f.at(key(90,100,{flash:true})),2,'a hit: the flash and the bar');
  assert.equal(f.at(key(90,100,{flash:true})),2,'still flashing: no redraw');
  assert.equal(f.at(key(90,100)),3,'the flash is over');
  assert.equal(f.at(key(90,100)),3);
  assert.equal(f.at(key(90,100,{k:1.004})),3,'zoom under 1/100: the same');
  assert.equal(f.at(key(90,100,{k:1.5})),4,'zoom: the contours');
  assert.equal(f.at(key(90,100,{k:1.5,view:1})),5,'a view turn');
  assert.equal(f.at(key(0,100,{k:1.5,view:1})),6,'fallen: rubble');
  assert.equal(f.at(key(0,100,{k:1.5,view:1})),6);
});

test('wall segment key: whole and fallen carry no bar; a low bar is its own look',()=>{
  assert.match(key(100,100),/\|-\|/);
  assert.match(key(0,100),/\|-\|/);
  assert.notEqual(key(20,100),key(21,100));
});

test('the renderer freezes each wall segment (TriBand) behind wallKey and only moves it per frame',()=>{
  assert.ok(src.includes("key=`${art?'arte|':''}${wallKey(stage,flash&&!art,view,showBar?bar:undefined,k)}`"));
  assert.match(src,/if\(w\?\.key!==key\)\{\s*w\?\.band\.destroy\(\);[^]*?TriBand\.make\(this\.scene,[^]*?\.setName\('obra-muro'\)/);
  assert.match(src,/w!?\.band\.setPosition\(p\.x,p\.y\)\.setDepth\(/);
  assert.doesNotMatch(src,/add\.graphics\(\)\.setName\('obra-muro'\)/,'no per-frame Graphics for the walls');
});
