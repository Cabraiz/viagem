/**
 * Bot routes in the Cidade Nevada (cidade-10): the room bots (and the protocol bots) walk the streets to where they
 * are going (home = the wall in the plaza, a crate in the intermission, a fallen friend, the person they walk with)
 * instead of a straight line into the buildings. Read-only over the city: a flow field (maps FlowField) per goal cell
 * on the hero grid (cityFlowGrid: the hero rule at each cell centre, the rule moveSafely walks heroes by), so a bot
 * following it is never sent where its own movement refuses.
 *
 * Fields are built lazily, on the first route to a goal cell, and kept in one small LRU shared by every room of the
 * isolate (BOT_ROUTE_FIELDS); an evicted field is reused for the next goal of the same city (setTargets, no new
 * buffers). A field is a pure function of (city, goal cell), so a hit, a miss or another room's traffic never changes
 * a decision: the routes are deterministic.
 *
 * Memory: a FlowField without clearance holds 27 bytes per cell (walk, near, goal flags and legal steps 1 B each,
 * next 1 B, connected part 4 B and its goal stamp 2 B, cost, goal list and the two queue links 4 B each). The city grid
 * is 192 × 192 = 36 864 cells: 995 328 B (972 KiB) a field, so the LRU tops out at BOT_ROUTE_FIELDS × 972 KiB = 7.6 MiB
 * per isolate, plus the grid's cells (36 KiB per city).
 * Building one costs one Dial pass over the grid (a few ms); the bots ask for one when they change goals, not per tick.
 *
 * The grid is the HERO view of the city: the barricades (cidade-06) are blocker discs solid for enemies only, and the
 * bots, like the heroes, walk through them (their movement, moveSafely on the room's terrain, ignores the blockers).
 * cityFlowGrid reads the enemy view (enemyTerrain), so the grid is built on a blocker-free terrain over the same asset:
 * routed around a barricade the bot's way home pointed away from the plaza next to a mouth, and the bot paced there
 * between the lure of a gem and its circle around the wall (city-room-bots, after cidade-06). Since no blocker reaches
 * the grid, routes are per asset: every room (each on its own fork of the city) shares one grid and the LRU.
 */
import {CityTerrain,FlowField,STRAIGHT_COST,UNREACHABLE,walkable,type CityAsset,type Point} from '../../maps/index.ts';
import {CITY_MAP_SCALE} from '../../rules/index.ts';
import {cityFlowGrid,type CityFlowGrid} from './grid.ts';

/** Flow fields the bots keep (LRU, all cities of the isolate): home, one crate per bot slot, two moving targets. */
export const BOT_ROUTE_FIELDS=8;
/** Bytes per cell of a bot route field (FlowField without clearance, see the module doc). */
export const BOT_ROUTE_BYTES_PER_CELL=27;
/**
 * Within this (u) of the target with a clear straight segment, the bot walks straight (no field). A stretch of street
 * (12 u on the .w3x-sized city), so it grows with the map (NEW-20261013-ORQ-cidade-escala-1-7: × CITY_MAP_SCALE, 20.4 u).
 */
export const BOT_ROUTE_DIRECT=12*CITY_MAP_SCALE;
/** Closer than this (u) the bot always walks straight (it is there; a field would point at a cell centre). */
export const BOT_ROUTE_NEAR=1.2;
/** A target on a closed cell (a crate against a wall, the wall's own point) routes to the nearest open cell within this ring (cells). */
export const BOT_ROUTE_SNAP=4;
/**
 * A moving target (rescue, escort) keeps the goal cell it was routed to while it stays within this many cells
 * (Chebyshev) of it: a person walking does not cost a field per cell.
 */
export const BOT_ROUTE_KEEP=3;
/** Sampling step (u) of the straight-segment check (the hero rule, like maps clearSegment, a little coarser). */
const SEGMENT_STEP=.2;

interface CityRoutes {id:number;grid:CityFlowGrid}
interface RouteField {routes:CityRoutes;cell:number;field:FlowField}
/** By asset (not by terrain): a room's fork and the decoded city share one grid, the blockers never reach it. */
const cities=new WeakMap<CityAsset,CityRoutes>();
let cityIds=0;
/** Least recently used first (Map insertion order). */
const lru=new Map<string,RouteField>();
/** Fields built and routes served from the cache (lab, tests). */
export const botRouteStats={builds:0,hits:0};

function routesOf(city:CityTerrain):CityRoutes{
  let r=cities.get(city.asset);
  // The hero view: a fresh terrain over the asset has no blockers, so cityFlowGrid's enemy view of it is the hero rule.
  if(!r){r={id:++cityIds,grid:cityFlowGrid(new CityTerrain(city.asset,city.signature))};cities.set(city.asset,r);}
  return r;
}
/** Forget a city's grid and fields (tests; the asset never changes, and the barricades never reach the grid). */
export function dropBotRoutes(city:CityTerrain){
  const r=cities.get(city.asset);
  if(!r)return;
  cities.delete(city.asset);
  for(const [key,f] of lru)if(f.routes===r)lru.delete(key);
}
/** Cached fields now (tests). */
export function botRouteFields(){return lru.size;}

/** The field whose single goal is `cell` (an open cell of the city grid). */
function fieldFor(routes:CityRoutes,cell:number):FlowField{
  const key=`${routes.id}:${cell}`,hit=lru.get(key);
  if(hit){lru.delete(key);lru.set(key,hit);botRouteStats.hits++;return hit.field;}
  const g=routes.grid,goal:Point={x:(cell%g.width+.5)*g.cellSize,y:(Math.floor(cell/g.width)+.5)*g.cellSize};
  let field:FlowField|undefined;
  if(lru.size>=BOT_ROUTE_FIELDS){
    const [oldKey,old]=lru.entries().next().value!;
    lru.delete(oldKey);
    if(old.routes===routes){field=old.field;field.setTargets([goal]);}
  }
  field??=new FlowField(g,[goal]);
  botRouteStats.builds++;
  lru.set(key,{routes,cell,field});
  return field;
}

/** The open cell a route to `to` aims at: its own, else the nearest open one within BOT_ROUTE_SNAP cells; -1 when none. */
export function botRouteGoal(city:CityTerrain,to:Point):number{
  const g=routesOf(city).grid,cs=g.cellSize,cx=Math.floor(to.x/cs),cy=Math.floor(to.y/cs);
  let best=-1,bestD=Infinity;
  for(let r=0;r<=BOT_ROUTE_SNAP&&best<0;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    const x=cx+dx,y=cy+dy;
    if(x<0||y<0||x>=g.width||y>=g.height||!g.cells[x+y*g.width])continue;
    const d=Math.hypot((x+.5)*cs-to.x,(y+.5)*cs-to.y);
    if(d<bestD){bestD=d;best=x+y*g.width;}
  }
  return best;
}

const probe={x:0,y:0};
/** The hero fits all along the straight segment a→b (sampled every SEGMENT_STEP, allocation-free). */
export function straightClear(city:CityTerrain,a:Point,b:Point):boolean{
  const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/SEGMENT_STEP));
  for(let i=1;i<=n;i++){probe.x=a.x+(b.x-a.x)*i/n;probe.y=a.y+(b.y-a.y)*i/n;if(!walkable(probe,city))return false;}
  return true;
}

/**
 * Street direction from `at` toward `to` into `out`. Returns the goal cell it routed to, -2 when the streets do not
 * lead from `at` to `to` (unreachable), or -1 when the bot should walk straight: within BOT_ROUTE_NEAR, within
 * BOT_ROUTE_DIRECT with a clear segment, no open cell near `to`, or already in the goal cell. `keep`: a goal cell routed to before (a
 * moving target), kept while `to` is within BOT_ROUTE_KEEP cells of it.
 */
export function botRoute(city:CityTerrain,at:Point,to:Point,out:Point,keep=-1):number{
  const d=Math.hypot(to.x-at.x,to.y-at.y);
  if(d<BOT_ROUTE_NEAR||d<=BOT_ROUTE_DIRECT&&straightClear(city,at,to))return -1;
  const routes=routesOf(city),g=routes.grid,cs=g.cellSize;
  let goal=-1;
  if(keep>=0&&keep<g.width*g.height&&g.cells[keep]){
    const kx=keep%g.width,ky=(keep-kx)/g.width;
    if(Math.max(Math.abs(Math.floor(to.x/cs)-kx),Math.abs(Math.floor(to.y/cs)-ky))<=BOT_ROUTE_KEEP)goal=keep;
  }
  if(goal<0)goal=botRouteGoal(city,to);
  if(goal<0)return -1;
  const field=fieldFor(routes,goal);
  field.directionAt(at.x,at.y,out);
  return out.x||out.y?goal:field.costAt(at.x,at.y)===UNREACHABLE?-2:-1;
}

/**
 * Walking distance (u) from `from` to `to` along the streets: the field's cost (wall penalties included, so a little
 * over the real walk: a safe estimate for "time to go home"); the straight distance when there is no field way
 * (a clear segment within BOT_ROUTE_DIRECT, or no open cell near `to`); Infinity when `from` cannot reach `to`.
 * A `from` on a closed cell (a crate against a wall) is measured from the nearest open cell, plus the step to it.
 */
export function botRouteDistance(city:CityTerrain,from:Point,to:Point):number{
  const d=Math.hypot(to.x-from.x,to.y-from.y);
  if(d<BOT_ROUTE_NEAR||d<=BOT_ROUTE_DIRECT&&straightClear(city,from,to))return d;
  const goal=botRouteGoal(city,to),start=botRouteGoal(city,from);
  if(goal<0)return d;
  if(start<0)return Infinity;
  const routes=routesOf(city),g=routes.grid,cs=g.cellSize,sx=start%g.width,sy=(start-sx)/g.width;
  const c=fieldFor(routes,goal).cellCost(sx,sy);
  return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*cs+Math.hypot((sx+.5)*cs-from.x,(sy+.5)*cs-from.y);
}
