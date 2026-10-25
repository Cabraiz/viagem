/**
 * D-052 slice 4 (card NEW-20261016-ORQ-carro-e-fortificacao-livre, render), pure rules kept apart from Phaser so node
 * tests import them. Placeholder look until the art arrives (fortify.ts draws boxes).
 * - The build grid (maps/build-sites.ts CITY_BUILD_CELL, origin 0,0 of the city; contract/build.ts): a piece's footprint
 *   in cells (a defense from the catalog, the wall and the barricade 1×1 (rules FREE_PIECE_DEFS); rot 1 turns it H×W), the top-left cell that
 *   centres it under a point (the finger, the mouse) and its rectangle back in world u.
 * - The ghost before the room answers: red when it is clearly refused here (too close to the car, to a living nest, or
 *   over a piece already standing); green otherwise. 'tranca' and 'fora' need the sim's flow field and walk mesh: the
 *   room's refusal (ghostLook's `answer`) paints those red.
 * - Hints (proposal §2): the old fixed build sites become a faint ghost on the 3 free ones nearest to the car.
 * - The rope (contract: car.rope; card puxar-uno-corda): tied to the car's FRONT bumper, from there to the hands of the
 *   hero holding it, or lying on the ground ahead (ropeRest) while nobody does, sagging with the
 *   slack left of CAR_ROPE.
 * The fields are read by shape (c/r/rot on the structures, car.rope) so this works before and after the contract lands.
 */
import {CAR_RADIUS,CAR_ROPE,CAR_ROPE_REST,type FreeBuildRefusal} from '../../contract/index.ts';
import {DEFENSES,FREE_PIECE_DEFS,type DefenseId} from '../../rules/index.ts';

/** How close to a living nest nothing is built (proposal §2; the room refuses with 'ninho'). */
export const NEST_BUILD_KEEP_OUT=6;
/** Faint hints shown around the car. */
export const HINTS_MAX=3;

export interface CellRect {c:number;r:number;w:number;h:number;x0:number;y0:number;x1:number;y1:number;cx:number;cy:number}
/** What the renderer reads of a snapshot structure (StructureView by shape). */
export interface FortStructure {id:string;kind:string;x:number;y:number;hp:number;c?:number;r?:number;rot?:number}

const isDefense=(kind:string):kind is DefenseId=>Object.prototype.hasOwnProperty.call(DEFENSES,kind);
/** A kind the free build places on the grid: a defense, a wall segment, a barricade or a barraca. */
export const isGridPiece=(kind:string)=>kind==='muro'||kind==='barricada'||kind==='barraca'||isDefense(kind);

/** Footprint in cells [w,h] of a piece (rot 1 swaps them); unknown kinds take one cell. */
export function footprintCells(piece:string,rot?:number):[number,number]{
  const [w,h]=piece==='barricada'||piece==='muro'||piece==='barraca'?FREE_PIECE_DEFS[piece].footprint:isDefense(piece)?DEFENSES[piece].footprint:[1,1];
  return rot===1?[h,w]:[w,h];
}
/** The piece's rectangle from its top-left cell (world u). */
export function cellRect(c:number,r:number,w:number,h:number,cell:number):CellRect{
  const x0=c*cell,y0=r*cell,x1=(c+w)*cell,y1=(r+h)*cell;
  return {c,r,w,h,x0,y0,x1,y1,cx:(x0+x1)/2,cy:(y0+y1)/2};
}
/** The top-left cell that centres a w×h footprint under the world point (x,y). */
export function cellUnder(x:number,y:number,w:number,h:number,cell:number){
  return {c:Math.round(x/cell-w/2),r:Math.round(y/cell-h/2)};
}
/** Distance from a point to a rectangle (0 inside). */
export function distToRect(x:number,y:number,b:{x0:number;y0:number;x1:number;y1:number}){
  const dx=Math.max(b.x0-x,0,x-b.x1),dy=Math.max(b.y0-y,0,y-b.y1);
  return Math.hypot(dx,dy);
}
const overlaps=(a:CellRect,b:CellRect)=>a.c<b.c+b.w&&b.c<a.c+a.w&&a.r<b.r+b.h&&b.r<a.r+a.h;
/** A standing structure's cells: its c/r when the room sends them, else its footprint centred on x,y. */
export function structureRect(s:FortStructure,cell:number):CellRect|undefined{
  if(!isGridPiece(s.kind))return undefined;
  const [w,h]=footprintCells(s.kind,s.rot);
  const at=s.c!==undefined&&s.r!==undefined?{c:s.c,r:s.r}:cellUnder(s.x,s.y,w,h,cell);
  return cellRect(at.c,at.r,w,h,cell);
}

export interface GhostContext {cell:number;car?:{x:number;y:number};structures:readonly FortStructure[]}
/** What the client already knows refuses the piece at this rectangle (the room decides; see the header). */
export function ghostRefusal(rect:CellRect,ctx:GhostContext):FreeBuildRefusal|undefined{
  if(ctx.car&&distToRect(ctx.car.x,ctx.car.y,rect)<CAR_RADIUS)return 'carro';
  for(const s of ctx.structures){
    if(s.kind==='ninho'&&s.hp>0&&distToRect(s.x,s.y,rect)<NEST_BUILD_KEEP_OUT)return 'ninho';
    const other=structureRect(s,ctx.cell);
    if(other&&s.hp>0&&overlaps(rect,other))return 'ocupado';
  }
  return undefined;
}
export type GhostLook='ok'|'bloqueado';
/** The ghost's colour: the room's answer for this very cell wins, else the local check. */
export function ghostLook(local:FreeBuildRefusal|undefined,answer?:{ok:boolean}):GhostLook{
  if(answer)return answer.ok?'ok':'bloqueado';
  return local?'bloqueado':'ok';
}

/** The faint hints: the `n` sites nearest to the car where this piece fits now (centred on each site). */
export function buildHints(piece:string,sites:readonly {x:number;y:number}[],ctx:GhostContext,n=HINTS_MAX):CellRect[]{
  if(!ctx.car)return [];
  const car=ctx.car,[w,h]=footprintCells(piece);
  const sorted=[...sites].sort((a,b)=>Math.hypot(a.x-car.x,a.y-car.y)-Math.hypot(b.x-car.x,b.y-car.y));
  const out:CellRect[]=[];
  for(const s of sorted){
    if(out.length>=n)break;
    const at=cellUnder(s.x,s.y,w,h,ctx.cell),rect=cellRect(at.c,at.r,w,h,ctx.cell);
    if(!ghostRefusal(rect,ctx)&&!out.some(o=>overlaps(o,rect)))out.push(rect);
  }
  return out;
}

/** The hands hold the rope this far (u) behind the hero's centre, toward the car (a puller leans away from it). */
export const ROPE_HANDS_BACK=.22;
/**
 * The rope from the hero's hands (a) to the car's front bumper (b): the car lies along `heading` (its nose) with half
 * length `half`. `sag` (u, downward on screen) grows with the slack left of CAR_ROPE; a taut rope is straight.
 */
export function ropeLine(hero:{x:number;y:number},car:{x:number;y:number},half:number,heading=0){
  const bx=car.x+Math.cos(heading)*half,by=car.y+Math.sin(heading)*half,d=Math.hypot(hero.x-bx,hero.y-by);
  const back=d>1e-6?Math.min(ROPE_HANDS_BACK,d/2)/d:0,ax=hero.x+(bx-hero.x)*back,ay=hero.y+(by-hero.y)*back;
  const len=Math.hypot(ax-bx,ay-by);
  return {ax,ay,bx,by,len,sag:Math.max(0,CAR_ROPE-len)*.35};
}
/**
 * The free rope lying on the ground (card puxar-uno-corda): world points from the front bumper (first, the knot) to
 * its end CAR_ROPE_REST u ahead (last, the loop a hero takes), waving a little to each side so it reads as a rope.
 * `n` segments; the sim's end (contract ropeTip) is the same spot measured from the body's centre.
 */
export function ropeRest(car:{x:number;y:number},half:number,heading=0,n=12):{x:number;y:number}[]{
  const hx=Math.cos(heading),hy=Math.sin(heading),out:{x:number;y:number}[]=[];
  for(let i=0;i<=n;i++){
    const t=i/n,along=half+CAR_ROPE_REST*t,wave=Math.sin(t*Math.PI*2)*.16*Math.min(1,t*3);
    out.push({x:car.x+hx*along-hy*wave,y:car.y+hy*along+hx*wave});
  }
  return out;
}

/** A snapshot that needs the fortify layer: a wall segment standing or fallen, or the chaveiro's car (its rope). */
export function needsFortify(view:{structures:readonly {kind:string}[];objective?:unknown}){
  if(view.structures.some(s=>s.kind==='muro'))return true;
  return !!(view.objective as {car?:unknown}|undefined)?.car;
}

/**
 * What one frozen wall segment is drawn for (card NEW-20261021-E2-obra-muro-assado): its damage stage, the hit flash,
 * the view, the bar (fraction and low colour; '-' when whole or fallen) and the camera's contour width `k` (to the
 * hundredth). The renderer freezes the segment (TriBand) again only when this key changes; per frame it only moves it.
 */
export function wallKey(stage:number,flash:boolean,view:number,bar:{fraction:number;low:boolean}|undefined,k:number):string{
  return `${stage}|${flash?1:0}|${view}|${bar?`${bar.fraction}|${bar.low?1:0}`:'-'}|${Math.round(k*100)}`;
}
