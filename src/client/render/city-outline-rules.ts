/**
 * City-mode outlines, pure rules (card NEW-20261012-E8-cidade-contorno-breu; art bible cidade-nevada-arte.md §6;
 * board design/arte-v2-teste/PORTAO.md "O aro do motor"; D-037).
 *
 * In the city every critter, pickup and hero draws with a Breu ring of 2 px measured on SCREEN, outside its own edge.
 * render/city-outline.ts builds, once per texture, a "city" copy of the sheet ALREADY AT SCREEN SCALE (each cell
 * resampled to its drawn size, then the ring grown by render/outline.ts), registered under a derived key with the
 * same frame names; the draw sites show it with the inverse scale, so the figure keeps its size and position.
 * Style-A art-v2 enemies keep the umber rim baked by the importer on light ground and switch to the Breu-ring copy
 * where the ground under their feet is darker than RIM_SWITCH_LUMINANCE.
 *
 * Nothing here runs outside the city: the island and the endless map always get the base key (`textureFor`).
 * Pure (no Phaser, no DOM) so node tests read it.
 */
// The pure leaves of render/city (its index also exports CityLayer, which loads Phaser): node tests read this module.
import {GROUND_KINDS,groundAt,type CityAsset,type GroundKind} from './city/asset.ts';
import {groundColor,luminance} from './city/palette.ts';

/** The ring: Breu #1E1530, opaque, 2 CSS px on screen (art bible §6). */
export const CITY_RING=Object.freeze({color:0x1e1530,alpha:1,cssPx:2});
/**
 * Ground luminance where the engine stops trusting the imported umber rim (#2A2018 at 85%). The flat-colour floor is
 * 0.184, but measured on real silhouettes (anti-aliasing lightens the rim) it only holds 3:1 from 0.26: PORTAO.md
 * uses 0.262. Below it the Breu ring (passes from 0.131) is drawn instead.
 */
export const RIM_SWITCH_LUMINANCE=0.262;
export type Rim='umber'|'breu';
/** Which rim reads on a ground of WCAG luminance `lum`: the imported umber one on light ground, Breu below the switch. */
export const rimForGround=(lum:number):Rim=>lum>=RIM_SWITCH_LUMINANCE?'umber':'breu';

/**
 * Luminance of each city ground kind on its darkest slope shade (palette.ts groundColor at shade -1): the conservative
 * value, so a shaded slope never keeps an umber rim its flat part could hold.
 */
export const GROUND_LUMINANCE:Readonly<Record<GroundKind,number>>=Object.freeze(Object.fromEntries(
  (Object.values(GROUND_KINDS) as GroundKind[]).map(kind=>[kind,Math.min(luminance(groundColor(kind,0)),luminance(groundColor(kind,-1)))]),
) as Record<GroundKind,number>);
/** Ground luminance under a world point of the city (snow outside the grid, like the renderer); no allocation. */
export function cityGroundLuminance(asset:CityAsset,x:number,y:number):number{
  return GROUND_LUMINANCE[groundAt(asset,Math.floor((x-asset.origin.x)/asset.cell),Math.floor((y-asset.origin.y)/asset.cell))];
}

/** Tag of every city texture key: `<base key>:cidade:<serial>` (the serial changes when a copy is rebuilt). */
export const CITY_KEY_TAG=':cidade:';
export const cityKey=(base:string,serial:number)=>`${base}${CITY_KEY_TAG}${serial}`;
export const isCityKey=(key:string)=>key.includes(CITY_KEY_TAG);
/**
 * The texture a draw site shows: the city copy only when the city is on AND the copy exists (built, and for an
 * imported enemy, only where its rim must be Breu); the base key otherwise, i.e. always on the island and the endless map.
 */
export function textureFor(base:string,city:boolean,variant?:string,rim:Rim='breu'):string{
  return city&&variant&&rim==='breu'?variant:base;
}

/**
 * Copy px per CSS px: min(DPR, 2), as the card asks. The world canvas itself renders 1 px per CSS px (Phaser 3.90 has
 * no `resolution`, economy.ts), so on a DPR ≥ 2 phone the copy is 2× oversampled and the GPU halves it: the figure
 * stays as crisp as the base sheet minified, where a 1:1 copy at a sub-pixel position comes out soft. DPR 1 = 1:1.
 */
export const MAX_COPY_RES=2;
export function copyResolution(dpr:number):number{
  return Number.isFinite(dpr)&&dpr>0?Math.max(1,Math.min(MAX_COPY_RES,dpr)):1;
}
/** A copy is rebuilt when the zoom (orientation change) or the draw scale moved by more than this. */
export const REBUILD_CHANGE=0.1;
/**
 * …but a copy is never shown enlarged by more than this: resampled at 1 copy px per canvas px, a few % of upscale
 * already blurs the figure (e.g. a copy made at the camera's default zoom 1 before the scene fits the city zoom 1.07).
 */
export const REBUILD_GROWTH=0.02;
export const changedEnough=(built:number,now:number)=>!(built>0)||!(now>0)||now/built-1>REBUILD_GROWTH||1-now/built>REBUILD_CHANGE;

/** A rectangle inside a cell, in source px (the part of every frame that holds the figure). */
export interface CellCrop {x:number;y:number;w:number;h:number}
/** Crop of a measured figure box (left/top inclusive, right/bottom exclusive, every frame together) plus 1 px, in the cell. */
export function cropOf(box:{left:number;top:number;right:number;bottom:number}|undefined,cellW:number,cellH:number):CellCrop|undefined{
  if(!box||!(box.right>box.left)||!(box.bottom>box.top))return undefined;
  const x=Math.max(0,Math.floor(box.left)-1),y=Math.max(0,Math.floor(box.top)-1);
  return {x,y,w:Math.min(cellW,Math.ceil(box.right)+1)-x,h:Math.min(cellH,Math.ceil(box.bottom)+1)-y};
}
/**
 * Geometry of a city copy. The `crop` of every cell (the whole `cellW × cellH` cell by default; a hero sheet's figure
 * box, which halves its memory) drawn at `drawScale` world px per source px, under camera `zoom` (CSS px per world px)
 * at `res` copy px per CSS px (copyResolution), is resampled to `cw × ch` px (never upscaled: a sheet already at or below screen
 * size keeps its resolution) and padded by `pad` px on every side, so the ring (`ring` copy px = CITY_RING.cssPx on
 * screen) never touches the slot edge. `kx`, `ky` (source px per copy px) multiply the draw site's scale.
 */
export interface VariantGeometry {cellW:number;cellH:number;crop:CellCrop;cw:number;ch:number;pad:number;ring:number;slotW:number;slotH:number;kx:number;ky:number}
export function variantGeometry(cellW:number,cellH:number,drawScale:number,zoom:number,res=1,crop?:CellCrop):VariantGeometry|undefined{
  const perSource=drawScale*zoom*res;
  if(!(cellW>0)||!(cellH>0)||!(perSource>0)||!Number.isFinite(perSource))return undefined;
  const c=crop&&crop.w>0&&crop.h>0&&crop.x>=0&&crop.y>=0&&crop.x+crop.w<=cellW&&crop.y+crop.h<=cellH?crop:{x:0,y:0,w:cellW,h:cellH};
  const r=Math.min(1,perSource),cw=Math.max(1,Math.round(c.w*r)),ch=Math.max(1,Math.round(c.h*r));
  const kx=c.w/cw,ky=c.h/ch,perCopy=perSource*(kx+ky)/2;
  const ring=CITY_RING.cssPx*res/perCopy,pad=Math.ceil(ring)+1;
  return {cellW,cellH,crop:c,cw,ch,pad,ring,slotW:cw+2*pad,slotH:ch+2*pad,kx,ky};
}
/** Copy px (from the slot's corner) of source px (sx, sy) of the cell. */
export const copyX=(g:VariantGeometry,sx:number)=>g.pad+(sx-g.crop.x)/g.kx;
export const copyY=(g:VariantGeometry,sy:number)=>g.pad+(sy-g.crop.y)/g.ky;
/** Origin (0..1 of the slot) that puts the copy's figure where the base origin (0..1 of the cell) put it. */
export function variantOrigin(g:VariantGeometry,ox:number,oy:number,out:{x:number;y:number}={x:0,y:0}){
  out.x=copyX(g,ox*g.cellW)/g.slotW;out.y=copyY(g,oy*g.cellH)/g.slotH;return out;
}
/** Slot (column, row) of a base frame cut at (x, y) in a sheet of `cellW × cellH` cells. */
export const slotOf=(g:VariantGeometry,x:number,y:number)=>({col:Math.round(x/g.cellW),row:Math.round(y/g.cellH)});
/** Bytes of an RGBA texture. */
export const textureBytes=(w:number,h:number)=>w*h*4;
