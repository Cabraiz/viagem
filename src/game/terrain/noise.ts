// Noise constants and octave weights adapted from Crônicas do Império terrainModel.ts.
// Pure integer/IEEE arithmetic only (no Math.sin/exp): identical on the Worker and in every browser.
export const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
/** 32-bit integer hash of (seed, x, y); x and y are truncated to int32 by Math.imul. */
export function hash2u(seed:number,x:number,y:number){let h=seed^Math.imul(x,0x1f123bb5)^Math.imul(y,0x5f356495);h=Math.imul(h^h>>>16,0x7feb352d);h=Math.imul(h^h>>>15,0x846ca68b);return (h^h>>>16)>>>0;}
export function hash2d(seed:number,x:number,y:number){return hash2u(seed,x,y)/4294967295;}
export function noise(seed:number,x:number,y:number){const ix=Math.floor(x),iy=Math.floor(y),tx=smooth(x-ix),ty=smooth(y-iy);return mix(mix(hash2d(seed,ix,iy),hash2d(seed,ix+1,iy),tx),mix(hash2d(seed,ix,iy+1),hash2d(seed,ix+1,iy+1),tx),ty);}
export function fbm(seed:number,x:number,y:number,octaves=4){let value=0,amplitude=.5,frequency=1,total=0;for(let i=0;i<octaves;i++){value+=noise(seed+i*1013,x*frequency,y*frequency)*amplitude;total+=amplitude;amplitude*=.5;frequency*=2.03;}return value/total;}
export function seedFrom(value:string){let n=0x811c9dc5;for(const c of value)n=Math.imul(n^c.charCodeAt(0),0x01000193);return n>>>0;}
