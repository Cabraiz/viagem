/**
 * Which ground tile goes in which render target, and when it is baked (terreno-em-blocos). Pure: the GPU side is a
 * backend (renderer.ts), so the pool's choices are tested in Node (tests/terrain-chunks.test.ts). Erasable TypeScript
 * only (no parameter properties): the tests run with --experimental-strip-types.
 *
 * Every frame (`update`) with the camera view in world px:
 * - tiles beyond the keep ring give their slot back;
 * - visible tiles that are missing: the one under the focus (the hero, or who the camera follows) and the one at the
 *   view centre at once, then at most URGENT_PER_FRAME more per frame, nearest first (a jump of the camera, such as
 *   watching a far teammate, a rematch or a reconnection, never bakes a whole screen in one frame); `whole` (the first
 *   frame, a resize, a view turn) bakes every visible tile now;
 * - then the prefetch ring: one chunk lattice, or 1 to BANDS bands of the nearest missing tile.
 * Only the visible tiles are shown.
 */
import {KEEP_TILES,PREFETCH_TILES,TILE_PX,inRange,tileRange,tilesByDistance,type Rect,type TileId,type TileRange} from './tiles.ts';

/** A tile of the ring is baked in this many horizontal bands (a whole tile is ~16k fragments of the relief shader). */
export const BANDS=4;
/** Missing ring tiles per extra band in a frame: 1-3 missing → 1 band, a whole missing row (6-9) → 2-3. */
export const RING_PER_BAND=3;
/** Visible missing tiles baked per frame beyond the focus and centre tiles (the rest show the ground colour a moment). */
export const URGENT_PER_FRAME=4;

/** Numeric key of a tile (no string per lookup): tiles stay within ±2^20 of the origin (WORLD_LIMIT is 1 M units). */
const OFFSET=1<<20,SPAN=1<<21;
export const tileKey=(ix:number,iy:number)=>(ix+OFFSET)*SPAN+(iy+OFFSET);

export interface PoolSlot {
  tile?:TileId;
  /** View the tile was baked for; -1 while it has to be baked (new tile, view turn, context restored). */
  baked:number;
  /** A bake in progress: the view it is for (-1: none) and the next band. */
  pending:number;band:number;
  shown:boolean;
}
export interface PoolBackend<S extends PoolSlot> {
  /** A new render target (only when the pool has to grow: making one stalls on the GPU). */
  create():S;
  /** Whether the data of a tile can be built now. Not urgent: it may build one missing chunk lattice and say no. */
  ready(t:TileId,angle:number,urgent:boolean):boolean;
  /** First band of a bake: fill the tile's height texture. */
  start(s:S,t:TileId,angle:number):void;
  /** Draws bands [from, to) of the slot's tile. */
  bands(s:S,from:number,to:number):void;
  /** All bands drawn: place the image, set up the water layer. */
  finish(s:S):void;
  /** The slot leaves its tile: hide it, give its water layer back. */
  release(s:S):void;
  /** Visibility (a tile coming into view may need its water in phase with its neighbours). */
  show(s:S,on:boolean):void;
}
export interface PoolStats {slots:number;live:number;bakes:number;urgent:number;deferred:number;lattices:number;grown:number}

export class TilePool<S extends PoolSlot> {
  readonly slots:S[]=[];
  private byKey=new Map<number,S>();
  angle=0;
  private wanted:TileRange={ix0:0,iy0:0,ix1:-1,iy1:-1};
  private view:Rect={x:0,y:0,w:1,h:1};
  readonly stats:PoolStats={slots:0,live:0,bakes:0,urgent:0,deferred:0,lattices:0,grown:0};
  private backend:PoolBackend<S>;
  constructor(backend:PoolBackend<S>,size:number){this.backend=backend;for(let i=0;i<size;i++)this.slots.push(backend.create());this.stats.slots=size;}
  /** A view turn (or a lost context): every tile is stale, baked again for `angle`. */
  invalidate(angle=this.angle){this.angle=angle;for(const s of this.slots){s.baked=-1;s.pending=-1;}}
  ready(t:TileId){const s=this.byKey.get(tileKey(t.ix,t.iy));return !!s&&s.baked===this.angle;}
  slotOf(t:TileId){return this.byKey.get(tileKey(t.ix,t.iy));}
  private missing(r:TileRange){
    for(let iy=r.iy0;iy<=r.iy1;iy++)for(let ix=r.ix0;ix<=r.ix1;ix++){const s=this.byKey.get(tileKey(ix,iy));if(!s||s.baked!==this.angle)return true;}
    return false;
  }
  update(v:Rect,options:{focus?:{x:number;y:number};whole?:boolean}={}){
    const visible=tileRange(v),wanted=tileRange(v,PREFETCH_TILES),keep=tileRange(v,KEEP_TILES);
    this.view=v;this.wanted=wanted;
    for(const s of this.slots)if(s.tile&&!inRange(s.tile,keep))this.release(s);
    if(this.missing(wanted)){
      if(this.missing(visible)){
        const list=tilesByDistance(visible,v).filter(t=>!this.ready(t));
        const first=new Set<number>();
        const at=(p:{x:number;y:number})=>first.add(tileKey(Math.floor(p.x/TILE_PX),Math.floor(p.y/TILE_PX)));
        at({x:v.x+v.w/2,y:v.y+v.h/2});if(options.focus)at(options.focus);
        let extra=options.whole?Infinity:URGENT_PER_FRAME;
        for(const t of list){
          const now=first.has(tileKey(t.ix,t.iy))||extra-->0;
          if(!now){this.stats.deferred++;continue;}
          this.backend.ready(t,this.angle,true);this.bake(t,BANDS);this.stats.urgent++;
        }
      }
      const order=tilesByDistance(wanted,v),next=order.find(t=>!this.ready(t));
      if(next){
        const started=this.slotOf(next),behind=order.reduce((n,t)=>n+(this.ready(t)?0:1),0);
        const bands=Math.max(1,Math.min(BANDS,Math.ceil(behind/RING_PER_BAND)));
        if(started&&started.pending===this.angle)this.bake(next,bands);
        else if(this.backend.ready(next,this.angle,false))this.bake(next,bands);
        else this.stats.lattices++;
      }
    }
    for(const s of this.slots){
      const on=!!s.tile&&s.baked===this.angle&&inRange(s.tile,visible);
      if(s.shown!==on){s.shown=on;this.backend.show(s,on);}
    }
    this.stats.live=this.byKey.size;this.stats.slots=this.slots.length;
  }
  private release(s:S){
    if(s.tile)this.byKey.delete(tileKey(s.tile.ix,s.tile.iy));
    s.tile=undefined;s.baked=-1;s.pending=-1;
    if(s.shown){s.shown=false;this.backend.show(s,false);}
    this.backend.release(s);
  }
  /** Slot of a tile: its own, a free one, the farthest one outside the prefetch ring, or (a bigger screen) a new one. */
  slotFor(t:TileId):S{
    const key=tileKey(t.ix,t.iy);
    let s=this.byKey.get(key)??this.slots.find(x=>!x.tile);
    if(!s){
      const v=this.view,cx=v.x+v.w/2,cy=v.y+v.h/2,d=(x:S)=>{const dx=(x.tile!.ix+.5)*TILE_PX-cx,dy=(x.tile!.iy+.5)*TILE_PX-cy;return dx*dx+dy*dy;};
      for(const x of this.slots)if(x.tile&&!inRange(x.tile,this.wanted)&&(!s||d(x)>d(s)))s=x;
    }
    if(!s){s=this.backend.create();this.slots.push(s);this.stats.grown++;}
    if(s.tile&&tileKey(s.tile.ix,s.tile.iy)!==key)this.release(s);
    s.tile={ix:t.ix,iy:t.iy};this.byKey.set(key,s);
    return s;
  }
  /** `bands` more bands of a tile; the first one fills its data, the last one makes it count as baked. */
  private bake(t:TileId,bands:number){
    const s=this.slotFor(t);
    if(s.pending!==this.angle){s.pending=this.angle;s.band=0;s.baked=-1;this.backend.start(s,t,this.angle);}
    const from=s.band,to=Math.min(BANDS,s.band+bands);
    this.backend.bands(s,from,to);s.band=to;
    if(to<BANDS)return;
    s.pending=-1;s.baked=this.angle;this.stats.bakes++;this.backend.finish(s);
  }
  /** Gives every slot back (scene shutdown); the backend frees the render targets. */
  destroy(){for(const s of this.slots)if(s.tile)this.release(s);const all=this.slots.splice(0);this.byKey.clear();return all;}
}
