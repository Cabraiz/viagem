/**
 * Minimap WC3: the terrain seen from above, in colours, as one image drawn with one transform (geometry.ts
 * imageTransform). The city is the whole map, built once per asset (cell by cell from the render asset's ground and
 * blocks, with a light relief shade); the endless map has no edge, so a window around a centre is built again when the
 * hero walks far from it; the island is its outline.
 *
 * Colours are a minimap palette (strong, like an RTS map): the city's art palette is pale snow and lilac, which would
 * read as one flat tone at 120 px.
 */
import {cityRenderAsset} from '../../render/city/from-maps.ts';
import {isLand,trailAt,type CityAsset as MapsCityAsset,type TerrainField} from '../../../maps/index.ts';
import type {Pt} from './geometry.ts';

export const MM_COLORS=Object.freeze({
  // Muted ground and blocks, strong lines (avenues, plaza, water): the dots must pop, as on an RTS map.
  outside:'#2b2542',snow:'#e3e6f0',packed:'#7f7ba3',ice:'#b6e3f3',water:'#3f86d6',rubble:'#b3aab9',cobble:'#e2a95c',
  building:'#a59fbd',wall:'#6e6690',cliff:'#c2bcd4',
  grass:'#5f9e4c',grassDark:'#3f7a37',dry:'#a9a85a',sand:'#e3cf94',trail:'#c9a46a',tree:'#2e5a2a',rock:'#8d8f8c',sea:'#2f7fb8',
});
const GROUND_HEX:Record<string,string>={s:MM_COLORS.snow,p:MM_COLORS.packed,i:MM_COLORS.ice,w:MM_COLORS.water,r:MM_COLORS.rubble,c:MM_COLORS.cobble};
const BLOCK_HEX:Record<string,string>={building:MM_COLORS.building,wall:MM_COLORS.wall,cliff:MM_COLORS.cliff,rubble:MM_COLORS.rubble};

/** An image of the terrain whose pixel (u, v) is the world point origin + (u, v)·unit. */
export interface TerrainImage {readonly canvas:HTMLCanvasElement|OffscreenCanvas;readonly origin:Pt;readonly unit:number;readonly width:number;readonly height:number}

const rgb=(hex:string)=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
function canvas(w:number,h:number):HTMLCanvasElement|OffscreenCanvas{
  if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);
  const c=document.createElement('canvas');c.width=w;c.height=h;return c;
}

/**
 * The city's pixels (RGBA, one per cell): ground colour, blocks over it, and a relief shade (lighter facing the
 * upper-left sun, darker away from it). Pure: the tests read it without a DOM.
 */
export function cityTerrainPixels(asset:MapsCityAsset):{width:number;height:number;data:Uint8ClampedArray<ArrayBuffer>;unit:number;origin:Pt}{
  const r=cityRenderAsset(asset),W=r.width,H=r.height,data=new Uint8ClampedArray(W*H*4);
  const kinds:string[]=new Array(W*H);
  for(let i=0;i<W*H;i++)kinds[i]=GROUND_HEX[r.ground[i]]??MM_COLORS.snow;
  for(const b of r.blocks){
    const c=BLOCK_HEX[b.kind]??MM_COLORS.building;
    for(let y=Math.max(0,Math.floor(b.y));y<Math.min(H,Math.ceil(b.y+b.h));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(W,Math.ceil(b.x+b.w));x++)kinds[y*W+x]=c;
  }
  const h=r.heights,at=(x:number,y:number)=>h[Math.min(H-1,Math.max(0,y))*W+Math.min(W-1,Math.max(0,x))];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,[cr,cg,cb]=rgb(kinds[i]);
    // Slope towards the upper-left sun: up to ±18% light.
    const slope=(at(x-1,y)-at(x+1,y)+at(x,y-1)-at(x,y+1))/(2*r.cell),k=1+Math.max(-.18,Math.min(.18,slope*.35));
    data[i*4]=cr*k;data[i*4+1]=cg*k;data[i*4+2]=cb*k;data[i*4+3]=255;
  }
  return {width:W,height:H,data,unit:r.cell,origin:{x:r.origin.x,y:r.origin.y}};
}

const cityCache=new WeakMap<object,TerrainImage>();
/** The city's terrain image, built once per asset. */
export function cityTerrainImage(asset:MapsCityAsset):TerrainImage{
  let img=cityCache.get(asset);
  if(img)return img;
  const px=cityTerrainPixels(asset),c=canvas(px.width,px.height),ctx=c.getContext('2d') as CanvasRenderingContext2D;
  ctx.putImageData(new ImageData(px.data,px.width,px.height),0,0);
  img={canvas:c,origin:px.origin,unit:px.unit,width:px.width,height:px.height};
  cityCache.set(asset,img);
  return img;
}

/**
 * The endless map around `center`: `span` world units across at `unit` u per pixel. Lakes blue with sand shores,
 * trails, grass by wetness (dark where moist, dry where not), trees and rocks as dots. Pure pixels (tests).
 */
export function endlessTerrainPixels(terrain:TerrainField,center:Pt,span:number,unit:number):{width:number;height:number;data:Uint8ClampedArray<ArrayBuffer>;unit:number;origin:Pt}{
  const chunks=terrain.chunks!,n=Math.max(8,Math.round(span/unit)),origin={x:center.x-n*unit/2,y:center.y-n*unit/2};
  const data=new Uint8ClampedArray(n*n*4);
  const put=(i:number,hex:string,k=1)=>{const [r,g,b]=rgb(hex);data[i*4]=r*k;data[i*4+1]=g*k;data[i*4+2]=b*k;data[i*4+3]=255;};
  for(let v=0;v<n;v++)for(let u=0;u<n;u++){
    const x=origin.x+(u+.5)*unit,y=origin.y+(v+.5)*unit,i=v*n+u,bed=chunks.bed(x,y);
    if(bed<0){put(i,MM_COLORS.water,bed<-1.5?.82:1);continue;}
    if(bed<1)put(i,MM_COLORS.sand);
    else if(trailAt(terrain.seed,x,y)>0)put(i,MM_COLORS.trail);
    else{const w=chunks.wetness(x,y);put(i,w>.6?MM_COLORS.grassDark:w<.38?MM_COLORS.dry:MM_COLORS.grass);}
  }
  // Trees and rocks: one dark dot each (2×2 px when the scale allows).
  const cx0=Math.floor(origin.x/32),cy0=Math.floor(origin.y/32),cx1=Math.floor((origin.x+n*unit)/32),cy1=Math.floor((origin.y+n*unit)/32);
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++)for(const o of chunks.chunk(cx,cy).obstacles){
    const u=Math.floor((o.x-origin.x)/unit),v=Math.floor((o.y-origin.y)/unit);
    if(u<0||v<0||u>=n||v>=n)continue;
    put(v*n+u,o.kind==='rock'?MM_COLORS.rock:MM_COLORS.tree);
  }
  return {width:n,height:n,data,unit,origin};
}
export function endlessTerrainImage(terrain:TerrainField,center:Pt,span:number,unit:number):TerrainImage{
  const px=endlessTerrainPixels(terrain,center,span,unit),c=canvas(px.width,px.height);
  (c.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(px.data,px.width,px.height),0,0);
  return {canvas:c,origin:px.origin,unit:px.unit,width:px.width,height:px.height};
}

/** The island (one field, 24 u across): land green, sea blue. */
export function islandTerrainImage(terrain?:TerrainField):TerrainImage{
  const n=48,unit=.5,origin={x:0,y:0},c=canvas(n,n),ctx=c.getContext('2d') as CanvasRenderingContext2D,img=ctx.createImageData(n,n);
  for(let v=0;v<n;v++)for(let u=0;u<n;u++){
    const i=(v*n+u)*4,[r,g,b]=rgb(isLand({x:(u+.5)*unit,y:(v+.5)*unit},0,terrain)?MM_COLORS.grass:MM_COLORS.sea);
    img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  return {canvas:c,origin,unit,width:n,height:n};
}
