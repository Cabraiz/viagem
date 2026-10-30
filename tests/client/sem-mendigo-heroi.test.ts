// The Mendigo hero was deleted (the user, 30/10; NEW-20261030-ORQ-deletar-mendigo-heroi). The mendigo on screen is the
// enemy (src/client/art/mendigo.ts, public/art/enemies/mendigo): it stays. An old client or save asking for the hero
// 'mendigo' plays the viciado.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {classes,LEGACY_CLASS_IDS,PLAYABLE_CLASS_IDS,playableClassId} from '../../src/rules/classes.ts';
import {KITS,kitFor} from '../../src/rules/kits.ts';
import {CLASS_LINES} from '../../src/client/fun/lines.data.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {FACE_CROP} from '../../src/client/ui/face-crop.ts';
import {MM_FACES} from '../../src/client/hud/wc-minimap/art.ts';
import {FACE_CLASSES} from '../../scripts/art-v2/spec.mjs';
import {parseArtIndex} from '../../src/client/art/manifest.ts';
import {MENDIGO,withMendigo} from '../../src/client/art/mendigo.ts';

const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const HERO=/^mendigo(-|$)/;

test('sem mendigo herói: no hero key "mendigo" in the rules, lines, sprites, faces, minimap or art manifests',()=>{
  assert.ok(!classes.some(c=>c.id===MENDIGO));
  assert.ok(!PLAYABLE_CLASS_IDS.includes(MENDIGO)&&!LEGACY_CLASS_IDS.includes(MENDIGO));
  assert.ok(!KITS.some(k=>k.classId===MENDIGO)&&kitFor(MENDIGO)===undefined);
  for(const [name,keys] of Object.entries({CLASS_LINES:Object.keys(CLASS_LINES),spriteCatalog:Object.keys(spriteCatalog),
    FACE_CROP:Object.keys(FACE_CROP),MM_FACES:[...MM_FACES],FACE_CLASSES:[...FACE_CLASSES]}))
    assert.deepEqual(keys.filter(k=>HERO.test(k)),[],name);
  const groups=json('public/art/manifest.json').groups;
  for(const g of ['personagens','rostos','menu'])assert.deepEqual(Object.keys(groups[g].pieces).filter(k=>HERO.test(k)),[],g);
  for(const path of ['public/art/sprites/manifest.json','public/art/rostos/manifest.json'])
    assert.deepEqual(Object.keys(json(path).pieces).filter(k=>HERO.test(k)),[],path);
  for(const file of ['sprites/mendigo.webp','portraits/mendigo.webp','portraits/mendigo-thumb.webp','portraits/mendigo-768.webp','rostos/mendigo-normal.webp'])
    assert.ok(!existsSync(`public/art/${file}`),file);
});

test('sem mendigo herói: the enemy mendigo stays, with idle, the 8-direction walk and the shoved sheets on disk',()=>{
  const idx=withMendigo(parseArtIndex(json('public/art/manifest.json')));
  const piece=idx.groups.inimigos.pieces[MENDIGO];
  assert.ok(piece,'the enemy piece');
  for(const anim of ['idle','walk','shoved','elite/walk','elite/shoved'])assert.ok(piece.files[anim],anim);
  const files=Object.values(piece.files).flatMap(f=>(f.pages??[f]).map(p=>p.file));
  assert.equal(new Set(files).size,1+8+8);
  for(const file of new Set(files))assert.ok(existsSync(`public/art/enemies/${file}`),file);
});

test('sem mendigo herói: an old client or save asking for the hero mendigo plays the viciado',()=>{
  assert.equal(playableClassId(MENDIGO),'viciado-em-bet');
});
