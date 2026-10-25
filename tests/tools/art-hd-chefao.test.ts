/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 6: the chefão's idle/walk/slam AI-upscaled (scripts/art-hd-chefao.mjs),
 * HD on the computer (768 px cell, pages ≤ 8192 px), semi-HD on the phone (512 px, pages ≤ 4096 px).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {HD_ANIMS,HD_ENEMIES,HD_SCREENS,hdLayout,parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {enemyFileUrl,enemyPieceLoads} from '../../src/client/art/horde-art.ts';
import {originalUrl} from '../../src/client/sprites/art-urls.ts';
// @ts-expect-error plain .mjs script
import {HD_ANIMS as SCRIPT_ANIMS,HD_IDS,HD_SCREENS as SCRIPT_SCREENS,checkHd,hdLayout as scriptLayout} from '../../scripts/art-hd-chefao.mjs';

const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));

test('the script and the client agree on who, which files, the cells and the pages',()=>{
  assert.deepEqual([...HD_IDS].sort(),[...HD_ENEMIES].sort());
  assert.deepEqual(SCRIPT_ANIMS,[...HD_ANIMS]);
  assert.deepEqual(SCRIPT_SCREENS,HD_SCREENS);
  for(const total of [6,48,64,80,128])for(const screen of ['pc','celular'] as const)
    assert.deepEqual(hdLayout('x','slam',screen,total),scriptLayout('x','slam',screen,total,HD_SCREENS[screen].cell,HD_SCREENS[screen].maxSide));
});

test('every HD page is on disk, in the layout, and none passes the screen\'s texture limit',async()=>{
  assert.deepEqual(checkHd(),[]);
  for(const id of HD_IDS)for(const anim of HD_ANIMS)for(const screen of ['pc','celular'] as const){
    const f=index.groups.inimigos.pieces[id].files[anim],{cell,maxSide}=HD_SCREENS[screen];
    for(const p of hdLayout(id,anim,screen,f.frames*f.directions)){
      const m=await sharp(`public/art/hd/enemies/${p.file}`).metadata();
      assert.equal(m.width,p.columns*cell,p.file);assert.equal(m.height,p.rows*cell,p.file);
      assert.ok(m.width<=maxSide&&m.height<=maxSide,p.file);
    }
  }
});

test('the computer loads the HD copy, the phone the semi-HD; his other files the computer\'s lossy copy at the approved cell',()=>{
  try{
    for(const [pc,screen] of [[true,'pc'],[false,'celular']] as const){
      setArtIndex(parseArtIndex(index,pc));
      for(const id of HD_ENEMIES){
        const loads=enemyPieceLoads(id);
        for(const anim of HD_ANIMS){
          const mine=loads.filter(l=>l.key===`art:enemy:${id}:${anim}`||l.key.startsWith(`art:enemy:${id}:${anim}:p`));
          assert.ok(mine.length,`${id} ${anim}`);
          for(const l of mine){assert.ok(l.url.startsWith(`/art/hd/enemies/${id}/${screen}/`),l.url);assert.equal(l.cell[0],HD_SCREENS[screen].cell);}
        }
        for(const l of loads.filter(l=>!/:(idle|walk|slam)(:p\d)?$/.test(l.key))){
          assert.equal(l.cell[0],384,l.url);
          assert.ok(l.url.startsWith(`/art/lite/enemies-pc/${id}/`),l.url);
          assert.equal(originalUrl(l.url),l.url.replace('/art/lite/enemies-pc/','/art/enemies/'),'a failed copy falls back to the approved file');
        }
      }
    }
    // Everyone else is untouched: the phone's lite copy.
    setArtIndex(parseArtIndex(index,false));
    assert.ok(enemyPieceLoads('bebado').every(l=>l.url.startsWith('/art/lite/enemies/')));
    assert.equal(enemyFileUrl('bebado','/art/enemies/bebado/idle.webp',{cell:[100,100]}),'/art/lite/enemies/bebado/idle.webp');
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});
