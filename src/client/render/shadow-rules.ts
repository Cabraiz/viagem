/**
 * Contact and silhouette shadows of the horde (BUG-20261017-ORQ-sombra-longe-personagem-pequeno). Pure (no Phaser).
 *  - Contact: an ellipse at the feet, as wide as what touches the ground (art/enemy-feet.ts, measured from the art's
 *    alpha by scripts/sombra-estudo.mjs), the lying footing while asleep; the old width (the kind's) without a table row.
 *  - Silhouette: the body's own frame, dark, flipped at the feet and laid on the ground away from the sun (light.ts:
 *    upper left, so right-down), flattened: it follows the pose and what the body holds, frame by frame.
 */
import {SUN_VIEW} from './light.ts';
import type {EnemyFeet} from '../art/enemy-feet.ts';

/** Contact ellipse: × the measured footing (a little wider than the feet), and never under this share of the old width. */
export const CONTACT_PAD=1.3,CONTACT_MIN=.35;
/**
 * Contact shadow width in screen px: the measured footing (`feet`, asleep = its lying one) × the cell's width on screen
 * × CONTACT_PAD, at least CONTACT_MIN × `fallback` (the kind's width, what it was) and at most `fallback`.
 * No row: `fallback`.
 */
export function contactWidth(feet:EnemyFeet|undefined,asleep:boolean,cellScreenW:number,fallback:number):number{
  if(!feet||!(cellScreenW>0))return fallback;
  const foot=(asleep?feet.sleepW??feet.footW:feet.footW)*cellScreenW*CONTACT_PAD;
  return Math.min(fallback,Math.max(fallback*CONTACT_MIN,foot));
}
/** The silhouette: length on the ground over the figure's height, its opacity. */
export const SILHOUETTE={flatten:.45,alpha:.3} as const;
/** Screen direction a shadow falls (unit, away from the sun: right and down). */
export const SHADOW_DIR=(()=>{const l=Math.hypot(SUN_VIEW[0],SUN_VIEW[1]);return {x:-SUN_VIEW[0]/l,y:-SUN_VIEW[1]/l};})();
/**
 * Rotation (rad) of a silhouette drawn flipped at the feet (scaleY < 0: the figure hangs DOWN from its origin) so its
 * length lies along SHADOW_DIR: the flipped up axis (0, 1) turned onto it.
 */
export const SILHOUETTE_ROTATION=Math.atan2(SHADOW_DIR.y,SHADOW_DIR.x)-Math.PI/2;
/**
 * Where a point drawn at (dx, dy) screen px from the feet (dy < 0: above) falls in its body's silhouette: flipped at the
 * feet, flattened, turned by SILHOUETTE_ROTATION. For a piece drawn apart from the frame (the weapon in the hand).
 */
export function castOffset(dx:number,dy:number,out:{x:number;y:number}={x:0,y:0}){
  const c=Math.cos(SILHOUETTE_ROTATION),s=Math.sin(SILHOUETTE_ROTATION),y=-dy*SILHOUETTE.flatten;
  out.x=dx*c-y*s;out.y=dx*s+y*c;return out;
}
