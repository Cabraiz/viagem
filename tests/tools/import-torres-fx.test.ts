/**
 * The defenses' painted effects (NEW-20261029-ORQ-fx-torres-arte): the importer's green key, strip splitting and
 * packing, and the delivered atlas holding every effect cell of towers.ts at the size of its procedural bake.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {FRAMES,keyGreen,pack,pieces} from '../../scripts/import-torres-fx.mjs';
import type {FxArtFrames} from '../../src/client/render/towers/towers.ts';

const FX='public/art/fx/';

test('green key: the chroma green goes, the piece stays, the green spill on the edge is pulled down', () => {
  const px=keyGreen(new Uint8ClampedArray([0,255,0,255, 200,180,40,255, 60,120,60,255]));
  assert.equal(px[3],0);
  assert.equal(px[7],255);
  assert.ok(px[11]>0&&px[11]<255,'the half-green edge is half see-through');
  assert.equal(px[9],60,'its green is pulled down to max(r, b)');
});

test('strip: the painted pieces are found left to right, small gaps bridged', () => {
  const w=20,h=2,data=new Uint8ClampedArray(w*h*4);
  for(const x of [1,2,4,5,12,13])data[(w+x)*4+3]=255;
  assert.deepEqual(pieces(data,w,h),[[1,6],[12,14]]);
});

test('pack: cells go on shelves of the page width', () => {
  const {at,height}=pack([{w:600,h:50},{w:600,h:40},{w:300,h:10}],1024);
  assert.deepEqual(at,[{x:0,y:0},{x:0,y:50},{x:600,y:50}]);
  assert.equal(height,90);
});

test('the delivered atlas has every effect cell at its bake size, inside the image', async () => {
  const art=JSON.parse(readFileSync(FX+'torres-fx.json','utf8')) as FxArtFrames;
  const meta=await sharp(FX+'torres-fx.webp').metadata();
  assert.deepEqual(Object.keys(art.frames).sort(),FRAMES.map(f=>f.name).sort());
  const src=readFileSync('src/client/render/towers/towers.ts','utf8');
  for(const f of FRAMES){
    const r=art.frames[f.name]!;
    assert.deepEqual([r.w,r.h],[f.w,f.h],f.name);
    assert.ok(r.x+r.w<=meta.width!&&r.y+r.h<=meta.height!,`${f.name} fora da imagem`);
    assert.ok(src.includes(`'${f.name.replace(/^fx:/,'')}'`)||src.includes(`'${f.name}'`),`${f.name} não é um quadro de towers.ts`);
  }
});
