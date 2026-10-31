/**
 * Card animacao-construir-6: a hero standing by an obra going up plays its build16 loop, facing it. Building never holds
 * the hero (the sim takes the order at once and the obra rises alone): this only picks what the drawing shows. The reach
 * is the sim's BUILD_REACH (src/sim/towers/system.ts), counted from the footprint's edge.
 */
import {isFreePiece,pieceCells} from '../../rules/index.ts';
import {MOVEMENT16_DURATION} from './movement128.ts';

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

/** How long (ms) a wall obra keeps the hero building after it is first seen: one build16 loop. */
export const PIECE_OBRA_MS=MOVEMENT16_DURATION.build;
export interface PieceLike {id:string;kind:string;phase?:string|undefined;c?:number|undefined;r?:number|undefined;rot?:number|undefined}
/**
 * NEW-20261031-ORQ-construir-andando-ate-a-obra: the wall pieces (muro, barricada) going up are obras too. The tower
 * feed (render/towers/tower-rules.ts TowerFeed) keeps only tower kinds, so a wall never was one, and its obra lasts 1 s
 * (rules FREE_PIECE_DEFS buildSeconds): a piece first seen in an obra phase stays one for a whole build16 loop.
 */
export class PieceObras {
  private readonly until=new Map<string,number>();
  /** The wall pieces in `structures` that count as obras at `now` (ms), on the build grid of `cell` u. */
  spots(structures:readonly PieceLike[],cell:number,now:number):ObraSpot[]{
    const out:ObraSpot[]=[],seen=new Set<string>();
    for(const s of structures){
      if(!isFreePiece(s.kind)||s.c===undefined||s.r===undefined)continue;
      seen.add(s.id);
      let end=this.until.get(s.id);
      if(end===undefined&&isObraPhase(s.phase))this.until.set(s.id,end=now+PIECE_OBRA_MS);
      if(!isObraPhase(s.phase)&&(end===undefined||now>=end))continue;
      const [w,h]=pieceCells(s.kind,s.rot===1?1:0);
      out.push({x:(s.c+w/2)*cell,y:(s.r+h/2)*cell,r:Math.max(w,h)*cell/2,half:[w*cell/2,h*cell/2]});
    }
    for(const id of this.until.keys())if(!seen.has(id))this.until.delete(id);
    return out;
  }
}
