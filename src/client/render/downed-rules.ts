/**
 * Pure geometry of the caído's ring in the world (UX-resgate-e-ping), no Phaser, so node tests run it.
 */
import {REVIVE_RADIUS} from '../../sim/revive.ts';

export interface Pt {x:number;y:number}
export interface DownedMark {id:string;at:Pt;progress:number}
/** Ground ring points (world units) around a caído, starting at the top of the screen in the current view. */
export const RING_STEPS=40;
/**
 * The ring's points on the ground, as world points, in screen order (clockwise on screen) starting from the point
 * that is highest on screen. `screenAngle(i)` of the view maps a step to the world angle: on screen the ring's top
 * is the world direction (-1,-1) rotated back by the view (projection.ts: up on screen = −x −y after the view turn).
 */
export function ringPoints(at:Pt,view:number,radius=REVIVE_RADIUS,steps=RING_STEPS):Pt[]{
  // Up on screen is world (-1,-1)/√2 in view 0; each view turns the world by 90° (rotateVector), so turn back.
  const base=Math.atan2(-1,-1)-((view%4+4)%4)*Math.PI/2;
  return Array.from({length:steps+1},(_,i)=>{const a=base+i/steps*Math.PI*2;return {x:at.x+Math.cos(a)*radius,y:at.y+Math.sin(a)*radius};});
}
/** The first `progress` share of the ring (at least 2 points when there is any progress). */
export function progressPoints(points:readonly Pt[],progress:number):Pt[]{
  const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
  if(p<=0)return [];
  const n=Math.max(2,Math.round(p*(points.length-1))+1);
  return points.slice(0,n);
}
/** Light column over a caído, world px on screen (height above the feet and width). */
export const COLUMN={height:150,width:22};

