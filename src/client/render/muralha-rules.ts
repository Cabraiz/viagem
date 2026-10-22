/**
 * Muralha de tralha (NEW-20261021-ORQ-muralha-tralha-no-jogo): what each free barricade square (the map's tralha and the
 * ones built from a kit, stonewards-rules isFreeBarricade) draws from the junk wall sheets (art/base-art.ts
 * BASE_ART.muralha / .pilar, scripts/import-muralha-tralha.mjs). Pure: no Phaser.
 * - A square in a straight run (its two neighbours on one axis) or alone draws one whole straight piece along that axis
 *   (alone: the axis of its rot, like freeBarricadeSpan).
 * - An end, a corner, a T or a cross draws half a straight piece toward each neighbour (they meet the neighbours' pieces
 *   at the cell edge) and a pillar on top, which covers the joint.
 * - Which piece: seeded by the cell (hashCell), so every player sees the same wall; two straight squares side by side
 *   never match (retoOf).
 * - Sheet column and half: from the axis' screen direction (muralhaColumn, muralhaHalf), so it holds in the 4 views.
 * - barricada-2x (user, 22/10): a square is BARRICADA_CELLS × BARRICADA_CELLS build cells (c,r its top-left), so its
 *   neighbours sit BARRICADA_CELLS cells away and its pieces are drawn that many times wider and taller.
 */
import {BARRICADA_CELLS} from '../../rules/towers.ts';
import {damageStage} from './stonewards-rules.ts';

/**
 * Height of the junk wall: 1 = the delivered art's height (card muralha-mais-alta: drawn 1.5× the stone wall's, muro-pedra,
 * so the jokes read), 1.2 = 20 % taller. The only knob: it scales the pieces vertically only, so their ends still meet
 * the cell edges (past ~1.2 the art looks stretched: ask E3 for taller pieces).
 */
export const MURALHA_ALTURA=1;
/** Pieces in the sheets (meta.pecas): straight ones and pillars. */
export const MURALHA_RETOS=10;
export const MURALHA_PILARES=3;
/** Damage rows of the sheets, by stonewards-rules damageStage (a fallen square is removed: no row). */
export const MURALHA_ESTADOS=['inteira','avariada','quase-caindo'] as const;
export type MuralhaEstado=typeof MURALHA_ESTADOS[number];

export type MuralhaAxis='c'|'r';
export interface MuralhaSquare {c:number;r:number;rot?:number}
export interface MuralhaDraw {
  kind:'reto'|'pilar';
  /** Piece index (0..MURALHA_RETOS-1 or 0..MURALHA_PILARES-1). */
  piece:number;
  /** reto: the wall's axis (world: 'c' = x, 'r' = y). */
  axis?:MuralhaAxis;
  /** reto: half toward the neighbour on this side of the axis (+1 / -1); undefined = the whole piece. */
  toward?:1|-1;
}

/** Deterministic 32-bit hash of a cell (and a salt): the same on every client. */
export function hashCell(c:number,r:number,salt=0):number{
  let h=Math.imul(c|0,0x27d4eb2d)^Math.imul(r|0,0x165667b1)^Math.imul(salt|0,0x9e3779b1);
  h=Math.imul(h^(h>>>15),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);
  return (h^(h>>>16))>>>0;
}
/**
 * The straight piece of a square: one of the 5 of its parity along `axis` (even squares the even pieces, odd squares the
 * odd ones, counting `step` cells a square), by its hash, so two squares side by side in a run never show the same piece.
 */
export function retoOf(c:number,r:number,axis:MuralhaAxis,step=BARRICADA_CELLS):number{
  return 2*(hashCell(c,r)%(MURALHA_RETOS/2))+(Math.floor((axis==='c'?c:r)/step)&1);
}
export const pilarOf=(c:number,r:number)=>hashCell(c,r,2)%MURALHA_PILARES;
/** Half pieces at a joint: their own seed per side, so a corner's two halves rarely match. */
const halfOf=(c:number,r:number,axis:MuralhaAxis,toward:1|-1)=>hashCell(c,r,(axis==='c'?3:5)+(toward>0?0:1))%MURALHA_RETOS;

export const cellKey=(c:number,r:number)=>`${c},${r}`;

/**
 * What square `s` draws, given every free barricade square standing (`cells`: cellKey of their top-left cells); its
 * neighbours are `step` cells away (a square's side, BARRICADA_CELLS).
 */
export function muralhaPlan(s:MuralhaSquare,cells:ReadonlySet<string>,step=BARRICADA_CELLS):MuralhaDraw[]{
  const {c,r}=s,has=(dc:number,dr:number)=>cells.has(cellKey(c+dc*step,r+dr*step));
  const e=has(1,0),w=has(-1,0),n=has(0,-1),so=has(0,1),count=+e+ +w+ +n+ +so;
  if(count===0){const axis:MuralhaAxis=s.rot===1?'r':'c';return [{kind:'reto',piece:retoOf(c,r,axis,step),axis}];}
  if(count===2&&e&&w)return [{kind:'reto',piece:retoOf(c,r,'c',step),axis:'c'}];
  if(count===2&&n&&so)return [{kind:'reto',piece:retoOf(c,r,'r',step),axis:'r'}];
  const out:MuralhaDraw[]=[];
  const half=(axis:MuralhaAxis,toward:1|-1)=>out.push({kind:'reto',piece:halfOf(c,r,axis,toward),axis,toward});
  if(e)half('c',1);if(w)half('c',-1);if(so)half('r',1);if(n)half('r',-1);
  out.push({kind:'pilar',piece:pilarOf(c,r)});
  return out;
}

/** The damage row of a square by its life (undefined once down: nothing is drawn). */
export function muralhaEstado(hp:number,maxHp:number):MuralhaEstado|undefined{
  const down=hp<=0,stage=damageStage(maxHp>0?hp/maxHp:0,down);
  return stage<3?MURALHA_ESTADOS[stage as 0|1|2]:undefined;
}

/**
 * Sheet column for an axis whose world step projects to screen (dx, dy): 0 = the piece as drawn (it runs from lower
 * left to upper right), 1 = mirrored.
 */
export const muralhaColumn=(dx:number,dy:number)=>dx*dy<0?0:1;
/** The half of the frame a half piece keeps: +1 the right half, -1 the left (the neighbour's side on screen). */
export const muralhaHalf=(toward:1|-1,dx:number):1|-1=>toward*dx>=0?1:-1;
/**
 * Scale of a piece: the projected square's screen width (|dx| of the square's side, BARRICADA_CELLS × CITY_BUILD_CELL,
 * along the axis) over the sheet's art px per square (meta.celula): x so the ends meet the square's edges; y times
 * MURALHA_ALTURA (so a 2-cell square draws its piece 2× wider and 2× taller than a 1-cell one).
 */
export function muralhaScale(dx:number,celula:number,altura=MURALHA_ALTURA){
  const x=celula>0?Math.abs(dx)/celula:0;
  return {x,y:x*altura};
}
