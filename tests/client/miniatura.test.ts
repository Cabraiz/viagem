import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {miniaturaOf, ROSTOS, rostoUrl} from '../../src/client/ui/miniatura.ts';
import {instaPerfil} from '../../src/client/ui/insta.ts';
import {isLiberado, PERSONAGENS_LIBERADOS, PLAYABLE_CLASS_IDS} from '../../src/rules/index.ts';

// NEW-20261023-ORQ-selecao-miniatura-rosto: the row's "?" becomes the released hero's face over his background.
const pub=(path:string)=>new URL(`../../public${path}`,import.meta.url);
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');

test('every released hero has his face in the row: the lite copy the tile loads and the approved file it comes from',()=>{
  for(const id of PERSONAGENS_LIBERADOS){
    const url=miniaturaOf(id,true);
    assert.equal(url,rostoUrl(id),`${id}: no face (ui/miniatura.ts ROSTOS, node scripts/miniatura-rosto.mjs)`);
    assert.ok(existsSync(pub(url!)),`${url}: missing (node scripts/art-lite.mjs --kinds menu)`);
    assert.ok(existsSync(pub(`/art/menu/rosto/${id}.webp`)),`${id}: no approved face`);
  }
});

test('a locked hero never leaks his face: the tile keeps the "?" even when his file exists (the maromba)',()=>{
  const locked=PLAYABLE_CLASS_IDS.filter(id=>!isLiberado(id));
  assert.ok(locked.length>0);
  for(const id of locked)assert.equal(miniaturaOf(id,false),undefined,id);
  for(const id of ROSTOS)assert.equal(miniaturaOf(id,false),undefined,id);
  // The row asks with the hero's own lock state, and a face goes in only through miniaturaOf.
  assert.match(main,/miniaturaOf\(hero\.id,isLiberado\(hero\.id\)\)/);
  assert.equal(main.match(/\/art\/lite\/menu\/rosto|rostoUrl/g),null);
});

test('the faces are the Instagram profile photos (one picture per hero) and stay light',()=>{
  for(const id of ROSTOS){
    assert.ok(instaPerfil(id),`${id}: no profile`);
    const bytes=readFileSync(pub(rostoUrl(id))).length;
    assert.ok(bytes<24_000,`${id}: ${bytes} bytes`);
  }
});
