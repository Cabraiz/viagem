// NEW-20261016-ORQ-icones-no-hud: the build menu wears each defense's imported sticker (ui/torre-<id>) in place of the
// bare suit, and "what got you" (revive banner, result) finds the nine's ui/inimigo-<id> icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {DEFENSE_IDS,RAIL} from '../../src/rules/index.ts';
import {towerSticker} from '../../src/client/hud/towers/model.ts';
import {CAUSE_KINDS} from '../../src/client/hud/cause.ts';
import {critterIconSource} from '../../src/client/art/hud-art.ts';

const index=JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8')) as ArtIndex;

test('every defense has its tower sticker; the rail and unknown keys keep the suit',()=>{
  setArtIndex(index);
  try{
    for(const id of DEFENSE_IDS)assert.match(towerSticker(id)??'',new RegExp(`/torre-${id}\.webp$`),id);
    assert.equal(towerSticker(RAIL.id),undefined);
    assert.equal(towerSticker('muralha'),undefined);
    assert.equal(towerSticker('toString'),undefined);
  }finally{setArtIndex({version:2,groups:{}});}
  assert.equal(towerSticker(DEFENSE_IDS[0]!),undefined,'no art loaded: the suit');
});

test('"what got you": each of the nine resolves to its imported ui/inimigo-<id> icon',()=>{
  setArtIndex(index);
  try{
    for(const kind of CAUSE_KINDS){
      const src=critterIconSource(kind);
      assert.ok(src&&'url' in src&&src.url.endsWith(`/inimigo-${kind}.webp`),`${kind}: ${JSON.stringify(src)}`);
    }
  }finally{setArtIndex({version:2,groups:{}});}
});
