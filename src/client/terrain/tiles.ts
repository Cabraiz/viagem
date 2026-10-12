/**
 * Ground tiles of the endless world (NEW-20261009-ORQ-terreno-em-blocos). Pure math, no Phaser, tested in Node.
 *
 * The ground is drawn by a relief shader that ray-marches each screen pixel down to the terrain (shaders.ts). On the
 * island one 1024×768 bake covered the whole map; the endless world has no edge, so the screen (world px of the current
 * view) is cut into square tiles of TILE_PX, and only the tiles around the camera are baked, each into its own small
 * render target from a pool. Every tile gets its own little height texture (FIELD_TEXELS², one texel per half unit,
 * on the *global* half-unit lattice of chunks.ts), so two tiles that look at the same ground point sample the very
 * same texels: no seam between tiles, and none between chunks either (the chunk lattices share their borders).
 *
 * The footprint of a tile on the ground: a screen pixel (wx, wy) sees the ground point
 *   q = ((wy + z)/42 + wx/84, (wy + z)/42 − wx/84)   (view coordinates, then turned back by the view)
 * for the height z where the ray meets the relief, z ∈ [0, ENDLESS_MAX_HEIGHT]. The shader also looks a little around
 * that point (slope ±0.125, a short self-shadow up to SHADOW_REACH along the sun), so each tile's texture covers its
 * footprint plus FIELD_MARGIN on every side.
 */
import {CHUNK_SIZE,CHUNK_STEP,CHUNK_SAMPLES,type ChunkWorld} from '../../maps/terrain/chunks.ts';
import {TILE_X} from '../../contract/offscreen.ts';

/** Side of a ground tile in world px (screen space of the view). 256 px ≈ 2 s of walking across it. */
export const TILE_PX=256;
/** Render target of a tile: 2 world px per texel, like the island's 1024×768 bake over 2200×1650 px. */
export const TILE_TEXELS=128;
/** Water render target of a tile (animated, only on tiles that hold a lake): 4 world px per texel, as before. */
export const WATER_TEXELS=64;
/** Top of the endless relief for the shader's bisection (relief ≤ 30.75 after the 8-bit code; offscreen.ts uses 40). */
export const ENDLESS_MAX_HEIGHT=40;
/** Ground units looked at around the footprint: self-shadow (6 × 0.35 along the sun: 1.25 u), slope (0.125) and the bilinear texel (0.5). */
export const FIELD_MARGIN=2;
/** Height texture of a tile: FIELD_TEXELS² samples every CHUNK_STEP (0.5 u) on the global lattice. */
export const FIELD_STEP=CHUNK_STEP,FIELD_TEXELS=32;
/** Tiles kept around the view beyond the visible ones, baked ahead of the camera (one per frame). */
export const PREFETCH_TILES=1;
/** A tile leaves its slot only when it is this many tiles beyond the prefetch ring (no thrashing at a border). */
export const KEEP_TILES=PREFETCH_TILES+1;

export interface Rect {x:number;y:number;w:number;h:number}
export interface Box {x0:number;y0:number;x1:number;y1:number}
export interface TileRange {ix0:number;iy0:number;ix1:number;iy1:number}
export interface TileId {ix:number;iy:number}

/** Tiles overlapping a rect (world px), grown by `ring` tiles on every side. */
export function tileRange(r:Rect,ring=0):TileRange{
  return {ix0:Math.floor(r.x/TILE_PX)-ring,iy0:Math.floor(r.y/TILE_PX)-ring,ix1:Math.floor((r.x+r.w)/TILE_PX)+ring,iy1:Math.floor((r.y+r.h)/TILE_PX)+ring};
}
export const inRange=(t:TileId,r:TileRange)=>t.ix>=r.ix0&&t.ix<=r.ix1&&t.iy>=r.iy0&&t.iy<=r.iy1;
/** Tiles of a range, nearest to the centre of `r` first (the order they are baked in). */
export function tilesByDistance(range:TileRange,r:Rect):TileId[]{
  const cx=r.x+r.w/2,cy=r.y+r.h/2,out:{ix:number;iy:number;d:number}[]=[];
  for(let iy=range.iy0;iy<=range.iy1;iy++)for(let ix=range.ix0;ix<=range.ix1;ix++){
    const dx=(ix+.5)*TILE_PX-cx,dy=(iy+.5)*TILE_PX-cy;out.push({ix,iy,d:dx*dx+dy*dy});
  }
  return out.sort((a,b)=>a.d-b.d).map(({ix,iy})=>({ix,iy}));
}
/** World point seen at view coordinates q, the inverse of projection.ts viewPoint (turn around the island centre). */
function unturn(x:number,y:number,view:number){
  const dx=x-12,dy=y-12;
  switch(((view%4)+4)%4){
    case 1:return {x:12+dy,y:12-dx};
    case 2:return {x:12-dx,y:12-dy};
    case 3:return {x:12-dy,y:12+dx};
    default:return {x,y};
  }
}
/**
 * Ground box (world units) a screen rect can show for heights 0..maxHeight, in a view: the inverse of
 * projection.ts projectView, which is a box in view coordinates turned by a multiple of 90° (still a box).
 */
export function groundBox(r:Rect,view:number,maxHeight=ENDLESS_MAX_HEIGHT,margin=0):Box{
  const qx0=r.y/TILE_X+r.x/(2*TILE_X),qx1=(r.y+r.h+maxHeight)/TILE_X+(r.x+r.w)/(2*TILE_X);
  const qy0=r.y/TILE_X-(r.x+r.w)/(2*TILE_X),qy1=(r.y+r.h+maxHeight)/TILE_X-r.x/(2*TILE_X);
  const a=unturn(qx0,qy0,view),b=unturn(qx1,qy1,view);
  return {x0:Math.min(a.x,b.x)-margin,y0:Math.min(a.y,b.y)-margin,x1:Math.max(a.x,b.x)+margin,y1:Math.max(a.y,b.y)+margin};
}
/** Screen rect (world px) of a tile. */
export const tileRect=(t:TileId):Rect=>({x:t.ix*TILE_PX,y:t.iy*TILE_PX,w:TILE_PX,h:TILE_PX});

/** Origin (world units) of a tile's height texture: the footprint's corner snapped down to the global lattice. */
export function fieldOrigin(t:TileId,view:number){
  const b=groundBox(tileRect(t),view,ENDLESS_MAX_HEIGHT,FIELD_MARGIN);
  return {x:Math.floor(b.x0/FIELD_STEP)*FIELD_STEP,y:Math.floor(b.y0/FIELD_STEP)*FIELD_STEP,box:b};
}
/** Chunks (cx, cy) whose lattice a tile's height texture reads. */
export function fieldChunks(origin:{x:number;y:number}):TileId[]{
  const span=(FIELD_TEXELS-1)*FIELD_STEP,out:TileId[]=[];
  const cx0=Math.floor(origin.x/CHUNK_SIZE),cy0=Math.floor(origin.y/CHUNK_SIZE),cx1=Math.floor((origin.x+span)/CHUNK_SIZE),cy1=Math.floor((origin.y+span)/CHUNK_SIZE);
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++)out.push({ix:cx,iy:cy});
  return out;
}
/** Decoded bed under which a lattice sample may show water (the land shader cuts below 0.25; bilinear stays above the min). */
const WATER_CODE=Math.floor((1+32)/160*255);
const TRAIL_EPS=1/512;
/**
 * Fills a tile's height texture (RGBA, FIELD_TEXELS², row j = y): R the chunk lattice's 8-bit height code (the very
 * code chunks.ts decodes, so the GPU's bilinear equals the server's), G wetness, B the dirt trail, A 255.
 * Reads lattices through `lattice(cx, cy)`, which builds missing ones (the caller budgets that). Returns whether any
 * sample is low enough for a lake to show (the tile then gets a water layer under the land).
 */
export function fillField(world:ChunkWorld,origin:{x:number;y:number},out:Uint8Array,lattice:(cx:number,cy:number)=>Uint8Array=(cx,cy)=>world.lattice(cx,cy)){
  let water=false,cx=NaN,cy=NaN,heights:Uint8Array|undefined;
  // Global lattice indices of the origin (exact: the origin is a multiple of FIELD_STEP).
  const gi0=Math.round(origin.x/FIELD_STEP),gj0=Math.round(origin.y/FIELD_STEP),per=CHUNK_SIZE/FIELD_STEP;
  for(let j=0;j<FIELD_TEXELS;j++){
    const gj=gj0+j,y=gj*FIELD_STEP;
    for(let i=0;i<FIELD_TEXELS;i++){
      const gi=gi0+i,x=gi*FIELD_STEP,ccx=Math.floor(gi/per),ccy=Math.floor(gj/per);
      if(ccx!==cx||ccy!==cy){cx=ccx;cy=ccy;heights=lattice(cx,cy);}
      const code=heights![(gj-ccy*per)*CHUNK_SAMPLES+(gi-ccx*per)],k=(j*FIELD_TEXELS+i)*4;
      out[k]=code;if(code<=WATER_CODE)water=true;
      out[k+1]=Math.round(Math.min(1,Math.max(0,world.wetness(x,y)))*255);
      const trail=world.trail(x,y);out[k+2]=trail<TRAIL_EPS?0:Math.round(trail*255);
      out[k+3]=255;
    }
  }
  return water;
}
/** Chunks whose obstacles and points of interest may show on a screen rect (trees rise above their feet). */
export const PROP_UP_PX=300,PROP_SIDE_PX=80;
export function propChunks(r:Rect,view:number,ring=0):TileRange{
  const b=groundBox({x:r.x-PROP_SIDE_PX,y:r.y,w:r.w+2*PROP_SIDE_PX,h:r.h+PROP_UP_PX},view,ENDLESS_MAX_HEIGHT,1);
  return {ix0:Math.floor(b.x0/CHUNK_SIZE)-ring,iy0:Math.floor(b.y0/CHUNK_SIZE)-ring,ix1:Math.floor(b.x1/CHUNK_SIZE)+ring,iy1:Math.floor(b.y1/CHUNK_SIZE)+ring};
}
