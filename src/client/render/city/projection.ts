/**
 * Projection for the city layer (card cidade-03a). Same math as the scene's `projectView`/`viewDepth`
 * (src/game/projection.ts), kept local so this folder stays standalone during the sector migration:
 *   q = rotate(p - pivot, view) + pivot
 *   screen = ((q.x - q.y) * TILE_X, (q.x + q.y) * TILE_Y - z * HEIGHT_PX)
 *   depth = (q.x + q.y) * DEPTH_SCALE
 * Views: 0 = (x,y), 1 = (-y,x), 2 = (-x,-y), 3 = (y,-x), rotating around `pivot` (the scene uses (12,12)).
 * Heights here are world units (city asset); HEIGHT_PX turns them into screen pixels.
 */
export const TILE_X=42;
export const TILE_Y=21;
/** Screen pixels per world unit of height: a 1 u box looks about as tall as its 1 u edge (~47 px on screen). */
export const HEIGHT_PX=42;
export const DEPTH_SCALE=100;
/** Rotation pivot used by the scene's projectView (src/game/projection.ts). */
export const VIEW_PIVOT:Readonly<{x:number;y:number}>=Object.freeze({x:12,y:12});

export type View=0|1|2|3;
export interface Pt {x:number;y:number}

export const normalizeView=(view:number):View=>(((Math.round(view)%4)+4)%4) as View;

/** World vector rotated into view space (no pivot). */
export function rotate(x:number,y:number,view:number):Pt{
  switch(normalizeView(view)){
    case 1:return {x:-y,y:x};
    case 2:return {x:-x,y:-y};
    case 3:return {x:y,y:-x};
    default:return {x,y};
  }
}
/** Inverse of rotate. */
export function unrotate(x:number,y:number,view:number):Pt{return rotate(x,y,4-normalizeView(view));}

/** View-space point q for world point p. */
export function viewPoint(x:number,y:number,view:number,pivot:Pt=VIEW_PIVOT):Pt{
  const r=rotate(x-pivot.x,y-pivot.y,view);
  return {x:r.x+pivot.x,y:r.y+pivot.y};
}

/** Screen position of world point (x, y) at height z (world units). */
export function project(x:number,y:number,z:number,view:number,pivot:Pt=VIEW_PIVOT):Pt{
  const q=viewPoint(x,y,view,pivot);
  return {x:(q.x-q.y)*TILE_X,y:(q.x+q.y)*TILE_Y-z*HEIGHT_PX};
}

/** Draw order of a ground point: larger is nearer the viewer (drawn later). */
export function depth(x:number,y:number,view:number,pivot:Pt=VIEW_PIVOT){
  const q=viewPoint(x,y,view,pivot);
  return (q.x+q.y)*DEPTH_SCALE;
}

/** World point on the plane z for a screen position (inverse of project). */
export function unproject(sx:number,sy:number,z:number,view:number,pivot:Pt=VIEW_PIVOT):Pt{
  const sum=(sy+z*HEIGHT_PX)/TILE_Y,diff=sx/TILE_X;
  const qx=(sum+diff)/2,qy=(sum-diff)/2;
  const w=unrotate(qx-pivot.x,qy-pivot.y,view);
  return {x:w.x+pivot.x,y:w.y+pivot.y};
}

/** Screen-space axis-aligned rectangle. */
export interface Rect {x:number;y:number;w:number;h:number}
export const rectsOverlap=(a:Rect,b:Rect)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
/** Screen bounds of a set of points. */
export function boundsOf(points:readonly Pt[]):Rect{
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points){if(p.x<x0)x0=p.x;if(p.y<y0)y0=p.y;if(p.x>x1)x1=p.x;if(p.y>y1)y1=p.y;}
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
