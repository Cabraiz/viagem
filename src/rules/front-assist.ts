/**
 * NEW-20261031-ORQ-tiro-rapido-e-local (the user: "se eu olho para o inimigo e não estou 100 % de frente, mas uns 80 %, o
 * tiro sai levemente torto para ele"; "só na sua frente para não parecer estranho atirar nas costas"): the aim assist of
 * a person's attack, pure so the sim's weapons (sim/weapons/system.ts freeAim) and the client's focus (the 4 red
 * arrows, the shot drawn on the press) pick alike.
 *
 * Only enemies within ±FRONT_HALF of the front and in reach count. The best is the nearest the front line: score =
 * angle / FRONT_HALF + FRONT_DISTANCE_WEIGHT × distance / reach (lower wins; the angle weighs more), ties by id. The
 * current focus (`current`) stays first unless another scores FRONT_KEEP_MARGIN lower, so two critters side by side do
 * not flicker. Nobody in the cone: an empty list (the shot flies straight ahead; never behind nor to the side).
 */
import type {Point} from '../contract/index.ts';

/** Half-angle of the front cone (rad): ±35°, the user's "80 %". */
export const FRONT_HALF=35*Math.PI/180;
/** How much the distance (as a fraction of the reach) weighs against the angle (as a fraction of FRONT_HALF). */
export const FRONT_DISTANCE_WEIGHT=.3;
/** Another enemy takes the current focus's place only when it scores this much lower. */
export const FRONT_KEEP_MARGIN=.15;

export interface FrontCandidate extends Point {id:string;radius?:number}
export interface FrontPick<T> {e:T;angle:number;d:number;score:number}

/**
 * The candidates inside the cone around `dir` from `from` and within `reach` (plus their radius with `pad`), best
 * first. The caller hands live enemies only; this never queries.
 */
export function frontAssist<T extends FrontCandidate>(from:Point,dir:Point,reach:number,candidates:Iterable<T>,o:{current?:string;pad?:boolean}={}):FrontPick<T>[]{
  const len=Math.hypot(dir.x,dir.y),ux=len>1e-9?dir.x/len:1,uy=len>1e-9?dir.y/len:0,r=Math.max(reach,1e-9);
  const out:FrontPick<T>[]=[];
  for(const e of candidates){
    const dx=e.x-from.x,dy=e.y-from.y,d=Math.hypot(dx,dy);
    if(d>reach+(o.pad?e.radius??0:0))continue;
    const angle=d>1e-9?Math.acos(Math.max(-1,Math.min(1,(dx*ux+dy*uy)/d))):0;
    if(angle>FRONT_HALF)continue;
    out.push({e,angle,d,score:angle/FRONT_HALF+FRONT_DISTANCE_WEIGHT*Math.min(d,r)/r});
  }
  out.sort((p,q)=>p.score-q.score||(p.e.id<q.e.id?-1:p.e.id>q.e.id?1:0));
  const i=o.current===undefined?-1:out.findIndex(p=>p.e.id===o.current);
  if(i>0&&out[i].score-out[0].score<FRONT_KEEP_MARGIN)out.unshift(...out.splice(i,1));
  return out;
}
