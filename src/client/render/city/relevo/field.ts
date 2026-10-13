/**
 * Relief ground of the Cidade Nevada (card NEW-20261013-ORQ-cidade-relevo-pseudo-realista): the small textures the
 * relief shader (shader.ts) reads, packed from the render asset (three, with the cover masks). Pure, no Phaser.
 *
 * Field: one texel per cell CORNER, (width+1)×(height+1), so the GPU's bilinear filter at uv = (f + 0.5) / (width + 1)
 * is exactly asset.ts groundZ (the ground actors stand on).
 *   R height / maxHeight (render units) · G, B unused (0) · A 255.
 * Kinds and cover: one texel per CELL, width×height, sampled bilinear at the cell centre (uv = f / width), so masks
 * blend over half a cell and a single cell still shows (a per-corner share would wash a 1-cell patch out).
 *   kinds: R trodden snow (streets) · G plaza stones · B ice · A 255.
 *   cover: R rubble · G water · B cliff (cells under a `cliff` block: drawn as a rock ledge, not a box) · A 255.
 * Fresh snow is what none of the masks claims. Alpha stays 255: an uploaded texture with alpha < 1 would be
 * premultiplied and lose its colour channels.
 */
import {groundAt,type CityAsset} from '../asset.ts';

export interface ReliefTextures {
  /** RGBA, (width+1)×(height+1), row-major from the north-west corner. */
  field:Uint8Array;
  fieldWidth:number;
  fieldHeight:number;
  /** RGBA, width×height. */
  kinds:Uint8Array;
  /** RGBA, width×height. */
  cover:Uint8Array;
  /** Height (render units) that R = 255 stands for: the highest corner, at least MIN_RELIEF_HEIGHT. */
  maxHeight:number;
}

/** A flat city still gets a non-zero scale (the shader divides the ray by it). */
export const MIN_RELIEF_HEIGHT=0.25;

const byte=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));

/** Corner heights (render units): the asset's exact corners, else each cell's height spread to its 4 corners. */
export function cornerHeights(asset:CityAsset):Float32Array{
  const W=asset.width+1,H=asset.height+1,out=new Float32Array(W*H);
  if(asset.corners){for(let i=0;i<out.length;i++)out[i]=Math.max(0,asset.corners[i]);return out;}
  const n=new Uint8Array(W*H);
  for(let cy=0;cy<asset.height;cy++)for(let cx=0;cx<asset.width;cx++){
    const h=Math.max(0,asset.heights[cy*asset.width+cx]);
    for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){const i=(cy+dy)*W+cx+dx;out[i]+=h;n[i]++;}
  }
  for(let i=0;i<out.length;i++)out[i]/=n[i]||1;
  return out;
}

export function reliefTextures(asset:CityAsset):ReliefTextures{
  const W=asset.width+1,H=asset.height+1,corners=cornerHeights(asset);
  let top=0;for(const h of corners)if(h>top)top=h;
  const maxHeight=Math.max(MIN_RELIEF_HEIGHT,top);
  const field=new Uint8Array(W*H*4);
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){
    const t=(j*W+i)*4;
    field[t]=byte(corners[j*W+i]/maxHeight);
    field[t+3]=255;
  }
  const kinds=new Uint8Array(asset.width*asset.height*4),cover=new Uint8Array(asset.width*asset.height*4);
  const cliff=new Uint8Array(asset.width*asset.height);
  for(const b of asset.blocks)if(b.kind==='cliff')for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)cliff[y*asset.width+x]=255;
  for(let cy=0;cy<asset.height;cy++)for(let cx=0;cx<asset.width;cx++){
    const t=(cy*asset.width+cx)*4,k=groundAt(asset,cx,cy);
    kinds[t]=k==='packed'?255:0;kinds[t+1]=k==='cobble'?255:0;kinds[t+2]=k==='ice'?255:0;kinds[t+3]=255;
    cover[t]=k==='rubble'?255:0;cover[t+1]=k==='water'?255:0;cover[t+2]=cliff[cy*asset.width+cx];cover[t+3]=255;
  }
  return {field,fieldWidth:W,fieldHeight:H,kinds,cover,maxHeight};
}

/** Height (render units) the shader reads back at fractional cell coordinates (f in cells from the grid origin). */
export function reliefHeight(t:ReliefTextures,fx:number,fy:number):number{
  const W=t.fieldWidth,H=t.fieldHeight;
  const x=Math.max(0,Math.min(W-1,fx)),y=Math.max(0,Math.min(H-1,fy));
  const i=Math.min(W-2,Math.floor(x)),j=Math.min(H-2,Math.floor(y)),u=x-i,v=y-j;
  const at=(a:number,b:number)=>t.field[(b*W+a)*4]/255*t.maxHeight;
  return at(i,j)*(1-u)*(1-v)+at(i+1,j)*u*(1-v)+at(i,j+1)*(1-u)*v+at(i+1,j+1)*u*v;
}
