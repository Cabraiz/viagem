/**
 * Swappable materials of the city layer (card cidade-03, art v2: design/arte-v2.md §6.3). Pure logic, no Phaser.
 * The layer asks this registry, when it builds a chunk, whether a texture exists for a ground kind, a building
 * footprint or a prop kind; when it does the chunk draws the art, otherwise the procedural look of cidade-03a. New art
 * therefore drops in by loading textures under these keys, with no code change.
 *
 * ART IMPORTER CONVENTIONS (arte-entrada/cenario → public/art/...; the scene loads them under these texture keys)
 *
 * Ground — key `city:ground:<kind>`, <kind> ∈ snow | packed | ice | water | rubble | cobble (asset.ts GROUND_KINDS).
 *   One seamless, top-down (orthographic, not projected) square tile, 512×512 px, covering GROUND_TILE_UNITS world
 *   units per side (4.4 u = 5 cells of 0.88 u). Texture u runs world east (+x), v runs world south (+y); the tile is
 *   pinned to world (0, 0), so it is continuous across cells and chunks. The layer projects it onto the iso ground
 *   (the same corner points as the flat quads, slopes included), lightens or blends it by slope like the flat ground
 *   (groundShadeOverlay) and draws no procedural specks/ruts/joints over it (decorOver = false: the art has its own
 *   detail). Water keeps its procedural rim and glint only while it is flat-coloured. Works inside an atlas frame (no
 *   texture repeat needed: cells are split at tile edges).
 *
 * Buildings — key `city:building:<a>x<b>` (intact) or `city:building:<a>x<b>-ruin` (ruined), a ≥ b, e.g. 1x1, 2x1,
 *   2x2, 3x2. Footprint `a×b` = a cells along world x (east-west), b cells along world y, in the art's own orientation.
 *   The texture has 4 frames (spritesheet, any frame size, all frames the same size): frame i = the building as seen
 *   in camera view i (projection.ts views; view 0 looks with world +x to screen right-down and +y to left-down).
 *   Scale: ART_SCALE art px per game px (a 1-unit edge along world x spans TILE_X·ART_SCALE = 84 px horizontally).
 *   Anchor (pivot): the FRONT-BOTTOM corner of the footprint, i.e. the ground corner nearest the camera (lowest on
 *   screen). In every frame the footprint diamond is centred horizontally in the frame and that front corner sits
 *   BUILDING_ANCHOR_BOTTOM_PX art px above the frame's bottom edge (room for rubble spilling forward). Its x is then
 *   frameW/2 + (A − B)/2 · TILE_X · ART_SCALE, with A, B the footprint's extents (world units) along view x and view y
 *   in that frame: (a, b)·cell on even frames, (b, a)·cell on odd frames (buildingAnchor computes it).
 *   A block matches a sheet when its footprint is exactly a×b in either orientation; rotated blocks use the frame of
 *   the rotated view (buildingFrame), and which of the valid rotations is used is seeded by the block id. The block
 *   draws as ONE image (it fades as a whole, sorts by its front corner, see city-layer.ts).
 *
 * Props — key `city:prop:<kind>`, <kind> ∈ rubble | car | lamp | crate | barrel | debris | bench (pines keep the
 *   approved `tree:arvore-nevada` sheet). 4 frames by view like the trees (1 frame = same picture in every view),
 *   same ART_SCALE, pivot = the prop's feet: horizontally centred, PROP_ANCHOR_BOTTOM_PX art px above the bottom.
 */
import type {CityBlock,GroundKind,PropKind} from './asset.ts';
import {hashId} from './chunks.ts';
import {GROUND_COLORS,GROUND_LIGHTEN,GROUND_TOWARD_DETAIL} from './palette.ts';
import {TILE_X,normalizeView,rotate} from './projection.ts';

/**
 * World units covered by one ground tile side (5 cells of 0.88 u). Per world unit, not per cell: on the 1.7× Cidade
 * Nevada (1.496 u cells, NEW-20261013-ORQ-cidade-escala-1-7) a tile still covers 4.4 u (~2.9 cells), so the ground's
 * grain keeps its size next to the people and the props.
 */
export const GROUND_TILE_UNITS=4.4;
/** Art pixels per game (projected) pixel for building and prop sheets. */
export const ART_SCALE=2;
/** Building frames: art px between the footprint's front corner and the frame's bottom edge. */
export const BUILDING_ANCHOR_BOTTOM_PX=16;
/** Prop frames: art px between the feet and the frame's bottom edge. */
export const PROP_ANCHOR_BOTTOM_PX=8;

export const groundTextureKey=(kind:GroundKind)=>`city:ground:${kind}`;
export const buildingTextureKey=(a:number,b:number,ruined:boolean)=>`city:building:${a}x${b}${ruined?'-ruin':''}`;
export const propTextureKey=(kind:PropKind)=>`city:prop:${kind}`;

/** A building sheet chosen for a block: sheet footprint a×b (art orientation) and the quarter turns applied to it. */
export interface BuildingMatch {key:string;a:number;b:number;turns:number}

/**
 * Sheet for a block of footprint w×h: the exact key `<w>x<h>` (block in the art's orientation: turns 0 or 2) or the
 * swapped `<h>x<w>` (block rotated a quarter turn: turns 1 or 3). A square footprint may take any of the 4 turns. The
 * choice among valid turns is seeded by the block id (same in every client and view). Undefined when no sheet exists.
 */
export function matchBuilding(block:Pick<CityBlock,'id'|'w'|'h'|'ruined'>,has:(key:string)=>boolean):BuildingMatch|undefined{
  const ruined=!!block.ruined,h=hashId(block.id);
  const direct=buildingTextureKey(block.w,block.h,ruined);
  if(block.w===block.h)return has(direct)?{key:direct,a:block.w,b:block.h,turns:h%4}:undefined;
  if(has(direct))return {key:direct,a:block.w,b:block.h,turns:2*(h%2)};
  const swapped=buildingTextureKey(block.h,block.w,ruined);
  if(has(swapped))return {key:swapped,a:block.h,b:block.w,turns:1+2*(h%2)};
  return undefined;
}

/**
 * Frame of a sheet for a view. A block that is the art turned by `turns` quarter turns (world rotation by
 * projection.rotate(·, turns)) looks in view v like the art in view v + turns. Sheets with fewer than 4 frames use frame 0.
 */
export function buildingFrame(view:number,turns:number,frameCount=4):number{
  return frameCount>=4?(normalizeView(view)+normalizeView(turns))%4:0;
}
/** Prop frame: frame = view, or 0 for single-frame sheets. */
export const propFrame=(view:number,frameCount=4)=>buildingFrame(view,0,frameCount);

/** Footprint extents (world units) along view x (A) and view y (B) of an a×b sheet in a frame. */
export function frameExtents(a:number,b:number,frame:number,cell:number):{A:number;B:number}{
  return frame%2===0?{A:a*cell,B:b*cell}:{A:b*cell,B:a*cell};
}

/**
 * Image origin (fractions of the frame) that puts the footprint's front-bottom corner on the anchor, and the display
 * scale, for an a×b sheet's frame of frameW×frameH art px (see the convention above).
 */
export function buildingAnchor(a:number,b:number,frame:number,frameW:number,frameH:number,cell:number):{originX:number;originY:number;scale:number}{
  const {A,B}=frameExtents(a,b,frame,cell);
  return {originX:0.5+(A-B)/2*TILE_X*ART_SCALE/frameW,originY:1-BUILDING_ANCHOR_BOTTOM_PX/frameH,scale:1/ART_SCALE};
}
/** Prop image origin and scale (feet at the pivot). */
export function propAnchor(frameH:number):{originX:number;originY:number;scale:number}{
  return {originX:0.5,originY:1-PROP_ANCHOR_BOTTOM_PX/frameH,scale:1/ART_SCALE};
}

/** World corner of a w×h block nearest the camera in a view (largest qx + qy), in cells relative to the block. */
export function frontCorner(view:number):{i:0|1;j:0|1}{
  // View-space q = rotate(world); the front corner maximises qx + qy (view 0: south-east, 1: north-east, 2: north-west, 3: south-west).
  let best={i:0 as 0|1,j:0 as 0|1},score=-Infinity;
  for(const j of [0,1] as const)for(const i of [0,1] as const){
    const r=rotate(i,j,view),s=r.x+r.y;
    if(s>score){score=s;best={i,j};}
  }
  return best;
}

/** One sub-quad of a cell that lies inside a single ground tile: local cell fractions and tile UVs (all in [0,1]). */
export interface UvPatch {s0:number;s1:number;t0:number;t1:number;u0:number;u1:number;v0:number;v1:number}

/** Splits [a0, a1] (world units) at multiples of `tile`: pieces as fractions of the interval and tile-local coords. */
export function tileSpans(a0:number,a1:number,tile:number=GROUND_TILE_UNITS):{f0:number;f1:number;c0:number;c1:number}[]{
  const len=a1-a0,eps=1e-6*tile,out:{f0:number;f1:number;c0:number;c1:number}[]=[];
  if(!(len>0)||!(tile>0))return out;
  let s=a0;
  while(s<a1-eps){
    const k=Math.floor((s+eps)/tile),start=k*tile;
    let e=Math.min(a1,start+tile);
    if(a1-e<eps)e=a1;
    out.push({f0:(s-a0)/len,f1:(e-a0)/len,c0:Math.max(0,(s-start)/tile),c1:Math.min(1,(e-start)/tile)});
    s=e;
  }
  return out;
}

/**
 * UV patches of the world rect [x0,x1]×[y0,y1] (one cell): UV = world position / tile, taken inside the tile that holds
 * each patch, so a frame of an atlas can be used without texture repeat and the tile stays continuous everywhere.
 */
export function cellUvPatches(x0:number,y0:number,x1:number,y1:number,tile:number=GROUND_TILE_UNITS):UvPatch[]{
  const out:UvPatch[]=[];
  for(const ty of tileSpans(y0,y1,tile))for(const tx of tileSpans(x0,x1,tile))
    out.push({s0:tx.f0,s1:tx.f1,t0:ty.f0,t1:ty.f1,u0:tx.c0,u1:tx.c1,v0:ty.c0,v1:ty.c1});
  return out;
}

/** Maps a tile UV into a texture frame's UV rect (u0..u1, v0..v1 as Phaser frames give them). */
export function frameUv(u:number,v:number,frame:{u0:number;v0:number;u1:number;v1:number}):[number,number]{
  return [frame.u0+u*(frame.u1-frame.u0),frame.v0+v*(frame.v1-frame.v0)];
}

/**
 * Slope shading over a textured ground cell, the same rule as palette.groundColor on the flat ground: lit slopes
 * lighten toward white, slopes facing away blend toward the kind's measured detail tone (mixing toward a colour by t
 * is that colour drawn over at alpha t). Undefined on flat ground and water.
 */
export function groundShadeOverlay(kind:GroundKind,shade:number):{color:number;alpha:number}|undefined{
  if(kind==='water'||!(shade<0||shade>0))return undefined;
  return shade>0?{color:0xffffff,alpha:GROUND_LIGHTEN*Math.min(1,shade)}:{color:GROUND_COLORS[kind].detail,alpha:GROUND_TOWARD_DETAIL*Math.min(1,-shade)};
}

/** Texture lookup the registry needs from the scene (Phaser's TextureManager in the layer, a set in tests). */
export interface TextureLookup {
  has(key:string):boolean;
  /** Frames of a texture besides Phaser's `__BASE` (1 for a plain image). */
  frames(key:string):number;
}

/**
 * Which material draws each thing, decided from the textures present when a chunk is built (art can arrive later:
 * nothing is cached, a chunk built after the texture loads uses it).
 */
export class CityMaterials {
  private readonly textures:TextureLookup;
  constructor(textures:TextureLookup){this.textures=textures;}
  /** Frames of a loaded texture (1 for a plain image). */
  frames(key:string):number{return this.textures.frames(key);}
  /** Ground texture key of a kind, or undefined (flat colour). */
  ground(kind:GroundKind):string|undefined{const k=groundTextureKey(kind);return this.textures.has(k)?k:undefined;}
  /** Whether the procedural ground decor is drawn over cells of this kind (not over painted ground). */
  decorOver(kind:GroundKind):boolean{return this.ground(kind)===undefined;}
  /** Building sheet for a block, with the frame for the view; only buildings take sheets. */
  building(block:CityBlock,view:number):(BuildingMatch&{frame:number})|undefined{
    if(block.kind!=='building')return undefined;
    const m=matchBuilding(block,k=>this.textures.has(k));
    return m?{...m,frame:buildingFrame(view,m.turns,this.textures.frames(m.key))}:undefined;
  }
  /** Prop sheet key and frame, or undefined (procedural / pine sheet). */
  prop(kind:PropKind,view:number):{key:string;frame:number}|undefined{
    if(kind==='pine')return undefined;
    const k=propTextureKey(kind);
    return this.textures.has(k)?{key:k,frame:propFrame(view,this.textures.frames(k))}:undefined;
  }
}
