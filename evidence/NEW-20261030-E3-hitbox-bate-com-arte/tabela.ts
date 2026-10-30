// Table of hitbox-bate-com-arte: node --experimental-strip-types evidence/NEW-20261030-E3-hitbox-bate-com-arte/tabela.ts
// Same formula as tests/client/hitbox-bate-com-arte.test.ts, for main's draw scales and the escala card's (1.5/1.5).
import {RADIUS} from '../../src/maps/index.ts';
import {enemyDef} from '../../src/sim/enemies/catalog.ts';
import {HERO_DRAW_SCALE,ENEMY_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';
import {artTargetHeight} from '../../src/client/art/horde-art.ts';
import {CITY_VIEW_SCALE} from '../../src/client/framing.ts';
import {HERO_WORLD_PX,TILE_X} from '../../src/contract/index.ts';
const U=TILE_X*Math.SQRT2,V=CITY_VIEW_SCALE;
const heroes=[['viciado',26,22],['clt',24,19],['gato',46,32],['maromba',33,26],['vendedor',29,27],['aposentado',32,26]] as const;
const enemies=[['mendigo','bebado',153,98,70],['saci','aberracao-saci',133,137,49]] as const;
const pct=(d:number,w:number)=>`${Math.round(d/w*100)} %`;
for(const [label,hs,es] of [['main',HERO_DRAW_SCALE,ENEMY_DRAW_SCALE],['escala 1.5/1.5',1.5,1.5]] as const){
  console.log(`\n### ${label} (HERO_DRAW_SCALE ${hs}, ENEMY_DRAW_SCALE ${es})\n\n| quem | raio (u) | diâmetro (u) | tronco desenhado (u) | pé desenhado (u) | diâmetro/tronco | diâmetro/pé |\n|---|---|---|---|---|---|---|`);
  for(const [id,t,f] of heroes){const k=HERO_WORLD_PX/96*hs*V/U,d=2*RADIUS;console.log(`| ${id} | ${RADIUS} | ${d.toFixed(3)} | ${(t*k).toFixed(3)} | ${(f*k).toFixed(3)} | ${pct(d,t*k)} | ${pct(d,f*k)} |`);}
  for(const [id,body,h,t,f] of enemies){
    // The saci's height follows the hero's on screen (horde-art SACI_ON_SCREEN), the mendigo's ENEMY_DRAW_SCALE.
    const fig=id==='saci'?HERO_WORLD_PX*1.4*hs:artTargetHeight(body)*es,k=fig/h*V/U,r=enemyDef(body).radius,d=2*r;
    console.log(`| ${id} | ${r.toFixed(3)} | ${d.toFixed(3)} | ${(t*k).toFixed(3)} | ${(f*k).toFixed(3)} | ${pct(d,t*k)} | ${pct(d,f*k)} |`);
  }
  console.log('| sanfoneiro | — | — | sem arte na main | — | — | — |');
}
