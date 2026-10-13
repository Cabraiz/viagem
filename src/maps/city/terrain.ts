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
import type {WorldKind} from '../../contract/index.ts';
import type {TerrainField} from '../terrain/field.ts';

/** Vertical pixels per unit of height, matching the iso y scale of world.project (21 px per unit). */
export const CITY_HEIGHT_PX_PER_UNIT=21;
/** Overlap below this is touching, not entering: a disc exactly as wide as a corridor still fits. */
const TOUCH_EPS=1e-6;

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
  private version=0;
  /** Cached `forEnemies()` view (created on first use). */
  private enemyView:CityTerrain|undefined=undefined;

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
    t.sorted=this.sorted;
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
    this.version++;
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
      setBlocker:{value:(id:string,shape:{x:number;y:number;r:number}|undefined)=>base.setBlocker(id,shape)},
      fork:{value:()=>base.fork()},
      enemyView:{value:view},
    });
    this.enemyView=view;
    return view;
  }
  /** True when a disc of radius r (≥ 0) at (x,y) overlaps a blocker disc by more than TOUCH_EPS. */
  private blocked(x:number,y:number,r:number):boolean{
    for(const b of this.sorted){
      const reach=r+b.r-TOUCH_EPS,dx=x-b.x,dy=y-b.y;
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
  /** Island-style `land`: here "the ground under a body of radius `margin` is walkable". */
  land(x:number,y:number,margin=0){return this.clearDisc(x,y,Math.max(0,margin));}
  /** Signed coastline helper of the island (director); in the city the sea is the map edge: + inside the playable area. */
  coast(x:number,y:number){
    const p=this.asset.playable;
    return Math.min(x-p.x,p.x+p.w-x,y-p.y,p.y+p.h-y);
  }
  /** Ground height in the iso pixel scale used by world.project/elevation (the lowest corner is 0). */
  bed(x:number,y:number){return (this.asset.heightAt(x,y)-this.minHeight)*CITY_HEIGHT_PX_PER_UNIT;}
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
