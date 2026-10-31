/**
 * torres-ramo-a-postos (user's option B, 28/10): the 7 ramo A posts draw base and crew at the hero's size, not the
 * scenery's, so a soldier (RAMO_A_CREW_PX art px in the sheets) stands as tall as the hero drawn now. One parameter:
 * the scale follows HERO_DRAW_SCALE and the actor scale, whatever the map's scenery scale; every other defense keeps
 * towerArtScale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RAMO_A_CREW_PX,RAMO_A_POSTS,TOWER_LOOK,towerArtScale,towerKindScale,type TowerKind} from '../../src/client/render/towers/tower-rules.ts';
import {HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {HERO_FIGURE_PX} from '../../src/client/art/horde-art.ts';

test('the 7 posts: T1 and the 6 ramo A defenses, no other',()=>{
  const want=(Object.keys(TOWER_LOOK) as TowerKind[]).filter(k=>TOWER_LOOK[k].branch==='T'||TOWER_LOOK[k].branch==='A');
  assert.deepEqual([...RAMO_A_POSTS].sort(),want.sort());
  assert.equal(RAMO_A_POSTS.size,7);
});

test('a post soldier stands as tall as the hero, on any map and actor scale; the crewless gustavão keeps the scenery scale',()=>{
  for(const art of [towerArtScale(84),towerArtScale(84,1.496),towerArtScale(200,1.2)])for(const s of [1,.5445,2]){
    for(const k of RAMO_A_POSTS){
      const soldier=RAMO_A_CREW_PX*towerKindScale(k,art,s),hero=HERO_FIGURE_PX*s*HERO_DRAW_SCALE;
      assert.ok(Math.abs(soldier-hero)<1e-9,`${k}: soldier ${soldier} vs hero ${hero}`);
    }
    // Since 31/10 (kits-so-torres-boas) the B/C crews stand at the hero's size too (tower-crew-scale.test.ts).
    assert.equal(towerKindScale('gustavao',art,s),art,'gustavao');
  }
});

test('the posts shrink against the scenery in the Cidade Nevada (the soldier was ~3× the hero there)',()=>{
  // City: actor scale CITY_VIEW_SCALE ≈ 0.5445, a scenery art px ≈ 0.85 world px (1.496 u cells).
  const k=towerKindScale('ninho-de-metralhadora',.85,.5445)/.85;
  assert.ok(k>.28&&k<.38,`post / scenery scale ${k.toFixed(3)}`);
});
