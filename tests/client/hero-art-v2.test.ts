/**
 * Imported art v2 heroes (group `personagens`): when the index lists a class's `dir4` atlas with the height the
 * importer measured, the game loads it for `sprite:<id>:dir4`; with an empty index nothing changes (no new request).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {importedSheet,directionalSheet,directionalSheets,sheetKey} from '../../src/client/sprites/sprite-sheets.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';

const FIGURE={left:9,top:60,right:183,bottom:169};
const dir4=(extra:Record<string,unknown>={})=>({file:'aposentado.dir4.webp',cell:[192,192],frames:6,directions:4,
  pages:[{file:'aposentado.dir4.webp',columns:6,rows:12,firstFrame:0,frameCount:72}],height:103,figure:FIGURE,...extra});
const index=(files:Record<string,unknown>)=>parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:{kind:'dir8',files}}}}});

test('empty index: every class keeps exactly today\'s sheet and key', ()=>{
  setArtIndex(parseArtIndex(undefined));
  for(const id of Object.keys(spriteCatalog)){
    assert.equal(importedSheet(id),undefined,id);
    assert.equal(directionalSheet(id),directionalSheets.get(id),id);
    assert.equal(sheetKey(id),directionalSheets.has(id)?`sprite:${id}:dir4`:`sprite:${id}`,id);
  }
});

test('an imported dir4 with its measured height is the class\'s atlas (URL, height and figure from the entry)',()=>{
  setArtIndex(index({dir4:dir4(),dir4c:{...dir4(),file:'aposentado.dir4c.webp',pages:undefined,height:undefined}}));
  const sheet=importedSheet('aposentado');
  assert.deepEqual(sheet,{url:'/art/lite/sprites/aposentado.dir4.webp',height:103,figure:FIGURE,
    cardinals:{url:'/art/lite/sprites/aposentado.dir4c.webp',figure:FIGURE}});
  assert.deepEqual(directionalSheet('aposentado'),sheet);
  assert.equal(sheetKey('aposentado'),'sprite:aposentado:dir4');
  // 96 world px figure (D-030): the scale CharacterSprites applies is 96 / height.
  assert.equal(Math.round(96/sheet!.height*103),96);
  assert.equal(sheetKey('mendigo'),'sprite:mendigo','classes without a piece are untouched');
  setArtIndex(parseArtIndex(undefined));
});

test('an entry the game cannot size or lay out is ignored; a bad figure only drops the figure',()=>{
  const cases:Record<string,unknown>[]=[
    {height:undefined},{height:0},{height:500},{height:'101'},{height:Number.NaN},
    {cell:[128,128]},
    {pages:[{file:'aposentado.dir4.webp',columns:6,rows:4,firstFrame:0,frameCount:24}]},
    {pages:[{file:'aposentado.dir4-p1.webp',columns:6,rows:6,firstFrame:0,frameCount:36},{file:'aposentado.dir4-p2.webp',columns:6,rows:6,firstFrame:36,frameCount:36}],file:undefined},
  ];
  for(const extra of cases){
    setArtIndex(index({dir4:dir4(extra)}));
    assert.equal(importedSheet('aposentado'),undefined,JSON.stringify(extra));
    assert.equal(sheetKey('aposentado'),directionalSheets.has('aposentado')?'sprite:aposentado:dir4':'sprite:aposentado');
  }
  for(const figure of [{left:10,top:0,right:5,bottom:9},{left:0,top:0,right:300,bottom:9},'x',null]){
    setArtIndex(index({dir4:dir4({figure})}));
    assert.deepEqual(importedSheet('aposentado'),{url:'/art/lite/sprites/aposentado.dir4.webp',height:103},JSON.stringify(figure));
  }
  // Only the downed pose or the cardinals: no slot in the renderer, today's art stays.
  setArtIndex(index({downed:{file:'aposentado.downed.webp',cell:[192,192],frames:6,directions:8}}));
  assert.equal(importedSheet('aposentado'),undefined);
  setArtIndex(parseArtIndex(undefined));
});
