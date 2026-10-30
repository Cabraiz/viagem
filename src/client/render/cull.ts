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

/**
 * The cap of critters drawn at once (Q3 slice 4, quality.ts enemyCap: Leve 150, Normal 300, Alta 3000). With more alive
 * than `cap`, marks in `out` the ones hidden: `dist2[i]` is critter i's squared distance to the hero, `keep[i]` one
 * always drawn (the boss, the target, an elite, a coach's ring), which counts against the cap; the nearest others fill
 * what is left, a tie going to the lower index. Returns how many are over. Allocation-free but for `order` growing.
 */
export function overCap(dist2:ArrayLike<number>,keep:ArrayLike<boolean>,cap:number,out:boolean[],order:number[]=[]):number{
  const n=dist2.length;out.length=n;out.fill(false);
  if(n<=cap)return 0;
  order.length=0;let kept=0;
  for(let i=0;i<n;i++)if(keep[i])kept++;else order.push(i);
  const room=Math.max(0,cap-kept);
  if(order.length<=room)return 0;
  order.sort((a,b)=>dist2[a]-dist2[b]||a-b);
  for(let j=room;j<order.length;j++)out[order[j]]=true;
  return order.length-room;
}
