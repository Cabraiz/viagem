/**
 * The cast silhouette of every figure (enemies, hero, allies; card NEW-20261022-ORQ-sombra-silhueta). Pure (no Phaser).
 * The body's own frame, dark, flipped at the feet and laid on the ground away from the sun (light.ts: upper left, so
 * right-down), flattened: it follows the pose and what the body holds, frame by frame. It is the only shadow a figure
 * casts (the contact ellipse read as a "circle on the ground", 22/10), in every quality level.
 *
 * Enemies also get a contact shadow under the soles (card NEW-20261023-ORQ-inimigos-v5a-padrao, study V2): small, dark
 * and soft, darker than the figure, so the feet sit on the snow. The old one (Breu 38 %, hard edge) was lighter than the
 * body on the snow and read as a "circle"; the silhouette alone left the feet with no anchor (study V2b).
 */
import {SUN_VIEW} from './light.ts';
import type {EnemyFeet} from '../art/enemy-feet.ts';

/** Contact width: × the measured footing (a little wider than the feet), and never under this share of the kind's width. */
export const CONTACT_PAD=1.3,CONTACT_MIN=.35;
/**
 * Contact shadow width in screen px: the measured footing (`feet`, asleep = its lying one) × the cell's width on screen
 * × CONTACT_PAD, at least CONTACT_MIN × `fallback` (the kind's width) and at most `fallback`. No row: `fallback`.
 */
export function contactWidth(feet:EnemyFeet|undefined,asleep:boolean,cellScreenW:number,fallback:number):number{
  if(!feet||!(cellScreenW>0))return fallback;
  const foot=(asleep?feet.sleepW??feet.footW:feet.footW)*cellScreenW*CONTACT_PAD;
  return Math.min(fallback,Math.max(fallback*CONTACT_MIN,foot));
}
/**
 * The enemies' contact shadow (study V2): a radial Breu blot, `alpha` at the centre, soft to 0 at the edge, in a w×h
 * texture; drawn `width`× the contact width and `height`× it tall (flat on the ground, under the soles).
 */
export const CONTACT={w:64,h:24,color:[23,21,26] as const,alpha:.78,width:.95,height:.38} as const;

/** The silhouette: length on the ground over the figure's height, its opacity. */
export const SILHOUETTE={flatten:.38,alpha:.36} as const;
/**
 * Card sombras-e-fala-do-uno (auditoria-arte-mundo item 9): the enemies' silhouette in a neutral dark (the hero's dusky
 * blue read as a lilac "ghost" with a tail on the snow), shorter (`length` × the hero's) and fainter, so the contact
 * shadow at the soles is what reads.
 */
export const ENEMY_SILHOUETTE={color:0x17151a,length:.55,alpha:.22} as const;
/**
 * Item 3: the soft shadow of a vehicle (the Uno, the moto) instead of the old hard footprint box: an ellipse through the
 * footprint (`pad` × its half sides), soft to 0 at the rim, neutral dark at `alpha`, pushed (x, y) world px away from
 * the sun. `rings`: nested fills from rim to centre (alpha stacks, darkest inside); `sides`: each ring's polygon.
 */
export const SOFT_SHADOW={color:[23,21,26] as const,alpha:.62,pad:1.3,x:14,y:8,rings:7,sides:28} as const;
/**
 * The ellipse through conjugate semi-diameters (ax, ay) and (bx, by) (a rectangle's half sides seen on screen) as an
 * image's rotation and semi-axes: the eigen axes of a·aᵀ + b·bᵀ.
 */
export function conjugateEllipse(ax:number,ay:number,bx:number,by:number):{rx:number;ry:number;rotation:number}{
  const p=ax*ax+bx*bx,q=ax*ay+bx*by,r=ay*ay+by*by,m=(p+r)/2,d=Math.hypot((p-r)/2,q);
  return {rx:Math.sqrt(m+d),ry:Math.sqrt(Math.max(0,m-d)),rotation:.5*Math.atan2(2*q,p-r)};
}
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
