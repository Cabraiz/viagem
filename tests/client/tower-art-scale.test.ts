/**
 * torres-entregues (NEW-20261020-ORQ-torres-entregues): the delivered tower art at one scale and from its lite copy.
 *  1. Scale: the city scenery's (materials.ts ART_SCALE, on the map's cell as the lots), for every defense alike, at
 *     any projection; the texture ratio of a lite copy undoes its smaller cell.
 *  2. Base frames follow the sheet's own rows (the obstacles have only pronta, danificada, ruina).
 *  3. Lite: every base and idle sheet a match loads has `liteCell` (manifest and index) and ONE lite file at
 *     public/art/lite/towers/<id>/<name>.webp holding all its frames (the paged bases too), at most 4096 px a side.
 *  4. The client index keeps a sane `liteCell` and drops a malformed one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {ART_CELL_U,baseFrame,textureRatio,towerArtScale} from '../../src/client/render/towers/tower-rules.ts';
import {ART_CELL} from '../../src/client/render/city/art-plan.ts';
import {ART_SCALE} from '../../src/client/render/city/materials.ts';
import {parseArtIndex} from '../../src/client/art/manifest.ts';
import {TILE_X} from '../../src/client/render/city/projection.ts';

const root=(p:string)=>new URL(`../../${p}`,import.meta.url);
const sharp=createRequire(import.meta.url)('sharp');

test("1. one scale for every tower: the city scenery's (ART_SCALE art px per projected px), growing with the map cell",()=>{
  assert.equal(ART_CELL_U,ART_CELL);
  const diamond=2*TILE_X; // city projection: a 1 u square is 2·TILE_X px across
  assert.equal(towerArtScale(diamond),1/ART_SCALE,'the sample city (0.88 u cells): as the building sheets');
  const real=towerArtScale(diamond,1.496);
  assert.ok(Math.abs(real-1/ART_SCALE*1.496/ART_CELL)<1e-12,'the 1.7× city: as its lots (art-plan big)');
  assert.ok(Math.abs(towerArtScale(2*diamond)-2/ART_SCALE)<1e-12,'linear in the projection');
  assert.equal(textureRatio({cell:[640,1152]}),1);
  assert.equal(textureRatio({cell:[640,1152],liteCell:[320,576]}),.5);
});

test('2. base frames by the sheet rows',()=>{
  assert.equal(baseFrame('pronta',1),3*4+1,'6 phases by default');
  const rows=['pronta','danificada','ruina'];
  assert.equal(baseFrame('pronta',2,4,rows),2);
  assert.equal(baseFrame('ruina',0,4,rows),8);
  assert.equal(baseFrame('obra-2',3,4,rows),3,'no obra rows: the ready row');
});

test('3. lite towers: one sheet per loaded file, all frames, liteCell in the manifest and the index',async()=>{
  const towers=JSON.parse(readFileSync(root('public/art/towers/manifest.json'),'utf8'));
  const index=JSON.parse(readFileSync(root('public/art/manifest.json'),'utf8'));
  let n=0;
  for(const [id,piece] of Object.entries<any>(towers.pieces))for(const name of ['base','idle']){
    const f=piece.files[name];if(!f)continue;
    assert.ok(Array.isArray(f.liteCell),`${id}/${name}: liteCell`);
    assert.deepEqual(index.groups.torres.pieces[id].files[name].liteCell,f.liteCell,`${id}/${name}: index`);
    const out=root(`public/art/lite/towers/${id}/${name}.webp`);
    assert.ok(existsSync(out),`${id}/${name}: lite file`);
    const {width,height}=await sharp(readFileSync(out)).metadata();
    assert.ok(width<=4096&&height<=4096,`${id}/${name}: ${width}×${height}`);
    assert.equal(width%f.liteCell[0],0);assert.equal(height%f.liteCell[1],0);
    const frames=(f.views??f.frames??1)*(Array.isArray(f.rows)?f.rows.length:f.directions??1);
    assert.ok((width/f.liteCell[0])*(height/f.liteCell[1])>=frames,`${id}/${name}: holds ${frames} frames`);
    n++;
  }
  assert.ok(n>=30,`${n} files`);
});

test('4. the index keeps a sane liteCell and drops a malformed one',()=>{
  const piece=(liteCell:unknown)=>parseArtIndex({version:2,groups:{torres:{output:'public/art/towers',pieces:{morteiro:{kind:'views',files:{base:{file:'morteiro/base.webp',cell:[448,448],liteCell}}}}}}})
    .groups.torres!.pieces.morteiro!.files.base!;
  assert.deepEqual(piece([224,224]).liteCell,[224,224]);
  assert.equal(piece([900,224]).liteCell,undefined);
  assert.equal(piece('x').liteCell,undefined);
  assert.equal(piece([224,224]).cell[0],448,'the delivered cell stays (mount and anchor are in its px)');
});
