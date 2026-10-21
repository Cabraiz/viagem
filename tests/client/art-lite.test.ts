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
import {BASE_LITE_PIECES,buildCityArtPlan,cityLiteFiles,cityLiteScale} from '../../src/client/render/city/art-plan.ts';
import {BASE_ART,baseLoads} from '../../src/client/art/base-art.ts';
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

test('every city file the city draws over 64 KB (art-plan cityLiteFiles: view sheets and the decor live loops) has its lossy copy (cells × 1 for the footprint pieces and loops, 0.75 for the sheets drawn small), made from the approved file as it is now; the plan and the live layer load it, never the original', ()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
  let copies=0,bytes=0,liteBytes=0;
  for(const group of ['predios','base','props','cenario']){
    const g=index.groups[group];
    for(const [id,piece] of Object.entries<any>(g?.pieces??{}))for(const {name,scale:k} of cityLiteFiles(group,id,piece)){
      const f=piece.files[name],src=`${g.output}/${f.file}`,key=src.replace(/^public\/art\//,''),size=readFileSync(src).length;
      if(size<=64*1024){assert.equal(f.liteCell,undefined,`${key}: ${size} B keeps the approved file`);continue;}
      assert.deepEqual(f.liteCell,[Math.ceil(f.cell[0]*k),Math.ceil(f.cell[1]*k)],`${key}: liteCell (node scripts/art-lite.mjs --kinds city)`);
      const entry=manifest.files[key];
      assert.ok(entry,`${key}: no copy in scripts/art-lite.json`);
      assert.equal(entry.source,sha(src),`${key}: the approved file changed after its copy`);
      assert.equal(entry.lite,sha(`public/art/lite/${key}`),`public/art/lite/${key} is not the copy the manifest measured`);
      assert.ok(entry.shownPsnr>=36,`${key}: ${entry.shownPsnr} dB`);
      copies++;bytes+=entry.bytes;liteBytes+=entry.liteBytes;
    }
  }
  assert.ok(copies>=200,`${copies} city copies`);
  assert.ok(liteBytes<bytes*.35,`${liteBytes} of ${bytes}`);
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
    // A live loop keeps its cell (the live layer places it in art px of the base cell).
    const loop=liveSheets(artIndex()).find(s=>s.key==='city:live:academia-praca-1:anim-balanco')!,f=index.groups.cenario.pieces['academia-praca-1'].files['anim-balanco'];
    assert.equal(loop.url,'/art/lite/city/decor/academia-praca-1/anim-balanco.webp');
    assert.deepEqual([loop.frameWidth,loop.frameHeight],f.cell);
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});

test('the base wall and barricades (art/base-art.ts) load their city lite copies at the same cell, before the first playable frame; a failed copy falls back to the approved file (base-lite-muralha)',()=>{
  const index=JSON.parse(readFileSync('public/art/manifest.json','utf8')),base=index.groups.base;
  // art-plan's list is base-art's 4-view pieces (kept apart so scripts/art-lite.mjs does not load the renderer).
  assert.deepEqual([...BASE_LITE_PIECES].sort(),Object.values<string>(BASE_ART).filter(id=>(base.pieces[id]?.files.sheet.views??0)>=4).sort());
  setArtIndex(parseArtIndex(index));
  try{
    const loads=baseLoads();
    for(const id of BASE_LITE_PIECES){
      const f=base.pieces[id].files.sheet,l=loads.find(x=>x.key===`art:base:${id}`)!;
      assert.equal(cityLiteScale('base',id,base.pieces[id]),1,`${id}: same cell`);
      assert.deepEqual(f.liteCell,f.cell,`${id}: liteCell = cell`);
      assert.equal(l.url,`/art/lite/city/base/${f.file}`);
      assert.ok(existsSync(`public${l.url}`),l.url);
      assert.ok(!liteOnly(l.url)&&originalUrl(l.url)===`/art/city/base/${f.file}`,`${l.url}: falls back to the approved file`);
      const entry=manifest.files[`city/base/${f.file}`];
      assert.ok(entry.liteBytes<entry.bytes*.7,`${id}: ${entry.liteBytes} of ${entry.bytes}`);
    }
    // The crate has one view (and ~50 KB): the approved file.
    assert.equal(loads.find(x=>x.key==='art:base:caixa-saque')?.url,'/art/city/base/caixa-saque.webp');
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});
