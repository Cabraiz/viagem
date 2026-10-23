// NEW-20261013-ORQ-heroi-menor-inimigos-maiores: heroes draw ×0.8, enemies ×1.15; the zoom keeps the reference hero.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {HP_BAR_CSS,RING_CSS,RING_SCALE,ringSize} from '../../src/client/render/you-rules.ts';
import {anchorOf} from '../../src/client/framing.ts';
import {HERO_WORLD_PX} from '../../src/contract/offscreen.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const source=(path:string)=>readFileSync(fromRoot(path),'utf8');

test('draw factors: the heroes 20% smaller, the enemies 15% bigger',()=>{
  assert.equal(HERO_DRAW_SCALE,.8);
  assert.equal(ENEMY_DRAW_SCALE,1.15);
});

test('the camera centres the drawn (smaller) body; the zoom keeps the reference hero',()=>{
  const viewport={width:390,height:844},zoom=.58;
  const drawn={width:58*zoom*HERO_DRAW_SCALE,height:HERO_WORLD_PX*zoom*HERO_DRAW_SCALE};
  // Outside the lobby the body (half the drawn height above the feet) is the viewport centre (camera-centro-heroi).
  const a=anchorOf(viewport,zoom,undefined,drawn);
  assert.deepEqual(a,{x:viewport.width/2,y:viewport.height/2+drawn.height/2},'feet half the drawn body under the centre');
  const scene=source('src/client/scene.ts');
  assert.doesNotMatch(scene,/framedHeroSize/,'snap and step pass the drawn box');
  assert.doesNotMatch(source('src/client/camera-zoom.ts'),/HERO_DRAW_SCALE/,'the zoom does not read the draw factor');
});

test('the "você" ring and the mini bar shrink with the hero; the ring\'s bands and beak keep their CSS px',()=>{
  for(const s of [.5,1,1.6]){
    // A narrow figure: the CSS floor sets the ring, now × HERO_DRAW_SCALE.
    const before=ringSize(10,s),after=ringSize(10,s,HERO_DRAW_SCALE);
    assert.ok(Math.abs(after.w-before.w*HERO_DRAW_SCALE)<1e-9&&Math.abs(after.h-before.h*HERO_DRAW_SCALE)<1e-9);
    assert.ok(Math.abs(after.w-RING_CSS.width*s*HERO_DRAW_SCALE*RING_SCALE)<1e-9);
    // A wide figure (already drawn smaller): the figure sets it, as before.
    assert.deepEqual(ringSize(200,s,HERO_DRAW_SCALE),ringSize(200,s));
  }
  // The mini bar stays over the card's 28×4 CSS px minimum.
  assert.ok(HP_BAR_CSS.width*HERO_DRAW_SCALE>=28&&HP_BAR_CSS.height*HERO_DRAW_SCALE>=4);
  const you=source('src/client/render/you.ts');
  assert.match(you,/ringSize\(fig\.width,s,HERO_DRAW_SCALE\)/);
  assert.match(you,/HP_BAR_CSS\.width\*s\*HERO_DRAW_SCALE,bh=HP_BAR_CSS\.height\*s\*HERO_DRAW_SCALE/);
  assert.match(you,/RING_CSS\.beak\*s,RING_CSS\.beak\*\.6\*s/,'the beak keeps its CSS px');
});

test('wiring: one place per factor (hero sheets, enemy body), the hero\'s marks and the camera decoupled',()=>{
  const sprites=source('src/client/sprites/character-sprites.ts');
  assert.match(sprites,/const scale=sheet\.scale\*this\.viewScale\*HERO_DRAW_SCALE;/,'every hero sheet (self and allies) draws ×0.8');
  const layers=source('src/client/render/layers.ts');
  assert.match(layers,/this\.enemyBody=this\.body\*ENEMY_DRAW_SCALE;/);
  assert.match(layers,/size=a\.elite\?ELITE_SCALE:1,body=this\.enemyBody;/,'the enemy sprite, its art, Breu copy, shadow and target ring');
  assert.match(layers,/private barLift\(a:EnemyActor\)\{return [^}]*\*this\.enemyBody;\}/,'the bar rides on the bigger head');
  assert.match(layers,/drawDeathArt\([^)]*this\.enemyBody,d\.art[,)]/,'the death plays at the enemy\'s size');
  const scene=source('src/client/scene.ts');
  assert.match(scene,/private get heroScale\(\)\{return this\.actorScale\*HERO_DRAW_SCALE;\}/);
  assert.match(scene,/this\.ring\?\.setScale\(hero\);/,'the hero\'s ring follows the sprite (its shadow is the silhouette)');
  assert.match(scene,/const k=this\.heroScale;\n\s+if\(!objects\)/,'ally icon, ring, shadow and ficha offset follow the sprite');
  assert.match(scene,/size=\(enemy\.elite&&kind!=='chefe'\?ELITE_SCALE:1\)\*this\.actorScale\*ENEMY_DRAW_SCALE/,'a tap finds the bigger enemy where it is drawn');
});
