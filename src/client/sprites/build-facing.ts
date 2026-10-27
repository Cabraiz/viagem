/**
 * Card animacao-construir-6: a hero standing by an obra going up plays its build16 loop, facing it. Building never holds
 * the hero (the sim takes the order at once and the obra rises alone): this only picks what the drawing shows. The reach
 * is the sim's BUILD_REACH (src/sim/towers/system.ts), counted from the footprint's edge.
 */
export const BUILD_FACING_REACH=3;
/** An obra on the ground: its centre and footprint (a square site's half side, or the rail's half extents). */
export interface ObraSpot {x:number;y:number;r:number;half?:readonly [number,number]}
/** A defense's phase while it is being built (tower-rules.ts TowerPhase: obra-1..3). */
export const isObraPhase=(phase:string|undefined)=>!!phase&&phase.startsWith('obra');
/**
 * The world direction (unit) from `p` to the nearest obra within `reach` of its footprint's edge, undefined when none is.
 * Standing on the obra's centre it looks down the screen (+y).
 */
export function buildFacing(p:{x:number;y:number},obras:readonly ObraSpot[],reach=BUILD_FACING_REACH):{x:number;y:number}|undefined{
  let best:ObraSpot|undefined,bestD=Infinity;
  for(const o of obras){
    const hx=o.half?.[0]??o.r,hy=o.half?.[1]??o.r;
    const d=Math.hypot(Math.max(0,Math.abs(p.x-o.x)-hx),Math.max(0,Math.abs(p.y-o.y)-hy));
    if(d<=reach&&d<bestD){bestD=d;best=o;}
  }
  if(!best)return;
  const vx=best.x-p.x,vy=best.y-p.y,len=Math.hypot(vx,vy);
  return len>1e-6?{x:vx/len,y:vy/len}:{x:0,y:1};
}
