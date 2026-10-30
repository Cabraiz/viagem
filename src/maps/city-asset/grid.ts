import {SAMPLES_PER_CELL,SAMPLE_NUDGE} from './types.ts';

export interface GridParts {cellsW:number; cellsH:number; unit:number; walkBits:Uint8Array; waterBits:Uint8Array|null; heights:Int16Array}

/** Grid part of a CityAsset. Queries are closures (safe to pass around unbound), O(1) and allocation-free. */
export function makeAsset(g:GridParts){
  const {unit,walkBits,waterBits,heights}=g;
  const sw=g.cellsW*SAMPLES_PER_CELL,sh=g.cellsH*SAMPLES_PER_CELL,hw=g.cellsW+1,hh=g.cellsH+1,step=unit/SAMPLES_PER_CELL;
  const W=walkBits,Wa=waterBits??new Uint8Array(0),H=heights,hasWater=waterBits!==null;
  const walkable=(sx:number,sy:number)=>{
    if(!(sx>=0&&sx<sw&&sy>=0&&sy<sh))return false;
    const i=(sy|0)*sw+(sx|0);
    return (W[i>>3]>>(i&7)&1)===1;
  };
  const water=(sx:number,sy:number)=>{
    if(!hasWater||!(sx>=0&&sx<sw&&sy>=0&&sy<sh))return false;
    const i=(sy|0)*sw+(sx|0);
    return (Wa[i>>3]>>(i&7)&1)===1;
  };
  // x/step lands a hair below an exact sample edge in floating point (5.06/0.22 = 22.999…); the nudge keeps
  // [sx·step, (sx+1)·step) exact for coordinates written with 3 decimals, as the encoder does.
  const walkableAt=(x:number,y:number)=>walkable(x/step+SAMPLE_NUDGE,y/step+SAMPLE_NUDGE);
  const height=(hx:number,hy:number)=>{
    const x=hx>0?(hx<hw-1?hx|0:hw-1):0,y=hy>0?(hy<hh-1?hy|0:hh-1):0;
    return H[y*hw+x]/100;
  };
  const heightAt=(x:number,y:number)=>{
    let fx=x/unit,fy=y/unit;
    if(!(fx>0))fx=0;else if(fx>hw-1)fx=hw-1;
    if(!(fy>0))fy=0;else if(fy>hh-1)fy=hh-1;
    let ix=fx|0,iy=fy|0;
    if(ix>hw-2)ix=hw-2;
    if(iy>hh-2)iy=hh-2;
    const tx=fx-ix,ty=fy-iy,i=iy*hw+ix;
    const top=H[i]+(H[i+1]-H[i])*tx,bottom=H[i+hw]+(H[i+hw+1]-H[i+hw])*tx;
    return (top+(bottom-top)*ty)/100;
  };
  return {
    samples:Object.freeze({w:sw,h:sh,step}),heightGrid:Object.freeze({w:hw,h:hh,step:unit}),hasWater,
    walkableBits:walkBits,waterBits,heightsCenti:heights,walkable,water,walkableAt,height,heightAt,
  };
}
