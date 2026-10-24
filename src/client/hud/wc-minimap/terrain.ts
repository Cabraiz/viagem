/**
 * Minimap WC3: the terrain seen from above, in colours, as one image drawn with one transform (geometry.ts
 * imageTransform). The city is the whole map, built once per asset (cell by cell from the render asset's ground and
 * blocks, with a light relief shade); the endless map has no edge, so a window around a centre is built again when the
 * hero walks far from it; the island is its outline.
 *
 * Colours are a minimap palette, like an RTS map: few colours and big patches (the city's art palette is pale snow and
 * lilac, one flat tone at 120 px).
 */
import {cityRenderAsset} from '../../render/city/from-maps.ts';
import {isLand,trailAt,type CityAsset as MapsCityAsset,type TerrainField} from '../../../maps/index.ts';
import type {Pt} from './geometry.ts';

export const MM_COLORS=Object.freeze({
  // The city reads at a glance like an RTS map: few colours, big patches. Walkable ground light and smooth (snow, the
  // avenues a shade darker), everything solid one flat dark tone, the plaza warm, water blue.
  outside:'#2b2542',snow:'#eef0f7',packed:'#cfd0e2',ice:'#cfe9f5',water:'#3f86d6',rubble:'#3b3456',cobble:'#f0b45c',
  building:'#3b3456',wall:'#3b3456',cliff:'#3b3456',
  grass:'#5f9e4c',grassDark:'#3f7a37',dry:'#a9a85a',sand:'#e3cf94',trail:'#c9a46a',tree:'#2e5a2a',rock:'#8d8f8c',sea:'#2f7fb8',
  // The viaduct (mapa-175-com-viaduto): a light strip with a dark edge over the streets it crosses.
  deck:'#c3bfd6',deckEdge:'#5b5478',
});
/** Share of solid cells in a 5×5 neighbourhood that makes a cell "built-up" (dark) on the city minimap. */
export const BUILT_SHARE=.2;
const GROUND_HEX:Record<string,string>={s:MM_COLORS.snow,p:MM_COLORS.packed,i:MM_COLORS.ice,w:MM_COLORS.water,r:MM_COLORS.rubble,c:MM_COLORS.cobble};

/** An image of the terrain whose pixel (u, v) is the world point origin + (u, v)·unit. */
export interface TerrainImage {readonly canvas:HTMLCanvasElement|OffscreenCanvas;readonly origin:Pt;readonly unit:number;readonly width:number;readonly height:number}

const rgb=(hex:string)=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
function canvas(w:number,h:number):HTMLCanvasElement|OffscreenCanvas{
  if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);
  const c=document.createElement('canvas');c.width=w;c.height=h;return c;
}

/**
 * The city's pixels (RGBA, one per cell): built-up (by the density of solid cells around) in one dark tone, the open
 * ground by its kind, the plaza warm. Pure: the tests read it without a DOM.
 */
export function cityTerrainPixels(asset:MapsCityAsset):{width:number;height:number;data:Uint8ClampedArray<ArrayBuffer>;unit:number;origin:Pt}{
  const r=cityRenderAsset(asset),W=r.width,H=r.height,data=new Uint8ClampedArray(W*H*4),cell=r.cell;
  // 1. Solid or not, per cell: blocks, and any cell whose centre a hero cannot stand on (lots, ruins, the map's edge).
  const solid=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!asset.walkableAt(r.origin.x+(x+.5)*cell,r.origin.y+(y+.5)*cell))solid[y*W+x]=1;
  for(const b of r.blocks)for(let y=Math.max(0,Math.floor(b.y));y<Math.min(H,Math.ceil(b.y+b.h));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(W,Math.ceil(b.x+b.w));x++)solid[y*W+x]=1;
  // 2. Built-up or open, by density: a cell is "built-up" when at least BUILT_SHARE of its 5×5 neighbourhood is solid.
  // The city is a maze of one-cell walls around snow lots; read cell by cell it is noise at 120 px. By density, the
  // blocks of houses become dark patches and the wide streets, the avenues and the plaza stay clear (an RTS map's read).
  const smooth=new Uint8Array(W*H),R=2,need=Math.ceil(BUILT_SHARE*(2*R+1)**2);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let n=0;
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const u=x+dx,v=y+dy;n+=u<0||v<0||u>=W||v>=H?1:solid[v*W+u];}
    smooth[y*W+x]=n>=need?1:0;
  }
  // 3. Colours: solid in one dark tone; open ground by its kind (snow, the avenues, the plaza, ice, water).
  for(let i=0;i<W*H;i++){
    const g=r.ground[i],water=g==='w';
    // The plaza keeps its warm tone even among the fountains and benches: it is the place to find.
    const [cr,cg,cb]=rgb(water?MM_COLORS.water:g==='c'?MM_COLORS.cobble:smooth[i]?MM_COLORS.building:GROUND_HEX[g]??MM_COLORS.snow);
    data[i*4]=cr;data[i*4+1]=cg;data[i*4+2]=cb;data[i*4+3]=255;
  }
  // 4. The viaducts on top (deck and ramp): their cells light, the ones on their outline dark.
  const deck=new Uint8Array(W*H),u=asset.unitsPerCell;
  for(const v of asset.viaducts)for(const [c0,r0,w,h] of [v.deck,v.ramp.rect])for(let j=r0;j<r0+h;j++)for(let i=c0;i<c0+w;i++){
    const x=Math.floor(((i+.5)*u-r.origin.x)/cell),y=Math.floor(((j+.5)*u-r.origin.y)/cell);
    if(x>=0&&y>=0&&x<W&&y<H)deck[y*W+x]=1;
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x;if(!deck[i])continue;
    const edge=x===0||y===0||x===W-1||y===H-1||!deck[i-1]||!deck[i+1]||!deck[i-W]||!deck[i+W];
    const [cr,cg,cb]=rgb(edge?MM_COLORS.deckEdge:MM_COLORS.deck);
    data[i*4]=cr;data[i*4+1]=cg;data[i*4+2]=cb;
  }
  return {width:W,height:H,data,unit:cell,origin:{x:r.origin.x,y:r.origin.y}};
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
