/** N27 · the lossy copies the game downloads (scripts/art-lite.mjs) exist for every tree and class and follow their source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {treeCatalog} from '../src/game/tree-catalog.ts';
import {spriteCatalog} from '../src/game/sprite-catalog.ts';
import {treeUrl,spriteUrl} from '../src/game/art-urls.ts';

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

test('measured quality: at the size a phone draws them no copy is below 36 dB, and the whole set is ≤ 45% of the bytes',()=>{
  const s=manifest.summary;
  assert.ok(s.worstShownPsnr>=36,`${s.worstShownPsnr} dB`);
  assert.ok(s.liteBytes<=s.bytes*.45,`${s.liteBytes} of ${s.bytes}`);
  assert.equal(manifest.webp.alphaQuality,100,'cut-out edges stay exact');
});
