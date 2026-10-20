/**
 * Shapes drawn as triangle fans instead of Phaser's earcut (NEW-20261018-ORQ-chunks-cidade-sem-pico). Phaser 3.90 fills
 * every fillPoints and fillCircle through earcut, and a circle is first an arc of ~100 points: the snow specks of one
 * baked chunk were most of its build (bakeGround ≈ 2.7 s of a 43 s walk on a 4× phone, nearly all of it earcut). A small convex
 * shape is a fan from its first corner, and a speck a regular polygon whose edge stays within CIRCLE_SAGITTA_PX of the
 * true circle: the same pixels, without earcut.
 */
import type {Pt} from './projection.ts';

/** Largest gap (px) between a circle and the polygon drawn for it: under a fifth of a pixel. */
export const CIRCLE_SAGITTA_PX=0.15;
/** Fewest sides of a circle's polygon (a 1 px speck), and the most (past this, the circle goes to Phaser's arc). */
export const CIRCLE_MIN_SIDES=8,CIRCLE_MAX_SIDES=48;

/** Sides of the polygon drawn for a circle of radius r px (CIRCLE_SAGITTA_PX), or 0 when it would need more than the max. */
export function circleSides(r:number):number{
  if(!(r>0)||!Number.isFinite(r))return 0;
  const c=1-CIRCLE_SAGITTA_PX/r;
  const n=c<=-1?CIRCLE_MIN_SIDES:Math.max(CIRCLE_MIN_SIDES,Math.ceil(Math.PI/Math.acos(Math.max(-1,c))));
  return n>CIRCLE_MAX_SIDES?0:n;
}

/** The polygon (counter-clockwise from angle 0, like Phaser's arc) drawn for a circle; empty when circleSides is 0. */
export function circlePolygon(cx:number,cy:number,r:number):Pt[]{
  const n=circleSides(r),out:Pt[]=[];
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2;out.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});}
  return out;
}

/** Whether a polygon is strictly convex (every turn the same way, none straight), so a fan from its first corner fills it. */
export function isConvex(points:readonly Pt[]):boolean{
  const n=points.length;
  if(n<3)return false;
  let sign=0;
  for(let i=0;i<n;i++){
    const a=points[i],b=points[(i+1)%n],c=points[(i+2)%n];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(!Number.isFinite(cross)||cross===0)return false;
    const s=cross>0?1:-1;
    if(sign===0)sign=s;else if(s!==sign)return false;
  }
  return true;
}

/** The fan triangles of a convex polygon as [x0,y0,x1,y1,x2,y2] per triangle, from its first corner. */
export function fanTriangles(points:readonly Pt[]):number[][]{
  const out:number[][]=[],o=points[0];
  for(let i=1;i+1<points.length;i++){const b=points[i],c=points[i+1];out.push([o.x,o.y,b.x,b.y,c.x,c.y]);}
  return out;
}
