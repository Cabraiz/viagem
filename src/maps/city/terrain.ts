/**
 * Cidade Nevada as a terrain (D-026/D-027): the same surface the island and the endless world expose (world.ts reads
 * it through TerrainField's shape), backed by the decoded city asset instead of noise. Pure and deterministic, so the
 * server simulation and the client prediction collide identically.
 *
 * Collision is the walkable bitset (0.22 u samples) against a body disc: a body of radius r stands where every sample
 * its disc overlaps is walkable (D-030: the hero's collision is half a cell, radius 0.22 u, so a 2-sample alley fits).
 */
import type {CityAsset,CityPoint} from '../city-asset.ts';
import {decodeCityAsset} from '../city-asset.ts';
import type {WorldKind} from '../../contract/index.ts';
import type {TerrainField} from '../terrain/field.ts';

/** Vertical pixels per unit of height, matching the iso y scale of world.project (21 px per unit). */
export const CITY_HEIGHT_PX_PER_UNIT=21;
/** Overlap below this is touching, not entering: a disc exactly as wide as a corridor still fits. */
const TOUCH_EPS=1e-6;

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
  readonly isCity=true;
  private readonly minHeight:number;
  private readonly step:number;
  private readonly sw:number;
  private readonly sh:number;

  constructor(asset:CityAsset,hash:string){
    this.asset=asset;this.signature=hash;
    this.step=asset.samples.step;this.sw=asset.samples.w;this.sh=asset.samples.h;
    let min=Infinity;
    for(let y=0;y<asset.heightGrid.h;y++)for(let x=0;x<asset.heightGrid.w;x++)min=Math.min(min,asset.height(x,y));
    this.minHeight=Number.isFinite(min)?min:0;
  }

  /**
   * True when a body of radius r centred at (x,y) overlaps only walkable samples (outside the grid is blocked).
   * r = 0 asks about the single sample under the point.
   */
  clearDisc(x:number,y:number,r:number):boolean{
    if(!(Number.isFinite(x)&&Number.isFinite(y)&&r>=0))return false;
    const s=this.step,a=this.asset;
    if(r===0)return a.walkableAt(x,y);
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

/** Decodes the committed asset text and builds the terrain; returns the decoder's error instead of throwing. */
export function cityTerrainFrom(json:string|unknown,hash:string):{ok:true;terrain:CityTerrain}|{ok:false;error:string}{
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
 * The city wherever a TerrainField is expected (Simulation, SimContext, world.ts, prediction). Compile-time proof that
 * CityTerrain has TerrainField's whole shape: if either side changes, this stops type-checking.
 */
export function cityAsField(terrain:CityTerrain):TerrainField{return terrain;}
