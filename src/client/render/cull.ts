/**
 * Culling of the horde off camera (estudo-desempenho §3.3, F2): Phaser does not cull Image/Sprite under WebGL, so a
 * critter off screen cost as much as one on it. The renderer skips everything but its position for the ones outside
 * the camera's view plus a margin, and shows them again as they come back.
 */

/** The camera's world view (Phaser's cameras.main.worldView), in world px. */
export interface ViewRect{x:number;y:number;right:number;bottom:number}

/** Margin around the view, in CSS px (× the world px per CSS px): a critter walking in is drawn before it shows. */
export const CULL_MARGIN_CSS=96;

/**
 * Whether a figure standing at (x, feetY) in world px, `halfWidth` to each side and `height` above its feet, touches
 * the view grown by `margin` on every side. Under the feet only the margin counts (the shadow is flat on the ground).
 */
export function inView(v:ViewRect,x:number,feetY:number,halfWidth:number,height:number,margin:number):boolean{
  return x+halfWidth+margin>=v.x&&x-halfWidth-margin<=v.right&&feetY+margin>=v.y&&feetY-height-margin<=v.bottom;
}
