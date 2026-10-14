/**
 * D-047: the chaveiro's route (src/sim/chaveiro/system.ts). One FlowField on the city's hero grid (no barricades: the
 * moto rides through the plaza mouths) toward the car, walked cell by cell from the avenue end he enters by, simplified
 * (Ramer-Douglas-Peucker) and cut short where the moto stops next to the car. A pure function of the grid and the two
 * points, so a restored run rebuilds the very same route from the seed and the asset (it is never stored).
 */
import {DIRS,FlowField,type FlowGrid,type Point} from '../../maps/index.ts';

export interface Route {
  /** Polyline from the entrance to where the moto stops (at least two points). */
  readonly points:readonly Point[];
  /** Length (u) along the route at each point (cum[0] = 0, last = length). */
  readonly cum:readonly number[];
  readonly length:number;
}

/** Simplification tolerance (u): about half a city cell. */
export const ROUTE_EPSILON=.45;

/** The route from `from` to `to` on `grid`, ending `stopShort` u before `to`. A straight line when the grid has no path. */
export function buildRoute(grid:FlowGrid,from:Point,to:Point,stopShort=0):Route{
  const size=grid.cellSize,ox=grid.originX??0,oy=grid.originY??0;
  const field=new FlowField(grid,[to]);
  const raw:Point[]=[{x:from.x,y:from.y}];
  let cx=Math.floor((from.x-ox)/size),cy=Math.floor((from.y-oy)/size);
  if(field.reachable(from.x,from.y)){
    for(let n=0,max=grid.width*grid.height;n<max;n++){
      const d=field.nextCell(cx,cy);
      if(d<0)break;
      cx+=DIRS[d].dx;cy+=DIRS[d].dy;
      raw.push({x:ox+(cx+.5)*size,y:oy+(cy+.5)*size});
    }
  }
  raw.push({x:to.x,y:to.y});
  return cut(measure(simplify(raw,ROUTE_EPSILON)),stopShort);
}

/** Ramer-Douglas-Peucker, iterative, endpoints kept. */
export function simplify(points:readonly Point[],epsilon:number):Point[]{
  if(points.length<3)return points.map(p=>({x:p.x,y:p.y}));
  const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
  const stack:[number,number][]=[[0,points.length-1]];
  while(stack.length){
    const [a,b]=stack.pop()!,pa=points[a],pb=points[b];
    const dx=pb.x-pa.x,dy=pb.y-pa.y,l=Math.hypot(dx,dy);
    let far=-1,best=epsilon;
    for(let i=a+1;i<b;i++){
      const p=points[i];
      const d=l>1e-9?Math.abs((p.x-pa.x)*dy-(p.y-pa.y)*dx)/l:Math.hypot(p.x-pa.x,p.y-pa.y);
      if(d>best){best=d;far=i;}
    }
    if(far>=0){keep[far]=1;stack.push([a,far],[far,b]);}
  }
  const out:Point[]=[];
  for(let i=0;i<points.length;i++)if(keep[i])out.push({x:points[i].x,y:points[i].y});
  return out;
}

function measure(points:Point[]):Route{
  // Drop repeated points (a zero-length leg), keep at least two.
  const pts=points.filter((p,i)=>i===0||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>1e-9);
  if(pts.length<2)pts.push({x:pts[0].x,y:pts[0].y});
  const cum=[0];
  for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y));
  return {points:pts,cum,length:cum[cum.length-1]};
}

/** The route without its last `short` u (never below a tenth of it). */
function cut(route:Route,short:number):Route{
  const keep=Math.max(route.length*.1,route.length-Math.max(0,short));
  if(keep>=route.length)return route;
  const pts:Point[]=[];
  for(let i=0;i<route.points.length&&route.cum[i]<keep;i++)pts.push({...route.points[i]});
  pts.push(pointAt(route,keep));
  return measure(pts);
}

/** The point `s` u along the route (clamped to its ends). */
export function pointAt(route:Route,s:number,out:Point={x:0,y:0}):Point{
  const {points,cum}=route;
  if(!(s>0)){out.x=points[0].x;out.y=points[0].y;return out;}
  if(s>=route.length){const p=points[points.length-1];out.x=p.x;out.y=p.y;return out;}
  let lo=0,hi=cum.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(cum[mid]<=s)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi],t=(s-cum[lo])/Math.max(1e-9,cum[hi]-cum[lo]);
  out.x=a.x+(b.x-a.x)*t;out.y=a.y+(b.y-a.y)*t;
  return out;
}
