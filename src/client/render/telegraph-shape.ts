/**
 * World-space outline of a telegraph, with exactly the server's hit semantics (src/rules/telegraph-geometry.ts, D-015):
 * line width = full thickness in world units, cone width = FULL aperture in radians. Pure module, tested against telegraphHits.
 */
import {DEFAULT_CONE_ANGLE,DEFAULT_LINE_WIDTH} from '../../rules/index.ts';

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

/** Most hatch lines one telegraph draws (the spacing grows past it, so a huge zone stays bounded). */
export const HATCH_MAX_LINES=64;
/**
 * Diagonal hatch (lines x − y = c, `spacing` apart) clipped to the closed polygon src[0..n): writes segments as
 * x0,y0,x1,y1 into out and returns how many. Even-odd pairing of the crossings, so it works for any simple polygon
 * (circle, line and cone outlines alike). Allocation-free with a caller scratch `xs` (≥ n numbers).
 * The fill then reads by shape, not only by Laranja Cone (onda 4: Cone on the new grass is 1,02:1; deuteranopia).
 */
export function hatchSegments(src:readonly Pt[],n:number,spacing:number,out:Float64Array,xs:Float64Array):number{
  if(n<3||!(spacing>0))return 0;
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<n;i++){const v=src[i].x-src[i].y;if(v<lo)lo=v;if(v>hi)hi=v;}
  const step=Math.max(spacing,(hi-lo)/HATCH_MAX_LINES),max=out.length>>2;
  let count=0;
  for(let c=Math.ceil(lo/step)*step;c<=hi&&count<max;c+=step){
    let k=0;
    for(let i=0;i<n&&k<xs.length;i++){
      const a=src[i],b=src[(i+1)%n],fa=a.x-a.y-c,fb=b.x-b.y-c;
      if((fa<0)!==(fb<0)){const t=fa/(fa-fb);xs[k++]=a.x+(b.x-a.x)*t;}
    }
    // Insertion sort of the few crossings by x (y follows: y = x − c).
    for(let i=1;i<k;i++){const v=xs[i];let j=i-1;while(j>=0&&xs[j]>v){xs[j+1]=xs[j];j--;}xs[j+1]=v;}
    for(let i=0;i+1<k&&count<max;i+=2){const o=count*4;out[o]=xs[i];out[o+1]=xs[i]-c;out[o+2]=xs[i+1];out[o+3]=xs[i+1]-c;count++;}
  }
  return count;
}

/**
 * Largest inset insetPolygon applies to the closed polygon src[0..n) (half its inradius estimate, 2*area/perimeter):
 * the same clamp, so a caller can fit several bands inside a small zone before insetting.
 */
export function insetLimit(src:readonly Pt[],n:number):number{
  let area=0,perimeter=0;
  for(let i=0;i<n;i++){const a=src[i],b=src[(i+1)%n];area+=a.x*b.y-b.x*a.y;perimeter+=Math.hypot(b.x-a.x,b.y-a.y);}
  area/=2;
  // Same arithmetic as insetPolygon's clamp, so an inset of exactly this much is never clamped.
  const inradius=perimeter>0?2*Math.abs(area)/perimeter:0;
  return inradius*.5;
}

/**
 * City telegraph edge (cidade-nevada-arte.md §7, cidade-nevada/parametros.md §10), CSS px, outside in: Breu 2 dashed,
 * Laranja Cone 3 solid at 100%, Papel 3 dashed in the SAME dash and phase as the Breu (the D-020 signature); then the
 * fill. Dash 9, gap 6. Contiguous bands, inset on the server's zone (D-015): the outer edge of the Breu is the zone edge.
 */
export const CITY_TELEGRAPH_CSS={breu:2,cone:3,papel:3,dash:9,gap:6} as const;
export const CITY_TELEGRAPH_EDGE_CSS=CITY_TELEGRAPH_CSS.breu+CITY_TELEGRAPH_CSS.cone+CITY_TELEGRAPH_CSS.papel;
/** One band of the edge: inset of its center line `d` and stroke width, in scene px. */
export interface EdgeBand {d:number;width:number}
export interface CityEdgeBands {breu:EdgeBand;cone:EdgeBand;papel:EdgeBand;
  /** Scene px per CSS px of the bands: `css`, or less when the zone is too small for 8 CSS px of edge. */
  scale:number}
/**
 * Band layout of the city edge for `css` scene px per CSS px and the polygon's insetLimit: every band keeps its CSS
 * width (screen-constant at any zoom); a zone too small for it shrinks all bands together so the innermost center
 * line stays within the limit (insetPolygon never clamps one band out of order).
 */
export function cityEdgeBands(css:number,limit:number,out?:CityEdgeBands):CityEdgeBands{
  const C=CITY_TELEGRAPH_CSS,deepest=C.breu+C.cone+C.papel/2;
  const k=Math.max(0,Math.min(css,limit/deepest));
  const o=out??{breu:{d:0,width:0},cone:{d:0,width:0},papel:{d:0,width:0},scale:0};
  o.scale=k;
  o.breu.d=k*C.breu/2;o.breu.width=k*C.breu;
  o.cone.d=k*(C.breu+C.cone/2);o.cone.width=k*C.cone;
  o.papel.d=k*deepest;o.papel.width=k*C.papel;
  return o;
}

/** Most dashes one outline draws (the pattern stretches past it, so a huge zone stays bounded). */
export const DASH_MAX=96;
/** Segments dashSegments can write: every dash, plus one more piece per vertex a dash runs over. */
export const DASH_MAX_SEGMENTS=DASH_MAX+OUTLINE_MAX_POINTS+2;
/**
 * Dashes along the closed polygon ref[0..n), by arc length: a dash covers [s, s+dash) wherever (s - phase) is a
 * multiple of dash+gap. `phase` may be any size (an unwrapped drift): it is wrapped here, on the period actually drawn
 * (stretched with the dash for a huge zone), so a drifting pattern never jumps. Writes them as segments x0,y0,x1,y1
 * into out and returns how many; a dash that runs over a vertex is split there, and its pieces share that vertex exactly (the caller joins them into one polyline).
 * `onto` (same count, corresponding vertices, e.g. an inset of ref) is where the segments are placed, at the same
 * fraction of each edge: two insets dashed from the same ref get their dashes side by side, in the same phase.
 * Allocation-free.
 */
export function dashSegments(ref:readonly Pt[],n:number,dash:number,gap:number,phase:number,out:Float64Array,onto:readonly Pt[]=ref):number{
  if(n<2||!(dash>0)||!(gap>=0))return 0;
  let perimeter=0;
  for(let i=0;i<n;i++){const a=ref[i],b=ref[(i+1)%n];perimeter+=Math.hypot(b.x-a.x,b.y-a.y);}
  if(!(perimeter>0))return 0;
  let period=dash+gap;
  const stretch=Math.max(1,perimeter/(period*DASH_MAX));
  dash*=stretch;period*=stretch;
  phase=((phase%period)+period)%period;
  const max=out.length>>2;
  let count=0,s=0;
  for(let i=0;i<n&&count<max;i++){
    const a=ref[i],b=ref[(i+1)%n],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(!(length>0))continue;
    const p=onto[i],q=onto[(i+1)%n];
    // Pattern position at the start of this edge, then walk its on-runs.
    // minStep: the walk always moves on, even where rounding puts m a hair under a dash or gap boundary.
    const minStep=length*1e-9+1e-12;
    let t=0;
    while(t<length&&count<max){
      const m=(((s+t-phase)%period)+period)%period;
      if(m<dash){
        const end=Math.min(length,t+Math.max(minStep,dash-m)),f0=t/length,f1=end/length,o=count*4;
        out[o]=f0===0?p.x:p.x+(q.x-p.x)*f0;out[o+1]=f0===0?p.y:p.y+(q.y-p.y)*f0;
        out[o+2]=f1===1?q.x:p.x+(q.x-p.x)*f1;out[o+3]=f1===1?q.y:p.y+(q.y-p.y)*f1;
        count++;t=end;
      }else t=Math.min(length,t+Math.max(minStep,period-m));
    }
    s+=length;
  }
  return count;
}
