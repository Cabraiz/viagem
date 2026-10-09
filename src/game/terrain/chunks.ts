/**
 * Endless world in chunks (D-019, Mad Forest): relief, lakes, trails, vegetation and rocks are a pure
 * function of (seed, cx, cy), so the server and every client build byte-identical chunks in any order.
 * The cache only saves time: evicting a chunk and building it again gives the same chunk, which is what
 * keeps the simulation deterministic while memory stays bounded.
 *
 * Only +, -, *, /, Math.sqrt, Math.floor and Math.imul are used to build a chunk (all exact in IEEE 754),
 * never Math.sin/exp/hypot, whose last bit may differ between V8 (Worker) and JavaScriptCore (iPhone).
 */
import {Rng} from '../sim/rng.ts';
import {treeCatalog} from '../tree-catalog.ts';
import {fbm,hash2u,mix,noise,smooth} from './noise.ts';

/** Bump when the generator changes: old and new chunks must never meet in one room. */
export const CHUNK_VERSION=1;
export const CHUNK_SIZE=32;
/** Height samples every half unit, borders shared with the neighbour (65×65 per chunk). */
export const CHUNK_STEP=.5,CHUNK_SAMPLES=CHUNK_SIZE/CHUNK_STEP+1;
/** The base (wall) sits at the origin inside a clearing with no lake or obstacle. */
export const BASE={x:0,y:0} as const;
export const BASE_CLEAR=9;
/** `coast` is the exact distance to the nearest lake shore up to this cap (lakes never reach a neighbour chunk). */
export const COAST_CAP=3.5;
/** Lakes shape the relief this far from their shore (shore ramp 6 per unit); it never crosses a chunk border. */
export const LAKE_INFLUENCE=5.2;
/** Largest obstacle radius: callers widen their search box by it. */
export const MAX_OBSTACLE_RADIUS=.62;
/** Chunks kept around each player (Chebyshev, in chunks): 2 → 5×5 = 25 per player, 150 for six spread out. */
export const KEEP_CHUNKS=2;
/** Hard cap of the cache (LRU). Above it the least recently used chunks go, even near someone. */
export const MAX_LIVE_CHUNKS=192;
/** Chunk coordinates stay in ±WORLD_LIMIT/CHUNK_SIZE; farther points read as deep water. */
export const WORLD_LIMIT=1_000_000;

export type ObstacleKind='palm'|'tree'|'rock';
export interface ChunkObstacle {x:number;y:number;radius:number;kind:ObstacleKind;art?:string}
export interface Lake {x:number;y:number;radius:number;wobble:number;seed:number}
export interface PointOfInterest {x:number;y:number;name:string;detail:string;icon:string}
export interface Chunk {
  readonly cx:number;readonly cy:number;
  /** Quantized heights (same 8-bit code as the island field: h = code/255*160-32), row-major. */
  readonly heights:Uint8Array;
  readonly obstacles:readonly ChunkObstacle[];
  readonly lakes:readonly Lake[];
  readonly pois:readonly PointOfInterest[];
  /** FNV-1a over heights and features: equal hash ⇔ equal chunk. */
  readonly hash:string;
  /** LRU stamp (not part of the chunk's content). */
  used:number;
}

/** The island landmarks become points of interest scattered over the map. */
const POIS=[
  {name:'Praça do Improviso',detail:'Todo mundo começa com o que tem.',icon:'✦'},
  {name:'Fonte dos Palpites',detail:'Nem todo palpite merece uma aposta.',icon:'◇'},
  {name:'Mirante da Turma',detail:'Um lugar para reunir histórias. E, depois, os amigos.',icon:'△'},
] as const;
const PALM_ART=['coqueiro-curvo','palmeira-leque','bananeira'];
const TREE_ART=treeCatalog.map(t=>t.id).filter(id=>!PALM_ART.includes(id));
const DECODE=Float32Array.from({length:256},(_v,i)=>i/255*160-32);
const encode=(h:number)=>Math.max(0,Math.min(255,Math.round((h+32)/160*255)));

const SALT={relief:0x51ed270b,ridge:0x9e3779b9,wet:0x85ebca6b,trail:0x2c1b3c6d,chunk:0x6a09e667} as const;

/** Signed distance from a lake's shore (positive on land), uncapped. */
function lakeDistance(l:Lake,x:number,y:number){
  const dx=x-l.x,dy=y-l.y,d=Math.sqrt(dx*dx+dy*dy);
  if(d<1e-9)return -l.radius;
  return d-(l.radius+l.wobble*(noise(l.seed,dx/d*1.7+4,dy/d*1.7+4)*2-1));
}
/** Rolling relief before lakes: 9..31, gentle (≤ ~7 per unit, under the island's 12 per unit bound). */
function dryHeight(seed:number,x:number,y:number){
  const broad=fbm(seed^SALT.relief,x*.035,y*.035,4);
  const ridge=1-Math.abs(fbm(seed^SALT.ridge,x*.05,y*.05,3)*2-1);
  return 9+22*smooth((broad*.8+ridge*.2-.3)/.45);
}
/** 0..1: about 1 on a dirt trail (a narrow band of a low-frequency noise level set), 0 off it. */
export function trailAt(seed:number,x:number,y:number){
  const t=fbm(seed^SALT.trail,x*.018,y*.018,2);
  return 1-smooth(Math.abs(t-.5)/.025);
}

export function chunkSeed(seed:number,cx:number,cy:number){return hash2u((seed^SALT.chunk)>>>0,cx,cy);}

/** Pure chunk builder: same (seed, cx, cy) → same chunk, independent of any other chunk. */
export function generateChunk(seed:number,cx:number,cy:number):Chunk{
  seed>>>=0;
  const rng=new Rng(chunkSeed(seed,cx,cy)),x0=cx*CHUNK_SIZE,y0=cy*CHUNK_SIZE;
  const baseDistance=(x:number,y:number)=>Math.sqrt((x-BASE.x)**2+(y-BASE.y)**2);
  const inside=(x:number,y:number,inset:number)=>x>=x0+inset&&x<=x0+CHUNK_SIZE-inset&&y>=y0+inset&&y<=y0+CHUNK_SIZE-inset;
  // Lakes: at most one per chunk, fully inside it together with their influence on relief and coast.
  const lakes:Lake[]=[];
  if(rng.chance(.32)){
    const radius=rng.range(2.2,4.2),wobble=rng.range(.2,.45),inset=radius+wobble+LAKE_INFLUENCE+.01;
    const x=rng.range(x0+inset,x0+CHUNK_SIZE-inset),y=rng.range(y0+inset,y0+CHUNK_SIZE-inset);
    const lakeSeed=rng.int(0,0x7fffffff);
    if(baseDistance(x,y)>BASE_CLEAR+radius+wobble+LAKE_INFLUENCE)lakes.push({x,y,radius,wobble,seed:lakeSeed});
  }
  const lakeCoast=(x:number,y:number)=>{let c=COAST_CAP;for(const l of lakes)c=Math.min(c,lakeDistance(l,x,y));return c;};
  // A point of interest now and then, in its own small clearing.
  const pois:PointOfInterest[]=[];
  if(rng.chance(.18)){
    const x=rng.range(x0+4,x0+CHUNK_SIZE-4),y=rng.range(y0+4,y0+CHUNK_SIZE-4),kind=POIS[rng.int(0,POIS.length-1)];
    if(baseDistance(x,y)>BASE_CLEAR+3&&lakeCoast(x,y)>=COAST_CAP)pois.push({x,y,...kind});
  }
  // Sparse blockers (VS map: for running from the horde, not for getting stuck). Every gap fits a hero.
  const obstacles:ChunkObstacle[]=[];
  const wanted=3+rng.int(0,5),inset=MAX_OBSTACLE_RADIUS+1;
  for(let tries=0;obstacles.length<wanted&&tries<wanted*12;tries++){
    const x=rng.range(x0+inset,x0+CHUNK_SIZE-inset),y=rng.range(y0+inset,y0+CHUNK_SIZE-inset),roll=rng.next();
    const kind:ObstacleKind=roll<.38?'palm':roll<.72?'tree':'rock';
    const radius=kind==='rock'?rng.range(.42,MAX_OBSTACLE_RADIUS):kind==='tree'?rng.range(.4,.48):rng.range(.38,.44);
    const pick=rng.next();
    if(!inside(x,y,inset)||baseDistance(x,y)<BASE_CLEAR)continue;
    if(lakeCoast(x,y)<1.6+radius||trailAt(seed,x,y)>0)continue;
    if(pois.some(p=>(p.x-x)**2+(p.y-y)**2<2.5*2.5))continue;
    if(obstacles.some(o=>(o.x-x)**2+(o.y-y)**2<2.2*2.2))continue;
    const art=kind==='rock'?undefined:kind==='palm'?PALM_ART[Math.floor(pick*PALM_ART.length)]:TREE_ART.length?TREE_ART[Math.floor(pick*TREE_ART.length)]:undefined;
    obstacles.push(art?{x,y,radius,kind,art}:{x,y,radius,kind});
  }
  // Heights on the shared half-unit lattice: border samples equal the neighbour's, so there is no seam.
  const heights=new Uint8Array(CHUNK_SAMPLES*CHUNK_SAMPLES);
  for(let j=0;j<CHUNK_SAMPLES;j++)for(let i=0;i<CHUNK_SAMPLES;i++){
    const x=x0+i*CHUNK_STEP,y=y0+j*CHUNK_STEP,dry=dryHeight(seed,x,y);
    let c=Infinity;for(const l of lakes)c=Math.min(c,lakeDistance(l,x,y));
    // Shore ramp of 6 per unit up to the relief: continuous and as gentle as the relief itself.
    const h=c>=0?Math.min(dry,1+6*c):-Math.min(12,-c*5);
    heights[j*CHUNK_SAMPLES+i]=encode(h);
  }
  let hash=0x811c9dc5;
  const mixIn=(n:number)=>{hash=Math.imul(hash^(n&0xff),0x01000193);hash=Math.imul(hash^(n>>>8&0xff),0x01000193);hash=Math.imul(hash^(n>>>16&0xff),0x01000193);hash=Math.imul(hash^(n>>>24&0xff),0x01000193);};
  mixIn(CHUNK_VERSION);mixIn(cx);mixIn(cy);
  for(const h of heights)hash=Math.imul(hash^h,0x01000193);
  const q=(v:number)=>Math.round(v*1000)|0;
  for(const o of obstacles){mixIn(q(o.x));mixIn(q(o.y));mixIn(q(o.radius));mixIn(o.kind.charCodeAt(0));}
  for(const l of lakes){mixIn(q(l.x));mixIn(q(l.y));mixIn(q(l.radius));mixIn(q(l.wobble));mixIn(l.seed);}
  for(const p of pois){mixIn(q(p.x));mixIn(q(p.y));mixIn(p.name.length);}
  return {cx,cy,heights,obstacles,lakes,pois,hash:(hash>>>0).toString(16).padStart(8,'0'),used:0};
}

const keyOf=(cx:number,cy:number)=>(cx+0x8000)*0x10000+(cy+0x8000);
const CHUNK_LIMIT=Math.floor(WORLD_LIMIT/CHUNK_SIZE);
/** Clamped chunk range of a box; beyond WORLD_LIMIT there are no chunks (and no obstacles: it is all deep water). */
const span=(lo:number,hi:number)=>[Math.max(-CHUNK_LIMIT,Math.floor(lo/CHUNK_SIZE)),Math.min(CHUNK_LIMIT,Math.floor(hi/CHUNK_SIZE))];

/**
 * Lazy chunk cache for one room/session. Point queries cost the same anywhere: one Map lookup
 * (or none for the chunk asked last) plus the handful of features of that chunk.
 */
export class ChunkWorld {
  readonly seed:number;
  readonly maxLive:number;
  /** Counters for tests and the lab measurements in done/. */
  generated=0;evicted=0;peakLive=0;
  private live=new Map<number,Chunk>();
  private clock=0;
  private last:Chunk|undefined;
  constructor(seed:number,options:{maxLive?:number}={}){this.seed=seed>>>0;this.maxLive=Math.max(9,options.maxLive??MAX_LIVE_CHUNKS);}
  get liveCount(){return this.live.size;}
  /** Live chunks (inspection only). */
  chunks():IterableIterator<Chunk>{return this.live.values();}
  chunk(cx:number,cy:number):Chunk{
    const last=this.last;
    if(last&&last.cx===cx&&last.cy===cy){last.used=++this.clock;return last;}
    const key=keyOf(cx,cy);
    let chunk=this.live.get(key);
    if(!chunk){
      chunk=generateChunk(this.seed,cx,cy);this.generated++;
      this.live.set(key,chunk);
      if(this.live.size>this.peakLive)this.peakLive=this.live.size;
      if(this.live.size>this.maxLive)this.evictOldest(chunk);
    }
    chunk.used=++this.clock;this.last=chunk;
    return chunk;
  }
  /** Chunk holding (x, y), or undefined beyond WORLD_LIMIT / for non-finite input. */
  at(x:number,y:number):Chunk|undefined{
    const cx=Math.floor(x/CHUNK_SIZE),cy=Math.floor(y/CHUNK_SIZE);
    if(!(cx>=-CHUNK_LIMIT&&cx<=CHUNK_LIMIT&&cy>=-CHUNK_LIMIT&&cy<=CHUNK_LIMIT))return undefined;
    return this.chunk(cx,cy);
  }
  /** Bilinear bed height (negative under lakes); deep water outside the world limit. */
  bed(x:number,y:number){
    const c=this.at(x,y);if(!c)return -32;
    const fx=(x-c.cx*CHUNK_SIZE)/CHUNK_STEP,fy=(y-c.cy*CHUNK_SIZE)/CHUNK_STEP;
    const ix=Math.min(CHUNK_SAMPLES-2,Math.floor(fx)),iy=Math.min(CHUNK_SAMPLES-2,Math.floor(fy)),tx=fx-ix,ty=fy-iy,i=iy*CHUNK_SAMPLES+ix,h=c.heights;
    return mix(mix(DECODE[h[i]],DECODE[h[i+1]],tx),mix(DECODE[h[i+CHUNK_SAMPLES]],DECODE[h[i+CHUNK_SAMPLES+1]],tx),ty);
  }
  /** Distance to the nearest lake shore, positive on land, capped at COAST_CAP. */
  coast(x:number,y:number){
    const c=this.at(x,y);if(!c)return -COAST_CAP;
    let d=COAST_CAP;for(const l of c.lakes)d=Math.min(d,lakeDistance(l,x,y));
    return d;
  }
  wetness(x:number,y:number){
    const base=fbm(this.seed^SALT.wet,x*.11,y*.11,3),c=this.coast(x,y);
    return Math.min(1,base+.35*(1-smooth(c/COAST_CAP)));
  }
  trail(x:number,y:number){return trailAt(this.seed,x,y);}
  /** True when a disc of `radius` at (x, y) touches no obstacle. Looks only at the chunks the disc's box overlaps. */
  clear(x:number,y:number,radius:number){
    const reach=radius+MAX_OBSTACLE_RADIUS;
    const [cx0,cx1]=span(x-reach,x+reach),[cy0,cy1]=span(y-reach,y+reach);
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){
      for(const o of this.chunk(cx,cy).obstacles){
        const dx=x-o.x,dy=y-o.y,r=o.radius+radius;
        if(dx*dx+dy*dy<=r*r)return false;
      }
    }
    return true;
  }
  /** Obstacles whose centre is within `reach` of (x, y) (chunk order, then generation order). */
  obstaclesNear(x:number,y:number,reach:number):ChunkObstacle[]{
    const out:ChunkObstacle[]=[];
    const [cx0,cx1]=span(x-reach,x+reach),[cy0,cy1]=span(y-reach,y+reach);
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++)for(const o of this.chunk(cx,cy).obstacles){
      const dx=x-o.x,dy=y-o.y;if(dx*dx+dy*dy<=reach*reach)out.push(o);
    }
    return out;
  }
  poisNear(x:number,y:number,reach:number):PointOfInterest[]{
    const out:PointOfInterest[]=[];
    const [cx0,cx1]=span(x-reach,x+reach),[cy0,cy1]=span(y-reach,y+reach);
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++)for(const p of this.chunk(cx,cy).pois){
      const dx=x-p.x,dy=y-p.y;if(dx*dx+dy*dy<=reach*reach)out.push(p);
    }
    return out;
  }
  /**
   * Drops every chunk farther than `keep` chunks (Chebyshev) from all the points. Returns how many went.
   * With no point (empty room) nothing is dropped; the LRU cap still bounds memory.
   */
  retain(points:Iterable<{x:number;y:number}>,keep=KEEP_CHUNKS){
    const near:{cx:number;cy:number}[]=[];
    for(const p of points)if(Number.isFinite(p.x)&&Number.isFinite(p.y))near.push({cx:Math.floor(p.x/CHUNK_SIZE),cy:Math.floor(p.y/CHUNK_SIZE)});
    if(!near.length)return 0;
    let dropped=0;
    for(const [key,c] of this.live){
      if(near.some(n=>Math.abs(n.cx-c.cx)<=keep&&Math.abs(n.cy-c.cy)<=keep))continue;
      this.live.delete(key);dropped++;
      if(this.last===c)this.last=undefined;
    }
    this.evicted+=dropped;
    return dropped;
  }
  /** Evicts down to 7/8 of the cap, least recently used first, never the chunk just created. */
  private evictOldest(keep:Chunk){
    const target=Math.floor(this.maxLive*7/8);
    const order=[...this.live.values()].filter(c=>c!==keep).sort((a,b)=>a.used-b.used);
    for(let i=0;this.live.size>target&&i<order.length;i++){
      const c=order[i];this.live.delete(keyOf(c.cx,c.cy));this.evicted++;
      if(this.last===c)this.last=undefined;
    }
  }
}
