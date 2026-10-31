/**
 * NEW-20261031-ORQ-kits-so-torres-boas part 3 (P0): the ninho and the obuseiro stood ~3× the hero in obra and fantasma.
 * Every crewed defense draws at the hero's size (CREW_PX × towerKindScale = the hero), and fantasma, obra and pronta
 * draw the same base sheet at that one scale, so a tower keeps its size from the ghost to the finished post.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TOWER_KINDS,towerArtScale,towerKindScale,type TowerKind} from '../../src/client/render/towers/tower-rules.ts';
import {CREW_PX} from '../../src/client/render/towers/tower-crew.ts';
import {HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {HERO_FIGURE_PX} from '../../src/client/art/horde-art.ts';

const src=(f:string)=>readFileSync(new URL(`../../src/client/render/towers/${f}`,import.meta.url),'utf8');

test('every defense but the crewless gustavão has a crew ruler',()=>{
  assert.deepEqual(TOWER_KINDS.filter(k=>!CREW_PX[k]),['gustavao']);
  for(const k of TOWER_KINDS)if(CREW_PX[k])assert.ok(CREW_PX[k]!>60&&CREW_PX[k]!<200,`${k} ${CREW_PX[k]}`);
});

test('a soldier of every crewed tower stands as tall as the hero, on any map and actor scale',()=>{
  for(const art of [towerArtScale(84),towerArtScale(84,1.496),towerArtScale(200,1.2)])for(const s of [1,.5445,2]){
    const hero=HERO_FIGURE_PX*s*HERO_DRAW_SCALE;
    for(const k of TOWER_KINDS){
      if(!CREW_PX[k])continue;
      const soldier=CREW_PX[k]!*towerKindScale(k,art,s);
      assert.ok(Math.abs(soldier-hero)<1e-9,`${k}: soldier ${soldier} vs hero ${hero}`);
    }
  }
});

test('the obuseiro no longer stands ~3× the hero in the Cidade Nevada (scenery art px ≈ 0.85 world px, actor .5445)',()=>{
  const k=towerKindScale('obuseiro' as TowerKind,.85,.5445)/.85;
  assert.ok(k>.2&&k<.45,`obuseiro / scenery scale ${k.toFixed(3)}`);
});

test('fantasma, obra and pronta: one base sheet at one scale (kindScale ÷ textureRatio), weapon and mount alike',()=>{
  const towers=src('towers.ts'),draw=src('tower-draw.ts');
  const ghost=towers.slice(towers.indexOf('setGhost('));
  assert.match(ghost.slice(0,1200),/setTexture\(towerBaseKey\(g\.kind\)\)[\s\S]*?setScale\(this\.kindScale\(g\.kind\)\/textureRatio\(file\)\)/,'fantasma');
  const place=draw.slice(draw.indexOf('protected placeArt('));
  // placeArt draws every phase (obra-1..3, pronta, danificada, ruina) from the same base texture and scale.
  assert.match(place.slice(0,900),/const scale=this\.kindScale\(t\.view\.kind\)[\s\S]*?setTexture\(towerBaseKey\(t\.view\.kind\)\)[\s\S]*?setScale\(scale\/textureRatio\(file\)\)[\s\S]*?baseFrame\(t\.phase,/,'obra and pronta');
  assert.match(place.slice(0,900),/art\.mount\[0\]-anchor\[0\]\*file\.cell\[0\]\)\*scale/,'mount');
  assert.match(draw,/setScale\(this\.kindScale\(t\.view\.kind\)\/textureRatio\(file\)\)\.setFrame\(weaponFrame/,'weapon');
});
