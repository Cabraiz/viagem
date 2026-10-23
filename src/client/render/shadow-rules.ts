/**
 * The cast silhouette of every figure (enemies, hero, allies; card NEW-20261022-ORQ-sombra-silhueta). Pure (no Phaser).
 * The body's own frame, dark, flipped at the feet and laid on the ground away from the sun (light.ts: upper left, so
 * right-down), flattened: it follows the pose and what the body holds, frame by frame. It is the only shadow a figure
 * casts (the contact ellipse read as a "circle on the ground", 22/10), in every quality level.
 */
import {SUN_VIEW} from './light.ts';

/** The silhouette: length on the ground over the figure's height, its opacity. */
export const SILHOUETTE={flatten:.38,alpha:.36} as const;
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
