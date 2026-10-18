/**
 * Chunked city layer (card cidade-03a): blocks cut into depth-sortable pieces, pieces and props bucketed
 * into square chunks of cells, and a tracker that decides which chunks the renderer should build or drop
 * for a camera rect. Pure logic (no Phaser); screen space is the one of projection.ts (world px, no zoom).
 */
import type {BlockKind,CityAsset,CityBlock,CityProp} from './asset.ts';
import {cellOf,groundZ,heightAt} from './asset.ts';
import type {Pt,Rect} from './projection.ts';
import {HEIGHT_PX,VIEW_PIVOT,boundsOf,normalizeView,project,rectsOverlap} from './projection.ts';

/** Chunk side in cells on the art's 0.88 u cell (the sample city; chunkCellsFor scales it to an asset's cell). */
export const CHUNK_CELLS=16;
/** Chunk side in world units: CHUNK_CELLS cells of 0.88 u (14.08 u), what a baked ground texture was sized for. */
export const CHUNK_UNITS=CHUNK_CELLS*0.88;
/**
 * Chunk side in cells for a cell size: the whole cells nearest CHUNK_UNITS, so a chunk (and its baked ground render
 * texture) keeps about the same world size and texel density on a bigger map: 16 at 0.88 u, 9 on the 1.7× Cidade Nevada
 * (1.496 u, 13.5 u; NEW-20261013-ORQ-cidade-escala-1-7).
 */
export const chunkCellsFor=(cell:number)=>cell>0&&Number.isFinite(cell)?Math.max(1,Math.round(CHUNK_UNITS/cell)):CHUNK_CELLS;
/**
 * Every block is cut into 1×1-cell pieces: a unit column sorts by its centre against other columns and against
 * point actors, which a whole building cannot (review of cidade-03a). The layer draws
 * the columns of one block that share a depth key in a single object, so the object count stays low.
 */
export const PIECE_MAX_CELLS=1;
/** Ruin bite floor, as a fraction of the block height. */
export const RUIN_FLOOR=0.6;
/** Ruined roofs: one side steps down in 2 or 3 steps of this fraction of the height (art bible §4.2). */
export const RUIN_STEP=0.12;
/** FNV-1a hash of a string, for decisions seeded by a block id (same in every client and view). */
export function hashId(id:string):number{
  let h=0x811c9dc5;
  for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return h>>>0;
}
/**
 * Stepped ruin roof: the side (n, e, s or w) and the number of steps (2 or 3, fewer on narrow blocks, always
 * leaving at least one full-height row) come from the block id. Returns the height factor of a cell.
 */
export function ruinStepFactor(b:CityBlock,i:number,j:number):number{
  const h=hashId(b.id),side=(['n','e','s','w'] as const)[h%4];
  const across=side==='n'||side==='s'?b.h:b.w;
  const steps=Math.min(2+((h>>>2)&1),across-1);
  if(steps<1)return 1;
  const d=side==='n'?j:side==='s'?b.h-1-j:side==='w'?i:b.w-1-i;
  return d<steps?1-RUIN_STEP*(steps-d):1;
}
/** Ruin bite (agreed with the art lane): a third of the block's shortest edge, at most 1 cell. */
export const ruinBite=(b:{w:number;h:number})=>Math.min(1,Math.min(b.w,b.h)/3);

/**
 * Screen extent of a prop above and beside its projected feet, in projected px. Must cover what city-layer.ts
 * draws: lamps are a pole of 14 r plus a 3 r head; pines use the approved sheet (353 px above the pivot at scale
 * 165/340 ≈ 171 px, 128 px half width ≈ 62 px) or a 3.2 r fallback; the rest stay under 2.5 r.
 */
/**
 * Largest drawn radius per prop kind (world units): the maps asset's footprint radii are collision sizes (up to 0.8),
 * far too big for a lamp pole or a crate next to a ~1 u hero. Lamps use the cap as a fixed size.
 */
export const PROP_DRAW_MAX:Readonly<Record<CityProp['kind'],number>>=Object.freeze({
  lamp:0.12,crate:0.3,barrel:0.22,bench:0.35,debris:0.45,rubble:0.45,car:0.6,pine:0.4,
});
/** Radius a prop is drawn with (world units). */
export const propDrawRadius=(prop:CityProp)=>prop.kind==='lamp'?PROP_DRAW_MAX.lamp:Math.min(prop.r,PROP_DRAW_MAX[prop.kind]);
export function propExtentPx(prop:CityProp):{up:number;side:number}{
  const r=propDrawRadius(prop)*HEIGHT_PX;
  if(prop.kind==='lamp')return {up:r*17+4,side:Math.max(r*3,4)};
  if(prop.kind==='pine')return {up:Math.max(353*165/340,r*3.2)+4,side:Math.max(128*165/340,r*1.2)+4};
  return {up:r*2.5+4,side:r*1.5+4};
}

/**
 * One cell of a block, drawn and depth-sorted as a unit box. x/y/w/h in cells (w = h = 1); `base` = the
 * LOWEST ground height under the whole block, shared by all its pieces (no floating walls on slopes, no
 * height steps between pieces), and `height` = box height above it (world units). `seams.<side>` = that edge
 * touches another piece of the same block (internal edge: no wall face, no outline). `bite` = ruin bite side
 * in cells, only on the world north-east piece of a ruined building.
 */
export interface BlockPiece {id:string;blockId:string;kind:BlockKind;x:number;y:number;w:number;h:number;height:number;
  ruined?:boolean;bite?:number;base:number;seams:{n:boolean;s:boolean;e:boolean;w:boolean};
  /** On a seam side, how much taller this piece is than its neighbour (world units; only when > 0). */
  drops?:{n?:number;s?:number;e?:number;w?:number}}

/** Cells [x0,x1)×[y0,y1). minBase/maxTop bound every height drawn by the chunk (world units). */
export interface CityChunk {key:string;cx:number;cy:number;x0:number;y0:number;x1:number;y1:number;
  pieces:BlockPiece[];props:CityProp[];minBase:number;maxTop:number}

export interface ChunkIndex {cols:number;rows:number;
  /** Chunk side in cells. */
  size:number;
  chunks:CityChunk[];get(cx:number,cy:number):CityChunk|undefined}

const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
const clamp=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;

/**
 * Lowest ground under a footprint: the lowest corner when the asset has exact corner heights (the ground is drawn
 * from them, so a block based on cell averages would float on slopes), else the lowest cell.
 */
function minGround(asset:CityAsset,x0:number,y0:number,x1:number,y1:number){
  let m=Infinity;
  if(asset.corners){
    const W=asset.width+1;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)m=Math.min(m,asset.corners[y*W+x]);
    return m;
  }
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)m=Math.min(m,heightAt(asset,x,y));
  return m;
}

/**
 * Cuts a block into 1×1 pieces, row-major (ids `${block}#${i}`), sharing the block's lowest ground as base.
 * Ruined buildings get a stepped roof (ruinStepFactor) and a bite on the north-east piece; `drops` records
 * where a piece stands above its neighbour so faces.ts closes the step with a wall.
 */
export function blockPieces(asset:CityAsset,b:CityBlock):BlockPiece[]{
  const base=minGround(asset,b.x,b.y,b.x+b.w,b.y+b.h),out:BlockPiece[]=[];
  const ruin=b.kind==='building'&&!!b.ruined;
  const bite=ruin?ruinBite(b):0;
  // A bite of a whole cell lowers the north-east column to the bite floor; neighbours close it with step walls.
  const top=(i:number,j:number)=>ruin&&bite>=1&&i===b.w-1&&j===0?height(i,j)*RUIN_FLOOR:height(i,j);
  const height=(i:number,j:number)=>ruin?b.height*ruinStepFactor(b,i,j):b.height;
  for(let j=0;j<b.h;j++)for(let i=0;i<b.w;i++){
    const ne=ruin&&i===b.w-1&&j===0,hh=height(i,j);
    const drops:{n?:number;s?:number;e?:number;w?:number}={};
    const near:[('n'|'s'|'e'|'w'),number,number][]=[['n',i,j-1],['s',i,j+1],['w',i-1,j],['e',i+1,j]];
    for(const [side,ni,nj] of near)if(ni>=0&&nj>=0&&ni<b.w&&nj<b.h&&top(i,j)-top(ni,nj)>1e-9)drops[side]=top(i,j)-top(ni,nj);
    out.push({id:`${b.id}#${j*b.w+i}`,blockId:b.id,kind:b.kind,x:b.x+i,y:b.y+j,w:1,h:1,height:hh,
      ...(b.ruined?{ruined:true}:{}),...(ne?{bite:ruinBite(b)}:{}),base,
      seams:{n:j>0,s:j<b.h-1,w:i>0,e:i<b.w-1},...(Object.keys(drops).length?{drops}:{})});
  }
  return out;
}

/** Buckets the asset into chunks: a piece goes to the chunk of its footprint centre cell, a prop to the chunk of its cell. */
export function buildChunks(asset:CityAsset,chunkCells=chunkCellsFor(asset.cell)):ChunkIndex{
  const size=Math.max(1,Math.floor(chunkCells));
  const cols=Math.ceil(asset.width/size),rows=Math.ceil(asset.height/size);
  const chunks:CityChunk[]=[];
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    chunks.push({key:`${cx},${cy}`,cx,cy,x0:cx*size,y0:cy*size,x1:Math.min(asset.width,(cx+1)*size),y1:Math.min(asset.height,(cy+1)*size),
      pieces:[],props:[],minBase:0,maxTop:0});
  }
  const at=(x:number,y:number)=>chunks[Math.floor(clamp(y,0,asset.height-1)/size)*cols+Math.floor(clamp(x,0,asset.width-1)/size)];
  for(const b of asset.blocks)for(const p of blockPieces(asset,b))at(p.x,p.y).pieces.push(p);
  for(const p of asset.props){const c=cellOf(asset,p.x,p.y);at(c.cx,c.cy).props.push(p);}
  for(const c of chunks){
    c.pieces.sort(byId);c.props.sort(byId);
    // Ground quads average corner heights with the neighbouring ring, so it counts for the bounds too.
    let lo=Infinity,hi=-Infinity;
    for(let y=Math.max(0,c.y0-1);y<Math.min(asset.height,c.y1+1);y++)for(let x=Math.max(0,c.x0-1);x<Math.min(asset.width,c.x1+1);x++){
      const h=heightAt(asset,x,y);if(h<lo)lo=h;if(h>hi)hi=h;
    }
    // Relief (cidade-relevo): the ground and the props follow the corner heights (groundZ), which can dip below or rise
    // above a cell's average height; bound them too so a chunk is not culled a few pixels early on a hill.
    const corners=asset.corners;
    if(corners){
      const W=asset.width+1;
      for(let y=Math.max(0,c.y0-1);y<=Math.min(asset.height,c.y1+1);y++)for(let x=Math.max(0,c.x0-1);x<=Math.min(asset.width,c.x1+1);x++){
        const h=corners[y*W+x];if(h<lo)lo=h;if(h>hi)hi=h;
      }
    }
    for(const p of c.props){const z=groundZ(asset,p.x,p.y);if(z<lo)lo=z;if(z>hi)hi=z;}
    for(const p of c.pieces)hi=Math.max(hi,p.base+p.height);
    c.minBase=lo;c.maxTop=hi;
  }
  return {cols,rows,size,chunks,get:(cx,cy)=>cx>=0&&cy>=0&&cx<cols&&cy<rows?chunks[cy*cols+cx]:undefined};
}

/**
 * Conservative screen rect of everything the chunk draws: its cells (pieces are unit cells inside them)
 * projected at minBase and maxTop, united with each prop's drawn extent (propExtentPx) around its feet.
 */
export function chunkScreenBounds(chunk:CityChunk,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):Rect{
  const {cell,origin}=asset;
  const x0=origin.x+chunk.x0*cell,y0=origin.y+chunk.y0*cell,x1=origin.x+chunk.x1*cell,y1=origin.y+chunk.y1*cell;
  const pts:Pt[]=[];
  for(const z of [chunk.minBase,chunk.maxTop])for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]])pts.push(project(x,y,z,view,pivot));
  for(const p of chunk.props){
    const {up,side}=propExtentPx(p);
    for(const z of [chunk.minBase,chunk.maxTop]){
      const f=project(p.x,p.y,z,view,pivot);
      pts.push({x:f.x-side,y:f.y-up},{x:f.x+side,y:f.y+side});
    }
  }
  return boundsOf(pts);
}

const grow=(r:Rect,m:number):Rect=>({x:r.x-m,y:r.y-m,w:r.w+2*m,h:r.h+2*m});

/**
 * Decides which chunks are on screen. A chunk is wanted when its bounds overlap the camera grown by
 * showMarginPx and is dropped only once it leaves the camera grown by keepMarginPx (hysteresis). New chunks
 * come in at most maxShowPerUpdate per update, nearest to the camera centre first. A view change drops
 * everything (the caller applies `hide` before `show`; a key may be in both on that update).
 */
export class ChunkTracker {
  readonly index:ChunkIndex;
  readonly asset:CityAsset;
  readonly showMarginPx:number;
  readonly keepMarginPx:number;
  readonly maxShowPerUpdate:number;
  readonly pivot:Pt;
  private readonly byKey=new Map<string,CityChunk>();
  /** Screen bounds per view (0..3) by chunk: read for every chunk on every frame, so no key string is built. */
  private readonly cache:Map<CityChunk,Rect>[]=[new Map(),new Map(),new Map(),new Map()];
  private readonly shown=new Set<string>();
  private view:number|undefined=undefined;

  constructor(index:ChunkIndex,asset:CityAsset,options:{showMarginPx?:number;keepMarginPx?:number;maxShowPerUpdate?:number;pivot?:Pt}={}){
    this.index=index;this.asset=asset;
    this.showMarginPx=options.showMarginPx??128;
    this.keepMarginPx=Math.max(this.showMarginPx,options.keepMarginPx??384);
    this.maxShowPerUpdate=Math.max(1,Math.floor(options.maxShowPerUpdate??4));
    this.pivot=options.pivot??VIEW_PIVOT;
    for(const c of index.chunks)this.byKey.set(c.key,c);
  }

  /** Cached screen bounds of a chunk in a view. */
  bounds(chunk:CityChunk,view:number):Rect{
    const v=normalizeView(view),cache=this.cache[v];
    let r=cache.get(chunk);
    if(!r){r=chunkScreenBounds(chunk,this.asset,v,this.pivot);cache.set(chunk,r);}
    return r;
  }

  /** Forgets every shown chunk (e.g. the layer was destroyed); the next update starts over. */
  reset(){this.shown.clear();this.view=undefined;}

  update(camera:Rect,view:number):{show:string[];hide:string[]}{
    const v=normalizeView(view),hide:string[]=[];
    // After a rotation the whole screen is new: every chunk the camera itself meets comes back at once instead of leaving
    // holes; the ring ahead of it (showMarginPx) follows at the per-update budget (NEW-20261018-ORQ-chunks-cidade-sem-pico).
    let budget=this.maxShowPerUpdate;
    const turned=this.view!==v&&this.view!==undefined;
    if(this.view!==v){hide.push(...[...this.shown].sort());this.shown.clear();this.view=v;}
    const keep=grow(camera,this.keepMarginPx),want=grow(camera,this.showMarginPx);
    for(const key of [...this.shown].sort()){
      const c=this.byKey.get(key);
      if(!c||!rectsOverlap(this.bounds(c,v),keep)){this.shown.delete(key);hide.push(key);}
    }
    const mx=camera.x+camera.w/2,my=camera.y+camera.h/2,cand:{key:string;d:number;on:boolean}[]=[];
    for(const c of this.index.chunks){
      if(this.shown.has(c.key))continue;
      const b=this.bounds(c,v);
      if(rectsOverlap(b,want))cand.push({key:c.key,d:(b.x+b.w/2-mx)**2+(b.y+b.h/2-my)**2,on:turned&&rectsOverlap(b,camera)});
    }
    cand.sort((a,b)=>Number(b.on)-Number(a.on)||a.d-b.d||(a.key<b.key?-1:a.key>b.key?1:0));
    if(turned)budget=Math.max(budget,cand.filter(c=>c.on).length);
    const show=cand.slice(0,budget).map(c=>c.key);
    for(const k of show)this.shown.add(k);
    return {show,hide};
  }

  /** Of `keys`, the chunk nearest the camera centre in this view (ties by key), or undefined when there is none. */
  nearest(keys:Iterable<string>,camera:Rect,view:number):string|undefined{
    const v=normalizeView(view),mx=camera.x+camera.w/2,my=camera.y+camera.h/2;
    let best:string|undefined,bestD=Infinity;
    for(const key of keys){
      const c=this.byKey.get(key);
      if(!c)continue;
      const b=this.bounds(c,v),d=(b.x+b.w/2-mx)**2+(b.y+b.h/2-my)**2;
      if(d<bestD||(d===bestD&&best!==undefined&&key<best)){best=key;bestD=d;}
    }
    return best;
  }

  /** Keys currently shown, sorted. */
  visible():string[]{return [...this.shown].sort();}
}
