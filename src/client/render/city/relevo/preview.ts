/**
 * Sandbox-only stand-in for the relief data (card NEW-20261013-ORQ-cidade-relevo-pseudo-realista): rolling snow hills
 * added to the render asset's corners, so the shader can be judged before the maps lane (Executor-1) ships the real
 * height field. Streets, the plaza, water and the cells under blocks stay at their own height (the hills fade out over
 * FADE_CELLS around them). `?sandbox=cidade&mapa=real&relevo=morros`. Never used by the game.
 */
import {groundAt,type CityAsset} from '../asset.ts';
import {cornerHeights} from './field.ts';

/** Hill amplitude (render units, ×42 px on screen) and the cells over which hills fade next to flat ground. */
const AMPLITUDE=1.6,FADE_CELLS=4,WAVELENGTH_CELLS=14;

const hash=(x:number,y:number)=>{let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1);h=Math.imul(h^(h>>>15),0x85ebca6b);return ((h^(h>>>13))>>>0)/0x100000000;};
function noise(x:number,y:number){
  const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,s=(t:number)=>t*t*(3-2*t),a=s(u),b=s(v);
  return (hash(i,j)*(1-a)+hash(i+1,j)*a)*(1-b)+(hash(i,j+1)*(1-a)+hash(i+1,j+1)*a)*b;
}
const fbm=(x:number,y:number)=>noise(x,y)*0.55+noise(x*2.1+5.3,y*2.1+1.7)*0.3+noise(x*4.3+9.1,y*4.3+3.3)*0.15;

export function previewHills(asset:CityAsset):CityAsset{
  const W=asset.width,H=asset.height,flat=new Uint8Array(W*H);
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){const k=groundAt(asset,cx,cy);if(k!=='snow')flat[cy*W+cx]=1;}
  for(const b of asset.blocks)for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)flat[y*W+x]=1;
  // Distance (cells, chessboard) to the nearest flat cell, capped at FADE_CELLS.
  const dist=new Float32Array(W*H).fill(FADE_CELLS);
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++)if(flat[cy*W+cx])
    for(let y=Math.max(0,cy-FADE_CELLS);y<=Math.min(H-1,cy+FADE_CELLS);y++)for(let x=Math.max(0,cx-FADE_CELLS);x<=Math.min(W-1,cx+FADE_CELLS);x++){
      const d=Math.max(Math.abs(x-cx),Math.abs(y-cy));if(d<dist[y*W+x])dist[y*W+x]=d;
    }
  const CW=W+1,base=cornerHeights(asset);
  const corners:number[]=new Array(CW*(H+1));
  for(let j=0;j<=H;j++)for(let i=0;i<=W;i++){
    let d=FADE_CELLS;
    for(const [dx,dy] of [[-1,-1],[0,-1],[-1,0],[0,0]]){const x=i+dx,y=j+dy;if(x>=0&&y>=0&&x<W&&y<H)d=Math.min(d,dist[y*W+x]);}
    const fade=Math.min(1,d/FADE_CELLS),t=fade*fade*(3-2*fade);
    const hill=Math.max(0,fbm(i/WAVELENGTH_CELLS,j/WAVELENGTH_CELLS)-0.35)/0.65;
    corners[j*CW+i]=base[j*CW+i]+AMPLITUDE*hill*t;
  }
  const heights=asset.heights.map((_,k)=>{const cx=k%W,cy=(k-cx)/W,i=cy*CW+cx;return (corners[i]+corners[i+1]+corners[i+CW]+corners[i+CW+1])/4;});
  return {...asset,corners,heights};
}
