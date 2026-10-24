/**
 * NEW-20261023-ORQ-barracas-no-caminho: the barracas' slow in the phone's replay. The room walks a hero whose body is on
 * a barraca at BARRACA_HERO_SLOW × the step (sim/towers/free-build.ts heroSlow, from where the step starts); the replay
 * does the same over the barracas the latest frame carries (their c/r and rot), so walking through a row never snaps back.
 */
import {CITY_BUILD_CELL,RADIUS,slowAmong,type Point} from '../../maps/index.ts';
import {BARRACA_HERO_SLOW,pieceCells} from '../../rules/index.ts';

export const BARRACA_KIND='barraca';
interface Piece {kind:string;hp:number;c?:number;r?:number;rot?:number}

/** The footprints (u) of the standing barracas among `structures`. */
export function barracaRects(structures:readonly Piece[],cell=CITY_BUILD_CELL){
  const out:{x:number;y:number;w:number;h:number}[]=[];
  for(const s of structures){
    if(s.kind!==BARRACA_KIND||!(s.hp>0)||s.c===undefined||s.r===undefined)continue;
    const [w,h]=pieceCells('barraca',s.rot===1?1:0);
    out.push({x:s.c*cell,y:s.r*cell,w:w*cell,h:h*cell});
  }
  return out;
}
/** The replay's step multiplier (maps MoveClock.slow) over these structures; undefined without a barraca. */
export function barracaSlow(structures:readonly Piece[]):((at:Point)=>number)|undefined{
  const rects=barracaRects(structures);
  return rects.length?at=>slowAmong(rects,at,BARRACA_HERO_SLOW,RADIUS):undefined;
}
