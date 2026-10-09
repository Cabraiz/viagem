/**
 * World-space outline of a telegraph, with exactly the server's hit semantics (src/game/sim/telegraphs.ts, D-015):
 * line width = full thickness in world units, cone width = FULL aperture in radians. Pure module, tested against telegraphHits.
 */
import {DEFAULT_CONE_ANGLE,DEFAULT_LINE_WIDTH} from '../sim/telegraphs.ts';

export interface Pt {x:number;y:number}
export interface TelegraphShape {shape:'circle'|'line'|'cone';x:number;y:number;radius:number;dx:number;dy:number;width?:number}

const TAU=Math.PI*2;
export const CIRCLE_SEGMENTS=32,LINE_SEGMENTS=8,CONE_SEGMENTS=24;
/** Points an outline can need; callers size their scratch arrays with this. */
export const OUTLINE_MAX_POINTS=Math.max(CIRCLE_SEGMENTS,2*(LINE_SEGMENTS+1),CONE_SEGMENTS+2);

export const lineWidthOf=(t:TelegraphShape)=>t.width??DEFAULT_LINE_WIDTH;
export const coneApertureOf=(t:TelegraphShape)=>Math.min(TAU,t.width??DEFAULT_CONE_ANGLE);

/**
 * Writes the outline grown by k (0..1, for the fill-up animation) into out via put(i,x,y); returns the point count.
 * (dx,dy) must be a unit vector.
 */
export function telegraphOutline(t:TelegraphShape,k:number,put:(i:number,x:number,y:number)=>void):number{
  if(t.shape==='circle'){
    const r=t.radius*k;
    for(let i=0;i<CIRCLE_SEGMENTS;i++){const a=i/CIRCLE_SEGMENTS*TAU;put(i,t.x+Math.cos(a)*r,t.y+Math.sin(a)*r);}
    return CIRCLE_SEGMENTS;
  }
  if(t.shape==='line'){
    const half=lineWidthOf(t)/2,length=t.radius*k,nx=-t.dy*half,ny=t.dx*half;
    for(let i=0;i<=LINE_SEGMENTS;i++){const d=length*i/LINE_SEGMENTS;put(i,t.x+t.dx*d+nx,t.y+t.dy*d+ny);}
    for(let i=0;i<=LINE_SEGMENTS;i++){const d=length*(LINE_SEGMENTS-i)/LINE_SEGMENTS;put(LINE_SEGMENTS+1+i,t.x+t.dx*d-nx,t.y+t.dy*d-ny);}
    return 2*(LINE_SEGMENTS+1);
  }
  const half=coneApertureOf(t)/2,facing=Math.atan2(t.dy,t.dx),r=t.radius*k;
  put(0,t.x,t.y);
  for(let i=0;i<=CONE_SEGMENTS;i++){const a=facing-half+2*half*i/CONE_SEGMENTS;put(1+i,t.x+Math.cos(a)*r,t.y+Math.sin(a)*r);}
  return CONE_SEGMENTS+2;
}

/** Longest a corner may be pushed in, in multiples of the inset (sharp cone tips; Phaser strokes have no miter joins). */
export const INSET_MITER_LIMIT=6;
/**
 * Offsets the closed polygon src[0..n) inward by d into out (same count): a stroke of width 2d along out lies inside the
 * zone instead of half outside it, so a player just outside never looks inside (D-015). d is clamped to half the
 * polygon's inradius estimate (2*area/perimeter) so tiny zones do not flip inside out. Returns the d actually used.
 */
export function insetPolygon(src:readonly Pt[],n:number,d:number,out:Pt[]):number{
  let area=0,perimeter=0;
  for(let i=0;i<n;i++){const a=src[i],b=src[(i+1)%n];area+=a.x*b.y-b.x*a.y;perimeter+=Math.hypot(b.x-a.x,b.y-a.y);}
  area/=2;
  const inradius=perimeter>0?2*Math.abs(area)/perimeter:0;
  d=Math.max(0,Math.min(d,inradius*.5));
  const sign=area>0?1:-1; // inward normal of edge (a->b) is sign*(-ey,ex)/|e|
  for(let i=0;i<n;i++){
    const prev=src[(i+n-1)%n],cur=src[i],next=src[(i+1)%n];
    let ax=cur.x-prev.x,ay=cur.y-prev.y,bx=next.x-cur.x,by=next.y-cur.y;
    const la=Math.hypot(ax,ay)||1,lb=Math.hypot(bx,by)||1;ax/=la;ay/=la;bx/=lb;by/=lb;
    // Inward normals of the two edges meeting here; the corner moves along their bisector by d/cos(half-angle).
    const n1x=-ay*sign,n1y=ax*sign,n2x=-by*sign,n2y=bx*sign;
    let mx=n1x+n2x,my=n1y+n2y;const ml=Math.hypot(mx,my);
    const o=out[i];
    if(ml<1e-9){o.x=cur.x+n1x*d;o.y=cur.y+n1y*d;continue;}
    mx/=ml;my/=ml;
    const cos=mx*n1x+my*n1y,scale=Math.min(INSET_MITER_LIMIT,1/Math.max(1e-6,cos))*d;
    o.x=cur.x+mx*scale;o.y=cur.y+my*scale;
  }
  return d;
}
