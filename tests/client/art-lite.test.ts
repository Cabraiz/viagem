/** N27 · the lossy copies the game downloads (scripts/art-lite.mjs) exist for every tree, class, enemy and big city file and follow their source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {treeCatalog} from '../../src/maps/tree-catalog.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {treeUrl,spriteUrl,thumbUrl,iconKey,originalUrl,STAND_IN_KEY} from '../../src/client/sprites/art-urls.ts';
import {setArtIndex,parseArtIndex,artIndex} from '../../src/client/art/manifest.ts';
import {enemyPieceLoads,liteEnemyUrl,liteOnly} from '../../src/client/art/horde-art.ts';
import {buildCityArtPlan,cityLiteFile} from '../../src/client/render/city/art-plan.ts';
import {liveSheets} from '../../src/client/render/city/live/art.ts';

const manifest=JSON.parse(readFileSync('scripts/art-lite.json','utf8'));
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('every tree and class sheet has its copy, made from the approved file as it is now (else: node scripts/art-lite.mjs)',()=>{
  const sheets=[...treeCatalog.map(t=>['trees',t.id,treeUrl(t.id)]),...Object.entries(spriteCatalog).flatMap(([id,c])=>[
    ['sprites',id,spriteUrl(id)],...(c.dir4?[['sprites',`${id}.dir4`,spriteUrl(id,true)]]:[])])];
  assert.ok(sheets.length>=74);
  for(const [kind,id,url] of sheets){
    const key=`${kind}/${id}.webp`,entry=manifest.files[key];
    assert.ok(entry,`${key}: no copy in scripts/art-lite.json`);
    assert.equal(entry.source,sha(`public/art/${key}`),`${key}: the approved file changed after its copy`);
    assert.ok(existsSync(`public${url}`),`${url} missing`);
    assert.equal(entry.lite,sha(`public${url}`),`${url} is not the copy the manifest measured`);
    assert.ok(entry.liteBytes<entry.bytes*.6,`${key}: ${entry.liteBytes} of ${entry.bytes}`);
  }
});

test('measured quality: at the size a phone draws them no copy is below 36 dB, and the whole set is ≤ 50% of the bytes (the v2 hero atlases and the 9 first enemies with their elite layers are denser, ~48%; each file stays < 60%)',()=>{
  const s=manifest.summary;
  assert.ok(s.worstShownPsnr>=36,`${s.worstShownPsnr} dB`);
  assert.ok(s.liteBytes<=s.bytes*.5,`${s.liteBytes} of ${s.bytes}`);
  assert.equal(manifest.webp.alphaQuality,100,'cut-out edges stay exact');
});

test('a copy that fails falls back to the approved file; a teammate without its icon yet shows the silhouette, never nothing',()=>{
  for(const url of [treeUrl('acacia'),spriteUrl('coach'),spriteUrl('coach',true)]){
    const back=originalUrl(url)!;
    assert.ok(back.startsWith('/art/')&&!back.includes('/lite/'),back);
    if(!url.includes('.dir4'))assert.ok(existsSync(`public${back}`),`${back} is the approved file`);
  }
  assert.equal(originalUrl(thumbUrl('coach')),undefined,'portraits have no copy to fall back from');
  assert.equal(iconKey('coach',()=>false),STAND_IN_KEY);
  assert.equal(iconKey('coach',k=>k==='class:coach'),'class:coach');
});

test('every imported v2 hero atlas (public/art/manifest.json, personagens dir4) has its lossy copy, which the game loads',()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  for(const [id,piece] of Object.entries<any>(index.groups?.personagens?.pieces??{})){
    const file=piece.files?.dir4?.file;if(!file)continue;
    assert.ok(existsSync(`public/art/lite/sprites/${file}`),`${id}: public/art/lite/sprites/${file} missing (node scripts/art-lite.mjs)`);
  }
});

test('every enemy file (public/art/manifest.json, inimigos, every page) has its copy, made from the approved file as it is now',()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  const files=Object.values<any>(index.groups?.inimigos?.pieces??{}).flatMap(p=>Object.values<any>(p.files))
    .flatMap(f=>f.pages?.length?f.pages.map((p:any)=>p.file):[f.file]);
  assert.ok(files.length>=76,`${files.length} enemy files`);
  for(const file of new Set<string>(files)){
    const key=`enemies/${file}`,entry=manifest.files[key];
    assert.ok(entry,`${key}: no copy in scripts/art-lite.json (node scripts/art-lite.mjs)`);
    assert.equal(entry.source,sha(`public/art/${key}`),`${key}: the approved file changed after its copy`);
    assert.equal(entry.lite,sha(`public/art/lite/${key}`),`public/art/lite/${key} is not the copy the manifest measured`);
    assert.ok(entry.shownPsnr>=36,`${key}: ${entry.shownPsnr} dB`);
  }
});

test('the horde loader asks for the enemies\' lite copies; a failed copy falls back to the approved file',()=>{
  assert.equal(liteEnemyUrl('/art/enemies/pamonheiro/walk.webp'),'/art/lite/enemies/pamonheiro/walk.webp');
  assert.equal(originalUrl(liteEnemyUrl('/art/enemies/pamonheiro/walk.webp')),'/art/enemies/pamonheiro/walk.webp');
  // Every imported enemy, a legacy kind or a roster id, loads per piece (enemyPieceLoads) as lite copies on disk.
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  setArtIndex(parseArtIndex(index));
  const enemies=['pamonheiro','bebado','chefe'].flatMap(id=>enemyPieceLoads(id));
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.ok(enemies.length>=15,`${enemies.length} sheets`);
  for(const l of enemies){
    assert.ok(l.url.startsWith('/art/lite/enemies/'),l.url);
    assert.ok(existsSync(`public${l.url}`),`${l.url} missing`);
  }
});

test('every city sheet the city draws over 200 KB (art-plan cityLiteFile) has its half-size copy, made from the approved file as it is now; the plan and the nests load it, never the original', ()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  let copies=0,bytes=0,liteBytes=0;
  for(const group of ['predios','base','props','cenario']){
    const g=index.groups[group];
    for(const [id,piece] of Object.entries<any>(g?.pieces??{})){
      const name=cityLiteFile(group,id,piece);if(!name)continue;
      const f=piece.files[name],src=`${g.output}/${f.file}`,key=src.replace(/^public\/art\//,''),size=readFileSync(src).length;
      if(size<=200*1024){assert.equal(f.liteCell,undefined,`${key}: ${size} B keeps the approved file`);continue;}
      // CITY_LITE_SCALE (scripts/art-lite.mjs, the towers' 0.5): the script runs on import, so the number is here.
      assert.deepEqual(f.liteCell,[Math.ceil(f.cell[0]*.5),Math.ceil(f.cell[1]*.5)],`${key}: liteCell (node scripts/art-lite.mjs --kinds city)`);
      const entry=manifest.files[key];
      assert.ok(entry,`${key}: no copy in scripts/art-lite.json`);
      assert.equal(entry.source,sha(src),`${key}: the approved file changed after its copy`);
      assert.equal(entry.lite,sha(`public/art/lite/${key}`),`public/art/lite/${key} is not the copy the manifest measured`);
      assert.ok(entry.shownPsnr>=36,`${key}: ${entry.shownPsnr} dB`);
      copies++;bytes+=entry.bytes;liteBytes+=entry.liteBytes;
    }
  }
  assert.ok(copies>=80,`${copies} city copies`);
  assert.ok(liteBytes<bytes*.15,`${liteBytes} of ${bytes}`);
  // The opening's heaviest (cena-nasce-rapido fase 2): the plan asks for their copies at the smaller cell.
  setArtIndex(parseArtIndex(index));
  try{
    const plan=buildCityArtPlan(artIndex(),{cell:1.496,decor:['predio-apto-5a-2','conjunto-habitacional-1','outdoor-1']});
    for(const id of ['predio-apto-5a-2','conjunto-habitacional-1','outdoor-1']){
      const s=plan.decor[id];
      assert.ok(s.url.startsWith('/art/lite/city/decor/')&&existsSync(`public${s.url}`),s.url);
      assert.ok(liteOnly(s.url),`${s.url}: a failed copy keeps its mound (the approved file has other cells)`);
    }
    const nest=liveSheets(artIndex()).find(s=>s.key==='city:live:ninho-festa-ativo:sheet')!;
    assert.equal(nest.url,'/art/lite/city/decor/ninho-festa-ativo/sheet.webp');
    assert.deepEqual([nest.frameWidth,nest.frameHeight],index.groups.cenario.pieces['ninho-festa-ativo'].files.sheet.liteCell);
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});
