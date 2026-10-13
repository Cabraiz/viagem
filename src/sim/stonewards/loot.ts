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
import {FlowField,SPEED,STRAIGHT_COST,UNREACHABLE,walkable,type CityAsset,type CityTerrain,type FlowGrid,type Point,type TerrainField} from '../../maps/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {AvenuePlanner} from '../city/avenues.ts';
import {cityLayoutFrom,cityTerrainOf} from '../city/grid.ts';
import {RETURN_SLACK_SECONDS} from '../../rules/index.ts';
import type {NodeInfo} from './resources.ts';
import type {ResourceKind} from './state.ts';

export type LootTier='near'|'good'|'far';
/** Walk-time bounds (s) of the tiers: near below the first, good up to the second, far beyond. */
export const LOOT_NEAR_SECONDS=10,LOOT_FAR_SECONDS=15;
/** Units a crate gives, by tier (farther pays more). */
export const LOOT_VALUE:Readonly<Record<LootTier,number>>=Object.freeze({near:1,good:2,far:3});
export const CRATE_RADIUS=.35;
/** Crate ids are `caixa-<index of the candidate in asset.loot>`. */
export const CRATE_PREFIX='caixa-';

/**
 * The hero's walking speed (u/s) in this terrain: the one place the loot tiers, the city intermission and the city
 * horn read it. Today every world moves heroes at the maps `SPEED` (3.1 u/s, world.ts moveDirection). cidade-04 gives
 * the city its own hero speed (~2.0 u/s, rules/scale 'cidade-nevada'): it must make THIS helper world-aware (return
 * what the movement code uses in `terrain`) so the tiers and the horn follow on their own.
 */
export function lootHeroSpeed(_terrain:TerrainField|undefined):number{return SPEED;}

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
  /** Walking distance (u) from p to the plaza (0 inside it); undefined when p is not on the hero field. */
  distanceToPlaza(p:Point):number|undefined;
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

function buildLoot(city:CityTerrain,speed:number):CityLoot{
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
    const x=r.moved?Math.round((r.cx+.5)*cs*100)/100:p.x,y=r.moved?Math.round((r.cy+.5)*cs*100)/100:p.y;
    crates.push({node:Object.freeze({id:`${CRATE_PREFIX}${i}`,kind,x,y,radius:CRATE_RADIUS,value:LOOT_VALUE[tier],capacity:1}),tier,distance,seconds});
  });
  let farthestGood:Crate|undefined;
  for(const c of crates)if(c.tier==='good'&&(!farthestGood||c.seconds>farthestGood.seconds))farthestGood=c;
  return Object.freeze({
    crates:Object.freeze(crates),nodes:Object.freeze(crates.map(c=>c.node)),farthestGood,speed,
    distanceToPlaza(p:Point){
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return undefined;
      const r=reach(p);
      return r?r.cost/STRAIGHT_COST*cs:undefined;
    },
    insideBase:(p:Point)=>planner.insideBase(p),
  });
}

/**
 * City return estimate (ticks) of the farthest standing hero: the real walk to the plaza (distanceToPlaza at
 * loot.speed) plus RETURN_SLACK_SECONDS, 0 for a hero already in the plaza; a hero off the hero field (undefined
 * distance) falls back to `straight(p)` (the island rule on the straight line).
 */
export function cityFarthestReturn(ctx:SimContext,loot:CityLoot,straight:(p:Point)=>number){
  let lead=0;
  for(const p of ctx.players.values()){
    if(!isStanding(p))continue;
    const d=loot.distanceToPlaza(p);
    lead=Math.max(lead,d===undefined?straight(p):d>0?Math.ceil((d/loot.speed+RETURN_SLACK_SECONDS)*SIM_HZ):0);
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
