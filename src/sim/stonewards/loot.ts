/**
 * Loot crates of the Cidade Nevada intermission (cidade-07, D-026/D-032): the asset's `loot` candidates become gather
 * nodes ("caixas") that nodesNear returns in the city instead of any island obstacle. No protocol or client change:
 * a crate is a NodeInfo of capacity 1, so the existing gather (resources.ts gatherStep, 0.8–1.2 s of standing next to
 * it) collects it once per intermission (refillNodes clears the round's touched nodes), and the client draws it as
 * any node (multiplayer/simulation.ts nodeViews).
 *
 * Which crates (a pure function of the asset, cached per asset, so every room, fork and the views agree):
 *  - reachability and distance come from a STATIC hero field: the plaza goal cells of the avenue planner (the same
 *    flood, AvenuePlanner on the asset's layout) on a grid of the hero rule (maps `walkable` at each cell centre, as
 *    cityFlowGrid on main), with no wall penalty, so the cost is the 8-neighbour walking distance. Static on purpose:
 *    the run's planner field turns enemy-only barricades (cidade-06) into walls and its wall penalty is not a walk, and
 *    nodesNear has only the terrain (the views call it without options). Doors are closed in the asset (D-032), so a
 *    candidate behind one is simply unreachable and dropped;
 *  - a candidate whose own cell the hero rule closes (a point drawn against a wall) moves to the centre of its cheapest
 *    reachable neighbour cell; none reachable → dropped. Candidates are then deduped by cell (first one wins);
 *  - all reachable crates every intermission (no per-round subset: deterministic from the asset, nothing in the state
 *    until somebody works one, and the views need no state to list them).
 *
 * Tiers by walk time from the plaza at lootHeroSpeed: near < LOOT_NEAR_SECONDS, good up to LOOT_FAR_SECONDS, far
 * beyond. Value LOOT_VALUE by tier (units of the crate's kind); kinds alternate coco/pedra inside each tier (asset
 * order), so every tier pays both. A good crate (2 units) is part of a repair (rules RECIPES.reparo: 2 coco + 3 pedra).
 */
import {CityTerrain,FlowField,STRAIGHT_COST,UNREACHABLE,baseHeroSpeed,clearSegment,heroSpeed,walkable,type CityAsset,type FlowGrid,type Point,type TerrainField} from '../../maps/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {AvenuePlanner} from '../city/avenues.ts';
import {cityLayoutFrom,cityTerrainOf} from '../city/grid.ts';
import {cityRunStart} from '../city/tutorial.ts';
import {CITY_DISTANCE_SCALE,CRATE_BODY_RADIUS,RETURN_SLACK_SECONDS} from '../../rules/index.ts';
import type {NodeInfo} from './resources.ts';
import type {ResourceKind} from './state.ts';

export type LootTier='near'|'good'|'far';
/**
 * Walk-time bounds (s) of the tiers: near below the first, good up to the second, far beyond. They describe where the
 * crates sit on the map (10 / 15 s at the base walk on the .w3x-sized city), so they grow with the map
 * (NEW-20261013-ORQ-cidade-escala-1-7: × CITY_DISTANCE_SCALE (CITY_MAP_SCALE ÷ CITY_COMPACT, mapa-175-com-viaduto), 9.7 / 14.6 s): the same candidates keep their tiers and values.
 */
export const LOOT_NEAR_SECONDS=10*CITY_DISTANCE_SCALE,LOOT_FAR_SECONDS=15*CITY_DISTANCE_SCALE;
/**
 * Units a crate gives, by tier (farther pays more). Sized against the forge (recipes cost 5–7 units) and the island
 * economy (~70 units per intermission for a team): with the city's walking distances a solo hero brings back ~18
 * units per intermission (2–3 crates) and six heroes ~80, so the forge stays useful in the city.
 */
export const LOOT_VALUE:Readonly<Record<LootTier,number>>=Object.freeze({near:3,good:6,far:9});
export const CRATE_RADIUS=.35;
/** Crate ids are `caixa-<index of the candidate in asset.loot>`. */
export const CRATE_PREFIX='caixa-';

/**
 * The hero's walking speed (u/s) the loot tiers and the city intermission are measured at: the BASE walk (maps
 * `baseHeroSpeed`, cidade-04: ~1.99 u/s in the city), not the 2× walk (HERO_SPEED_MULT) the heroes now have, so the
 * crate tiers and the intermission length stay as tuned. The horn (cityFarthestReturn) times the real walk back.
 */
/** D-051: walk distance (u) from the plaza of CityLoot.aroundPlaza, [min, max] ([8, 14] on the 1.7× city; ÷ CITY_COMPACT since mapa-175-com-viaduto). */
export const AROUND_PLAZA:readonly [number,number]=[5,8];
/**
 * BUG-20261022-ORQ-caixas-sumiram: walk distance (u) from the run's start (sim/city/tutorial.ts cityRunStart, where the
 * heroes spawn, ~76 u of walk from the plaza) of CityLoot.aroundStart, [min, max]: the first minute's crates. Up to
 * 60 s at the hero's 4 u/s walk reaches far beyond; these stay where a hero who walks off in any direction passes them.
 */
export const AROUND_START:readonly [number,number]=[6,48];
/** CityLoot.spotAhead: tries, and how far (rad) a try turns off the heading at most. */
export const SPOT_TRIES=12,SPOT_SPREAD=.5;
export function lootHeroSpeed(terrain:TerrainField|undefined):number{return baseHeroSpeed(terrain);}

export interface Crate {
  node:NodeInfo;tier:LootTier;
  /** Walking distance (u) from the plaza and its time (s) at lootHeroSpeed. */
  distance:number;seconds:number;
}
export interface CityLoot {
  /** Reachable crates in asset order. */
  readonly crates:readonly Crate[];
  /** The crates as gather nodes (same order, shared objects). */
  readonly nodes:readonly NodeInfo[];
  /** The farthest good crate (undefined when the city has none). */
  readonly farthestGood:Crate|undefined;
  /** Hero speed (u/s) the tiers were sized with. */
  readonly speed:number;
  /**
   * D-051: hero cell centres just outside the base (its mouths reach ~8 u), AROUND_PLAZA u of walk from the plaza
   * (cell order), where the manual combat's start crates sit (the loot points are 18 s and more away, the intermission
   * 20 s).
   */
  readonly aroundPlaza:readonly Point[];
  /**
   * The first minute's crate spots (BUG-20261022-ORQ-caixas-sumiram): hero cell centres AROUND_START u of walk from
   * the run's start (cityRunStart), a crate's whole body on open ground, outside the base; cell order, with the walk.
   */
  readonly aroundStart:readonly (Point&{walk:number})[];
  /** Walking distance (u) from p to the plaza (0 inside it); undefined when p is not on the hero field. */
  distanceToPlaza(p:Point):number|undefined;
  /**
   * A first-minute trail crate's spot (sim/crates.ts trailSpot): about `ahead` u from `at` along the unit `heading`,
   * turned up to SPOT_SPREAD off it (straight first), in the open line of the hero, on open ground for the crate's body, on a cell the heroes reach, outside the
   * base; SPOT_TRIES draws; undefined when none fits.
   */
  spotAhead(at:Point,heading:Point,ahead:number,rng:{next():number}):Point|undefined;
  /** Plaza goal cell or a mouth line (the planner's "inside the base", static: barricades do not change it). */
  insideBase(p:Point):boolean;
}

/** A FlowGrid of the hero rule at each cell centre, read once (heroes ignore the enemy-only barricades). */
function heroGrid(city:CityTerrain):FlowGrid{
  const asset=city.asset,width=asset.cells.w,height=asset.cells.h,cellSize=asset.unitsPerCell;
  const cells=new Uint8Array(width*height),probe={x:0,y:0};
  for(let cy=0;cy<height;cy++)for(let cx=0;cx<width;cx++){
    probe.x=(cx+.5)*cellSize;probe.y=(cy+.5)*cellSize;
    cells[cx+cy*width]=walkable(probe,city)?1:0;
  }
  return {width,height,cellSize,originX:0,originY:0,walkable:(cx,cy)=>cells[cx+cy*width]===1};
}

const cache=new WeakMap<CityAsset,CityLoot>();

/** The city's crates (built once per asset, ~tens of ms); undefined outside the city. */
export function cityLoot(terrain:TerrainField|undefined):CityLoot|undefined{
  const city=cityTerrainOf(terrain);
  if(!city)return undefined;
  let loot=cache.get(city.asset);
  if(!loot){loot=buildLoot(city,lootHeroSpeed(terrain));cache.set(city.asset,loot);}
  return loot;
}

function buildLoot(shared:CityTerrain,speed:number):CityLoot{
  // A fresh terrain over the asset: never a room's fork or enemy-only view (cidade-06 blockers), whichever caller
  // reaches this first, so the per-asset cache is the same for every room.
  const city=new CityTerrain(shared.asset,shared.signature);
  const grid=heroGrid(city),planner=new AvenuePlanner(cityLayoutFrom(city,grid));
  const w=grid.width,h=grid.height,cs=grid.cellSize,goals:Point[]=[];
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++)if(planner.plazaField.cellCost(cx,cy)===0)goals.push({x:(cx+.5)*cs,y:(cy+.5)*cs});
  const field=new FlowField(grid,goals,{wallPenalty:0});
  /** Cost of p's cell, else of its cheapest neighbour (fixed DIRS-like order), with that cell; undefined when none. */
  const reach=(p:Point)=>{
    const cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs),own=field.cellCost(cx,cy);
    if(own!==UNREACHABLE)return {cost:own,cx,cy,moved:false};
    let best=UNREACHABLE,bx=0,by=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const c=field.cellCost(cx+dx,cy+dy);
      if(c<best){best=c;bx=cx+dx;by=cy+dy;}
    }
    return best===UNREACHABLE?undefined:{cost:best,cx:bx,cy:by,moved:true};
  };
  const crates:Crate[]=[],seen=new Set<number>(),count:Record<LootTier,number>={near:0,good:0,far:0};
  city.asset.loot.forEach((p,i)=>{
    const r=reach(p);
    if(!r||seen.has(r.cx+r.cy*w))return;
    seen.add(r.cx+r.cy*w);
    const distance=r.cost/STRAIGHT_COST*cs,seconds=distance/speed;
    const tier:LootTier=seconds<LOOT_NEAR_SECONDS?'near':seconds<=LOOT_FAR_SECONDS?'good':'far';
    const kind:ResourceKind=count[tier]++%2?'pedra':'coco';
    // The candidate itself when the hero can stand there, else its cell centre; never inside the base.
    const centre=r.moved||!walkable(p,city);
    const x=centre?Math.round((r.cx+.5)*cs*100)/100:p.x,y=centre?Math.round((r.cy+.5)*cs*100)/100:p.y;
    if(planner.insideBase({x,y})){count[tier]--;return;}
    crates.push({node:Object.freeze({id:`${CRATE_PREFIX}${i}`,kind,x,y,radius:CRATE_RADIUS,value:LOOT_VALUE[tier],capacity:1}),tier,distance,seconds});
  });
  const aroundPlaza:Point[]=[];
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++){
    const cost=field.cellCost(cx,cy);
    if(cost===UNREACHABLE)continue;
    const d=cost/STRAIGHT_COST*cs,p={x:Math.round((cx+.5)*cs*100)/100,y:Math.round((cy+.5)*cs*100)/100};
    if(d>=AROUND_PLAZA[0]&&d<=AROUND_PLAZA[1]&&walkable(p,city)&&!planner.insideBase(p))aroundPlaza.push(Object.freeze(p));
  }
  const aroundStart:(Point&{walk:number})[]=[],start=cityRunStart(city);
  const fromStart=new FlowField(grid,[start],{wallPenalty:0});
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++){
    const cost=fromStart.cellCost(cx,cy);
    if(cost===UNREACHABLE)continue;
    const walk=cost/STRAIGHT_COST*cs,x=Math.round((cx+.5)*cs*100)/100,y=Math.round((cy+.5)*cs*100)/100;
    if(walk>=AROUND_START[0]&&walk<=AROUND_START[1]&&city.clearDisc(x,y,CRATE_BODY_RADIUS)&&!planner.insideBase({x,y}))
      aroundStart.push(Object.freeze({x,y,walk:Math.round(walk*100)/100}));
  }
  let farthestGood:Crate|undefined;
  for(const c of crates)if(c.tier==='good'&&(!farthestGood||c.seconds>farthestGood.seconds))farthestGood=c;
  return Object.freeze({
    crates:Object.freeze(crates),nodes:Object.freeze(crates.map(c=>c.node)),farthestGood,speed,aroundPlaza:Object.freeze(aroundPlaza),aroundStart:Object.freeze(aroundStart),
    distanceToPlaza(p:Point){
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return undefined;
      const r=reach(p);
      return r?r.cost/STRAIGHT_COST*cs:undefined;
    },
    insideBase:(p:Point)=>planner.insideBase(p),
    spotAhead(at:Point,heading:Point,ahead:number,rng:{next():number}){
      const base=Math.atan2(heading.y,heading.x);
      for(let i=0;i<SPOT_TRIES;i++){
        // Straight ahead first, then turning off it both ways (a street that bends), a little nearer or farther.
        const a=base+(i%2?-1:1)*Math.ceil(i/2)/Math.ceil(SPOT_TRIES/2)*SPOT_SPREAD,r=ahead*(.85+.3*rng.next());
        const p={x:Math.round((at.x+Math.cos(a)*r)*100)/100,y:Math.round((at.y+Math.sin(a)*r)*100)/100};
        const cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);
        if(cx<0||cy<0||cx>=w||cy>=h||field.cellCost(cx,cy)===UNREACHABLE)continue;
        if(city.clearDisc(p.x,p.y,CRATE_BODY_RADIUS)&&!planner.insideBase(p)&&clearSegment(at,p,city))return p;
      }
      return undefined;
    },
  });
}

/**
 * City return estimate (ticks) of the farthest standing hero: the real walk to the plaza (distanceToPlaza at the
 * hero's real walk, maps heroSpeed: 2 × loot.speed) plus RETURN_SLACK_SECONDS, 0 for a hero already in the plaza; a
 * hero off the hero field (undefined distance) falls back to `straight(p)` (the island rule on the straight line).
 * `skip(id)`: heroes left out (the horn's idle heroes, system.ts HORN_IDLE_RADIUS).
 */
export function cityFarthestReturn(ctx:SimContext,loot:CityLoot,straight:(p:Point)=>number,skip?:(id:string)=>boolean){
  let lead=0;const walk=heroSpeed(ctx.terrain);
  for(const p of ctx.players.values()){
    if(!isStanding(p)||skip?.(p.id))continue;
    const d=loot.distanceToPlaza(p);
    lead=Math.max(lead,d===undefined?straight(p):d>0?Math.ceil((d/walk+RETURN_SLACK_SECONDS)*SIM_HZ):0);
  }
  return lead;
}

/**
 * Ticks an intermission needs for the trip to the farthest good crate: there and back at loot.speed, `collectTicks`
 * of standing at it, plus `marginTicks`. 0 when the city has no good crate.
 */
export function lootTripTicks(loot:CityLoot,collectTicks:(kind:ResourceKind)=>number,marginTicks:number){
  const c=loot.farthestGood;
  return c?Math.ceil(2*c.seconds*SIM_HZ)+collectTicks(c.node.kind)+marginTicks:0;
}
