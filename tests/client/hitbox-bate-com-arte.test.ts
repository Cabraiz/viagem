// hitbox-bate-com-arte (NEW-20261030-E3): the body circle of the 6 heroes and 3 enemies covers their drawing. Rule: the
// collision diameter is 60 %..110 % of the torso width as drawn in the city (the MVP map), both along screen x.
// The art's widths were measured once (evidence/NEW-20261030-E3-hitbox-bate-com-arte/medir.mjs: alpha ≥ 128, median
// over the idle frames, torso = rows at 45–60 % of the figure's height from the feet; arms and props count); the sheet's
// name (hero-feet table) or the file's sha pins them, so new art fails here until it is measured again.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RADIUS} from '../../src/maps/index.ts';
import {enemyDef} from '../../src/sim/enemies/catalog.ts';
import {HERO_DRAW_SCALE,ENEMY_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {artTargetHeight} from '../../src/client/art/horde-art.ts';
import {HERO_FEET} from '../../src/client/sprites/hero-feet-data.ts';
import {CITY_VIEW_SCALE} from '../../src/client/framing.ts';
import {HERO_WORLD_PX,TILE_X} from '../../src/contract/index.ts';

const BAND={min:.6,max:1.1};
/** World px of one unit along screen x (a body of radius r is 2·r·this wide on screen). */
const UNIT_PX=TILE_X*Math.SQRT2;

/** Hero idle (south) sheets: the cell maps to HERO_WORLD_PX × HERO_DRAW_SCALE (character-sprites 96/height). */
const HEROES=[
  {id:'viciado',sheet:'viciado-em-bet.idle16-s.ee01578e879c.webp',cell:96,torso:26},
  {id:'clt',sheet:'clt-cansado.idle16-s.c6aba328d725.webp',cell:96,torso:24},
  {id:'gato',sheet:'gato-nada-pra-comer.idle16-s.054f6df3e766.webp',cell:96,torso:46},
  {id:'maromba',sheet:'maromba.idle16-s.5d112d66dfd2.webp',cell:96,torso:33},
  {id:'vendedor',sheet:'vendedor-praia.idle16-s.92f9ba81ef42.webp',cell:96,torso:29},
  {id:'aposentado',sheet:'aposentado.idle16-s.f9f4da098fe1.webp',cell:96,torso:32},
] as const;
/**
 * Enemy idle sheets: the figure (feet to top, `figure` cell px) stands artTargetHeight × ENEMY_DRAW_SCALE (horde-art
 * drawnScale). The mendigo is every common enemy's drawing (art/mendigo.ts), on the bêbado's body.
 */
const ENEMIES=[
  {id:'mendigo',body:'bebado',art:'bebado',file:'public/art/enemies/mendigo/idle.webp',sha:'a75be4447f6d',figure:153,torso:98},
  {id:'saci',body:'aberracao-saci',art:'aberracao-saci',file:'public/art/enemies/saci/idle.webp',sha:'93d7724f1986',figure:133,torso:137},
] as const;
/** No art on main yet: measured when it lands. */
const NO_ART=['sanfoneiro'];
/** Out of the band today; the card carries the proposed number. Fixing it makes this test fail: drop the line then. */
const ESCALA='NEW-20261028-ORQ-escala-heroi-uno-inimigo',RAIO='NEW-20261030-E3-raio-heroi-pos-escala';
const OUT:Readonly<Record<string,string>>={viciado:RAIO,clt:RAIO,vendedor:RAIO,gato:ESCALA,maromba:ESCALA,aposentado:ESCALA,mendigo:ESCALA,saci:ESCALA};

const heroTorsoUnits=(h:typeof HEROES[number])=>h.torso*HERO_WORLD_PX/h.cell*HERO_DRAW_SCALE*CITY_VIEW_SCALE/UNIT_PX;
const enemyTorsoUnits=(e:typeof ENEMIES[number])=>e.torso/e.figure*artTargetHeight(e.art)*ENEMY_DRAW_SCALE*CITY_VIEW_SCALE/UNIT_PX;
const rows=[
  ...HEROES.map(h=>({id:h.id,diameter:2*RADIUS,torso:heroTorsoUnits(h)})),
  ...ENEMIES.map(e=>({id:e.id,diameter:2*enemyDef(e.body).radius,torso:enemyTorsoUnits(e)})),
];

test('the measured sheets are the ones the game draws (re-measure on new art)',()=>{
  for(const h of HEROES)assert.ok(Object.hasOwn(HERO_FEET,h.sheet),`${h.id}: ${h.sheet} left the hero-feet table: measure the new sheet`);
  for(const e of ENEMIES){
    const sha=createHash('sha256').update(readFileSync(e.file)).digest('hex');
    assert.ok(sha.startsWith(e.sha),`${e.id}: ${e.file} changed (${sha.slice(0,12)}): measure it again`);
  }
});

test('every hero and enemy of the cast is measured or waiting for its art',()=>{
  assert.deepEqual([...rows.map(r=>r.id),...NO_ART].sort(),['aposentado','clt','gato','maromba','mendigo','saci','sanfoneiro','vendedor','viciado']);
});

test('the body diameter is 60 %..110 % of the drawn torso width',()=>{
  for(const r of rows){
    const k=r.diameter/r.torso,inside=k>=BAND.min&&k<=BAND.max,pct=`${Math.round(k*100)} %`;
    if(OUT[r.id])assert.ok(!inside,`${r.id} is in the band now (${pct}): remove it from OUT (${OUT[r.id]})`);
    else assert.ok(inside,`${r.id}: diameter ${r.diameter.toFixed(3)} u over torso ${r.torso.toFixed(3)} u = ${pct}`);
  }
});
