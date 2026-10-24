/**
 * NEW-20261016-ORQ-inimigos-peso-download: the enemies' lite copies are smaller, cell by cell, down to what a phone
 * shows (scripts/art-lite.mjs); the index gives their files `liteCell`, which the client takes as the cell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HD_ENEMIES,parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {existsSync} from 'node:fs';
import {artTargetHeight,enemyPieceLoads,HERO_FIGURE_PX,liteEnemyUrl,liteOnly,setWaveBossDraw,unusedEnemyFile} from '../../src/client/art/horde-art.ts';
import {WAVE_BOSS,WAVE_BOSS_IDS} from '../../src/rules/index.ts';
import {critterSheetFrame} from '../../src/client/art/hud-art.ts';
import {bootArt} from '../../src/client/ui/art-boot.ts';
import {ELITE_SCALE} from '../../src/client/render/keys.ts';
import {HERO_DESKTOP_SCREEN_PX,HERO_MIN_SCREEN_PX,REFERENCE_SHORT_SIDE_PX} from '../../src/contract/offscreen.ts';

const lite=JSON.parse(readFileSync('scripts/art-lite.json','utf8'));
const enemies=JSON.parse(readFileSync('public/art/enemies/manifest.json','utf8'));
const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
const filesOf=(f:any):string[]=>f.pages?.length?f.pages.map((p:any)=>p.file):[f.file];

test('an enemy file with liteCell is drawn with that cell; a malformed or bigger one keeps the approved cell; other groups ignore it',()=>{
  const file=(liteCell:unknown)=>({file:'x/idle.webp',cell:[384,384],liteCell});
  const idx=parseArtIndex({version:2,groups:{
    inimigos:{output:'public/art/enemies',pieces:{a:{kind:'animations',files:{idle:file([192,192])}},b:{kind:'animations',files:{idle:file([512,512])}},c:{kind:'animations',files:{idle:file('x')}}}},
    ui:{output:'public/art/ui',pieces:{d:{kind:'single',files:{idle:file([192,192])}}}}}});
  assert.deepEqual(idx.groups.inimigos.pieces.a.files.idle.cell,[192,192]);
  assert.deepEqual(idx.groups.inimigos.pieces.a.files.idle.liteCell,[192,192]);
  for(const id of ['b','c']){assert.deepEqual(idx.groups.inimigos.pieces[id].files.idle.cell,[384,384]);assert.equal(idx.groups.inimigos.pieces[id].files.idle.liteCell,undefined);}
  assert.deepEqual(idx.groups.ui.pieces.d.files.idle.cell,[384,384]);
});

test('every smaller copy is its source cell by cell (the sheet is columns × liteCell) and the index carries the same liteCell',()=>{
  let smaller=0;
  for(const [id,piece] of Object.entries<any>(enemies.pieces))for(const [name,f] of Object.entries<any>(piece.files)){
    const inIndex=index.groups.inimigos.pieces[id].files[name];
    assert.deepEqual(inIndex.liteCell,f.liteCell,`${id} ${name}: index and manifest disagree (node scripts/art-lite.mjs)`);
    for(const file of filesOf(f)){
      const e=lite.files[`enemies/${file}`];
      assert.deepEqual(e.liteCell,f.liteCell,`${file}: the copy was made for another cell (node scripts/art-lite.mjs)`);
      if(f.liteCell)smaller++;
    }
  }
  assert.ok(smaller>=500,`${smaller} smaller enemy copies`);
});

test('a smaller copy keeps LITE_TEXELS (0.9) texels per CSS px of its figure as an elite at the closest zoom, 1.2 as a plain enemy',()=>{
  for(const [id,fig] of Object.entries<any>(lite.enemyFigures)){
    const piece=enemies.pieces[id],f=Object.values<any>(piece.files).find(x=>x.cell[1]===fig.cell[1]);
    if(!f?.liteCell)continue;
    // The 1st wave's chefão (boss-fim-onda-1) draws × WAVE_BOSS.drawScale past his sheet (its own 384 px cell is under
    // that): softer by choice, the lite copy keeps his download; the check stays on his role's height.
    if(WAVE_BOSS_IDS.includes(id))setWaveBossDraw(1);
    const need=artTargetHeight(id)*HERO_MIN_SCREEN_PX/HERO_FIGURE_PX*ELITE_SCALE*.9;
    setWaveBossDraw(WAVE_BOSS.drawScale);
    assert.ok(fig.drawn*f.liteCell[1]/fig.cell[1]>=need-1e-9,`${id}: ${fig.drawn} px × ${f.liteCell[1]}/${fig.cell[1]} < ${need.toFixed(1)}`);
  }
});

test('the loader asks for a smaller copy with its cell, and that copy never falls back to the approved file',()=>{
  setArtIndex(parseArtIndex(index));
  const id=Object.keys(enemies.pieces).find(k=>Object.values<any>(enemies.pieces[k].files).some(f=>f.liteCell))!;
  const loads=enemyPieceLoads(id);
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.ok(loads.length);
  for(const l of loads){
    const name=Object.entries<any>(enemies.pieces[id].files).find(([,f])=>filesOf(f).some(p=>l.url.endsWith(`/${p}`)))![1];
    if(!name.liteCell)continue;
    assert.deepEqual(l.cell,name.liteCell,l.url);
    assert.ok(liteOnly(l.url),l.url);
  }
});

// NEW-20261023-ORQ-inimigos-v5a-padrao: the computer's copy (scripts/art-lite.mjs, family enemies-pc).
test('every drawn file of a piece with a smaller phone copy has a computer copy at pcCell (manifest = index = the copy), never smaller than the phone one; the rest rows have none',()=>{
  let pc=0;
  for(const [id,piece] of Object.entries<any>(enemies.pieces))for(const [name,f] of Object.entries<any>(piece.files)){
    const inIndex=index.groups.inimigos.pieces[id].files[name];
    assert.deepEqual(inIndex.pcCell,f.pcCell,`${id} ${name}: index and manifest disagree (node scripts/art-lite.mjs)`);
    if(unusedEnemyFile(name)||!f.liteCell){assert.equal(f.pcCell,undefined,`${id} ${name}`);continue;}
    assert.ok(f.pcCell,`${id} ${name}: no pcCell (node scripts/art-lite.mjs --kinds enemies-pc)`);
    assert.ok(f.pcCell[0]>=f.liteCell[0]&&f.pcCell[1]>=f.liteCell[1]&&f.pcCell[0]<=f.cell[0]&&f.pcCell[1]<=f.cell[1],`${id} ${name}: ${f.pcCell}`);
    for(const file of filesOf(f)){
      const e=lite.files[`enemies-pc/${file}`];
      assert.ok(e,`enemies-pc/${file}: no copy`);
      assert.deepEqual(e.liteCell,f.pcCell,`${file}: the computer copy was made for another cell`);
      assert.equal(e.source,lite.files[`enemies/${file}`].source,`${file}: the computer copy comes from another approved file`);
      assert.ok(e.shownPsnr>=36,`enemies-pc/${file}: ${e.shownPsnr} dB`);
      pc++;
    }
  }
  assert.ok(pc>=500,`${pc} computer copies`);
  for(const key of Object.keys(lite.files))if(key.startsWith('enemies-pc/'))assert.ok(lite.files[key.replace('enemies-pc/','enemies/')],`${key}: orphan copy`);
});

test('a computer copy keeps LITE_TEXELS (0.9) texels per CSS px of a plain enemy beside a full HD hero (38 × 1080 / 390 = 105 px), not an elite one (the full sheet, ~4×)',()=>{
  const heroPc=HERO_DESKTOP_SCREEN_PX*1080/REFERENCE_SHORT_SIDE_PX;
  assert.ok(Math.abs(heroPc-105.2)<.1);
  let checked=0;
  for(const [id,fig] of Object.entries<any>(lite.enemyFigures)){
    const piece=enemies.pieces[id],f=Object.values<any>(piece.files).find(x=>x.cell[1]===fig.cell[1]&&x.pcCell);
    if(!f)continue;
    const need=artTargetHeight(id)*heroPc/HERO_FIGURE_PX*.9,got=fig.drawn*f.pcCell[1]/fig.cell[1];
    assert.ok(got>=need-1e-9||f.pcCell[1]===f.cell[1],`${id}: ${got.toFixed(1)} < ${need.toFixed(1)}`);
    assert.ok(f.pcCell[1]===f.cell[1]||got<need+fig.drawn/fig.cell[1]+1e-9,`${id}: bigger than it needs (${got.toFixed(1)} for ${need.toFixed(1)})`);
    checked++;
  }
  assert.ok(checked>=100,`${checked} pieces`);
});

// Etapa 4: the client picks the computer's copy only on a computer (the fine pointer of the fixed zoom).
test('pcCell is the cell only on a computer; the phone never keeps it; a malformed one (bigger than cell, smaller than liteCell, without liteCell) is dropped',()=>{
  const file=(liteCell:unknown,pcCell:unknown)=>({file:'x/idle.webp',cell:[384,384],...(liteCell?{liteCell}:{}),pcCell});
  const raw={version:2,groups:{inimigos:{output:'public/art/enemies',pieces:{
    a:{kind:'animations',files:{idle:file([128,128],[256,256])}},
    big:{kind:'animations',files:{idle:file([128,128],[512,512])}},
    small:{kind:'animations',files:{idle:file([128,128],[96,96])}},
    bad:{kind:'animations',files:{idle:file([128,128],'x')}},
    nolite:{kind:'animations',files:{idle:file(undefined,[256,256])}}}}}};
  const pc=parseArtIndex(raw,true).groups.inimigos.pieces,phone=parseArtIndex(raw).groups.inimigos.pieces;
  assert.deepEqual(pc.a.files.idle.cell,[256,256]);assert.deepEqual(pc.a.files.idle.pcCell,[256,256]);assert.deepEqual(pc.a.files.idle.liteCell,[128,128]);
  assert.deepEqual(phone.a.files.idle.cell,[128,128]);assert.equal(phone.a.files.idle.pcCell,undefined);
  for(const id of ['big','small','bad']){
    for(const p of [pc,phone]){assert.deepEqual(p[id].files.idle.cell,[128,128],id);assert.equal(p[id].files.idle.pcCell,undefined,id);}
  }
  for(const p of [pc,phone]){assert.deepEqual(p.nolite.files.idle.cell,[384,384]);assert.equal(p.nolite.files.idle.pcCell,undefined);}
  assert.equal(liteEnemyUrl('/art/enemies/a/idle.webp',pc.a.files.idle),'/art/lite/enemies-pc/a/idle.webp');
  assert.equal(liteEnemyUrl('/art/enemies/a/idle.webp',phone.a.files.idle),'/art/lite/enemies/a/idle.webp');
});

test('the phone loads exactly what it loaded before the computer copies (same URLs and cells as an index without pcCell)',()=>{
  const strip=JSON.parse(JSON.stringify(index));
  for(const piece of Object.values<any>(strip.groups.inimigos.pieces))for(const f of Object.values<any>(piece.files))delete f.pcCell;
  const ids=Object.keys(enemies.pieces);
  setArtIndex(parseArtIndex(strip));const before=ids.flatMap(id=>enemyPieceLoads(id));
  setArtIndex(parseArtIndex(index));const after=ids.flatMap(id=>enemyPieceLoads(id)),frames=ids.map(id=>critterSheetFrame(id));
  setArtIndex(parseArtIndex(index,true));const pcFrames=ids.map(id=>critterSheetFrame(id));
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  assert.ok(after.length>=500);
  assert.deepEqual(after,before);
  assert.ok(after.every(l=>!l.url.includes('/enemies-pc/')));
  assert.ok(frames.every(f=>!f||!f.url.includes('/enemies-pc/')));
  assert.ok(pcFrames.some(f=>f?.url.includes('/enemies-pc/')),'the HUD face on a computer takes its copy too');
});

test('a computer loads every drawn file with pcCell from enemies-pc at that cell (on disk, never falling back to the approved file); the rest keep the phone copy',()=>{
  setArtIndex(parseArtIndex(index,true));
  const loads=Object.keys(enemies.pieces).flatMap(id=>enemyPieceLoads(id).map(l=>({id,l})));
  setArtIndex(parseArtIndex({version:2,groups:{}}));
  let pc=0;
  for(const {id,l} of loads){
    const f=Object.values<any>(enemies.pieces[id].files).find(x=>filesOf(x).some(p=>l.url.endsWith(`/${p}`)));
    assert.ok(existsSync(`public${l.url}`),l.url);
    // The 1st wave's chefão draws his approved file at its own cell (boss-fim-onda-1, HD at 3×), on any screen.
    if(HD_ENEMIES.has(id)){assert.ok(l.url.startsWith('/art/enemies/'),l.url);assert.deepEqual(l.cell,f.cell,l.url);continue;}
    if(f.pcCell){
      pc++;
      assert.ok(l.url.startsWith('/art/lite/enemies-pc/'),l.url);
      assert.deepEqual(l.cell,f.pcCell,l.url);
      assert.ok(liteOnly(l.url),l.url);
    }else assert.ok(l.url.startsWith('/art/lite/enemies/'),l.url);
  }
  assert.ok(pc>=500,`${pc} computer loads`);
});

test('bootArt takes the computer copies only when asked (the fine pointer; node has no matchMedia: the phone)',async()=>{
  const answer=async()=>({ok:true,json:async()=>index});
  for(const pc of [undefined,false,true]){
    assert.equal(await bootArt({fetcher:answer,...(pc===undefined?{}:{pc})}),true);
    const id=Object.keys(enemies.pieces).find(k=>Object.values<any>(enemies.pieces[k].files).some(f=>f.pcCell))!;
    assert.equal(enemyPieceLoads(id).some(l=>l.url.includes('/enemies-pc/')),pc===true,String(pc));
  }
  setArtIndex(parseArtIndex({version:2,groups:{}}));
});
