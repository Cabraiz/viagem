/**
 * Build sites ("pontos de obra", D-041): where the team may raise a defence between rounds, around the base — the
 * Cidade Nevada plaza and the endless world's camp — plus the one stretch of rail the Gustavão needs (12×4 cells on
 * the city's west avenue). Data plus a pure validator; the sim (torres-sim) builds on them, nothing here draws.
 *
 * A site is the centre of its largest footprint: a build of size s (1..maxSize) covers the s·cell square centred on
 * it. `cell` is the city's asset cell (0.88 u) and, in the endless world, the same drawn size (0.88 / CITY_VIEW_SCALE).
 */
import {RADIUS,walkable,maskSurface,worldBase,worldSpawn} from './world.ts';
import {FlowField,type FlowGrid} from './flowfield.ts';
import {BASE_CLEAR} from './terrain/chunks.ts';
import type {TerrainField} from './terrain/field.ts';
import type {CityTerrain} from './city/terrain.ts';
import type {Point} from '../contract/index.ts';

export type BuildSize=1|2|3;
export interface BuildSite {readonly id:string;readonly x:number;readonly y:number;readonly maxSize:BuildSize}
/** The Gustavão's rail: `length` cells along `axis`, `width` cells across, centred on (x,y). */
export interface RailSite {readonly id:'trilho';readonly x:number;readonly y:number;readonly axis:'x'|'y';readonly length:number;readonly width:number}
export interface BuildPlan {readonly cell:number;readonly sites:readonly BuildSite[];readonly rail:RailSite|null}
export interface Rect {x:number;y:number;w:number;h:number} // top-left corner and size, world units
export interface BuildProblem {readonly id:string;readonly reason:string}

/** A tower's footprint unit (u): a person-sized cell, not the map's (the towers stay the people's size). */
export const CITY_BUILD_CELL=.88;
/**
 * The city asset's cell (u) the site rows below are written in: 0.88 × rules CITY_MAP_SCALE 1.7 since the asset's version 2
 * (NEW-20261013-ORQ-cidade-escala-1-7); tests/maps/build-sites.test.ts checks it against the asset's unitsPerCell.
 */
export const CITY_SITE_CELL=1.496;
/** 0.88 u drawn at the endless world's scale (rules/scale.ts CITY_VIEW_SCALE ≈ 0.5445): same on-screen size. */
export const ENDLESS_BUILD_CELL=1.616;
export const MIN_SITES=12,MAX_SITES=16;
/** No footprint within this of the wall: the forge is worked from beside it and the bots come home to it. */
export const BASE_KEEP_OUT=3;
/**
 * No footprint within this of a city mouth: the barricade seal grows up to BARRICADE_MAX_R (sim/stonewards/barricades.ts),
 * 4 u × CITY_DISTANCE_SCALE (1.7 ÷ 1.75) = 3.886 u since mapa-175-com-viaduto (was 6.8 u on the 1.7× city; maps may not
 * import rules/sim: the same value, kept by hand).
 */
export const MOUTH_KEEP_OUT=4*1.7/1.75;
/** No footprint within this of the players' spawn point. */
export const SPAWN_KEEP_OUT=1.5;

/*
 * City sites as asset cells [cx, cy, maxSize] (CITY_SITE_CELL), centred on the cell centre; the four avenue corridors
 * into the mouths stay open (the enemies' routes pass beside the footprints, never across them).
 * First (NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro, part A): a 3×3 on each side of the last stretch of the N, L and
 * O avenues, just outside MOUTH_KEEP_OUT, interleaved N, L, O, N, L, O (the bots build the largest free site in plan
 * order, so their first towers cover each mouth once). On the 1.7× city those mouths sit 18.7–21.5 u from the wall and
 * the old ring of sites 12–15 u from them, out of a root's 6 u: these sit 8–10 u from the mouth point, ≤ 6.2 u (L, O
 * 5.4 u) from where the bodies press the barricade, with the avenue's last ~10 u in range. N's kiosk (cells 92..98 of
 * row 86) leaves its flank only north of it and at the bend west of it. Then the older ring: four 3×3 north/south of
 * the plaza block, two 3×3 farther south and the four 2×2 west and east of it. S (4.1 u from the wall) keeps its old
 * sites: its bodies are at the wall at once, where the team fights.
 */
const CITY_CELLS:readonly (readonly [number,number,BuildSize])[]=[
  [53,47,3],[66,56,3],[44,53,3],[50,49,3],[66,58,3],[42,58,3],
  [48,48,3],[59,48,3],[50,63,3],[61,63,3],[46,63,3],[65,63,3],
  [44,51,2],[64,51,2],[44,59,2],[65,60,2],
];
/*
 * Asset v4 (mapa-175-com-viaduto, the city 1.75× shorter): the same sites in the same order and sizes, each taken to its
 * mapped cell and, where that no longer passed validateBuildPlan (the plaza shrank, the towers did not), moved to the
 * nearest cell (≤ 6) that does.
 */
/** The rail: cells x 34..45, y 54..57 on the west avenue (v4: its mapped cells, 2 west so it clears the O mouth). */
const CITY_RAIL={x0:34,y0:54,length:12,width:4};

// Endless camp, relative to the base: per quadrant a 2×2 on the diagonal and two 1×1 flanking it. Every corner is
// within 8.02 u of the base, inside the ground no seed can block (obstacle centres beyond BASE_CLEAR = 9, radius ≤ 0.62,
// hero 0.22 → 8.16 u); the four cardinal lanes, the spawn's included, stay ≥ 3.3 u wide.
const ENDLESS_SITES:readonly (readonly [number,number,BuildSize])[]=(()=>{
  const out:[number,number,BuildSize][]=[];
  for(const q of [45,135,225,315]){
    const d=q*Math.PI/180;out.push([5.6*Math.cos(d),5.6*Math.sin(d),2]);
    for(const f of [-24,24]){const a=(q+f)*Math.PI/180;out.push([6.95*Math.cos(a),6.95*Math.sin(a),1]);}
  }
  return out;
})();

const round3=(v:number)=>Math.round(v*1000)/1000;
const freezeSites=(rows:readonly (readonly [number,number,BuildSize])[],at:(a:number,b:number)=>Point)=>Object.freeze(rows.map(([a,b,s],i)=>{
  const p=at(a,b);return Object.freeze({id:`obra-${String(i+1).padStart(2,'0')}`,x:round3(p.x),y:round3(p.y),maxSize:s});
}));
const CITY_PLAN:BuildPlan=Object.freeze({
  cell:CITY_BUILD_CELL,
  sites:freezeSites(CITY_CELLS,(cx,cy)=>({x:(cx+.5)*CITY_SITE_CELL,y:(cy+.5)*CITY_SITE_CELL})),
  rail:Object.freeze({id:'trilho',axis:'x',length:CITY_RAIL.length,width:CITY_RAIL.width,
    x:round3((CITY_RAIL.x0+CITY_RAIL.length/2)*CITY_SITE_CELL),y:round3((CITY_RAIL.y0+CITY_RAIL.width/2)*CITY_SITE_CELL)}) as RailSite,
});
const ISLAND_PLAN:BuildPlan=Object.freeze({cell:ENDLESS_BUILD_CELL,sites:Object.freeze([]),rail:null});
// The 3×3 ápices (A4, A5, B5) do not fit inside that guaranteed ground, so each diagonal also tries a 3×3 just past
// the clearing, on this seed's ground: the first candidate (nearest first, then turning off the diagonal) that fits.
const ENDLESS_BIG_RADII=[11.4,12.4,13.4,14.4],ENDLESS_BIG_TURNS=[0,-10,10,-20,20,-30,30];
const endlessPlans=new WeakMap<TerrainField,BuildPlan>();

/** The build sites of a world: the city's, the endless camp's (around its base, per seed), none on the island. */
export function buildPlanFor(terrain?:TerrainField):BuildPlan{
  if(maskSurface(terrain))return CITY_PLAN;
  if(!terrain?.chunks)return ISLAND_PLAN;
  let plan=endlessPlans.get(terrain);
  if(!plan){
    const base=worldBase(terrain),rows:(readonly [number,number,BuildSize])[]=[...ENDLESS_SITES];
    const taken=rows.map(([x,y,s])=>footprint({x:base.x+x,y:base.y+y},s,ENDLESS_BUILD_CELL));
    for(const q of [45,135,225,315])search:for(const r of ENDLESS_BIG_RADII)for(const turn of ENDLESS_BIG_TURNS){
      const a=(q+turn)*Math.PI/180,dx=r*Math.cos(a),dy=r*Math.sin(a),rect=footprint({x:base.x+dx,y:base.y+dy},3,ENDLESS_BUILD_CELL);
      if(taken.some(t=>overlaps(t,rect))||!rectFits(rect,terrain))continue;
      rows.push([dx,dy,3]);taken.push(rect);break search;
    }
    plan=Object.freeze({cell:ENDLESS_BUILD_CELL,sites:freezeSites(rows,(dx,dy)=>({x:base.x+dx,y:base.y+dy})),rail:null});
    endlessPlans.set(terrain,plan);
  }
  return plan;
}

/** The square a build of `size` covers on a site. */
export function footprint(site:{x:number;y:number},size:BuildSize,cell:number):Rect{
  const side=size*cell;return {x:site.x-side/2,y:site.y-side/2,w:side,h:side};
}
export function railRect(rail:RailSite,cell:number):Rect{
  const w=(rail.axis==='x'?rail.length:rail.width)*cell,h=(rail.axis==='x'?rail.width:rail.length)*cell;
  return {x:rail.x-w/2,y:rail.y-h/2,w,h};
}
/** Distance from a point to a rectangle (0 inside). */
export function rectDistance(r:Rect,p:Point):number{
  const dx=Math.max(r.x-p.x,0,p.x-(r.x+r.w)),dy=Math.max(r.y-p.y,0,p.y-(r.y+r.h));
  return Math.hypot(dx,dy);
}
function overlaps(a:Rect,b:Rect){return a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;}
const inside=(r:Rect,x:number,y:number)=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;

/** True when every point of the rectangle (sampled at `step`, edges included) is ground a hero may stand on. */
export function rectFits(r:Rect,terrain?:TerrainField,step=.2):boolean{
  const nx=Math.max(1,Math.ceil(r.w/step)),ny=Math.max(1,Math.ceil(r.h/step)),p={x:0,y:0};
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    p.x=r.x+r.w*i/nx;p.y=r.y+r.h*j/ny;
    if(!walkable(p,terrain))return false;
  }
  return true;
}

/**
 * Everything wrong with a plan on its terrain (empty = valid). Each site at its largest footprint and the rail:
 * stand on open ground, overlap nothing else, keep clear of the wall, the mouths and the spawn; with all of them
 * built, the base is still reachable from every mouth/spawn and every site from the base (flow field, hero rule).
 */
export function validateBuildPlan(plan:BuildPlan,terrain?:TerrainField):BuildProblem[]{
  const problems:BuildProblem[]=[],bad=(id:string,reason:string)=>problems.push({id,reason});
  const city=maskSurface(terrain) as unknown as CityTerrain|undefined;
  const base=worldBase(terrain),spawn=worldSpawn(terrain);
  const mouths:Point[]=city?Object.values(city.asset.points.bocas):[];
  const shapes:{id:string;rect:Rect}[]=plan.sites.map(s=>({id:s.id,rect:footprint(s,s.maxSize,plan.cell)}));
  if(plan.rail)shapes.push({id:plan.rail.id,rect:railRect(plan.rail,plan.cell)});
  if(plan.sites.length&&(plan.sites.length<MIN_SITES||plan.sites.length>MAX_SITES))bad('plano',`${plan.sites.length} pontos (quero ${MIN_SITES}..${MAX_SITES})`);
  const ids=new Set<string>();
  for(const s of plan.sites){
    if(ids.has(s.id))bad(s.id,'id repetido');ids.add(s.id);
    if(!(s.maxSize===1||s.maxSize===2||s.maxSize===3))bad(s.id,`tamanho ${s.maxSize}`);
  }
  shapes.forEach(({id,rect},i)=>{
    if(!rectFits(rect,terrain))bad(id,'não cabe no chão livre');
    if(rectDistance(rect,base)<BASE_KEEP_OUT)bad(id,'cobre a muralha/forja');
    if(rectDistance(rect,spawn)<SPAWN_KEEP_OUT)bad(id,'cobre o ponto de nascer');
    for(const m of mouths)if(rectDistance(rect,m)<MOUTH_KEEP_OUT)bad(id,'cobre uma boca/barricada');
    for(let j=i+1;j<shapes.length;j++)if(overlaps(rect,shapes[j].rect))bad(id,`sobrepõe ${shapes[j].id}`);
  });
  if(!shapes.length)return problems;
  // Reachability with everything built, on a grid around the base (city: the asset grid; endless: 0.5 u cells).
  const blocked=(x:number,y:number)=>shapes.some(s=>inside(s.rect,x,y));
  let grid:FlowGrid;
  if(city){
    const cs=city.asset.unitsPerCell;
    grid={width:city.asset.cells.w,height:city.asset.cells.h,cellSize:cs,
      walkable:(cx,cy)=>{const x=(cx+.5)*cs,y=(cy+.5)*cs;return !blocked(x,y)&&city.clearDisc(x,y,RADIUS);}};
  }else{
    const half=24,cs=.5,ox=base.x-half,oy=base.y-half;
    grid={width:2*half/cs,height:2*half/cs,cellSize:cs,originX:ox,originY:oy,
      walkable:(cx,cy)=>{const p={x:ox+(cx+.5)*cs,y:oy+(cy+.5)*cs};return !blocked(p.x,p.y)&&walkable(p,terrain);}};
  }
  const flow=new FlowField(grid,[base],{wallPenalty:0});
  const from:{id:string;p:Point}[]=[{id:'nascer',p:spawn}];
  if(city){
    const pts=city.asset.points;
    for(const [k,p] of Object.entries(pts.bocas))from.push({id:`boca-${k}`,p});
    for(const k of ['N','S','L','O'] as const)from.push({id:`spawn${k}`,p:pts[`spawn${k}`]});
  }
  else for(const [k,a] of [['N',-90],['S',90],['L',0],['O',180]] as const){
    const r=BASE_CLEAR+6,d=a*Math.PI/180;from.push({id:`borda-${k}`,p:{x:base.x+r*Math.cos(d),y:base.y+r*Math.sin(d)}});
  }
  for(const f of from)if(!flow.reachable(f.p.x,f.p.y))bad(f.id,'não chega na base com tudo construído');
  // A site is reachable when some cell just outside its footprint is.
  const g=grid.cellSize;
  for(const {id,rect} of shapes){
    let ok=false;
    for(let t=0;t<=1&&!ok;t+=1/16){
      for(const [x,y] of [[rect.x+rect.w*t,rect.y-g],[rect.x+rect.w*t,rect.y+rect.h+g],[rect.x-g,rect.y+rect.h*t],[rect.x+rect.w+g,rect.y+rect.h*t]])
        if(flow.reachable(x,y)){ok=true;break;}
    }
    if(!ok)bad(id,'ninguém chega para construir');
  }
  return problems;
}
