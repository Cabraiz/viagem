/**
 * Cidade Nevada relief (cidade-relevo-pseudo-realista, data part): the asset's corner heights are WC3 terraces — flat
 * shelves one .w3x cell (0.88 u) × the map scale apart (1.496 u since cidade-escala-1-7), joined by cliff cells. The ground the client draws and the actors stand on (CityTerrain.bed,
 * render/city/from-maps.ts corners) reads this instead: terraces relaxed into ramps, a low snow undulation on open
 * ground, while buildings, walls and the map edge keep their corners (walls stay walls) and the plaza and the avenues get
 * no undulation (nearly flat streets).
 *
 * Heights only: the walkable/water bits, blocks, points and the asset hash are untouched, and nothing in the simulation
 * reads ground height, so rooms are byte-identical. Computed once per asset, lazily (sim terrains never ask), and shared
 * by every fork and view of it. Pure and deterministic (no Math.random, integer hash), the same on every client.
 */
import type {CityAsset,CityRect} from '../city-asset.ts';
import {UNITS_PER_CELL} from '../city-asset.ts';

/** Relaxation passes (damped Jacobi: half the corner, half its 4-neighbour mean; damping also kills checkerboards) over the free corners: a 0.88 u step becomes a ramp a few cells long. */
export const RELIEF_PASSES=16;
/** Extra passes on the streets and the plaza only (their source has 0.88 u row steps too): nearly flat, not rippled. */
export const STREET_PASSES=40;
/**
 * Snow undulation: peak height (u, never below the source ground) and wavelength (cells). The height is for the .w3x
 * cell (UNITS_PER_CELL 0.88 u); undulationHeight scales it with the asset's map scale like the asset's own heights
 * (NEW-20261013-ORQ-cidade-escala-1-7: version 2 is × 1.7), so the bumps keep their slope. The wavelength is a map
 * distance: 14 cells on the 1.7× city, 8 since its distances are 1.75× shorter (asset v4, mapa-175-com-viaduto).
 */
export const UNDULATION_HEIGHT=2.4,UNDULATION_CELLS=8;
/** Map scale of an asset: its cell over the .w3x cell (1 for a version-1 import, 1.7 for the Cidade Nevada version 2). */
export const cityMapScale=(asset:Pick<CityAsset,'unitsPerCell'>)=>asset.unitsPerCell/UNITS_PER_CELL;
/** Peak snow undulation (u) on this asset: UNDULATION_HEIGHT × its map scale. */
export const undulationHeight=(asset:Pick<CityAsset,'unitsPerCell'>)=>UNDULATION_HEIGHT*cityMapScale(asset);
/** Undulation fades in over this many cells away from walls/buildings, the streets and the water (8 before asset v4: ÷ 1.75). */
export const UNDULATION_FADE_CELLS=5;
/** Street zones, same shape as render/city/from-maps.ts draws them ('c' plaza, 'p' avenues and the ring road). */
export const STREET_PLAZA_PAD_CELLS=1,STREET_PLAZA_RADIUS_CELLS=3,STREET_AVENUE_HALF_WIDTH_CELLS=2,STREET_RING_CELLS=4;

const cache=new WeakMap<CityAsset,Float64Array>();

/** Smoothed corner heights in world units, (cells.w+1)×(cells.h+1), row-major like asset.heightsCenti. */
export function cityRelief(asset:CityAsset):Float64Array{
  let out=cache.get(asset);
  if(!out){out=buildRelief(asset);cache.set(asset,out);}
  return out;
}

/** Bilinear ground height (u) on the relief, clamped to the grid like asset.heightAt. */
export function cityReliefAt(asset:CityAsset,x:number,y:number):number{return sampleRelief(cityRelief(asset),asset,x,y);}
/** Bilinear sample of a relief array already in hand (CityTerrain keeps it, no lookup per query). */
export function sampleRelief(R:Float64Array,asset:CityAsset,x:number,y:number):number{
  const hw=asset.heightGrid.w,hh=asset.heightGrid.h,unit=asset.heightGrid.step;
  let fx=x/unit,fy=y/unit;
  if(!(fx>0))fx=0;else if(fx>hw-1)fx=hw-1;
  if(!(fy>0))fy=0;else if(fy>hh-1)fy=hh-1;
  let ix=fx|0,iy=fy|0;
  if(ix>hw-2)ix=hw-2;
  if(iy>hh-2)iy=hh-2;
  const tx=fx-ix,ty=fy-iy,i=iy*hw+ix;
  const top=R[i]+(R[i+1]-R[i])*tx,bottom=R[i+hw]+(R[i+hw+1]-R[i+hw])*tx;
  return top+(bottom-top)*ty;
}

function buildRelief(asset:CityAsset):Float64Array{
  const W=asset.cells.w,H=asset.cells.h,hw=W+1,hh=H+1,cell=asset.unitsPerCell,n=hw*hh;
  const src=new Float64Array(n);
  for(let i=0;i<n;i++)src[i]=asset.heightsCenti[i]/100;
  // Cells under a building, wall or the map edge lock their 4 corners: their bases, faces and the wall tops stay put.
  const solid=new Uint8Array(W*H),edge=new Uint8Array(W*H);
  const mark=(r:CityRect,into:Uint8Array)=>{
    const x0=Math.max(0,Math.floor(r[0]/cell+1e-6)),y0=Math.max(0,Math.floor(r[1]/cell+1e-6));
    const x1=Math.min(W,Math.ceil((r[0]+r[2])/cell-1e-6)),y1=Math.min(H,Math.ceil((r[1]+r[3])/cell-1e-6));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)into[y*W+x]=1;
  };
  for(const b of asset.blocks){
    if(b.kind==='building'||b.kind==='wall'||b.kind==='edge')for(const r of b.rects)mark(r,solid);
    if(b.kind==='edge')for(const r of b.rects)mark(r,edge);
  }
  const locked=new Uint8Array(n);
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++)if(solid[cy*W+cx]){const i=cy*hw+cx;locked[i]=locked[i+1]=locked[i+hw]=locked[i+hw+1]=1;}
  for(let x=0;x<hw;x++){locked[x]=1;locked[(hh-1)*hw+x]=1;}
  for(let y=0;y<hh;y++){locked[y*hw]=1;locked[y*hw+hw-1]=1;}
  // 1. Ramps: relax the free corners toward their neighbours' mean, locked corners fixed. Every value stays a convex
  // combination of source heights.
  let a=Float64Array.from(src),b=new Float64Array(n);
  for(let pass=0;pass<RELIEF_PASSES;pass++){
    for(let y=0;y<hh;y++)for(let x=0;x<hw;x++){
      const i=y*hw+x;
      b[i]=locked[i]?a[i]:a[i]*.5+(a[i-1]+a[i+1]+a[i-hw]+a[i+hw])*.125;
    }
    const t=a;a=b;b=t;
  }
  const street=streetCorners(asset,edge);
  for(let pass=0;pass<STREET_PASSES;pass++){
    for(let y=0;y<hh;y++)for(let x=0;x<hw;x++){
      const i=y*hw+x;
      b[i]=locked[i]||!street[i]?a[i]:a[i]*.5+(a[i-1]+a[i+1]+a[i-hw]+a[i+hw])*.125;
    }
    const t=a;a=b;b=t;
  }
  // 2. Snow undulation on open ground: distance (cells, chamfer) to a locked corner and to a street corner fades it in.
  const FAR=1e9,dist=new Float64Array(n);
  const spc=cell/asset.samples.step,wet=new Uint8Array(n);
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++)if(asset.water((cx+.5)*spc,(cy+.5)*spc)){const i=cy*hw+cx;wet[i]=wet[i+1]=wet[i+hw]=wet[i+hw+1]=1;}
  for(let i=0;i<n;i++)dist[i]=locked[i]||street[i]||wet[i]?0:FAR;
  for(let pass=0;pass<2;pass++){
    for(let y=0;y<hh;y++)for(let x=0;x<hw;x++){
      const i=y*hw+x;
      if(x>0)dist[i]=Math.min(dist[i],dist[i-1]+1);
      if(y>0)dist[i]=Math.min(dist[i],dist[i-hw]+1);
    }
    for(let y=hh-1;y>=0;y--)for(let x=hw-1;x>=0;x--){
      const i=y*hw+x;
      if(x<hw-1)dist[i]=Math.min(dist[i],dist[i+1]+1);
      if(y<hh-1)dist[i]=Math.min(dist[i],dist[i+hw]+1);
    }
  }
  const peak=undulationHeight(asset);
  for(let y=0;y<hh;y++)for(let x=0;x<hw;x++){
    const i=y*hw+x,f=Math.min(1,dist[i]/UNDULATION_FADE_CELLS),fade=f*f*(3-2*f);
    if(fade>0)a[i]+=peak*fade*snowNoise(x/UNDULATION_CELLS,y/UNDULATION_CELLS);
  }
  // 3. Same lowest corner as the source (a relaxed pit rises a little): the terrain's zero and minHeight stay valid.
  let srcMin=Infinity,min=Infinity;
  for(let i=0;i<n;i++){if(src[i]<srcMin)srcMin=src[i];if(a[i]<min)min=a[i];}
  if(Number.isFinite(min)&&min!==srcMin){
    const shift=srcMin-min;let low=0;
    for(let i=0;i<n;i++){a[i]+=shift;if(a[i]<a[low])low=i;}
    a[low]=srcMin; // exactly, not min + (srcMin - min) in floating point
    for(let i=0;i<n;i++)if(a[i]<srcMin)a[i]=srcMin;
  }
  return a;
}

/** Corners of the street cells (plaza box and disc, the four avenues, the ring road along the map edge). */
function streetCorners(asset:CityAsset,edge:Uint8Array):Uint8Array{
  const W=asset.cells.w,H=asset.cells.h,hw=W+1,cell=asset.unitsPerCell,p=asset.points,c=(v:number)=>v/cell;
  const mouths=[p.bocas.N,p.bocas.S,p.bocas.L,p.bocas.O];
  const px0=Math.min(...mouths.map(m=>c(m.x)))-STREET_PLAZA_PAD_CELLS,px1=Math.max(...mouths.map(m=>c(m.x)))+STREET_PLAZA_PAD_CELLS;
  const py0=Math.min(...mouths.map(m=>c(m.y)))-STREET_PLAZA_PAD_CELLS,py1=Math.max(...mouths.map(m=>c(m.y)))+STREET_PLAZA_PAD_CELLS;
  const pcx=c(p.praca.x),pcy=c(p.praca.y),plazaR2=STREET_PLAZA_RADIUS_CELLS**2,aveR2=STREET_AVENUE_HALF_WIDTH_CELLS**2;
  const avenues=[[p.bocas.N,p.spawnN],[p.bocas.S,p.spawnS],[p.bocas.L,p.spawnL],[p.bocas.O,p.spawnO]].map(([a,b])=>[c(a.x),c(a.y),c(b.x),c(b.y)] as const);
  // Cells within STREET_RING_CELLS of the map edge blocks (chamfer distance over cells).
  const FAR=1e9,ring=new Float64Array(W*H);
  for(let i=0;i<W*H;i++)ring[i]=edge[i]?0:FAR;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(x>0)ring[i]=Math.min(ring[i],ring[i-1]+1);if(y>0)ring[i]=Math.min(ring[i],ring[i-W]+1);}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;if(x<W-1)ring[i]=Math.min(ring[i],ring[i+1]+1);if(y<H-1)ring[i]=Math.min(ring[i],ring[i+W]+1);}
  const out=new Uint8Array(hw*(H+1));
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){
    const x=cx+.5,y=cy+.5;
    let on=(x>=px0&&x<=px1&&y>=py0&&y<=py1)||(x-pcx)**2+(y-pcy)**2<=plazaR2||(!edge[cy*W+cx]&&ring[cy*W+cx]<=STREET_RING_CELLS);
    if(!on)for(const [ax,ay,bx,by] of avenues)if(segDist2(x,y,ax,ay,bx,by)<=aveR2){on=true;break;}
    if(on){const i=cy*hw+cx;out[i]=out[i+1]=out[i+hw]=out[i+hw+1]=1;}
  }
  return out;
}
function segDist2(x:number,y:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l>0?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l)):0;
  return (x-ax-dx*t)**2+(y-ay-dy*t)**2;
}
/** Smooth value noise in [0, 1] (two octaves), integer-hashed lattice: the same bumps on every device. */
function snowNoise(x:number,y:number){return (lattice(x,y)*.7+lattice(x*2.1+17.3,y*2.1+5.7)*.3);}
function lattice(x:number,y:number){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const v00=hash(ix,iy),v10=hash(ix+1,iy),v01=hash(ix,iy+1),v11=hash(ix+1,iy+1);
  return (v00+(v10-v00)*sx)+((v01+(v11-v01)*sx)-(v00+(v10-v00)*sx))*sy;
}
function hash(x:number,y:number){
  let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1);
  h=Math.imul(h^(h>>>15),0x2c1b3c6d);h^=h>>>13;
  return (h>>>0)/4294967296;
}
