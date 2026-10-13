/**
 * Beyond the map edge (card cidade-borda-e-quadras, choice (b)): rings of snow that sink into Breu fog all around the
 * city, so the screen never shows the bare background next to the playable map and nothing out there reads as ground
 * to walk on. Pure geometry (no Phaser): the layer draws the quads once per view, just under the ground.
 * Ring k spans k..k+1 ring widths outside the map rectangle (mitered at the corners, so the rings close). The colour is
 * a continuous gradient (BUG silhueta-branca-e-nevoa: flat rings showed 7 steps): each ring blends, per vertex on the
 * GPU, from the colour of its inner edge to that of its outer edge, from a snow already pulled toward Breu (edge 0) to
 * exactly OUTSIDE_CITY (the outer edge of the last ring), which is also the camera background beyond it: no seam.
 * The edge colours follow a smoothstep, so the blend has no visible kink at the map nor where it meets the background.
 * It is frozen once per view like any city band (render/city/tri-band.ts): no per-frame cost over the flat rings.
 * Each point is projected at the ground height of the nearest map edge point, so the inner ring meets the drawn
 * ground without a gap whatever the relief.
 */
import {groundZ,type CityAsset} from './asset.ts';
import {CITY_PALETTE,OUTSIDE_CITY,mixColor} from './palette.ts';
import {VIEW_PIVOT,project,type Pt} from './projection.ts';

/** Number of rings and their width in cells: about 9 cells of fog, past the farthest the camera shows beyond the edge wall. */
export const FOG_RINGS=7;
export const FOG_RING_CELLS=1.25;
/** Edge 0 is the near snow pulled this far toward Breu: darker than every walkable ground, so it never reads as street. */
export const FOG_START=0.5;
export const FOG_NEAR=CITY_PALETTE['neve-detalhe'];
/** Cells per drawn part along a side (each part is culled on its own). */
export const FOG_SEGMENT_CELLS=16;

/**
 * One ring of one side segment: `inner` and `outer` are its two edges as matching point lists (same count, inner[i]
 * faces outer[i]), drawn as quads (inner[i], inner[i+1], outer[i+1], outer[i]) blending `from` (inner) to `to` (outer).
 */
export interface FogRing {from:number;to:number;inner:Pt[];outer:Pt[]}

/** Colour of ring edge k (0 = touching the map, FOG_RINGS = the outer end): snow toward Breu, the end exactly OUTSIDE_CITY. */
export function fogColor(k:number):number{
  if(k>=FOG_RINGS)return OUTSIDE_CITY;
  const x=Math.max(0,k)/FOG_RINGS,t=FOG_START+(1-FOG_START)*x*x*(3-2*x);
  return mixColor(FOG_NEAR,OUTSIDE_CITY,t);
}

/**
 * The fog as drawable parts (one per side segment of FOG_SEGMENT_CELLS cells), each a list of FOG_RINGS rings in
 * projected px for `view`. Every ring lies outside the map rectangle.
 */
export function borderFog(asset:CityAsset,view:number,pivot:Pt=VIEW_PIVOT):FogRing[][]{
  const {cell,width,height,origin}=asset,X0=origin.x,Y0=origin.y,X1=X0+width*cell,Y1=Y0+height*cell,ring=FOG_RING_CELLS*cell;
  const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
  const at=(x:number,y:number)=>project(x,y,groundZ(asset,clamp(x,X0,X1-1e-6),clamp(y,Y0,Y1-1e-6)),view,pivot);
  // Each side as (t along it, d outward) -> world point, walking clockwise; `cells` is its length in cells.
  const sides:{cells:number;point:(t:number,d:number)=>Pt}[]=[
    {cells:width,point:(t,d)=>({x:X0+t,y:Y0-d})},
    {cells:height,point:(t,d)=>({x:X1+d,y:Y0+t})},
    {cells:width,point:(t,d)=>({x:X1-t,y:Y1+d})},
    {cells:height,point:(t,d)=>({x:X0-d,y:Y1-t})},
  ];
  const parts:FogRing[][]=[];
  for(const side of sides){
    const L=side.cells*cell;
    for(let a=0;a<side.cells;a+=FOG_SEGMENT_CELLS){
      const b=Math.min(side.cells,a+FOG_SEGMENT_CELLS),part:FogRing[]=[];
      for(let k=0;k<FOG_RINGS;k++){
        const d0=k*ring,d1=(k+1)*ring;
        // Inner edge at d0 and outer edge at d1, through every cell corner of the segment; the side's two ends are
        // mitered (they reach d past the corner) so neighbouring sides' rings meet on the diagonal.
        const ts=(d:number)=>{
          const out:number[]=[a?a*cell:-d];
          for(let i=a+1;i<b;i++)out.push(i*cell);
          out.push(b<side.cells?b*cell:L+d);
          return out;
        };
        const inner=ts(d0).map(t=>{const p=side.point(t,d0);return at(p.x,p.y);});
        const outer=ts(d1).map(t=>{const p=side.point(t,d1);return at(p.x,p.y);});
        part.push({from:fogColor(k),to:fogColor(k+1),inner,outer});
      }
      parts.push(part);
    }
  }
  return parts;
}

/** Draws one fog ring on a Graphics as gradient triangles (two per quad), for TriBand.make (frozen per vertex colour). */
export function drawFogRing(g:{fillGradientStyle(tl:number,tr:number,bl:number,br:number,a0:number,a1:number,a2:number,a3:number):unknown;
  fillTriangle(x0:number,y0:number,x1:number,y1:number,x2:number,y2:number):unknown},r:FogRing){
  const {inner,outer,from,to}=r;
  for(let i=0;i+1<inner.length;i++){
    const a=inner[i],b=inner[i+1],c=outer[i+1],d=outer[i];
    // fillTriangle gives its vertices the top-left, top-right and bottom-left colours, in that order.
    g.fillGradientStyle(from,from,to,to,1,1,1,1);g.fillTriangle(a.x,a.y,b.x,b.y,c.x,c.y);
    g.fillGradientStyle(from,to,to,to,1,1,1,1);g.fillTriangle(a.x,a.y,c.x,c.y,d.x,d.y);
  }
}
