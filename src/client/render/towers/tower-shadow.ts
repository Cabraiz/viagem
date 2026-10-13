/**
 * Cast shadow of a defense (card iluminacao-levemente-realista, E3): the footprint stretched away from the sun, like
 * the city's blocks (render/city/decor.ts shadowUnion): toward screen right-down (+qx in view space, the same screen
 * direction in every view), length = drawn height × SHADOW_PER_HEIGHT × 0.75 (the blocks' factor, city-layer.ts), in
 * the lit shadow colour (LIT_SHADOW). Soft: three nested copies whose overlap reaches LIT_SHADOW.alpha in the core.
 * Off with `?luz=0` and in economy mode. Pure (no Phaser): towers.ts bakes the polygons once per kind × phase × view ×
 * size into the shared atlas.
 */
import {LIT_SHADOW,SHADOW_PER_HEIGHT} from '../light.ts';
import {TILE_X,TILE_Y,type Pt} from '../city/projection.ts';
import type {Calibre} from './tower-rules.ts';

/** Shadow length (u) per unit of drawn height: the city blocks' (CAST_SHADOW in city-layer.ts), so both match. */
export const TOWER_SHADOW_PER_HEIGHT=SHADOW_PER_HEIGHT*.75;
/** Unit screen direction of the shadow: +qx in view space (screen (TILE_X, TILE_Y)), right-down in every view. */
export const SHADOW_DIR:Readonly<Pt>=Object.freeze({x:TILE_X/Math.hypot(TILE_X,TILE_Y),y:TILE_Y/Math.hypot(TILE_X,TILE_Y)});
/** The Gustavão is a flat carriage on its rail: its shadow counts this share of its drawn height (modest). */
export const FLAT_CARRIAGE_SHADOW=.5;
/** Soft edge: the outer and inner copies grow and shrink by this many px (× actor scale) around the polygon. */
export const SHADOW_SOFT_PX=4;
/** Copies drawn on top of each other (outer, middle, inner); each at `layerAlpha`, the core reaches LIT_SHADOW.alpha. */
export const SHADOW_LAYERS=3;

export interface TowerShadowLook {readonly color:number;readonly alpha:number;readonly perHeight:number}
/** The look of the defenses' shadow, or none: `?luz=0` (light off) or economy mode. */
export function towerShadowLook(light:boolean,economy:boolean):TowerShadowLook|undefined{
  if(!light||economy)return undefined;
  return {color:LIT_SHADOW.color,alpha:LIT_SHADOW.alpha,perHeight:TOWER_SHADOW_PER_HEIGHT};
}
/** Alpha of one soft layer so that SHADOW_LAYERS of them stacked reach `alpha` (1 − (1 − a)^n = alpha). */
export const layerAlpha=(alpha:number,n=SHADOW_LAYERS)=>1-Math.pow(1-alpha,1/n);
/** The height (u) that casts: the drawn one (obra and ruin by phase), the Gustavão's flat carriage counted at a share. */
export const castHeight=(calibre:Calibre,drawnHeight:number)=>drawnHeight*(calibre==='gustavao'?FLAT_CARRIAGE_SHADOW:1);

/**
 * The shadow polygon on the ground (screen px): the convex hull of the footprint's projected corners and of those
 * corners moved by the shadow (`height` u × perHeight, at `unitPx` screen px per u of ground). Empty without a look.
 */
export function towerShadow(foot:readonly Pt[],height:number,unitPx:number,look:TowerShadowLook|undefined):Pt[]{
  if(!look||foot.length<3)return [];
  const L=Math.max(0,height)*look.perHeight*unitPx,dx=SHADOW_DIR.x*L,dy=SHADOW_DIR.y*L;
  return hull([...foot,...foot.map(p=>({x:p.x+dx,y:p.y+dy}))]);
}
/** The polygon grown (d > 0) or shrunk (d < 0) by about d px: scaled around its centroid by its mean radius. */
export function grow(poly:readonly Pt[],d:number):Pt[]{
  if(!poly.length)return [];
  let cx=0,cy=0;for(const p of poly){cx+=p.x;cy+=p.y;}cx/=poly.length;cy/=poly.length;
  let r=0;for(const p of poly)r+=Math.hypot(p.x-cx,p.y-cy);r/=poly.length;
  const k=r>0?Math.max(0,1+d/r):1;
  return poly.map(p=>({x:cx+(p.x-cx)*k,y:cy+(p.y-cy)*k}));
}
/** The soft layers to draw, outer first: polygons and the alpha of each. Empty without a look. */
export function softShadow(foot:readonly Pt[],height:number,unitPx:number,look:TowerShadowLook|undefined,softPx:number):{alpha:number;polys:Pt[][]}{
  const core=towerShadow(foot,height,unitPx,look);
  if(!look||!core.length)return {alpha:0,polys:[]};
  return {alpha:layerAlpha(look.alpha),polys:[grow(core,softPx),core,grow(core,-softPx)]};
}

/** Convex hull (Andrew's monotone chain), counter-clockwise on screen (as render/city/decor.ts). */
function hull(points:Pt[]):Pt[]{
  const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3)return p;
  const cross=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo:Pt[]=[],hi:Pt[]=[];
  for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}
  return [...lo.slice(0,-1),...hi.slice(0,-1)];
}
