/**
 * Endless world in chunks (D-019, Mad Forest): relief, lakes, trails, vegetation and rocks are a pure
 * function of (seed, cx, cy), so the server and every client build byte-identical chunks in any order.
 * The cache only saves time: evicting a chunk and building it again gives the same chunk, which is what
 * keeps the simulation deterministic while memory stays bounded.
 *
 * Two layers per chunk:
 * - features (lakes, obstacles, POIs): cheap (tens of µs), built synchronously the first time a query
 *   touches the chunk;
 * - the 65×65 height lattice (~1.4 ms): built by `prefetch`, at most one per player per tick and
 *   MAX_BUILDS_PER_TICK in all, off the query path. A height query on a chunk whose lattice is not built
 *   yet computes the four lattice samples it needs with the very same function and quantization, so the
 *   answer is bit-identical to the built chunk's: prefetching changes only the time, never a result.
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
/** Height lattices built per prefetch call (per tick), and never more than one per anchor. */
export const MAX_BUILDS_PER_TICK=1;
/** Hard cap of the cache (LRU), above the 7×25 that retain keeps for six players and the base. Above it the least recently used chunks go, even near someone. */
export const MAX_LIVE_CHUNKS=256;
/** Chunk coordinates stay in ±WORLD_LIMIT/CHUNK_SIZE; farther points read as deep water. */
export const WORLD_LIMIT=1_000_000;

export type ObstacleKind='palm'|'tree'|'rock';
export interface ChunkObstacle {x:number;y:number;radius:number;kind:ObstacleKind;art?:string}
export interface Lake {x:number;y:number;radius:number;wobble:number;seed:number}
export interface PointOfInterest {x:number;y:number;name:string;detail:string;icon:string}
/** What collision, coast and gameplay need: cheap and always present. */
export interface ChunkFeatures {
  readonly cx:number;readonly cy:number;
  readonly obstacles:readonly ChunkObstacle[];
  readonly lakes:readonly Lake[];
  readonly pois:readonly PointOfInterest[];
}
/** A fully built chunk (tests, signature, tools). */
export interface BuiltChunk extends ChunkFeatures {
  /** Quantized heights (same 8-bit code as the island field: h = code/255*160-32), row-major. */
  readonly heights:Uint8Array;
  /** FNV-1a over heights and features: equal hash ⇔ equal chunk. */
  readonly hash:string;
}
/** A cached chunk: features always, the height lattice once prefetched. */
export interface Chunk extends ChunkFeatures {
  heights:Uint8Array|undefined;
  /** LRU stamp and height queries answered without the lattice (not part of the chunk's content). */
  used:number;misses:number;
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

/** Lakes, POIs and obstacles of a chunk: pure, independent of any other chunk, and cheap. */
export function generateFeatures(seed:number,cx:number,cy:number):ChunkFeatures{
  seed>>>=0;
  const rng=new Rng(chunkSeed(seed,cx,cy)),x0=cx*CHUNK_SIZE,y0=cy*CHUNK_SIZE;
  const baseDistance=(x:number,y:number)=>{const dx=x-BASE.x,dy=y-BASE.y;return Math.sqrt(dx*dx+dy*dy);};
  const near=(ax:number,ay:number,bx:number,by:number,r:number)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy<r*r;};
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
    if(baseDistance(x,y)<BASE_CLEAR)continue;
    if(lakeCoast(x,y)<1.6+radius||trailAt(seed,x,y)>0)continue;
    if(pois.some(p=>near(p.x,p.y,x,y,2.5)))continue;
    if(obstacles.some(o=>near(o.x,o.y,x,y,2.2)))continue;
    const art=kind==='rock'?undefined:kind==='palm'?PALM_ART[Math.floor(pick*PALM_ART.length)]:TREE_ART.length?TREE_ART[Math.floor(pick*TREE_ART.length)]:undefined;
    obstacles.push(art?{x,y,radius,kind,art}:{x,y,radius,kind});
  }
  return {cx,cy,obstacles,lakes,pois};
}
/** 8-bit height code of lattice sample (i, j) of a chunk: the one function behind both the lattice and lazy queries. */
function heightCode(seed:number,f:ChunkFeatures,i:number,j:number){
  const x=f.cx*CHUNK_SIZE+i*CHUNK_STEP,y=f.cy*CHUNK_SIZE+j*CHUNK_STEP,dry=dryHeight(seed,x,y);
  let c=Infinity;for(const l of f.lakes)c=Math.min(c,lakeDistance(l,x,y));
  // Shore ramp of 6 per unit up to the relief: continuous and as gentle as the relief itself.
  return encode(c>=0?Math.min(dry,1+6*c):-Math.min(12,-c*5));
}
/** Height lattice on the shared half-unit grid: border samples equal the neighbour's, so there is no seam. */
export function buildHeights(seed:number,f:ChunkFeatures):Uint8Array{
  seed>>>=0;
  const heights=new Uint8Array(CHUNK_SAMPLES*CHUNK_SAMPLES);
  for(let j=0;j<CHUNK_SAMPLES;j++)for(let i=0;i<CHUNK_SAMPLES;i++)heights[j*CHUNK_SAMPLES+i]=heightCode(seed,f,i,j);
  return heights;
}
class Fnv {
  h=0x811c9dc5;
  byte(n:number){this.h=Math.imul(this.h^(n&0xff),0x01000193);}
  int(n:number){this.byte(n);this.byte(n>>>8);this.byte(n>>>16);this.byte(n>>>24);}
  text(s:string){for(let i=0;i<s.length;i++)this.int(s.charCodeAt(i));}
  hex(){return (this.h>>>0).toString(16).padStart(8,'0');}
}
const q=(v:number)=>Math.round(v*1000)|0;
function mixFeatures(fnv:Fnv,f:ChunkFeatures){
  for(const o of f.obstacles){fnv.int(q(o.x));fnv.int(q(o.y));fnv.int(q(o.radius));fnv.int(o.kind.charCodeAt(0));}
  for(const l of f.lakes){fnv.int(q(l.x));fnv.int(q(l.y));fnv.int(q(l.radius));fnv.int(q(l.wobble));fnv.int(l.seed);}
  for(const p of f.pois){fnv.int(q(p.x));fnv.int(q(p.y));fnv.int(p.name.length);}
}
export function chunkHash(f:ChunkFeatures,heights:Uint8Array){
  const fnv=new Fnv();fnv.int(CHUNK_VERSION);fnv.int(f.cx);fnv.int(f.cy);
  for(const h of heights)fnv.byte(h);
  mixFeatures(fnv,f);
  return fnv.hex();
}
/** Pure full builder: same (seed, cx, cy) → same chunk, independent of any other chunk. */
export function generateChunk(seed:number,cx:number,cy:number):BuiltChunk{
  const f=generateFeatures(seed,cx,cy),heights=buildHeights(seed,f);
  return {...f,heights,hash:chunkHash(f,heights)};
}
/** Far chunks in the signature: catches drift at large coordinates (about 10 000 units out). */
const SIGNATURE_FAR=[[312,0],[-221,221]] as const;
const SIGNATURE_FEATURES=7;
/**
 * Room signature of the endless world, compared by the client on join. It is a canary for a different
 * generator (CHUNK_VERSION) or engine, not a proof: equality of every chunk comes from the pure generator.
 * It covers every code path for ~2 ms of features plus 12 lattices: features of the 15×15 chunks around the
 * base (~230 000 u²: lakes, POIs, obstacles, trails), lattices of the 3×3 around the base, of the first chunk
 * with a lake in that window, and of two chunks ~10 000 units out.
 */
export function endlessSignature(seed:number,built:(cx:number,cy:number)=>BuiltChunk=(cx,cy)=>generateChunk(seed,cx,cy)){
  seed>>>=0;
  const fnv=new Fnv();fnv.text('infinito');fnv.int(CHUNK_VERSION);
  let lake:ChunkFeatures|undefined;
  for(let cy=-SIGNATURE_FEATURES;cy<=SIGNATURE_FEATURES;cy++)for(let cx=-SIGNATURE_FEATURES;cx<=SIGNATURE_FEATURES;cx++){
    const f=generateFeatures(seed,cx,cy);fnv.int(cx);fnv.int(cy);mixFeatures(fnv,f);
    if(!lake&&f.lakes.length)lake=f;
  }
  for(let cy=-1;cy<=1;cy++)for(let cx=-1;cx<=1;cx++)fnv.text(built(cx,cy).hash);
  if(lake)fnv.text(chunkHash(lake,buildHeights(seed,lake)));
  for(const [cx,cy] of SIGNATURE_FAR)fnv.text(generateChunk(seed,cx,cy).hash);
  return fnv.hex();
}

const keyOf=(cx:number,cy:number)=>(cx+0x8000)*0x10000+(cy+0x8000);
const CHUNK_LIMIT=Math.floor(WORLD_LIMIT/CHUNK_SIZE);
/** Clamped chunk range of a box; beyond WORLD_LIMIT there are no chunks (and no obstacles: it is all deep water). */
const span=(lo:number,hi:number)=>[Math.max(-CHUNK_LIMIT,Math.floor(lo/CHUNK_SIZE)),Math.min(CHUNK_LIMIT,Math.floor(hi/CHUNK_SIZE))];
const finitePoint=(p:{x:number;y:number})=>Number.isFinite(p.x)&&Number.isFinite(p.y);

/**
 * Lazy chunk cache for one room/session. Point queries cost the same anywhere: one Map lookup
 * (or none for the chunk asked last) plus the handful of features of that chunk.
 */
export class ChunkWorld {
  readonly seed:number;
  readonly maxLive:number;
  /** Counters for tests and the lab measurements in done/: features made, lattices built, chunks dropped. */
  generated=0;built=0;evicted=0;peakLive=0;misses=0;
  private live=new Map<number,Chunk>();
  private clock=0;
  private turn=0;
  private last:Chunk|undefined;
  /** Chunks asked for heights without a lattice since the last prefetch. */
  private missed=new Set<Chunk>();
  constructor(seed:number,options:{maxLive?:number}={}){this.seed=seed>>>0;this.maxLive=Math.max(9,options.maxLive??MAX_LIVE_CHUNKS);}
  get liveCount(){return this.live.size;}
  /** Live chunks (inspection only). */
  chunks():IterableIterator<Chunk>{return this.live.values();}
  /** Cached chunk with its features (the lattice may still be missing). */
  chunk(cx:number,cy:number):Chunk{
    const last=this.last;
    if(last&&last.cx===cx&&last.cy===cy){last.used=++this.clock;return last;}
    const key=keyOf(cx,cy);
    let chunk=this.live.get(key);
    if(!chunk){
      chunk={...generateFeatures(this.seed,cx,cy),heights:undefined,used:0,misses:0};this.generated++;
      this.live.set(key,chunk);
      if(this.live.size>this.peakLive)this.peakLive=this.live.size;
      if(this.live.size>this.maxLive)this.evictOldest(chunk);
    }
    chunk.used=++this.clock;this.last=chunk;
    return chunk;
  }
  /** Cached chunk with its lattice built now if needed (tests, signature, tools; not for the tick path). */
  ready(cx:number,cy:number):BuiltChunk{
    const c=this.chunk(cx,cy);
    if(!c.heights){c.heights=buildHeights(this.seed,c);this.built++;}
    return {cx,cy,obstacles:c.obstacles,lakes:c.lakes,pois:c.pois,heights:c.heights,hash:chunkHash(c,c.heights)};
  }
  /** Chunk holding (x, y), or undefined beyond WORLD_LIMIT / for non-finite input. */
  at(x:number,y:number):Chunk|undefined{
    const cx=Math.floor(x/CHUNK_SIZE),cy=Math.floor(y/CHUNK_SIZE);
    if(!(cx>=-CHUNK_LIMIT&&cx<=CHUNK_LIMIT&&cy>=-CHUNK_LIMIT&&cy<=CHUNK_LIMIT))return undefined;
    return this.chunk(cx,cy);
  }
  /** Bilinear bed height (negative under lakes); deep water outside the world limit. Same value with or without the lattice. */
  bed(x:number,y:number){
    const c=this.at(x,y);if(!c)return -32;
    const fx=(x-c.cx*CHUNK_SIZE)/CHUNK_STEP,fy=(y-c.cy*CHUNK_SIZE)/CHUNK_STEP;
    const ix=Math.min(CHUNK_SAMPLES-2,Math.floor(fx)),iy=Math.min(CHUNK_SAMPLES-2,Math.floor(fy)),tx=fx-ix,ty=fy-iy;
    let a:number,b:number,d:number,e:number;
    const h=c.heights;
    if(h){const i=iy*CHUNK_SAMPLES+ix;a=h[i];b=h[i+1];d=h[i+CHUNK_SAMPLES];e=h[i+CHUNK_SAMPLES+1];}
    else{
      // Not prefetched yet: the four samples straight from the generator (bit-identical to the lattice).
      a=heightCode(this.seed,c,ix,iy);b=heightCode(this.seed,c,ix+1,iy);d=heightCode(this.seed,c,ix,iy+1);e=heightCode(this.seed,c,ix+1,iy+1);
      c.misses++;this.misses++;this.missed.add(c);
    }
    return mix(mix(DECODE[a],DECODE[b],tx),mix(DECODE[d],DECODE[e],tx),ty);
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
   * Builds lattices ahead of the players, off the query path: for each anchor (in turn, so six players
   * share the budget), the nearest chunk within `keep` (rings outward) still without one; then,
   * with budget left, the chunk most asked for heights without a lattice. At most one per anchor and
   * `maxBuilds` in all. Returns how many were built. Only the timing changes, never a query result.
   */
  prefetch(anchors:Iterable<{x:number;y:number}>,maxBuilds=MAX_BUILDS_PER_TICK,keep=KEEP_CHUNKS){
    const list=[...anchors].filter(finitePoint);
    let built=0,k=0;
    for(;k<list.length&&built<maxBuilds;k++){
      const p=list[(k+this.turn)%list.length],pcx=Math.floor(p.x/CHUNK_SIZE),pcy=Math.floor(p.y/CHUNK_SIZE);
      if(!(Math.abs(pcx)<=CHUNK_LIMIT-keep&&Math.abs(pcy)<=CHUNK_LIMIT-keep))continue;
      search:for(let r=0;r<=keep;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
        const c=this.chunk(pcx+dx,pcy+dy);
        if(c.heights)continue;
        c.heights=buildHeights(this.seed,c);this.built++;built++;this.missed.delete(c);
        break search;
      }
    }
    // Next call starts after the last anchor looked at, so every anchor gets its turn.
    this.turn=list.length?(this.turn+k)%list.length:0;
    if(built<maxBuilds&&this.missed.size){
      let best:Chunk|undefined;
      for(const c of this.missed)if(!c.heights&&this.live.get(keyOf(c.cx,c.cy))===c&&(!best||c.misses>best.misses))best=c;
      if(best){best.heights=buildHeights(this.seed,best);this.built++;built++;}
    }
    this.missed.clear();
    return built;
  }
  /**
   * Drops every chunk farther than `keep` chunks (Chebyshev) from all the anchors (players, base) and not
   * next to (≤ 1 chunk) any body (enemies, pickups). Returns how many went. With no anchor and no body
   * (empty room) nothing is dropped; the LRU cap still bounds memory.
   */
  retain(anchors:Iterable<{x:number;y:number}>,bodies:Iterable<{x:number;y:number}>=[],keep=KEEP_CHUNKS){
    const wanted=new Set<number>();
    const mark=(p:{x:number;y:number},r:number)=>{
      if(!finitePoint(p))return;
      const cx=Math.floor(p.x/CHUNK_SIZE),cy=Math.floor(p.y/CHUNK_SIZE);
      if(!(Math.abs(cx)<=CHUNK_LIMIT&&Math.abs(cy)<=CHUNK_LIMIT))return;
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)wanted.add(keyOf(cx+dx,cy+dy));
    };
    for(const p of anchors)mark(p,keep);
    for(const p of bodies)mark(p,1);
    if(!wanted.size)return 0;
    let dropped=0;
    for(const [key,c] of this.live){
      if(wanted.has(key))continue;
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
