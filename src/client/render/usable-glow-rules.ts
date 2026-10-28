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
/**
 * One ring of offset copies: radius (CSS px from the figure's edge), colour, depth under the sprite; `dirs` which of the
 * 8 directions it uses (default all; a shot uses 4 per band, half the copies: it is small and moving).
 */
export interface GlowBand {css:number;color:number;depth:number;dirs?:readonly number[]}
const AXES=Object.freeze([0,2,4,6]),DIAGONALS=Object.freeze([1,3,5,7]),ALL=Object.freeze([0,1,2,3,4,5,6,7]);
/** The directions (indices into OUTLINE_DIRS) a band uses. */
export const bandDirs=(band:GlowBand):readonly number[]=>band.dirs??ALL;
/** Breu #1E1530 (the city's ring colour). */
export const GLOW_BREU=0x1e1530;
/** The glow of usable things: gold 2.5 CSS px, then Breu to 3.5 CSS px (drawn first, farther under). */
export const GLOW_BANDS:readonly GlowBand[]=Object.freeze([
  {css:3.5,color:GLOW_BREU,depth:-.0006},
  {css:2.5,color:INTERATIVO_COR,depth:-.0004},
]);
/**
 * Items and crate stickers on the ground (card NEW-20261028-ORQ-escala-heroi-uno-inimigo, auditoria-arte-mundo item 13):
 * a thin gold and Breu line, so a small item does not read as a HUD icon dropped on the map; the pulse still calls.
 */
export const ITEM_BANDS:readonly GlowBand[]=Object.freeze([
  {css:2,color:GLOW_BREU,depth:-.0006},
  {css:1.25,color:INTERATIVO_COR,depth:-.0004},
]);
/**
 * The shot: the same gold and Breu, thinner (a bullet is a few px; the full glow would swallow it), 4 directions per band
 * (Breu on the diagonals, gold on the axes): 8 copies a bullet, not 16 (measured: shots are most of the glows in a fight).
 */
export const SHOT_BANDS:readonly GlowBand[]=Object.freeze([
  {css:2.5,color:GLOW_BREU,depth:-.0006,dirs:DIAGONALS},
  {css:1.5,color:INTERATIVO_COR,depth:-.0004,dirs:AXES},
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
/** Copies per glow (each band's directions). */
export const copiesOf=(bands:readonly GlowBand[])=>bands.reduce((n,b)=>n+bandDirs(b).length,0);
/** Band and direction of copy `i` of a glow: bands in order, each over its own directions. */
export function copySlot(bands:readonly GlowBand[],i:number,out:{band:number;dir:number}={band:0,dir:0}){
  for(let b=0;b<bands.length;b++){const d=bandDirs(bands[b]);if(i<d.length){out.band=b;out.dir=d[i];return out;}i-=d.length;}
  out.band=bands.length-1;out.dir=0;return out;
}
