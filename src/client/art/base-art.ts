/**
 * Imported art v2 for the Stonewards base (NEW-20261012-E5-cidade-barricadas-cliente): the wall, the city barricades
 * and the loot crates drawn from the importer's `base` sheets (scripts/art-v2/spec.mjs BASE) when the manifest has
 * them; render/stonewards.ts keeps today's Graphics otherwise. With no `base` piece nothing is queued and every
 * function answers false/undefined, so the game looks exactly as before.
 *
 * Sheet layout ('views' pieces): one column per camera view (0°, 90°, 180°, 270°; 1 column for a symmetric piece),
 * one row per state, the row names in the file's `rows` (an animated state has rows `<state>-1..n`) and the state names
 * in `meta.states`. States are always looked up by name, never by a fixed index. Pages (sheets over 4096 px) hold the
 * cells in reading order of that grid.
 *
 * Pure helpers (baseLoads, baseStates, baseState, baseFrame, baseDrawScale) run in node tests; the Phaser side
 * (queueBaseArt, applyBaseArt) only touches what it is given and imports Phaser as a type.
 */
import type Phaser from 'phaser';
import {artPiece,artUrl,hasArt,type ArtFile,type ArtPage} from './manifest.ts';
import {damageStage} from '../render/stonewards-rules.ts';

/** The `base` ids the renderer draws today (ART-IDS.md). The rest of the group (fountain, forge, helicopter…) has no world anchor yet. */
export const BASE_ART={wall:'muralha-acampamento',barricade:'barricada',crate:'caixa-saque'} as const;
export type BaseArtId=typeof BASE_ART[keyof typeof BASE_ART];
const USED:readonly string[]=Object.values(BASE_ART);

/**
 * Drawn width (world px at the endless map's size, times the scene's actor scale) of a sheet cell: the procedural
 * wall is ~150 px wide, a barricade spans 2 u of a plaza mouth (≈ 98 px in the city) and a crate ≈ 0.7 u.
 */
export const BASE_WIDTH:Readonly<Record<string,number>>={'muralha-acampamento':170,barricada:180,'caixa-saque':64};
/**
 * Pieces drawn at the city scenery's scale (world px per art px, render/towers/tower-rules.ts towerArtScale, like the
 * delivered towers) when the caller gives it: the sofa barricade (NEW-20261021-ORQ-barricada-sofa) is as big as it was
 * drawn next to the buildings, not stretched to BASE_WIDTH.
 */
export const BASE_ART_SCALED:ReadonlySet<string>=new Set([BASE_ART.barricade]);
/** The importer's foot rule for pieces standing on the ground (spec.mjs ANCHOR). */
const DEFAULT_ANCHOR:[number,number]=[.5,.88];
/** States the broken end of a damage sheet may be called (barricade 'quebrada', wall 'ruina'). */
const BROKEN=['quebrada','ruina'];
const DAMAGE=['inteira','avariada','quase-caindo'];

/** Texture key of one page of a base sheet: `art:base:<id>` plus `:p<n>` (1-based) when the sheet is paged. */
export const baseArtKey=(id:string,page=0,pages=1)=>`art:base:${id}${pages>1?`:p${page+1}`:''}`;

/** The sheet of a base piece: 'sheet' (the importer's key for one-file pieces), else its first file. */
export function baseFile(id:string):ArtFile|undefined{
  const piece=artPiece('base',id);if(!piece)return undefined;
  if(piece.files.sheet)return piece.files.sheet;
  for(const name in piece.files)return piece.files[name];
  return undefined;
}
const validCell=(f:ArtFile)=>Array.isArray(f.cell)&&f.cell[0]>0&&f.cell[1]>0;

/**
 * A sheet with a city lite copy at its own cell (`liteCell` = cell: scripts/art-lite.mjs, render/city/art-plan.ts
 * BASE_LITE_PIECES, NEW-20261021-E1-base-lite-muralha) loads that lossy copy under /art/lite/city/: the wall's 929 KB
 * came before the first playable frame. Same cell, so frames, anchor and scale are unchanged, and a copy that fails
 * falls back to the approved file (scene artFallback). A smaller liteCell would change the scale: the approved file stays.
 */
const sameCellLite=(f:ArtFile)=>!!f.liteCell&&f.liteCell[0]===f.cell[0]&&f.liteCell[1]===f.cell[1];
const liteBaseUrl=(url:string)=>url.replace(/^\/art\/city\//,'/art/lite/city/');

export interface BaseLoad {key:string;url:string;cell:[number,number]}
/** Every texture the base art needs from the current manifest: each page of the used pieces (no piece → []). */
export function baseLoads():BaseLoad[]{
  const out:BaseLoad[]=[];
  for(const id of USED){
    const file=baseFile(id);if(!file||!validCell(file))continue;
    const pages=basePages(file),lite=sameCellLite(file);
    pages.forEach((page,i)=>{const url=artUrl('base',page.file);if(url)out.push({key:baseArtKey(id,i,pages.length),url:lite?liteBaseUrl(url):url,cell:file.cell});});
  }
  return out;
}
/** Preload: queues every base sheet (one spritesheet per page, frame = cell). A failed one keeps the Graphics. */
export function queueBaseArt(scene:Phaser.Scene){
  for(const l of baseLoads())if(!scene.textures.exists(l.key))scene.load.spritesheet(l.key,l.url,{frameWidth:l.cell[0],frameHeight:l.cell[1]});
}

/** The piece's state names in row order (`meta.states`; else the file's row names); [] without the piece. */
export function baseStates(id:string):readonly string[]{
  const piece=artPiece('base',id);if(!piece)return [];
  const meta=piece.meta?.states;
  if(Array.isArray(meta)&&meta.every(s=>typeof s==='string'))return meta as string[];
  const rows=baseFile(id)?.rows;
  return Array.isArray(rows)?rows:[];
}
/** Frames of an animated state (`meta.stateFrames`), 1 otherwise. */
export function baseStateFrames(id:string,state:string):number{
  const f=artPiece('base',id)?.meta?.stateFrames as Record<string,unknown>|undefined;
  const n=f&&typeof f==='object'?f[state]:undefined;
  return typeof n==='number'&&Number.isInteger(n)&&n>1?n:1;
}
/**
 * The damage state of a wall or barricade piece for a life `ratio` (hp / maxHp) and `down` (ART-IDS rule, through
 * stonewards-rules damageStage): 'inteira' > 66%, 'avariada' > 33%, 'quase-caindo' > 0, then the broken state
 * ('quebrada' or 'ruina'). Undefined when the piece is missing or does not have that state (the Graphics stay).
 */
export function baseState(id:string,ratio:number,down=false):string|undefined{
  const states=baseStates(id);if(!states.length)return undefined;
  const stage=damageStage(ratio,down);
  const want=stage<3?DAMAGE[stage]:BROKEN.find(s=>states.includes(s));
  return want!==undefined&&states.includes(want)?want:undefined;
}

/** Sheet row of `state` (frame `frame` of an animated state): by name in the file's rows, else its place in the states. */
export function baseRow(id:string,state:string,frame=0):number{
  const file=baseFile(id);if(!file)return -1;
  const n=baseStateFrames(id,state),rows=file.rows;
  if(Array.isArray(rows)){
    const named=n>1?`${state}-${(((frame|0)%n)+n)%n+1}`:state;
    const i=rows.indexOf(named);
    return i>=0?i:rows.indexOf(state);
  }
  return baseStates(id).indexOf(state);
}
/** Columns of a piece's sheet: its views (1 for a symmetric piece). */
export const baseViews=(file:ArtFile)=>Math.max(1,Math.min(4,file.views??1));

export interface BaseFrameRef {key:string;frame:number}
/**
 * Pages of a base sheet: the manifest's (the importer always writes them); a bare `file` is one page of the whole
 * views × rows grid (manifest.ts artPages counts frames × directions, which a 'views' sheet does not have).
 */
export function basePages(file:ArtFile):ArtPage[]{
  if(file.pages?.length)return file.pages;
  if(!file.file)return [];
  const views=baseViews(file),rows=Array.isArray(file.rows)?file.rows.length:typeof file.rows==='number'?Math.max(1,file.rows|0):1;
  return [{file:file.file,columns:views,rows,firstFrame:0,frameCount:views*rows}];
}
const pagesCache=new WeakMap<ArtFile,{pages:ArtPage[];keys:string[];id:string}>();
function pagesOf(id:string,file:ArtFile){
  let c=pagesCache.get(file);
  if(!c||c.id!==id){const pages=basePages(file);c={id,pages,keys:pages.map((_,i)=>baseArtKey(id,i,pages.length))};pagesCache.set(file,c);}
  return c;
}
/**
 * Texture key and frame of piece `id` in `state` seen from camera column `view` (0..3; a 1-view piece always shows
 * column 0): row = the state's row, column = the view, the cell found in its page. Undefined without the piece or the
 * state. `out` avoids an allocation per call.
 */
export function baseFrame(id:string,state:string,view:number,frame=0,out:BaseFrameRef={key:'',frame:0}):BaseFrameRef|undefined{
  const file=baseFile(id);if(!file)return undefined;
  const row=baseRow(id,state,frame);if(row<0)return undefined;
  const views=baseViews(file),col=views>1?((Math.round(view)%views)+views)%views:0,global=row*views+col;
  const {pages,keys}=pagesOf(id,file);
  for(let i=0;i<pages.length;i++){
    const p=pages[i];
    if(global>=p.firstFrame&&global<p.firstFrame+p.frameCount){out.key=keys[i];out.frame=global-p.firstFrame;return out;}
  }
  return undefined;
}
/**
 * Scale that draws a cell of `file` BASE_WIDTH[id] world px wide at the endless map's size, times `u` (actor scale);
 * a BASE_ART_SCALED piece takes `artPx` (world px per art px) when given.
 */
export function baseDrawScale(id:string,file:ArtFile,u=1,artPx?:number):number{
  if(artPx!==undefined&&artPx>0&&BASE_ART_SCALED.has(id))return artPx;
  return (BASE_WIDTH[id]??file.cell[0])/file.cell[0]*u;
}

const ref:BaseFrameRef={key:'',frame:0};
/**
 * Shows piece `id` in `state` from camera column `view` on `image` (texture, frame, origin from the piece's anchor,
 * scale BASE_WIDTH × `u`) and returns true; the caller positions it and sets its depth. False (the image untouched)
 * when the piece, the state or its loaded texture is missing: the caller hides the image and draws its Graphics.
 */
export function applyBaseArt(image:Phaser.GameObjects.Image,id:string,state:string|undefined,view:number,u=1,frame=0,artPx?:number):boolean{
  if(!state||!hasArt('base',id))return false;
  const file=baseFile(id),at=file&&baseFrame(id,state,view,frame,ref);
  if(!file||!at||!image.scene.textures.exists(at.key))return false;
  if(image.texture.key!==at.key)image.setTexture(at.key,at.frame);else image.setFrame(at.frame);
  const anchor=file.anchor??DEFAULT_ANCHOR;
  image.setOrigin(anchor[0],anchor[1]).setScale(baseDrawScale(id,file,u,artPx));
  return true;
}
