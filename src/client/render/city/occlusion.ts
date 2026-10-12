/**
 * Building see-through for the city layer (card cidade-03a). Pure logic, no Phaser.
 * A building that covers the local hero (hero behind it in view space AND its screen silhouette over the
 * hero sprite box) fades as a whole block to FADE_ALPHA over FADE_MS; walls, cliffs and rubble never fade
 * (art lane: walls <= 1.6 u, buildings 2-4 u, rubble <= 0.3 u). Same idea as the island's `canopyCovers`
 * (src/game/render/you-rules.ts), but box-exact and with a short fade instead of an instant switch.
 * Also gives `heroRelativeDepth`, the draw-order fix that keeps the hero above a block it stands in front of.
 */
import type {BlockKind,CityAsset,CityBlock} from './asset.ts';
import {type Pt,type Rect,VIEW_PIVOT,boundsOf,depth,project,viewPoint} from './projection.ts';

export const FADE_ALPHA=0.35;
/** Outline (edge lines) alpha when its block is fully faded: edges stay a bit stronger so the shape still reads. */
export const OUTLINE_FADE_ALPHA=0.6;
export const FADE_MS=120;
/** Hero sprite box in screen px, centred on the feet and extending upward from them. */
/** The scene's hero figure: 96 px tall (framing.ts HERO_WORLD_PX), ~58 px wide (canopy half width in you-rules.ts). */
export const HERO_SCREEN:Readonly<{w:number;h:number}>=Object.freeze({w:58,h:96});
/** View-space tolerance: standing exactly on a front edge counts as in front. */
const EPS=1e-6;

/** A block as the occlusion test sees it in one view. */
export interface Occluder {
  id:string;kind:BlockKind;
  /** View-space footprint (front corner is (x1, y1): nearest the viewer). */
  q:{x0:number;x1:number;y0:number;y1:number};
  /** Bottom and top heights in world units. */
  base:number;top:number;
  /** Screen-space convex hull of the 8 projected box corners, consistent winding, no collinear points. */
  silhouette:Pt[];
  /** Screen bounds of the silhouette: a cheap reject before the exact test (actorDepth runs per actor per frame). */
  box:{x0:number;y0:number;x1:number;y1:number};
}

/** Convex hull (monotone chain); collinear points are dropped. */
function hull(points:readonly Pt[]):Pt[]{
  const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3)return p;
  const cross=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo:Pt[]=[],hi:Pt[]=[];
  for(const v of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],v)<=0)lo.pop();lo.push(v);}
  for(let i=p.length-1;i>=0;i--){const v=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],v)<=0)hi.pop();hi.push(v);}
  lo.pop();hi.pop();
  return lo.concat(hi);
}

/** Occluder of a block in `view`; `base` is the ground height under the block (caller's choice). */
export function occluderFor(block:CityBlock,asset:CityAsset,base:number,view:number,pivot:Pt=VIEW_PIVOT):Occluder{
  const c=asset.cell,wx0=asset.origin.x+block.x*c,wy0=asset.origin.y+block.y*c,wx1=wx0+block.w*c,wy1=wy0+block.h*c;
  const corners:Pt[]=[{x:wx0,y:wy0},{x:wx1,y:wy0},{x:wx1,y:wy1},{x:wx0,y:wy1}];
  const qs=corners.map(p=>viewPoint(p.x,p.y,view,pivot));
  const top=base+block.height;
  const screen:Pt[]=[];
  for(const p of corners)screen.push(project(p.x,p.y,base,view,pivot),project(p.x,p.y,top,view,pivot));
  const silhouette=hull(screen),b=boundsOf(silhouette);
  return {id:block.id,kind:block.kind,
    q:{x0:Math.min(...qs.map(p=>p.x)),x1:Math.max(...qs.map(p=>p.x)),y0:Math.min(...qs.map(p=>p.y)),y1:Math.max(...qs.map(p=>p.y))},
    base,top,silhouette,box:{x0:b.x,y0:b.y,x1:b.x+b.w,y1:b.y+b.h}};
}

/** Screen box of the hero: `size.w` wide, centred on the projected feet, `size.h` px upward from them. */
export function heroRect(x:number,y:number,z:number,view:number,pivot:Pt=VIEW_PIVOT,size:{w:number;h:number}=HERO_SCREEN):Rect{
  const f=project(x,y,z,view,pivot);
  return {x:f.x-size.w/2,y:f.y-size.h,w:size.w,h:size.h};
}

/**
 * Iso box rule in view space: the hero point is behind the box iff it is on the back side of both front
 * faces (qx < x1 and qy < y1) and not inside the footprint. Exactly on a front edge counts as in front.
 */
export function isBehind(occ:Occluder,hx:number,hy:number,view:number,pivot:Pt=VIEW_PIVOT):boolean{
  const p=viewPoint(hx,hy,view,pivot),q=occ.q;
  if(!(p.x<q.x1-EPS&&p.y<q.y1-EPS))return false;
  return !(p.x>q.x0+EPS&&p.y>q.y0+EPS);
}

/** Projects a polygon on an axis. */
function span(poly:readonly Pt[],ax:number,ay:number):[number,number]{
  let lo=Infinity,hi=-Infinity;
  for(const p of poly){const d=p.x*ax+p.y*ay;if(d<lo)lo=d;if(d>hi)hi=d;}
  return [lo,hi];
}
/** Rect vs convex polygon (SAT); touching edges do not count as overlap. */
export function rectHitsConvex(r:Rect,poly:readonly Pt[]):boolean{
  const n=poly.length;
  if(n<3||!(r.w>0)||!(r.h>0))return false;
  // Allocation-free SAT: the rect's own axes first (a bounds test), then each polygon edge normal.
  const rx1=r.x+r.w,ry1=r.y+r.h;
  let px0=Infinity,px1=-Infinity,py0=Infinity,py1=-Infinity;
  for(let i=0;i<n;i++){const p=poly[i];if(p.x<px0)px0=p.x;if(p.x>px1)px1=p.x;if(p.y<py0)py0=p.y;if(p.y>py1)py1=p.y;}
  if(rx1<=px0+EPS||px1<=r.x+EPS||ry1<=py0+EPS||py1<=r.y+EPS)return false;
  for(let i=0;i<n;i++){
    const a=poly[i],b=poly[(i+1)%n];
    let ax=a.y-b.y,ay=b.x-a.x;
    const len=Math.hypot(ax,ay);if(!(len>0))continue;
    ax/=len;ay/=len;
    let b0=Infinity,b1=-Infinity;
    for(let k=0;k<n;k++){const d=poly[k].x*ax+poly[k].y*ay;if(d<b0)b0=d;if(d>b1)b1=d;}
    const c1=r.x*ax+r.y*ay,c2=rx1*ax+r.y*ay,c3=rx1*ax+ry1*ay,c4=r.x*ax+ry1*ay;
    const a0=Math.min(c1,c2,c3,c4),a1=Math.max(c1,c2,c3,c4);
    if(a1<=b0+EPS||b1<=a0+EPS)return false;
  }
  return true;
}

/** True when the block hides part of the hero: hero behind it and its silhouette over the hero box. */
export function covers(occ:Occluder,hero:{x:number;y:number;z:number},view:number,pivot:Pt=VIEW_PIVOT,size:{w:number;h:number}=HERO_SCREEN):boolean{
  return isBehind(occ,hero.x,hero.y,view,pivot)&&rectHitsConvex(heroRect(hero.x,hero.y,hero.z,view,pivot,size),occ.silhouette);
}

/** Moves `current` linearly toward `target` at (1-FADE_ALPHA)/fadeMs per ms, never past it. Bad dt: no change. */
export function stepAlpha(current:number,target:number,dtMs:number,fadeMs:number=FADE_MS):number{
  if(!Number.isFinite(dtMs)||dtMs<0)return current;
  if(!(fadeMs>0))return target;
  const step=(1-FADE_ALPHA)/fadeMs*dtMs;
  return current<target?Math.min(target,current+step):Math.max(target,current-step);
}

/** Outline alpha for a block alpha: 1 -> 1, FADE_ALPHA -> OUTLINE_FADE_ALPHA, linear, clamped to [0, 1]. */
export function outlineAlpha(blockAlpha:number):number{
  const a=1+(blockAlpha-1)*(1-OUTLINE_FADE_ALPHA)/(1-FADE_ALPHA);
  return Math.min(1,Math.max(0,a));
}

/**
 * Per-block fade state. `update` once per frame; the returned map holds every block with alpha < 1,
 * ordered by id. Only buildings fade; a block that leaves `occluders` (chunk hidden) is dropped at once;
 * no hero (dead, spectating) eases everything back to 1.
 */
export class OcclusionFader {
  private state:Map<string,number>=new Map();
  update(occluders:readonly Occluder[],hero:{x:number;y:number;z:number}|undefined,view:number,dtMs:number,pivot:Pt=VIEW_PIVOT):ReadonlyMap<string,number>{
    const byId=new Map<string,Occluder>();
    for(const o of occluders)if(!byId.has(o.id))byId.set(o.id,o);
    const next=new Map<string,number>();
    for(const id of [...byId.keys()].sort((a,b)=>a<b?-1:a>b?1:0)){
      const o=byId.get(id)!,cur=this.state.get(id)??1;
      const target=o.kind==='building'&&hero&&covers(o,hero,view,pivot)?FADE_ALPHA:1;
      if(cur>=1&&target>=1)continue;
      const a=stepAlpha(cur,target,dtMs);
      if(a<1)next.set(id,a);
    }
    this.state=next;
    return next;
  }
  /** Current alpha of a block (1 when not fading). */
  alpha(id:string):number{return this.state.get(id)??1;}
  reset():void{this.state=new Map();}
}

/** A unit column as actorDepth sees it: its sort key and its occluder in the current view. */
export interface ColumnRef {key:number;occ:Occluder;
  /** Scratch for callers that gather columns from several cells: the last query that saw it (dedupe, no Set). */
  mark?:number}

/**
 * Exact draw depth for a point actor among nearby unit columns. A scalar key per column cannot be exact (the
 * "behind" region of a box is an L, not a half-plane), so the actor is placed instead: above every column it
 * overlaps on screen and stands in front of, below every column it overlaps and stands behind. Its plain
 * depth is kept when it already fits; otherwise it goes just inside the allowed gap. If the constraints ever
 * conflict (not seen on unit columns) the plain depth is returned.
 */
export function actorDepth(x:number,y:number,z:number,view:number,columns:Iterable<ColumnRef>,pivot:Pt=VIEW_PIVOT,size:{w:number;h:number}=HERO_SCREEN):number{
  const own=depth(x,y,view,pivot),r=heroRect(x,y,z,view,pivot,size);
  let lo=-Infinity,hi=Infinity;
  const rx1=r.x+r.w,ry1=r.y+r.h;
  for(const c of columns){
    const b=c.occ.box;
    if(b&&(rx1<=b.x0||b.x1<=r.x||ry1<=b.y0||b.y1<=r.y))continue;
    if(!rectHitsConvex(r,c.occ.silhouette))continue;
    if(isBehind(c.occ,x,y,view,pivot))hi=Math.min(hi,c.key);else lo=Math.max(lo,c.key);
  }
  if(own>lo&&own<hi)return own;
  if(!(lo<hi))return own;
  const gap=Math.min(0.5,(hi-lo)/2);
  return own<=lo?lo+gap:hi-gap;
}

/**
 * Draw-order guard for one actor against one block, for callers that cannot use exact keys: only when the
 * actor's screen box overlaps the block's silhouette, returns a depth that puts the block above the actor when
 * the actor is behind it and below otherwise; elsewhere the block keeps its own key. The city layer does not
 * need it: blocks are unit columns (chunks.ts) keyed by their centre (faces.ts), already right against point actors,
 * as long as the scene draws actors at their world depth (not the fixed SELF_DEPTH of the island).
 */
export function heroRelativeDepth(occ:Occluder,blockDepth:number,heroDepth:number,hero:{x:number;y:number;z:number},view:number,pivot:Pt=VIEW_PIVOT,size:{w:number;h:number}=HERO_SCREEN):number{
  if(!rectHitsConvex(heroRect(hero.x,hero.y,hero.z,view,pivot,size),occ.silhouette))return blockDepth;
  const behind=isBehind(occ,hero.x,hero.y,view,pivot);
  if(behind&&blockDepth<=heroDepth)return heroDepth+1;
  if(!behind&&blockDepth>=heroDepth)return heroDepth-1;
  return blockDepth;
}
