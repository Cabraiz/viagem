/**
 * Modo foto `elenco-roster` (D-049): pure helpers of the roster's contact sheet (sandboxes/sandbox-elenco.ts draws it).
 * Each tile: the hero at its game size, then the enemy's still loop (idle, else fly/walk: horde-art chooseAnim), frame 0,
 * facing S, SE and E, at the game's size (drawnScale × ENEMY_DRAW_SCALE against the hero's 96 × HERO_DRAW_SCALE).
 * Every figure stands on the tile's baseline; one zoom for the whole selection, so pages compare.
 */
import {ENEMY_ART_IDS} from '../../rules/index.ts';
import {HERO_FIGURE_PX,artTargetHeight,drawnScale} from '../art/horde-art.ts';
import {ENEMY_DRAW_SCALE,HERO_DRAW_SCALE} from '../render/draw-scale.ts';

/** Sheet rows shown (scripts/art-v2/spec.mjs DIRECTIONS: S,SW,W,NW,N,NE,E,SE). */
export const ELENCO_DIRS:readonly {nome:string;row:number}[]=Object.freeze([{nome:'S',row:0},{nome:'SE',row:7},{nome:'E',row:6}]);
/** The roster ids with art before the 24 imported on 14/10 (`novos=1` hides these; `antes=a,b` replaces the list). */
export const ELENCO_ANTES:readonly string[]=Object.freeze([
  'ambulante-guarda-chuva','barata-voadora','bebum-de-carrinho','dono-do-boteco','espetinho-suspeito',
  'flanelinha-interdimensional','grauzeiro','malabarista-do-sinal','marronzinho','moco-do-gas','pamonheiro',
  'paredao-ambulante','rato-de-boteco','subsindico','tio-do-isopor','tiozinho-da-sinuca',
]);
const list=(v:string|null)=>(v??'').split(',').map(s=>s.trim()).filter(Boolean);

/** The ids shown: `ids=a,b` (in that order, only ids with art), else all; `novos=1` drops ELENCO_ANTES (or `antes=`). */
export function elencoIds(search:string,all:readonly string[]=ENEMY_ART_IDS):{ids:string[];desconhecidos:string[]}{
  const q=new URLSearchParams(search),pedidos=list(q.get('ids'));
  const known=new Set(all),antes=new Set(q.has('antes')?list(q.get('antes')):ELENCO_ANTES);
  let ids=pedidos.length?pedidos.filter(id=>known.has(id)):[...all];
  if(q.get('novos')==='1')ids=ids.filter(id=>!antes.has(id));
  return {ids:[...new Set(ids)],desconhecidos:pedidos.filter(id=>!known.has(id))};
}

/** Screen px: caption under each tile, gap between tiles and between figures, padding inside a tile. */
export const CAPTION_PX=30,GAP_PX=8,PAD_PX=6;
/**
 * The grid is chosen from the screen only (so the page count is known before any art loads): a reference tile of
 * REF_TILE world px (a brutamontes: the hero + 3 facings ≈ 400 wide, 1.3 × 96 × 1.15 ≈ 144 tall) at zoom K_MIN.
 */
export const REF_TILE={w:400,h:144},K_MIN=.9;
export interface Grade {cols:number;rows:number;porPagina:number;cw:number;ch:number}
export function elencoGrade(w:number,h:number):Grade{
  const cols=Math.max(1,Math.floor((w+GAP_PX)/(REF_TILE.w*K_MIN+GAP_PX))),rows=Math.max(1,Math.floor((h+GAP_PX)/(REF_TILE.h*K_MIN+CAPTION_PX+GAP_PX)));
  return {cols,rows,porPagina:cols*rows,cw:(w-GAP_PX*(cols-1))/cols,ch:(h-GAP_PX*(rows-1))/rows};
}
export const elencoPaginas=(n:number,porPagina:number)=>Math.max(1,Math.ceil(n/porPagina));
/** Page `pagina` (1-based, clamped) of the selection. */
export function elencoPagina<T>(ids:readonly T[],pagina:number,porPagina:number):{itens:T[];pagina:number;paginas:number}{
  const paginas=elencoPaginas(ids.length,porPagina),p=Math.min(paginas,Math.max(1,Math.floor(pagina)||1));
  return {itens:ids.slice((p-1)*porPagina,p*porPagina),pagina:p,paginas};
}

/** World px per cell px of an enemy whose figure stands `drawn` cell px above its feet (the game's rule). */
export function enemyEscala(id:string,drawn:number|undefined,cellH:number,anchorY=.88):number{
  return (drawnScale(id,drawn)??artTargetHeight(id)/(cellH*anchorY))*ENEMY_DRAW_SCALE;
}
/** World px per cell px of a hero sheet whose standing figure is `height` cell px (character-sprites.ts). */
export const heroEscala=(height:number)=>HERO_FIGURE_PX/height*HERO_DRAW_SCALE;

/** A figure's alpha box around its feet, world px: left/top ≤ 0 (left of / above the feet), right/bottom ≥ 0. */
export interface Caixa {left:number;right:number;top:number;bottom:number}
/** Cell-px alpha box (x0..x1, y0..y1 inclusive) → world px around the anchor. */
export function caixaMundo(b:{x0:number;x1:number;y0:number;y1:number},cell:readonly [number,number],anchor:readonly [number,number],escala:number):Caixa{
  const fx=cell[0]*anchor[0],fy=cell[1]*anchor[1];
  return {left:Math.min(0,(b.x0-fx)*escala),right:Math.max(0,(b.x1+1-fx)*escala),top:Math.min(0,(b.y0-fy)*escala),bottom:Math.max(0,(b.y1+1-fy)*escala)};
}
/** World size of a tile: the figures side by side, all on one baseline. */
export function tileMundo(figs:readonly Caixa[]):{w:number;acima:number;abaixo:number}{
  let w=0,acima=0,abaixo=0;
  for(const f of figs){w+=f.right-f.left;acima=Math.max(acima,-f.top);abaixo=Math.max(abaixo,f.bottom);}
  return {w,acima,abaixo};
}
/** Screen px per world px that fits every tile of the selection in a grid cell (cw × ch, caption and gaps out). */
export function elencoZoom(tiles:readonly (readonly Caixa[])[],cw:number,ch:number):number{
  let k=Infinity;
  for(const figs of tiles){
    const t=tileMundo(figs),livreW=cw-2*PAD_PX-GAP_PX*Math.max(0,figs.length-1),livreH=ch-CAPTION_PX-2*PAD_PX;
    if(t.w>0)k=Math.min(k,livreW/t.w);
    if(t.acima+t.abaixo>0)k=Math.min(k,livreH/(t.acima+t.abaixo));
  }
  return Number.isFinite(k)&&k>0?k:1;
}
