/**
 * NEW-20261031-ORQ-armas-reais-12 (the user: "o revólver solta 2 balas ao mesmo tempo"): the room fires one bullet per
 * shot, but the bullet's art is a strip of 2 frames the import guessed as one, so every shot drew both side by side.
 * Every projectile sheet in the manifest is named in the spec (no guess), with the same cell and frame count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GROUPS} from '../../scripts/art-v2/spec.mjs';

const manifest=JSON.parse(readFileSync('public/art/projectiles/manifest.json','utf8')) as
  {pieces:Record<string,{files:{sheet:{cell:number[];frames:number;pages:{columns:number;frameCount:number}[]}}}>};
const expected=GROUPS.projeteis.expected as Record<string,{cell:number[];frames:number|number[]}>;

test('every projectile sheet is cut as the spec says: no strip drawn whole',()=>{
  for(const [id,piece] of Object.entries(manifest.pieces)){
    const spec=expected[id],sheet=piece.files.sheet;
    if(!spec){assert.equal(sheet.frames>1||sheet.cell[0]<=sheet.cell[1]*2,true,`${id}: not in the spec, its ${sheet.cell} cell was guessed`);continue;}
    assert.deepEqual(sheet.cell,spec.cell,id);
    const frames=Array.isArray(spec.frames)?spec.frames:[spec.frames];
    assert.ok(frames.includes(sheet.frames),`${id}: ${sheet.frames} frames`);
    assert.equal(sheet.pages.reduce((n,p)=>n+p.frameCount,0),sheet.frames,id);
  }
});

test('the real guns\' bullets are one bullet per frame',()=>{
  for(const [id,n] of [['bala-revolver',2],['bala-metralhadora',2],['bala-fuzil',2]] as const){
    const sheet=manifest.pieces[id].files.sheet;
    assert.equal(sheet.frames,n,id);
    assert.equal(sheet.pages[0].columns,n,id);
  }
});
