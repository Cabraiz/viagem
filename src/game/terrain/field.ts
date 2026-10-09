// Noise constants and octave weights adapted from Crônicas do Império terrainModel.ts.
export const TERRAIN_VERSION=1;
export const DEFAULT_SEED=0x4c8f2a17;
export const FIELD_SIZE=129,FIELD_MIN=-4,FIELD_STEP=.25;
export const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
export function hash2d(seed:number,x:number,y:number){let h=seed^Math.imul(x,0x1f123bb5)^Math.imul(y,0x5f356495);h=Math.imul(h^h>>>16,0x7feb352d);h=Math.imul(h^h>>>15,0x846ca68b);return ((h^h>>>16)>>>0)/4294967295;}
export function noise(seed:number,x:number,y:number){const ix=Math.floor(x),iy=Math.floor(y),tx=smooth(x-ix),ty=smooth(y-iy);return mix(mix(hash2d(seed,ix,iy),hash2d(seed,ix+1,iy),tx),mix(hash2d(seed,ix,iy+1),hash2d(seed,ix+1,iy+1),tx),ty);}
export function fbm(seed:number,x:number,y:number,octaves=4){let value=0,amplitude=.5,frequency=1,total=0;for(let i=0;i<octaves;i++){value+=noise(seed+i*1013,x*frequency,y*frequency)*amplitude;total+=amplitude;amplitude*=.5;frequency*=2.03;}return value/total;}
export function seedFrom(value:string){let n=0x811c9dc5;for(const c of value)n=Math.imul(n^c.charCodeAt(0),0x01000193);return n>>>0;}
export function randomSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
export class TerrainField {
  readonly seed:number;
  readonly heights=new Float32Array(FIELD_SIZE*FIELD_SIZE);
  readonly moisture=new Float32Array(FIELD_SIZE*FIELD_SIZE);
  readonly signature:string;
  constructor(seed:number){
    this.seed=seed>>>0;let signature=0x811c9dc5;
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
  bed(x:number,y:number){return this.sample(this.heights,x,y);}
  height(x:number,y:number){return Math.max(0,this.bed(x,y));}
  wetness(x:number,y:number){return this.sample(this.moisture,x,y);}
  slope(x:number,y:number){return Math.hypot(this.height(x+.125,y)-this.height(x-.125,y),this.height(x,y+.125)-this.height(x,y-.125))/.25;}
  land(x:number,y:number,margin=0){return Number.isFinite(x)&&Number.isFinite(y)&&this.coast(x,y)>margin&&this.bed(x,y)>0;}
}
// Instances belong to a session/room. No mutable global seed shared by rooms.
export const defaultTerrain=new TerrainField(DEFAULT_SEED);
