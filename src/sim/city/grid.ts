/**
 * Cidade Nevada glue for the avenue planner (cidade-05): the city terrain as a flow-field grid, the planner's layout
 * from the asset's points, and the enemy-ai steer that walks bodies down the avenues instead of into buildings.
 *
 * Grid: one cell per asset cell (asset.unitsPerCell, 0.88 u), origin 0. A cell is walkable iff the hero rule
 * `walkable(cell centre)` of the maps port holds (the hero's disc against the walkable mask, the same rule moveSafely
 * uses), so a body following the field is never sent to a cell its own movement refuses. The cells are cached in a
 * Uint8Array; when the terrain's walkability changes (barricades, cidade-06) call `refresh(rect)` on the grid first,
 * then `planner.invalidate([rect])`.
 */
import {walkable,type CellRect,type CityTerrain,type FlowGrid,type FlowPoint,type Point,type TerrainField} from '../../maps/index.ts';
import {SCALE_PROFILES,enemySpeed} from '../../rules/index.ts';
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {AvenuePlanner,type AvenuePlannerOptions,type CityLayout} from './avenues.ts';

/** FlowGrid over the city with its cached cells; `refresh` re-reads walkability inside a cell rect (inclusive, clamped). */
export interface CityFlowGrid extends FlowGrid {
  readonly cells:Uint8Array;
  refresh(rect:CellRect):void;
}

/** The city terrain behind a TerrainField (D-034: world === 'cidade' with its decoded asset), else undefined. */
export function cityTerrainOf(terrain:TerrainField|undefined):CityTerrain|undefined{
  const t=terrain as Partial<CityTerrain>|undefined;
  return t&&t.world==='cidade'&&t.asset&&typeof t.clearDisc==='function'?t as CityTerrain:undefined;
}

/** Walkable cells of the city at asset.unitsPerCell, by the hero rule at each cell centre (see the module doc). */
export function cityFlowGrid(terrain:CityTerrain):CityFlowGrid{
  const asset=terrain.asset, width=asset.cells.w, height=asset.cells.h, cellSize=asset.unitsPerCell;
  const cells=new Uint8Array(width*height), probe={x:0,y:0};
  const read=(x0:number,y0:number,x1:number,y1:number)=>{
    for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
      probe.x=(cx+.5)*cellSize; probe.y=(cy+.5)*cellSize;
      cells[cx+cy*width]=walkable(probe,terrain)?1:0;
    }
  };
  read(0,0,width-1,height-1);
  return {
    width,height,cellSize,originX:0,originY:0,cells,
    walkable:(cx,cy)=>cells[cx+cy*width]===1,
    refresh(rect){
      const x0=Math.max(0,Math.floor(Math.min(rect.x0,rect.x1))), x1=Math.min(width-1,Math.floor(Math.max(rect.x0,rect.x1)));
      const y0=Math.max(0,Math.floor(Math.min(rect.y0,rect.y1))), y1=Math.min(height-1,Math.floor(Math.max(rect.y0,rect.y1)));
      if(x0<=x1&&y0<=y1)read(x0,y0,x1,y1);
    },
  };
}

/** Planner layout from the asset's points: spawns ← spawnN/S/L/O, mouths ← bocas, plaza (fallback seed) ← praca. */
export function cityLayoutFrom(terrain:CityTerrain,grid:FlowGrid=cityFlowGrid(terrain)):CityLayout{
  const p=terrain.asset.points, pt=(q:{x:number;y:number}):FlowPoint=>({x:q.x,y:q.y});
  return {
    grid,plaza:pt(p.praca),
    mouths:{N:pt(p.bocas.N),S:pt(p.bocas.S),L:pt(p.bocas.L),O:pt(p.bocas.O)},
    spawns:{N:pt(p.spawnN),S:pt(p.spawnS),L:pt(p.spawnL),O:pt(p.spawnO)},
  };
}

/** Common enemy speed of the city profile (u/s), the planner's default arrival estimate. */
export const CITY_ENEMY_SPEED=enemySpeed(SCALE_PROFILES['cidade-nevada']);

/** AvenuePlanner of a city; `grid` exposes the cached cells for `refresh` before `planner.invalidate`. */
export function cityPlanner(terrain:CityTerrain,options:AvenuePlannerOptions={}):AvenuePlanner&{readonly grid:CityFlowGrid}{
  const grid=cityFlowGrid(terrain);
  const planner=new AvenuePlanner(cityLayoutFrom(terrain,grid),{enemySpeed:CITY_ENEMY_SPEED,...options});
  return Object.assign(planner,{grid});
}

/** EnemyAiOptions.steer: writes a unit direction into `out` and returns true to replace the straight line to `target`. */
export type CitySteer=(ctx:SimContext,e:EnemyState,target:Point,out:Point)=>boolean;
export interface CitySteerOptions {
  /** Within this distance (u) of its target, with a clear straight segment, an enemy goes straight. Default 6. */
  chaseRange?:number;
}
/** Sampling step of the straight-segment check (maps world.ts clearSegment). */
const SEGMENT_STEP=.08;

/**
 * Steer for the city: false (keep the straight line) when the target is within chaseRange and the straight segment is
 * clear (the maps clearSegment rule, sampled without allocating); else the planner's flow direction toward
 * planner.targetFor(e) (plaza, else the barricade that cut it off), true when that direction is non-zero. Retreating
 * enemies are never steered. Allocation-free.
 */
export function citySteer(planner:AvenuePlanner,opts:CitySteerOptions={}):CitySteer{
  const range=Number.isFinite(opts.chaseRange)&&opts.chaseRange!>=0?opts.chaseRange!:6, range2=range*range;
  const probe={x:0,y:0};
  const clear=(a:Point,b:Point,terrain:TerrainField)=>{
    const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/SEGMENT_STEP));
    for(let i=0;i<=n;i++){probe.x=a.x+(b.x-a.x)*i/n;probe.y=a.y+(b.y-a.y)*i/n;if(!walkable(probe,terrain))return false;}
    return true;
  };
  return (ctx,e,target,out)=>{
    if(e.memory?.retreat===1)return false;
    const dx=target.x-e.x, dy=target.y-e.y;
    if(dx*dx+dy*dy<=range2&&clear(e,target,ctx.terrain))return false;
    planner.directionFor(e,planner.targetFor(e),out);
    return out.x!==0||out.y!==0;
  };
}
