/**
 * Chunked city layer (card cidade-03a): blocks cut into depth-sortable pieces, pieces and props bucketed
 * into square chunks of cells, and a tracker that decides which chunks the renderer should build or drop
 * for a camera rect. Pure logic (no Phaser); screen space is the one of projection.ts (world px, no zoom).
 */
import type {BlockKind,CityAsset,CityBlock,CityProp} from './asset.ts';
import {cellOf,heightAt} from './asset.ts';
import type {Pt,Rect} from './projection.ts';
import {HEIGHT_PX,VIEW_PIVOT,boundsOf,normalizeView,project,rectsOverlap} from './projection.ts';

/** Chunk side in cells. */
export const CHUNK_CELLS=16;
/** Longest piece (cells along the long axis) for walls, cliffs and rubble; buildings stay whole. */
export const PIECE_MAX_CELLS=2;
/** Screen padding per world unit of the largest prop radius (props are sprites up to ~4 r tall). */
const PROP_PAD_PER_R=4*HEIGHT_PX;

/**
 * Part of a block drawn and depth-sorted as one box. x/y/w/h in cells; `base` = max ground height under
 * the footprint and `height` = box height above it (world units). `seams.<side>` = that edge touches
 * another piece of the same block (internal edge: no wall face, no outline).
 */
export interface BlockPiece {id:string;blockId:string;kind:BlockKind;x:number;y:number;w:number;h:number;height:number;
  ruined?:boolean;base:number;seams:{n:boolean;s:boolean;e:boolean;w:boolean}}

/** Cells [x0,x1)×[y0,y1). minBase/maxTop bound every height drawn by the chunk (world units). */
export interface CityChunk {key:string;cx:number;cy:number;x0:number;y0:number;x1:number;y1:number;
  pieces:BlockPiece[];props:CityProp[];minBase:number;maxTop:number}

export interface ChunkIndex {cols:number;rows:number;chunks:CityChunk[];get(cx:number,cy:number):CityChunk|undefined}

const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
const clamp=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;

function maxGround(asset:CityAsset,x0:number,y0:number,x1:number,y1:number){
  let m=-Infinity;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)m=Math.max(m,heightAt(asset,x,y));
  return m;
}

/** Cuts a block into pieces: buildings whole, the rest in ≤PIECE_MAX_CELLS segments along the long axis (x on ties). */
export function blockPieces(asset:CityAsset,b:CityBlock):BlockPiece[]{
  const alongX=b.w>=b.h,len=alongX?b.w:b.h;
  const n=b.kind==='building'?1:Math.ceil(len/PIECE_MAX_CELLS);
  const out:BlockPiece[]=[];
  for(let i=0;i<n;i++){
    const off=n===1?0:i*PIECE_MAX_CELLS,size=n===1?len:Math.min(PIECE_MAX_CELLS,len-off);
    const x=alongX?b.x+off:b.x,y=alongX?b.y:b.y+off,w=alongX?size:b.w,h=alongX?b.h:size;
    const prev=i>0,next=i<n-1;
    out.push({id:`${b.id}#${i}`,blockId:b.id,kind:b.kind,x,y,w,h,height:b.height,...(b.ruined?{ruined:true}:{}),
      base:maxGround(asset,x,y,x+w,y+h),
      seams:alongX?{n:false,s:false,w:prev,e:next}:{n:prev,s:next,w:false,e:false}});
  }
  return out;
}

/** Buckets the asset into chunks: a piece goes to the chunk of its footprint centre cell, a prop to the chunk of its cell. */
export function buildChunks(asset:CityAsset,chunkCells=CHUNK_CELLS):ChunkIndex{
  const size=Math.max(1,Math.floor(chunkCells));
  const cols=Math.ceil(asset.width/size),rows=Math.ceil(asset.height/size);
  const chunks:CityChunk[]=[];
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    chunks.push({key:`${cx},${cy}`,cx,cy,x0:cx*size,y0:cy*size,x1:Math.min(asset.width,(cx+1)*size),y1:Math.min(asset.height,(cy+1)*size),
      pieces:[],props:[],minBase:0,maxTop:0});
  }
  const at=(x:number,y:number)=>chunks[Math.floor(clamp(y,0,asset.height-1)/size)*cols+Math.floor(clamp(x,0,asset.width-1)/size)];
  for(const b of asset.blocks)for(const p of blockPieces(asset,b))at(p.x+Math.floor((p.w-1)/2),p.y+Math.floor((p.h-1)/2)).pieces.push(p);
  for(const p of asset.props){const c=cellOf(asset,p.x,p.y);at(c.cx,c.cy).props.push(p);}
  for(const c of chunks){
    c.pieces.sort(byId);c.props.sort(byId);
    // Ground quads average corner heights with the neighbouring ring, so it counts for the bounds too.
    let lo=Infinity,hi=-Infinity;
    for(let y=Math.max(0,c.y0-1);y<Math.min(asset.height,c.y1+1);y++)for(let x=Math.max(0,c.x0-1);x<Math.min(asset.width,c.x1+1);x++){
      const h=heightAt(asset,x,y);if(h<lo)lo=h;if(h>hi)hi=h;
    }
    for(const p of c.pieces)hi=Math.max(hi,p.base+p.height);
    c.minBase=lo;c.maxTop=hi;
  }
  return {cols,rows,chunks,get:(cx,cy)=>cx>=0&&cy>=0&&cx<cols&&cy<rows?chunks[cy*cols+cx]:undefined};
}

/**
 * Conservative screen rect of everything the chunk draws: its world box (chunk cells grown to cover its
 * pieces' footprints and prop circles) projected at minBase and maxTop, padded for prop sprites.
 */
export function chunkScreenBounds(chunk:CityChunk,asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):Rect{
  const {cell,origin}=asset;
  let x0=origin.x+chunk.x0*cell,y0=origin.y+chunk.y0*cell,x1=origin.x+chunk.x1*cell,y1=origin.y+chunk.y1*cell,maxR=0;
  for(const p of chunk.pieces){
    x0=Math.min(x0,origin.x+p.x*cell);y0=Math.min(y0,origin.y+p.y*cell);
    x1=Math.max(x1,origin.x+(p.x+p.w)*cell);y1=Math.max(y1,origin.y+(p.y+p.h)*cell);
  }
  for(const p of chunk.props){x0=Math.min(x0,p.x-p.r);y0=Math.min(y0,p.y-p.r);x1=Math.max(x1,p.x+p.r);y1=Math.max(y1,p.y+p.r);maxR=Math.max(maxR,p.r);}
  const pts:Pt[]=[];
  for(const z of [chunk.minBase,chunk.maxTop])for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]])pts.push(project(x,y,z,view,pivot));
  const r=boundsOf(pts),pad=maxR*PROP_PAD_PER_R;
  return {x:r.x-pad,y:r.y-pad,w:r.w+2*pad,h:r.h+2*pad};
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
  private readonly cache=new Map<string,Rect>();
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
    const v=normalizeView(view),k=`${chunk.key}|${v}`;
    let r=this.cache.get(k);
    if(!r){r=chunkScreenBounds(chunk,this.asset,v,this.pivot);this.cache.set(k,r);}
    return r;
  }

  update(camera:Rect,view:number):{show:string[];hide:string[]}{
    const v=normalizeView(view),hide:string[]=[];
    if(this.view!==v){hide.push(...[...this.shown].sort());this.shown.clear();this.view=v;}
    const keep=grow(camera,this.keepMarginPx),want=grow(camera,this.showMarginPx);
    for(const key of [...this.shown].sort()){
      const c=this.byKey.get(key);
      if(!c||!rectsOverlap(this.bounds(c,v),keep)){this.shown.delete(key);hide.push(key);}
    }
    const mx=camera.x+camera.w/2,my=camera.y+camera.h/2,cand:{key:string;d:number}[]=[];
    for(const c of this.index.chunks){
      if(this.shown.has(c.key))continue;
      const b=this.bounds(c,v);
      if(rectsOverlap(b,want))cand.push({key:c.key,d:(b.x+b.w/2-mx)**2+(b.y+b.h/2-my)**2});
    }
    cand.sort((a,b)=>a.d-b.d||(a.key<b.key?-1:a.key>b.key?1:0));
    const show=cand.slice(0,this.maxShowPerUpdate).map(c=>c.key);
    for(const k of show)this.shown.add(k);
    return {show,hide};
  }

  /** Keys currently shown, sorted. */
  visible():string[]{return [...this.shown].sort();}
}
