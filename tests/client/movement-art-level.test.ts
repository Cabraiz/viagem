import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movement128Plan,movementIdle8Plan,setMovementArtLevel,MOVEMENT_LEVEL_CELL} from '../../src/client/sprites/movement128.ts';
import {importedSheet,PHONE_DIR4_CELL} from '../../src/client/sprites/sprite-sheets.ts';
import {originalUrl} from '../../src/client/sprites/art-urls.ts';
import {patchCrop,patchShift} from '../../src/client/sprites/hand-points.ts';

// Card q3-niveis-qualidade, fatia 2: Alta draws the 96 px sheets; Normal and Leve the art-lite level copies.
afterEach(()=>{setMovementArtLevel('alta');setArtIndex(parseArtIndex(undefined));});
const legacy=(file:string)=>({file,cell:[192,192],frames:6,directions:4,height:120,figure:{left:20,top:48,right:172,bottom:170},pages:[{file,columns:6,rows:12,firstFrame:0,frameCount:72}]});
const walk={file:'aposentado.walk128-s.webp',cell:[96,96],revision:6,movementHands:'empty',frames:128,durationMs:600,loop:true,anchor:[.5,.875],
  height:60,figure:{left:8,top:20,right:88,bottom:86},pages:[{file:'aposentado.walk128-s.webp',columns:16,rows:8,firstFrame:0,frameCount:128}]};
const idle8={file:'aposentado.idle8.webp',cell:[96,96],frames:1,directions:8,revision:6,movementHands:'empty',loop:false,anchor:[.5,.875],height:60,
  figure:{left:8,top:20,right:88,bottom:86},pages:[{file:'aposentado.idle8.webp',columns:8,rows:1,firstFrame:0,frameCount:8}]};
const index=()=>setArtIndex(parseArtIndex({version:2,groups:{personagens:{output:'public/art/sprites',pieces:{aposentado:{kind:'dir8',
  files:{dir4:legacy('aposentado.dir4.webp'),dir4c:legacy('aposentado.dir4c.webp'),'walk128-S':walk,idle8}}}}}}));

test('R06 by level: Alta 96 px × 128 poses, Normal 64 px × 64, Leve 64 px × 32; the figure stays in 96 px units',()=>{
  index();
  const alta=movement128Plan('aposentado','walk','S')!;
  assert.equal(alta.cell,undefined);assert.equal(alta.frameCount,128);assert.match(alta.url,/^\/art\/lite\/sprites\//);
  setMovementArtLevel('normal');
  const normal=movement128Plan('aposentado','walk','S')!;
  assert.deepEqual([normal.cell,normal.columns,normal.rows,normal.frameCount],[MOVEMENT_LEVEL_CELL,8,8,64]);
  assert.match(normal.url,/^\/art\/lite\/sprites-normal\/aposentado\.walk128-s\.webp$/);
  assert.notEqual(normal.key,alta.key,'another texture: the LRU frees the 96 px one');
  assert.equal(normal.original,alta.original,'hand points and feet rows stay keyed by the original');
  assert.deepEqual(normal.figure,alta.figure);
  setMovementArtLevel('leve');
  const leve=movement128Plan('aposentado','walk','S')!;
  assert.deepEqual([leve.cell,leve.columns,leve.rows,leve.frameCount],[64,8,4,32]);
  assert.match(leve.url,/\/art\/lite\/sprites-leve\//);
  setMovementArtLevel('alta');
  assert.equal(movement128Plan('aposentado','walk','S')!.key,alta.key);
});

test('the other 96 px sheets keep their poses at 64 px on Normal and Leve (sprites-64)',()=>{
  index();setMovementArtLevel('leve');
  const idle=movementIdle8Plan('aposentado')!;
  assert.deepEqual([idle.cell,idle.columns,idle.rows,idle.frameCount],[64,8,1,8]);
  assert.match(idle.url,/\/art\/lite\/sprites-64\/aposentado\.idle8\.webp$/);
});

test('dir4 and dir4c: the 128 px phone copy on Normal and Leve, the 192 px lite on Alta; a level copy has no original fallback',()=>{
  index();
  const alta=importedSheet('aposentado')!;
  assert.equal(alta.cell,undefined);assert.match(alta.url,/\/art\/lite\/sprites\//);assert.match(alta.cardinals!.url,/\/art\/lite\/sprites\//);
  setMovementArtLevel('normal');
  const phone=importedSheet('aposentado')!;
  assert.equal(phone.cell,PHONE_DIR4_CELL);
  assert.match(phone.url,/\/art\/lite\/sprites-celular\/aposentado\.dir4\.webp$/);
  assert.match(phone.cardinals!.url,/\/art\/lite\/sprites-celular\/aposentado\.dir4c\.webp$/);
  assert.equal(phone.height,alta.height,'height and figure stay in 192 px units');
  assert.equal(originalUrl(phone.url),undefined);
  assert.equal(originalUrl('/art/lite/sprites/aposentado.dir4c.webp'),'/art/sprites/aposentado.dir4c.webp');
});

test("the hand's patch on a 64 px frame: the 96 px hand scaled into the frame, mirrored at the frame's width",()=>{
  const hand={x:60,y:48};
  const near=(a:number[],b:number[])=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-9),`${a} ≈ ${b}`);
  near(patchCrop(hand,false,undefined,64),patchCrop(hand,false).map(v=>v*64/96));
  near(patchCrop(hand,true,undefined,64),patchCrop(hand,true).map(v=>v*64/96));
  near([patchShift(hand,true,undefined,64)],[patchShift(hand,true)*64/96]);
});
