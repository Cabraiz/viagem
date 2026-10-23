/**
 * Usable glow, pure rules (card NEW-20261023-ORQ-contorno-usavel-wc3). The user: "contorno chamativo que nem Warcraft 3
 * [...] para a galera saber que dá para usar". Everything the player can use or pick up (barricades, loot crates,
 * towers and their obra, the car, arsenal items and crates on the ground) and the player's own shot wear the same
 * bright outline: INTERATIVO_COR (Warcraft 3's interactive gold, already the hover outline of the barricada squares)
 * hugging the figure, a thin Breu band outside it so the gold holds on the snow, pulsing gently (fixed with reduced
 * motion). Measured on SCREEN (CSS px), so it reads the same at every zoom.
 *
 * Pure (no Phaser): render/usable-glow.ts draws it as tint-filled copies of the sprite offset in 8 directions (the
 * hero sticker's technique, you.ts): same texture as the sprite, so they batch with it and cost no build at load.
 */
import {INTERATIVO_COR} from '../hud/tralha/model.ts';
import {OUTLINE_DIRS} from './you-rules.ts';

export {OUTLINE_DIRS};
/** One ring of offset copies: radius (CSS px from the figure's edge), colour, depth under the sprite. */
export interface GlowBand {css:number;color:number;depth:number}
/** Breu #1E1530 (the city's ring colour). */
export const GLOW_BREU=0x1e1530;
/** The glow of usable things: gold 2.5 CSS px, then Breu to 3.5 CSS px (drawn first, farther under). */
export const GLOW_BANDS:readonly GlowBand[]=Object.freeze([
  {css:3.5,color:GLOW_BREU,depth:-.0006},
  {css:2.5,color:INTERATIVO_COR,depth:-.0004},
]);
/** The shot: the same gold and Breu, thinner (a bullet is a few px; the full glow would swallow it). */
export const SHOT_BANDS:readonly GlowBand[]=Object.freeze([
  {css:2.5,color:GLOW_BREU,depth:-.0006},
  {css:1.5,color:INTERATIVO_COR,depth:-.0004},
]);
/** One pulse a second, like Warcraft 3's highlighted items. */
export const GLOW_PERIOD_MS=1000;
/** The gold's opacity swings between these (the Breu band stays solid: the contrast never drops on the snow). */
export const GLOW_MIN=.55,GLOW_MAX=1;
/** Gold opacity at renderer time `now` (ms); reduced motion: steady at GLOW_MAX. */
export function glowAlpha(now:number,reduced:boolean):number{
  if(reduced||!Number.isFinite(now))return GLOW_MAX;
  const t=.5+.5*Math.sin(now/GLOW_PERIOD_MS*Math.PI*2);
  return GLOW_MIN+(GLOW_MAX-GLOW_MIN)*t;
}
/** Copies per glow (8 directions per band). */
export const copiesOf=(bands:readonly GlowBand[])=>bands.length*OUTLINE_DIRS.length;
