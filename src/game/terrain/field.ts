// Noise constants and octave weights adapted from Crônicas do Império terrainModel.ts.
export const TERRAIN_VERSION=1;
export const DEFAULT_SEED=0x4c8f2a17;
export const FIELD_SIZE=129,FIELD_MIN=-4,FIELD_STEP=.25;
export {clamp,mix,smooth,hash2d,hash2u,noise,fbm,seedFrom} from './noise.ts';
import {clamp,mix,smooth,hash2d,fbm} from './noise.ts';
import {ChunkWorld,CHUNK_VERSION} from './chunks.ts';
/** 'ilha': the ~24×24 island (default). 'infinito': endless chunked map (D-019), base at the origin. */
export type WorldKind='ilha'|'infinito';
export interface TerrainOptions {world?:WorldKind;maxLiveChunks?:number}
export function randomSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
export class TerrainField {
  readonly seed:number;
  readonly heights=new Float32Array(FIELD_SIZE*FIELD_SIZE);
  readonly moisture=new Float32Array(FIELD_SIZE*FIELD_SIZE);
  readonly signature:string;
  readonly world:WorldKind;
  /** Chunk cache of the endless world; undefined on the island. */
  readonly chunks:ChunkWorld|undefined;
  constructor(seed:number,options:TerrainOptions={}){
    this.seed=seed>>>0;let signature=0x811c9dc5;
    this.world=options.world??'ilha';
    if(this.world==='infinito'){
      const chunks=this.chunks=new ChunkWorld(this.seed,{maxLive:options.maxLiveChunks});
      // The legacy 129×129 window (-4..28) keeps the island renderer drawing something sane around the base.
      for(let y=0;y<FIELD_SIZE;y++)for(let x=0;x<FIELD_SIZE;x++){
        const gx=FIELD_MIN+x*FIELD_STEP,gy=FIELD_MIN+y*FIELD_STEP,i=y*FIELD_SIZE+x;
        this.heights[i]=chunks.bed(gx,gy);this.moisture[i]=chunks.wetness(gx,gy);
      }
      for(const c of 'infinito')signature=Math.imul(signature^c.charCodeAt(0),0x01000193);
      signature=Math.imul(signature^CHUNK_VERSION,0x01000193);
      for(let cy=-1;cy<=1;cy++)for(let cx=-1;cx<=1;cx++)for(const c of chunks.chunk(cx,cy).hash)signature=Math.imul(signature^c.charCodeAt(0),0x01000193);
      this.signature=(signature>>>0).toString(16).padStart(8,'0');
      return;
    }
    this.chunks=undefined;
    for(let y=0;y<FIELD_SIZE;y++)for(let x=0;x<FIELD_SIZE;x++){
      const gx=FIELD_MIN+x*FIELD_STEP,gy=FIELD_MIN+y*FIELD_STEP;
      const broad=fbm(this.seed^0x51ed270b,gx*.12,gy*.12,4);
      const ridge=1-Math.abs(fbm(this.seed^0x9e3779b9,gx*.15,gy*.15,3)*2-1);
      const shore=this.coast(gx,gy);
      const dry=10+65*smooth((broad*.72+ridge*.28-.28)/.48);
      const height=shore>=0?dry*smooth(shore/4.8):-Math.min(32,-shore*10);
      const index=y*FIELD_SIZE+x;this.heights[index]=height;
      this.moisture[index]=fbm(this.seed^0x85ebca6b,gx*.11,gy*.11,3);
    }
    // Bound the gradient so every walkable slope has one visible intersection
    // in all four views. This avoids characters disappearing behind a cliff.
    for(let y=0;y<FIELD_SIZE;y++)for(let x=0;x<FIELD_SIZE;x++){const i=y*FIELD_SIZE+x;this.heights[i]=Math.min(this.heights[i],x?this.heights[i-1]+3:Infinity,y?this.heights[i-FIELD_SIZE]+3:Infinity);}
    for(let y=FIELD_SIZE-1;y>=0;y--)for(let x=FIELD_SIZE-1;x>=0;x--){const i=y*FIELD_SIZE+x;this.heights[i]=Math.min(this.heights[i],x<FIELD_SIZE-1?this.heights[i+1]+3:Infinity,y<FIELD_SIZE-1?this.heights[i+FIELD_SIZE]+3:Infinity);}
    for(let i=0;i<this.heights.length;i++){
      const encoded=Math.round((this.heights[i]+32)/160*255);
      this.heights[i]=encoded/255*160-32;
      signature=Math.imul(signature^encoded,0x01000193);
    }
    this.signature=(signature>>>0).toString(16).padStart(8,'0');
  }
  coast(x:number,y:number){
    if(this.chunks)return this.chunks.coast(x,y);
    const dx=x-12,dy=(y-12)*1.025,angle=Math.atan2(dy,dx);
    const phase=hash2d(this.seed,1,2)*Math.PI*2;
    const radius=10.35+.58*Math.sin(angle*3+phase)+.3*Math.sin(angle*5-phase*.7);
    return radius-Math.hypot(dx,dy);
  }
  private sample(data:Float32Array,x:number,y:number){
    const fx=clamp((x-FIELD_MIN)/FIELD_STEP,0,FIELD_SIZE-1),fy=clamp((y-FIELD_MIN)/FIELD_STEP,0,FIELD_SIZE-1);
    const ix=Math.min(FIELD_SIZE-2,Math.floor(fx)),iy=Math.min(FIELD_SIZE-2,Math.floor(fy)),tx=fx-ix,ty=fy-iy,index=iy*FIELD_SIZE+ix;
    return mix(mix(data[index],data[index+1],tx),mix(data[index+FIELD_SIZE],data[index+FIELD_SIZE+1],tx),ty);
  }
  bed(x:number,y:number){return this.chunks?this.chunks.bed(x,y):this.sample(this.heights,x,y);}
  height(x:number,y:number){return Math.max(0,this.bed(x,y));}
  wetness(x:number,y:number){return this.chunks?this.chunks.wetness(x,y):this.sample(this.moisture,x,y);}
  slope(x:number,y:number){return Math.hypot(this.height(x+.125,y)-this.height(x-.125,y),this.height(x,y+.125)-this.height(x,y-.125))/.25;}
  land(x:number,y:number,margin=0){return Number.isFinite(x)&&Number.isFinite(y)&&this.coast(x,y)>margin&&this.bed(x,y)>0;}
  /** Drops chunks far from every point (endless world); no-op on the island. Returns how many went. */
  retain(points:Iterable<{x:number;y:number}>){return this.chunks?this.chunks.retain(points):0;}
}
// Instances belong to a session/room. No mutable global seed shared by rooms.
export const defaultTerrain=new TerrainField(DEFAULT_SEED);
