/**
 * Cidade Nevada as a terrain (D-026/D-027): the same surface the island and the endless world expose (world.ts reads
 * it through TerrainField's shape), backed by the decoded city asset instead of noise. Pure and deterministic, so the
 * server simulation and the client prediction collide identically.
 *
 * Collision is the walkable bitset (0.22 u samples) against a body disc: a body of radius r stands where every sample
 * its disc overlaps is walkable (D-030: the hero's collision is half a cell, radius 0.22 u, so a 2-sample alley fits).
 *
 * Blockers (cidade-06): the asset is immutable and shared by every room of the process, so per-room obstacles (the
 * barricades at the avenue mouths) live on a `fork()`: same asset and signature, its own blocker discs. Blockers stop
 * ENEMIES only: the terrain itself (clearDisc, hence land/walkable/moveDirection for the heroes, the room bots and the
 * client prediction) ignores them; its `forEnemies()` view (`enemyTerrain` below: enemy movement, the flow grid) treats
 * a blocker disc as solid ground: a body disc overlapping it is not clear, touching it is.
 */
import type {CityAsset,CityPoint} from '../city-asset.ts';
import {checkCityHash,decodeCityAsset} from '../city-asset.ts';
import {cityRelief,sampleRelief} from './relief.ts';
import type {WorldKind} from '../../contract/index.ts';
import type {TerrainField} from '../terrain/field.ts';

/** Vertical pixels per unit of height, matching the iso y scale of world.project (21 px per unit). */
export const CITY_HEIGHT_PX_PER_UNIT=21;
/** Overlap below this is touching, not entering: a disc exactly as wide as a corridor still fits. */
const TOUCH_EPS=1e-6;

/**
 * Per asset (a pure memo, shared by every fork): for each walkable sample, its Chebyshev distance in samples (capped at
 * 255) to the nearest unwalkable sample or the outside of the grid, 0 on an unwalkable one. Every sample nearer than
 * that is walkable, so clearDisc accepts a disc whose sample box fits in that square without reading it (the city is
 * mostly open street: the hero's 3×3 box, the wide bodies' up to 10×10, every tick for hundreds of bodies).
 */
const freeSquares=new WeakMap<CityAsset,Uint8Array>();
function freeSquaresOf(asset:CityAsset):Uint8Array{
  let f=freeSquares.get(asset);
  if(f)return f;
  const w=asset.samples.w,h=asset.samples.h;
  f=new Uint8Array(w*h);
  // Two-pass chamfer distance with unit weights on all 8 neighbors (exact for Chebyshev); outside the grid is 0.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(!asset.walkable(x,y))continue;
    const up=y>0?y*w-w:-1;
    let m=x>0&&up>=0?f[up+x-1]:0;
    if(up>=0){m=Math.min(m,f[up+x]);m=Math.min(m,x+1<w?f[up+x+1]:0);}else m=0;
    m=Math.min(m,x>0?f[y*w+x-1]:0);
    f[y*w+x]=Math.min(255,m+1);
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const i=y*w+x;
    if(!f[i])continue;
    const dn=y+1<h?i+w:-1;
    let m=dn>=0&&x>0?f[dn-1]:0;
    if(dn>=0){m=Math.min(m,f[dn]);m=Math.min(m,x+1<w?f[dn+1]:0);}else m=0;
    m=Math.min(m,x+1<w?f[i+1]:0);
    if(m+1<f[i])f[i]=m+1;
  }
  freeSquares.set(asset,f);
  return f;
}

/** A blocking disc on a CityTerrain fork (world units): `id` names it (e.g. 'barricada-N'). */
export interface CityBlocker {readonly id:string;readonly x:number;readonly y:number;readonly r:number}

export class CityTerrain {
  readonly asset:CityAsset;
  /** D-034: a city room says 'cidade' with seed 0; the signature pins the asset. */
  readonly world:WorldKind='cidade';
  readonly seed=0;
  /** The asset's sha256 (D-027 manifest), so welcome/frames can pin the exact city both sides decoded. */
  readonly signature:string;
  /** No chunk cache: the whole city is resident. */
  readonly chunks=undefined;
  /** The island's noise grids; empty for the city (rendered by render/city, not by the island renderer). */
  readonly heights=new Float32Array(0);
  readonly moisture=new Float32Array(0);
  private readonly minHeight:number;
  private readonly step:number;
  private readonly sw:number;
  private readonly sh:number;
  /** Active blocker discs by id; `sorted` caches blockers() until the next change. */
  private readonly blocking=new Map<string,CityBlocker>();
  private sorted:readonly CityBlocker[]=Object.freeze([]);
  /** Box around every blocker disc (world units; empty when none): `blocked` rejects a disc outside it at once. */
  private bx0=Infinity;private by0=Infinity;private bx1=-Infinity;private by1=-Infinity;
  private version=0;
  /** The asset's relief (relief.ts), fetched on the first height query: the simulation never asks. */
  private relief:Float64Array|undefined=undefined;
  /** Cached `forEnemies()` view (created on first use). */
  private enemyView:CityTerrain|undefined=undefined;
  /** freeSquaresOf(asset), fetched on the first disc query. */
  private free:Uint8Array|undefined=undefined;

  /** `minHeight` is internal (fork): the lowest corner already scanned for this asset. */
  constructor(asset:CityAsset,hash:string,minHeight?:number){
    this.asset=asset;this.signature=hash;
    this.step=asset.samples.step;this.sw=asset.samples.w;this.sh=asset.samples.h;
    if(minHeight!==undefined&&Number.isFinite(minHeight)){this.minHeight=minHeight;return;}
    let min=Infinity;
    for(let y=0;y<asset.heightGrid.h;y++)for(let x=0;x<asset.heightGrid.w;x++)min=Math.min(min,asset.height(x,y));
    this.minHeight=Number.isFinite(min)?min:0;
  }

  /**
   * A new terrain over the same asset and signature (no copy of the asset) with its own blockers, starting from a copy
   * of this one's. Changing either side's blockers never touches the other. One per room (multiplayer/simulation.ts).
   */
  fork():CityTerrain{
    const t=new CityTerrain(this.asset,this.signature,this.minHeight);
    for(const b of this.sorted)t.blocking.set(b.id,b);
    t.sorted=this.sorted;t.bound();
    return t;
  }
  /**
   * Sets (or moves) the blocker disc `id`, or removes it with `undefined`. The disc is in world units; x, y must be
   * finite and r > 0 (else RangeError). `blockerVersion` grows on every real change, not on a no-op.
   */
  setBlocker(id:string,shape:{x:number;y:number;r:number}|undefined):void{
    if(shape===undefined){
      if(!this.blocking.delete(id))return;
    }else{
      const {x,y,r}=shape;
      if(!(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(r)&&r>0))throw new RangeError(`blocker ${id}: bad disc (${x},${y},${r})`);
      const old=this.blocking.get(id);
      if(old&&old.x===x&&old.y===y&&old.r===r)return;
      this.blocking.set(id,Object.freeze({id,x,y,r}));
    }
    this.sorted=Object.freeze([...this.blocking.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
    this.bound();
    this.version++;
  }
  private bound(){
    this.bx0=this.by0=Infinity;this.bx1=this.by1=-Infinity;
    for(const b of this.sorted){
      this.bx0=Math.min(this.bx0,b.x-b.r);this.by0=Math.min(this.by0,b.y-b.r);this.bx1=Math.max(this.bx1,b.x+b.r);this.by1=Math.max(this.by1,b.y+b.r);
    }
  }
  /** Active blocker discs, sorted by id (deterministic); the same frozen array until the next change. */
  blockers():readonly CityBlocker[]{return this.sorted;}
  /** Grows by one on every change of the blockers (set, move, remove); 0 on a fresh fork without blockers. */
  get blockerVersion():number{return this.version;}
  /**
   * The same terrain as the enemies see it: every read goes to this one (asset, signature, world, the live blockers),
   * except that clearDisc (hence land/walkable/moveSafely through it) also refuses any disc overlapping a blocker.
   * Created once and cached; `forEnemies()` on the view returns the view, and its setBlocker/fork act on this terrain.
   */
  forEnemies():CityTerrain{
    if(this.enemyView)return this.enemyView;
    const base=this,view=Object.create(this) as CityTerrain;
    Object.defineProperties(view,{
      clearDisc:{value:(x:number,y:number,r:number)=>base.clearDisc(x,y,r)&&!(base.sorted.length&&base.blocked(x,y,r<=TOUCH_EPS?0:r))},
      clearReach:{value:(x:number,y:number,r:number)=>{
        let d=base.clearReach(x,y,r);
        // A disc within d of (x,y) stays off every blocker: its centre distance only shrinks by d.
        for(const b of base.sorted)if(d>0)d=Math.min(d,Math.hypot(x-b.x,y-b.y)-(r+b.r-TOUCH_EPS));
        return d>0?d:0;
      }},
      setBlocker:{value:(id:string,shape:{x:number;y:number;r:number}|undefined)=>base.setBlocker(id,shape)},
      fork:{value:()=>base.fork()},
      enemyView:{value:view},
    });
    this.enemyView=view;
    return view;
  }
  /** True when a disc of radius r (≥ 0) at (x,y) overlaps a blocker disc by more than TOUCH_EPS. */
  private blocked(x:number,y:number,r:number):boolean{
    // Farther than r from the box of every disc: no overlap (it needs a centre distance under r + b.r).
    if(x+r<this.bx0||x-r>this.bx1||y+r<this.by0||y-r>this.by1)return false;
    const list=this.sorted;
    for(let k=0;k<list.length;k++){
      const b=list[k],reach=r+b.r-TOUCH_EPS,dx=x-b.x,dy=y-b.y;
      if(reach>0&&dx*dx+dy*dy<reach*reach)return true;
    }
    return false;
  }

  /**
   * True when a body of radius r centred at (x,y) overlaps only walkable samples (outside the grid is blocked).
   * r = 0 asks about the single sample under the point. Blockers do not count here (heroes walk through them); the
   * `forEnemies()` view's clearDisc adds them.
   */
  clearDisc(x:number,y:number,r:number):boolean{
    if(!(Number.isFinite(x)&&Number.isFinite(y)&&r>=0))return false;
    const s=this.step,a=this.asset;
    if(r<=TOUCH_EPS)return a.walkableAt(x,y); // a point, not a disc
    const reach=r-TOUCH_EPS,r2=reach*reach;
    const sx0=Math.floor((x-reach)/s),sx1=Math.floor((x+reach)/s),sy0=Math.floor((y-reach)/s),sy1=Math.floor((y+reach)/s);
    if(sx0<0||sy0<0||sx1>=this.sw||sy1>=this.sh)return false;
    // Fast accept: every sample of the box lies within the walkable square around the centre's sample.
    const cx=Math.floor(x/s),cy=Math.floor(y/s),f=this.free??=freeSquaresOf(a);
    if(Math.max(cx-sx0,sx1-cx,cy-sy0,sy1-cy)<f[cy*this.sw+cx])return true;
    for(let sy=sy0;sy<=sy1;sy++){
      // Nearest point of the sample row band to the centre, on y.
      const dy=y<sy*s?sy*s-y:y>(sy+1)*s?y-(sy+1)*s:0;
      for(let sx=sx0;sx<=sx1;sx++){
        const dx=x<sx*s?sx*s-x:x>(sx+1)*s?x-(sx+1)*s:0;
        if(dx*dx+dy*dy<r2&&!a.walkable(sx,sy))return false;
      }
    }
    return true;
  }
  /**
   * A distance d ≥ 0 (u) such that clearDisc(x', y', r) is true for every (x', y') within d of (x, y), from the free
   * square around (x, y)'s sample (freeSquaresOf); 0 when it cannot be told at once. Lets a sampled segment check skip
   * the samples it already knows are clear (same answers, fewer reads). Walls only; the enemy view adds the blockers.
   */
  clearReach(x:number,y:number,r:number):number{
    if(!(Number.isFinite(x)&&Number.isFinite(y)&&r>TOUCH_EPS))return 0;
    const s=this.step,cx=Math.floor(x/s),cy=Math.floor(y/s);
    if(cx<0||cy<0||cx>=this.sw||cy>=this.sh)return 0;
    // Every sample nearer than f to (cx, cy) is walkable; a disc's sample box stays inside while it moves by at most
    // (f − 1)·s − reach on each axis (its centre sample is within one step of (x, y) there).
    const f=(this.free??=freeSquaresOf(this.asset))[cy*this.sw+cx],d=(f-1)*s-(r-TOUCH_EPS);
    return d>0?d:0;
  }
  /** Island-style `land`: here "the ground under a body of radius `margin` is walkable". */
  land(x:number,y:number,margin=0){return this.clearDisc(x,y,Math.max(0,margin));}
  /** Signed coastline helper of the island (director); in the city the sea is the map edge: + inside the playable area. */
  coast(x:number,y:number){
    const p=this.asset.playable;
    return Math.min(x-p.x,p.x+p.w-x,y-p.y,p.y+p.h-y);
  }
  /**
   * Ground height in the iso pixel scale used by world.project/elevation (the lowest corner is 0): the relief (ramps
   * and snow undulation over the asset's terraces, relief.ts), the same corners the client draws. Never read by the sim.
   */
  bed(x:number,y:number){return (sampleRelief(this.relief??=cityRelief(this.asset),this.asset,x,y)-this.minHeight)*CITY_HEIGHT_PX_PER_UNIT;}
  height(x:number,y:number){return this.bed(x,y);}
  wetness(x:number,y:number){return this.asset.water(x/this.step,y/this.step)?1:0;}
  slope(x:number,y:number){return Math.hypot(this.height(x+.125,y)-this.height(x-.125,y),this.height(x,y+.125)-this.height(x,y-.125))/.25;}
  /** Whole city resident: nothing to stream. */
  retain(_players:Iterable<{x:number;y:number}>,_bodies?:Iterable<{x:number;y:number}>){return 0;}
  prefetch(_players:Iterable<{x:number;y:number}>){return 0;}
  /** Where the base goes (the fountain plaza) and where heroes start (the crashed helicopter). */
  get base():CityPoint{return this.asset.points.praca;}
  get spawn():CityPoint{return this.asset.points.inicio;}
}

/**
 * Decodes the asset text after checking it hashes to `hash` (the D-027 manifest / welcome signature) and registers it.
 * One instance per hash per process: rooms and the client share the decoded city. Never throws.
 */
export async function cityTerrainFrom(json:string,hash:string):Promise<{ok:true;terrain:CityTerrain}|{ok:false;error:string}>{
  const known=loaded.get(hash);if(known)return {ok:true,terrain:known};
  const checked=await checkCityHash(json,hash);
  if(!checked.ok)return checked;
  const decoded=decodeCityAsset(json);
  if(!decoded.ok)return decoded;
  const terrain=new CityTerrain(decoded.asset,hash);
  loaded.set(hash,terrain);
  return {ok:true,terrain};
}

/** Cities decoded in this process, by asset hash: the client's welcome looks the room's city up here (D-034). */
const loaded=new Map<string,CityTerrain>();
export function cityTerrainFor(signature:string):CityTerrain|undefined{return loaded.get(signature);}

/**
 * The terrain as enemies move on it: a city's `forEnemies()` view (its blockers are solid), anything else unchanged
 * (island and endless world: the same object, so their runs are untouched). Cheap: one property read per call.
 */
export function enemyTerrain(terrain:CityTerrain):CityTerrain;
export function enemyTerrain(terrain:TerrainField):TerrainField;
export function enemyTerrain(terrain:TerrainField|undefined):TerrainField|undefined;
export function enemyTerrain(terrain:TerrainField|undefined):TerrainField|undefined{
  const view=(terrain as {forEnemies?:()=>TerrainField}|undefined)?.forEnemies;
  return typeof view==='function'?view.call(terrain):terrain;
}

/**
 * The city wherever a TerrainField is expected (Simulation, SimContext, world.ts, prediction). Compile-time proof that
 * CityTerrain has TerrainField's whole shape: if either side changes, this stops type-checking.
 */
export function cityAsField(terrain:CityTerrain):TerrainField{return terrain;}
