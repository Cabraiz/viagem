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
 * - The rope (contract: car.rope): from the hero holding it to the car's bumper on the hero's side, sagging with the
 *   slack left of CAR_ROPE.
 * The fields are read by shape (c/r/rot on the structures, car.rope) so this works before and after the contract lands.
 */
import {CAR_RADIUS,CAR_ROPE,type FreeBuildRefusal} from '../../contract/index.ts';
import {DEFENSES,FREE_PIECE_DEFS,type DefenseId} from '../../rules/index.ts';

/** How close to a living nest nothing is built (proposal §2; the room refuses with 'ninho'). */
export const NEST_BUILD_KEEP_OUT=6;
/** Faint hints shown around the car. */
export const HINTS_MAX=3;

export interface CellRect {c:number;r:number;w:number;h:number;x0:number;y0:number;x1:number;y1:number;cx:number;cy:number}
/** What the renderer reads of a snapshot structure (StructureView by shape). */
export interface FortStructure {id:string;kind:string;x:number;y:number;hp:number;c?:number;r?:number;rot?:number}

const isDefense=(kind:string):kind is DefenseId=>Object.prototype.hasOwnProperty.call(DEFENSES,kind);
/** A kind the free build places on the grid: a defense, a wall segment or a barricade. */
export const isGridPiece=(kind:string)=>kind==='muro'||kind==='barricada'||isDefense(kind);

/** Footprint in cells [w,h] of a piece (rot 1 swaps them); unknown kinds take one cell. */
export function footprintCells(piece:string,rot?:number):[number,number]{
  const [w,h]=piece==='barricada'||piece==='muro'?FREE_PIECE_DEFS[piece].footprint:isDefense(piece)?DEFENSES[piece].footprint:[1,1];
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

/**
 * The rope from the hero (a) to the car's bumper (b): the car lies along `heading` with half length `half`; the bumper
 * is the end on the hero's side. `sag` (u, downward on screen) grows with the slack left of CAR_ROPE; a taut rope is
 * straight.
 */
export function ropeLine(hero:{x:number;y:number},car:{x:number;y:number},half:number,heading=0){
  const hx=Math.cos(heading),hy=Math.sin(heading),side=(hero.x-car.x)*hx+(hero.y-car.y)*hy>=0?1:-1;
  const bx=car.x+hx*half*side,by=car.y+hy*half*side,len=Math.hypot(hero.x-bx,hero.y-by);
  return {ax:hero.x,ay:hero.y,bx,by,len,sag:Math.max(0,CAR_ROPE-len)*.35};
}

/** A snapshot that needs the fortify layer: a wall segment standing or fallen, or a hero on the car's rope. */
export function needsFortify(view:{structures:readonly {kind:string}[];objective?:unknown}){
  if(view.structures.some(s=>s.kind==='muro'))return true;
  const car=(view.objective as {car?:{rope?:string}}|undefined)?.car;
  return !!car?.rope;
}
