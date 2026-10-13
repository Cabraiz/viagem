/** N27 · the lossy copies the game downloads (scripts/art-lite.mjs) exist for every tree and class and follow their source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {treeCatalog} from '../../src/maps/tree-catalog.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {treeUrl,spriteUrl,thumbUrl,iconKey,originalUrl,STAND_IN_KEY} from '../../src/client/sprites/art-urls.ts';

const manifest=JSON.parse(readFileSync('scripts/art-lite.json','utf8'));
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('every tree and class sheet has its copy, made from the approved file as it is now (else: node scripts/art-lite.mjs)',()=>{
  const sheets=[...treeCatalog.map(t=>['trees',t.id,treeUrl(t.id)]),...Object.entries(spriteCatalog).flatMap(([id,c])=>[
    ['sprites',id,spriteUrl(id)],...(c.dir4?[['sprites',`${id}.dir4`,spriteUrl(id,true)]]:[])])];
  assert.ok(sheets.length>=76);
  for(const [kind,id,url] of sheets){
    const key=`${kind}/${id}.webp`,entry=manifest.files[key];
    assert.ok(entry,`${key}: no copy in scripts/art-lite.json`);
    assert.equal(entry.source,sha(`public/art/${key}`),`${key}: the approved file changed after its copy`);
    assert.ok(existsSync(`public${url}`),`${url} missing`);
    assert.equal(entry.lite,sha(`public${url}`),`${url} is not the copy the manifest measured`);
    assert.ok(entry.liteBytes<entry.bytes*.6,`${key}: ${entry.liteBytes} of ${entry.bytes}`);
  }
});

test('measured quality: at the size a phone draws them no copy is below 36 dB, and the whole set is ≤ 47% of the bytes (the imported v2 hero atlases are denser: ~48%)',()=>{
  const s=manifest.summary;
  assert.ok(s.worstShownPsnr>=36,`${s.worstShownPsnr} dB`);
  assert.ok(s.liteBytes<=s.bytes*.47,`${s.liteBytes} of ${s.bytes}`);
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
