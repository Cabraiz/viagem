/**
 * A walk to a far point (minimapa-wc3: a click on the minimap orders the hero across the map, as in Warcraft 3).
 * findPath only searches a box around the start and the target (PATH_MAX_NODES); past that it returns []. Here:
 * - the target snaps to the nearest walkable spot (a click on a roof walks to its door side);
 * - the city: one flow field over the city's cells to the target, traced from the start and thinned to the
 *   waypoints a straight walk can join (clearSegment);
 * - the endless world and the island: hops of HOP units towards the target, each a findPath, turning up to ±60° when a
 *   hop is blocked.
 * Pure (no Phaser): the client's scene calls it, the tests run it on the real city.
 */
import {findPath,walkable,clearSegment,maskSurface,type Point} from './world.ts';
import {FlowField,type FlowGrid} from './flowfield.ts';
import type {TerrainField} from './terrain/field.ts';

export const HOP=14,SNAP_RADIUS=8,MAX_HOPS=60;

/** The walkable spot nearest `p` within SNAP_RADIUS (rings every 0.5 u), or undefined. */
export function snapWalkable(p:Point,terrain?:TerrainField):Point|undefined{
  if(walkable(p,terrain))return {x:p.x,y:p.y};
  for(let r=.5;r<=SNAP_RADIUS;r+=.5){
    const n=Math.max(8,Math.round(2*Math.PI*r/.5));
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2,q={x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r};if(walkable(q,terrain))return q;}
  }
  return undefined;
}

interface CityLike {asset:{cells:{w:number;h:number};unitsPerCell:number}}
const grids=new WeakMap<object,FlowGrid>();
function cityGrid(terrain:TerrainField&CityLike):FlowGrid{
  let g=grids.get(terrain);
  if(g)return g;
  const {w,h}=terrain.asset.cells,cell=terrain.asset.unitsPerCell,open=new Uint8Array(w*h),p={x:0,y:0};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){p.x=(x+.5)*cell;p.y=(y+.5)*cell;open[y*w+x]=walkable(p,terrain)?1:0;}
  g={width:w,height:h,cellSize:cell,walkable:(cx,cy)=>open[cy*w+cx]===1};
  grids.set(terrain,g);
  return g;
}

/** Builds the city's walk grid ahead (≈ 0.2 s once per terrain): the first click on the minimap then plans in ~20 ms. */
export function prewarmFarPath(terrain?:TerrainField){
  const city=maskSurface(terrain) as unknown as (TerrainField&CityLike)|undefined;
  if(city?.asset)cityGrid(city);
}

/** Keeps the waypoints a straight walk cannot skip (greedy, from the start). */
function thin(start:Point,points:Point[],terrain?:TerrainField):Point[]{
  const out:Point[]=[];let anchor=start,i=0;
  while(i<points.length){
    let j=i;
    while(j+1<points.length&&clearSegment(anchor,points[j+1],terrain))j++;
    out.push(points[j]);anchor=points[j];i=j+1;
  }
  return out;
}

/** Waypoints from `start` to (the walkable spot nearest) `target`; [] when there is no way. */
export function farPath(start:Point,target:Point,terrain?:TerrainField):Point[]{
  const goal=snapWalkable(target,terrain);
  if(!goal||!walkable(start,terrain))return [];
  const near=findPath(start,goal,terrain);
  if(near.length)return near;
  const city=maskSurface(terrain) as unknown as (TerrainField&CityLike)|undefined;
  if(city?.asset){
    const grid=cityGrid(city),flow=new FlowField(grid,[goal]),cell=grid.cellSize;
    if(!flow.reachable(start.x,start.y))return [];
    const points:Point[]=[],p={x:start.x,y:start.y},dir={x:0,y:0};
    let walked=0;
    for(let i=0;i<40000;i++){
      flow.directionAt(p.x,p.y,dir);
      if(dir.x===0&&dir.y===0)break;
      p.x+=dir.x*cell*.5;p.y+=dir.y*cell*.5;walked+=cell*.5;
      if(Math.hypot(goal.x-p.x,goal.y-p.y)<cell)break;
      if(walked>=cell*2){walked=0;points.push({x:p.x,y:p.y});}
    }
    points.push(goal);
    return thin(start,points,terrain);
  }
  // Open worlds: hops towards the goal, each a short findPath; a blocked hop turns up to ±60°.
  const route:Point[]=[];let cur={x:start.x,y:start.y};
  for(let k=0;k<MAX_HOPS;k++){
    const dx=goal.x-cur.x,dy=goal.y-cur.y,d=Math.hypot(dx,dy);
    if(d<.5)break;
    if(d<=HOP){const seg=findPath(cur,goal,terrain);if(seg.length){route.push(...seg);return route;}}
    let seg:Point[]=[];
    for(const turn of [0,-.5,.5,-1,1]){
      const a=Math.atan2(dy,dx)+turn,hop=snapWalkable({x:cur.x+Math.cos(a)*Math.min(HOP,d),y:cur.y+Math.sin(a)*Math.min(HOP,d)},terrain);
      if(hop){seg=findPath(cur,hop,terrain);if(seg.length)break;}
    }
    if(!seg.length)return route.length?route:[];
    route.push(...seg);cur=seg[seg.length-1];
  }
  return route;
}
