/**
 * One art's own height × the hero's, over its role's (art/horde-art.ts artTargetHeight reads it; kept here so horde-art
 * does not grow). Each entry is the figure × the hero as drawn on screen, so it folds out the enemies' ENEMY_DRAW_SCALE
 * over the heroes' HERO_DRAW_SCALE (render/draw-scale.ts).
 *  - aberração-saci: 1.4 (card saci-elite-no-jogo, the user: "E as proporções"); card saci-chefe-2x (the user, 30/10:
 *    "ponha o saci 2x"): the chefão now, 2.8, body (SACI_BOSS.size) too.
 *  - sanfoneiro: the wooden toy arrasta-pé, a common enemy (role corredor, whose 0.9 would make him smaller than the
 *    hero) drawn 1.5× the hero (card sanfoneiro-brinquedo-no-jogo, ORQ 31/10), between the hero and the saci.
 */
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from '../render/draw-scale.ts';

export const SACI_ON_SCREEN=2.8;
export const SANFONEIRO_ON_SCREEN=1.5;
const onScreen=(k:number)=>k*HERO_DRAW_SCALE/ENEMY_DRAW_SCALE;
export const ART_HEIGHT:Readonly<Record<string,number>>={
  'aberracao-saci':onScreen(SACI_ON_SCREEN),
  sanfoneiro:onScreen(SANFONEIRO_ON_SCREEN),
};
