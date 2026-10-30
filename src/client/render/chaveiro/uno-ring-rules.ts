/**
 * Card legivel-uno-e-inimigo-na-rocha (parte 1): the Uno's own marker on the ground, in the hero ring's idiom (hard bands
 * Breu inside / colour / Papel outside, a Breu edge in the city, and a beak), so it is found in a second in the middle of
 * the group on a phone. Its colour is Cartolina: the Lilás is the hero's ("você"), the Breu the allies', the Amarelo is
 * "touch", the Cone is danger. The ellipse runs through the car's footprint (like its soft shadow), the beak points
 * where the nose points. Pure module (no Phaser) so node tests pin it down; the renderer draws it in one Graphics.
 */
import {isoOffset} from './iso.ts';
import {conjugateEllipse} from '../shadow-rules.ts';
import {RING_CSS,ringBands,type RingBand} from '../you-rules.ts';

/** The ring's colour token, and how far out of the footprint's half sides (× pad) the ellipse runs: past √2, so round
 * the footprint's corners too (the shadow's is 1.3). */
export const UNO_RING={token:'--c-cartolina',pad:1.5} as const;
/** Over the car's soft shadow (the ground Graphics, −9979), under the parts lying on the ground (−9978.999) and every figure. */
export const UNO_RING_DEPTH=-9978.9995;

/** The ring's ellipse on screen (world px, around the car's centre): semi-axes and rotation, for a footprint hl × hw. */
export function unoRingEllipse(hl:number,hw:number,heading:number,view:number){
  const c=Math.cos(heading),s=Math.sin(heading),a=isoOffset(hl*c,hl*s,0,view),b=isoOffset(-hw*s,hw*c,0,view),p=UNO_RING.pad;
  return conjugateEllipse(a.x*p,a.y*p,b.x*p,b.y*p);
}

/**
 * The parametric angle (the `angle` of you-rules beakPoints, in the ellipse's own frame) of the point where the nose's
 * screen direction leaves an ellipse rx × ry turned by `rotation`.
 */
export function unoBeakAngle(rx:number,ry:number,rotation:number,heading:number,view:number){
  const n=isoOffset(Math.cos(heading),Math.sin(heading),0,view),local=Math.atan2(n.y,n.x)-rotation;
  return Math.atan2(rx*Math.sin(local),ry*Math.cos(local));
}

/** The bands (CSS px, outer to inner, each with its colour), the hero's in the city: Breu edge, Papel, colour, Breu. */
export function unoRingBands():{band:RingBand;color:'breu'|'papel'|'cor'}[]{
  const b=ringBands(true);
  return [{band:b.outer!,color:'breu'},{band:b.papel,color:'papel'},{band:b.voce,color:'cor'},{band:b.breu,color:'breu'}];
}
/** The beak's tip length and base half-width (CSS px): the hero's. */
export const UNO_BEAK={length:RING_CSS.beak,half:RING_CSS.beak*.6,papel:RING_CSS.papel} as const;

/** Shown while the run is on: the end (the trunk, the wreck) has nothing left to find. */
export const unoRingShown=(view:{ended?:unknown}|undefined)=>!!view&&!view.ended;

/** The drawn ring changes only with its shape: the heading step, the camera's view and its zoom (CSS px → world px). */
export const unoRingKey=(step:number,view:number,k:number)=>`${step}|${view}|${Math.round(k*100)}`;
