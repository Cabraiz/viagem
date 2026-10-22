/**
 * Cidade Nevada glue for the avenue planner (cidade-05): the city terrain as a flow-field grid, the planner's layout
 * from the asset's points, and the enemy-ai steer that walks bodies down the avenues and through the streets to the
 * team instead of into buildings.
 *
 * Grid: one cell per asset cell (asset.unitsPerCell, 0.88 u), origin 0. A cell is walkable iff the hero rule
 * `walkable(cell centre)` of the maps port holds (the hero's disc against the walkable mask, the same rule moveSafely
 * uses), so a body following the field is never sent to a cell its own movement refuses. The cells are cached in a
 * Uint8Array; when the terrain's walkability changes (barricades, cidade-06) call `refresh(rect)` on the grid first,
 * then `planner.invalidate([rect])`; citySteer's fields (players and every size class) follow the grid's `version` on
 * their own (see citySteer). Everything here is for enemies, so it reads the terrain through `enemyTerrain` (the
 * barricades' blocker discs are solid for enemies only; heroes walk through them).
 */
import {DIRS,FlowField,RADIUS,STRAIGHT_COST,UNREACHABLE,enemyTerrain,walkable,type CellRect,type CityTerrain,type FlowGrid,type FlowPoint,type Point,type TerrainField} from '../../maps/index.ts';
import {CITY_MAP_SCALE,SCALE_PROFILES,enemySpeed} from '../../rules/index.ts';
import type {EnemyState,SimPlayer} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {SIEGE_FLAG} from '../stonewards/wall.ts';
import {enemyDef} from '../enemies/catalog.ts';
import {AvenuePlanner,type AvenuePlannerOptions,type CityLayout} from './avenues.ts';
import {blockingCity,sealRadii} from '../stonewards/barricades.ts';

/**
 * FlowGrid over the city with its cached cells; `refresh` re-reads walkability inside a cell rect (inclusive, clamped)
 * and bumps `version`, so a field built outside the planner (citySteer's fields) re-reads the grid too.
 */
export interface CityFlowGrid extends FlowGrid {
  readonly cells:Uint8Array;
  readonly version:number;
  refresh(rect:CellRect):void;
  /**
   * Cell rect (clamped) covering every refresh after `version`; undefined when nothing changed since. The whole grid
   * when that history is older than the last CHANGE_LOG refreshes.
   */
  changedSince(version:number):CellRect|undefined;
}
/** Refreshes a CityFlowGrid remembers for changedSince. */
const CHANGE_LOG=64;

/** The city terrain behind a TerrainField (D-034: world === 'cidade' with its decoded asset), else undefined. */
export function cityTerrainOf(terrain:TerrainField|undefined):CityTerrain|undefined{
  const t=terrain as Partial<CityTerrain>|undefined;
  return t&&t.world==='cidade'&&t.asset&&typeof t.clearDisc==='function'?t as CityTerrain:undefined;
}

/** Walkable cells of the city at asset.unitsPerCell, by the hero rule at each cell centre (see the module doc). */
export function cityFlowGrid(city:CityTerrain):CityFlowGrid{
  const terrain=enemyTerrain(city), asset=terrain.asset, width=asset.cells.w, height=asset.cells.h, cellSize=asset.unitsPerCell;
  const cells=new Uint8Array(width*height), probe={x:0,y:0};
  const read=(x0:number,y0:number,x1:number,y1:number)=>{
    for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
      probe.x=(cx+.5)*cellSize; probe.y=(cy+.5)*cellSize;
      cells[cx+cy*width]=walkable(probe,terrain)?1:0;
    }
  };
  read(0,0,width-1,height-1);
  let version=0;
  const log:{version:number;rect:CellRect}[]=[];
  return {
    width,height,cellSize,originX:0,originY:0,cells,
    get version(){return version;},
    walkable:(cx,cy)=>cells[cx+cy*width]===1,
    refresh(rect){
      const x0=Math.max(0,Math.floor(Math.min(rect.x0,rect.x1))), x1=Math.min(width-1,Math.floor(Math.max(rect.x0,rect.x1)));
      const y0=Math.max(0,Math.floor(Math.min(rect.y0,rect.y1))), y1=Math.min(height-1,Math.floor(Math.max(rect.y0,rect.y1)));
      if(x0<=x1&&y0<=y1){
        read(x0,y0,x1,y1);version++;
        log.push({version,rect:{x0,y0,x1,y1}});
        if(log.length>CHANGE_LOG)log.shift();
      }
    },
    changedSince(since){
      if(!(since<version))return undefined;
      if(!log.length||log[0].version>since+1)return {x0:0,y0:0,x1:width-1,y1:height-1};
      let out:CellRect|undefined;
      for(const {version:v,rect:r} of log){
        if(v<=since)continue;
        out=out?{x0:Math.min(out.x0,r.x0),y0:Math.min(out.y0,r.y0),x1:Math.max(out.x1,r.x1),y1:Math.max(out.y1,r.y1)}:{...r};
      }
      return out;
    },
  };
}

/**
 * Planner layout from the asset's points: spawns ← spawnN/S/L/O, mouths ← bocas, plaza (fallback seed) ← praca; mapScale
 * ← rules CITY_MAP_SCALE (the asset is the .w3x city × that scale since its version 2, NEW-20261013-ORQ-cidade-escala-1-7).
 * mouthRadius (the barricade goals) ← the widest barricade disc (stonewards sealRadii) + a hero radius + half a cell:
 * the first walkable cells past the disc. The discs grew more than the map (2.2 / 1.95 u, not 1.7 / 1.7: the slack a
 * seal may leave is a hero's), so MOUTH_RADIUS × CITY_MAP_SCALE (2.55 u) missed the N/S avenue cells (2.81 u out).
 */
export function cityLayoutFrom(terrain:CityTerrain,grid:FlowGrid=cityFlowGrid(terrain)):CityLayout{
  const p=terrain.asset.points, pt=(q:{x:number;y:number}):FlowPoint=>({x:q.x,y:q.y});
  const seals=blockingCity(terrain)?Object.values(sealRadii(terrain)).filter((r):r is number=>r!==null):[];
  return {
    grid,plaza:pt(p.praca),mapScale:CITY_MAP_SCALE,
    ...(seals.length?{mouthRadius:Math.max(...seals)+RADIUS+terrain.asset.unitsPerCell/2}:{}),
    mouths:{N:pt(p.bocas.N),S:pt(p.bocas.S),L:pt(p.bocas.L),O:pt(p.bocas.O)},
    spawns:{N:pt(p.spawnN),S:pt(p.spawnS),L:pt(p.spawnL),O:pt(p.spawnO)},
  };
}

/**
 * Common enemy speed of the city profile (u/s, ≈1.79), the planner's default arrival estimate. It is also
 * citySpeed(the endless common enemy) (city/speed.ts maps that fraction exactly onto this one).
 */
export const CITY_ENEMY_SPEED=enemySpeed(SCALE_PROFILES['cidade-nevada']);

/** AvenuePlanner of a city; `grid` exposes the cached cells for `refresh` before `planner.invalidate`. */
export function cityPlanner(terrain:CityTerrain,options:AvenuePlannerOptions={}):AvenuePlanner&{readonly grid:CityFlowGrid}{
  const grid=cityFlowGrid(terrain);
  const planner=new AvenuePlanner(cityLayoutFrom(terrain,grid),{enemySpeed:CITY_ENEMY_SPEED,...options});
  return Object.assign(planner,{grid});
}

/**
 * The steer's output: the walking direction, plus `fit` (BUG-20261013-E1): when > 0, the radius of the field it followed,
 * narrower than the body (its own size class does not reach the target); the enemy-ai then collides with the walls by
 * that radius, so the body squeezes through the gap that field led it to instead of standing at it. 0: its own radius.
 */
export type SteerOut=Point&{fit?:number};
/** EnemyAiOptions.steer: writes a unit direction into `out` and returns true to replace the straight line to `target`. */
export type CitySteer=((ctx:SimContext,e:EnemyState,target:Point,out:SteerOut)=>boolean)&{
  /** Goals: the cells of the live players (see citySteer); undefined when there is no grid to build it on. */
  readonly playersField:FlowField|undefined;
  /** Wide-body fields per WIDE_RADII class (cell centres, then corners from half a cell); empty until a body needs them. */
  readonly widePlayersFields:readonly (readonly FlowField[])[];
  /**
   * Rebuilds `playersField` for this tick now when a live player changed cells (or the grid changed), outside the
   * refreshTicks throttle: the director calls it only when it plans (round start, a group's warning), and nothing may
   * have asked the steer for a while (intermission). Deterministic: ctx.tick and the players only.
   */
  refresh(ctx:SimContext):void;
  /** Path distance (u, wall penalties included) from p to the nearest live player on `playersField`; Infinity when unreachable or unbuilt. */
  costTo(p:Point):number;
  /**
   * The same steer for a body that collides by the hero rule whatever its radius (the boss, boss.ts clearSegment;
   * cidade-05c v2): the hero-size `playersField` only, no size class, its straight chase and corner nudge by the hero
   * rule. Shares this steer's fields (no extra build).
   */
  readonly hero:(ctx:SimContext,e:EnemyState,target:Point,out:SteerOut)=>boolean;
};
export interface CitySteerOptions {
  /** Within this distance (u) of its target, with a clear straight segment, an enemy goes straight. Default 6. */
  chaseRange?:number;
  /** Each players field is rebuilt at most once every refreshTicks ticks (fixed phase per field). Default 10 (0.5 s). */
  refreshTicks?:number;
  /** Grid of the players fields; default the planner's `grid` (cityPlanner exposes it). Without one, no players field. */
  grid?:FlowGrid;
  /** The city: builds every wide-body field now (reading the terrain, tens of ms) instead of on the first wide body. */
  terrain?:CityTerrain;
  /** Every body steers like `CitySteer.hero` (the hero-size players field only, no size classes). Default false. */
  heroOnly?:boolean;
  /**
   * Whether the steer's own checks see the barricades (the enemy view, cidade-06). Default true. The boss walks over them
   * (D-010: it never bashes structures), so its steer is built on a barricade-free planner with `blockers:false`.
   */
  blockers?:boolean;
}
/** Sampling step of the straight-segment check (maps world.ts clearSegment). */
const SEGMENT_STEP=.08;
/**
 * Wide bodies (radius > WIDE_FROM, wider than the hero: bêbado 0.32, agiota 0.3, tio-pavê 0.52, elites, big-size
 * rounds, the round-10 boss 0.9) do not fit every gap the hero rule opens (the city's narrowest passages clear a disc
 * of ~0.44 u), and the
 * wider ones fit a two-cell street only along its middle line, which runs on cell corners; moveSafely keeps their whole
 * disc out of the walls, so a field that sends them there parks them. They follow the players field of their class
 * (WIDE_RADII: the smallest class ≥ the body, else the largest; where that class does not reach the body, the next
 * smaller classes in turn, cidade-05c v2): on the cell centres and, from half a cell of radius,
 * also on the cell corners (the cheaper of the two at the body), a node being open iff the terrain clears a disc of the
 * class radius there. Its goals around each player are the open nodes of the smallest Chebyshev ring
 * (0..WIDE_GOAL_RING) that has any, so a player hugging a wall still has goals next to it (none: that player is out of
 * this field's reach). Their straight chase also needs their own disc clear along the way (WIDE_SEGMENT_STEP): a
 * straight line along a wall that only the hero fits would park them against it.
 */
export const WIDE_FROM=.25,WIDE_RADII:readonly number[]=Object.freeze([.35,.5,.75,1]);
const WIDE_GOAL_RING=2,WIDE_SEGMENT_STEP=.2;
/** Samples a segment check may pass over: those within `reach` (CityTerrain.clearReach, minus a hair) of the clear one, `gap` apart. */
const skip=(reach:number,gap:number)=>reach>1e-6&&gap>0?Math.floor((reach-1e-6)/gap):0;
/** Look-ahead (u) of the corner check of a players-field direction (see `follow` in citySteer). */
const NUDGE=.15;
/** Goal fields kept (card bichos-travados): a band's noise is one goal, so a handful covers the bands waking at once. */
const GOAL_FIELDS=8;
/** The AI's chase targets (enemies/ai.ts `live`): only these are goals of the players fields. */
const chased=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
/**
 * Enemy memory flag of a body that holds the plaza (cidade-08: the tutorial's plaza group, set by the director). Unlike
 * SIEGE_FLAG it never targets a structure (enemies/ai.ts only lets siege bodies hit the wall): the body walks the
 * planner's flow into the plaza and waits there, facing its target, until a live hero is inside the base
 * (planner.insideBase) or within PLAZA_HOLD_RADIUS u of it; then the flag drops to 0 for good and it chases like any
 * body. JSON-safe (a number in memory).
 */
export const PLAZA_HOLD_FLAG='plazaHold',PLAZA_HOLD_RADIUS=6;

/** A players field on grid `on`, with the player cells it was last built from and its scratch (no per-tick allocation). */
interface PlayersLayer {
  /** pad: cells a grid change spreads to on this field (its class radius; 0 for the players field). */
  field:FlowField;on:FlowGrid;ring:number;phase:number;pad:number;
  built:number[];scratch:number[];goals:FlowPoint[];pool:FlowPoint[];checked:number;ready:boolean;gridVersion:number;
}

/**
 * Steer for the city (cidade-05 v2: the horde chases the team through the streets). Per call, allocation-free:
 *  - target within chaseRange with a clear straight segment (the maps clearSegment rule, sampled without allocating)
 *    → false: the AI's straight line;
 *  - a siege body (memory.siege === 1) or a target that is not a player (a structure) → the planner's flow toward
 *    planner.targetFor(e) (plaza, else the barricade that cut it off);
 *  - a player, in the base or not (cidade-05c: no plaza-flow-first for a player in the base, see the steer's note) →
 *    `playersField`, whose goals are the cells of the live players (online, not spectating, downed nor eliminated,
 *    hp > 0: the AI's chase targets), so bodies follow the streets to the team wherever it stands. A wide body
 *    (WIDE_FROM) follows its `widePlayersFields` class first where that reaches it, to its goal ring, then straight;
 *    where its class does not reach it, the next smaller classes (cidade-05c v2: a gap one class too narrow still
 *    keeps it on a field nearer its size), then the hero-size `playersField`. `hero` (the boss, which collides by the
 *    hero rule) and opts.heroOnly skip the classes.
 *    In a player's cell → false (straight). Unreachable (or no live player) → the planner's flow (plaza, or the
 *    barricade that cut it off); zero → false.
 *    A players-field step that would clip a wall's end heads for the next cell's centre instead (NUDGE).
 * A body holding the plaza (memory PLAZA_HOLD_FLAG === 1, cidade-08) follows the planner's flow and stands in the
 * plaza (never the straight chase) until a live hero is in the base or within PLAZA_HOLD_RADIUS; from then on it is
 * steered as above.
 * Retreating enemies are never steered. Each players field is built on its first call and rebuilt (setTargets, the
 * only O(cells) work) at most once every refreshTicks ticks (a fixed phase per field), when a live player's cell
 * changed (and `refresh(ctx)` rebuilds `playersField` on demand for the director's plans), and on the first use after more
 * than refreshTicks ticks nobody used it, so it depends on ctx.tick, the players and the ticks bodies of its class were
 * steered only. A sim restored from a round checkpoint (taken in the intermission, nothing steered for far longer than
 * refreshTicks) builds its fields on their first call like the original rebuilds its idle ones: it plays on bit for bit
 * (checkpoint-cidade). A sim restored mid-wave would not (up to refreshTicks − 1 ticks of a fresher field).
 * Barricades (cidade-06): when the city grid's `version` moves (CityFlowGrid.refresh), every field — the players
 * field and each class's centre and corner fields — re-reads the changed cells (CityFlowGrid.changedSince, grown by
 * its class radius; the whole grid when the grid cannot tell) and recomputes once, lazily: on its first use on one of
 * its own rebuild ticks (its fixed phase), so the work of a barricade is spread like the rebuilds and depends on
 * ctx.tick only. Until then a field may lag the barricade by up to refreshTicks − 1 ticks (moveSafely still blocks).
 */
export function citySteer(planner:AvenuePlanner&{readonly grid?:FlowGrid},opts:CitySteerOptions={}):CitySteer{
  const range=Number.isFinite(opts.chaseRange)&&opts.chaseRange!>=0?opts.chaseRange!:6, range2=range*range;
  const every=Number.isFinite(opts.refreshTicks)&&opts.refreshTicks!>=1?Math.floor(opts.refreshTicks!):10;
  const probe={x:0,y:0};
  const view=opts.blockers===false?(ctx:SimContext)=>ctx.terrain:(ctx:SimContext)=>enemyTerrain(ctx.terrain);
  const clear=(a:Point,b:Point,terrain:TerrainField)=>{
    const len=Math.hypot(a.x-b.x,a.y-b.y), n=Math.max(1,Math.ceil(len/SEGMENT_STEP)), city=len>0?cityTerrainOf(terrain):undefined;
    for(let i=0;i<=n;i++){
      probe.x=a.x+(b.x-a.x)*i/n;probe.y=a.y+(b.y-a.y)*i/n;
      if(!walkable(probe,terrain))return false;
      // The samples the walls (and blockers) leave clear for sure around this one are not read (same answer).
      if(city)i+=skip(city.clearReach(probe.x,probe.y,RADIUS),len/n);
    }
    return true;
  };
  const grid=opts.grid??planner.grid, cityGrid=grid as Partial<CityFlowGrid>|undefined;
  const layer=(on:FlowGrid,ring:number,phase:number,pad=0):PlayersLayer=>({field:new FlowField(on,[]),on,ring,phase,pad,
    built:[],scratch:[],goals:[],pool:[],checked:NaN,ready:false,gridVersion:cityGrid?.version??0});
  const narrow=grid?layer(grid,0,0):undefined;
  const wide:PlayersLayer[][]=WIDE_RADII.map(()=>[]);
  // Rebuild phases: one slot per field (narrow, then each class's centre and corner fields), spread over `every` ticks.
  const half=grid?grid.cellSize/2:0, slots=1+WIDE_RADII.reduce((n,r)=>n+(r<half?1:2),0);
  const slotOf=(k:number,corner:boolean)=>1+WIDE_RADII.slice(0,k).reduce((n,r)=>n+(r<half?1:2),0)+(corner?1:0);
  /**
   * Fields of a wide class: on the city grid's cell centres (one-cell gaps and centred streets fit there) and, from
   * half a cell of radius, also on the corner grid, node (cx,cy) on the corner (cx,cy) of the cells (a two-cell street
   * fits such a body only along its middle line, on the corners). The steer follows the cheaper of the two.
   */
  const wideLayers=(city:CityTerrain,k:number)=>{
    const terrain=enemyTerrain(city), radius=WIDE_RADII[k], g=grid!, cs=g.cellSize;
    return (radius<half?[0]:[0,half]).map(shift=>{
      const ox=(g.originX??0)-shift, oy=(g.originY??0)-shift, extra=shift?1:0;
      const on:FlowGrid={width:g.width+extra,height:g.height+extra,cellSize:cs,originX:ox,originY:oy,
        walkable:(cx,cy)=>terrain.clearDisc(ox+(cx+.5)*cs,oy+(cy+.5)*cs,radius)};
      // A grid cell that changes moves the nodes whose disc (the class radius) reaches it: pad by that, plus the shift.
      return layer(on,WIDE_GOAL_RING,Math.floor(every*slotOf(k,shift>0)/slots),Math.ceil(radius/cs)+1);
    });
  };
  if(grid&&opts.terrain&&opts.heroOnly!==true)for(let k=0;k<WIDE_RADII.length;k++)wide[k]=wideLayers(opts.terrain,k);
  /**
   * Once per tick and field: build on the first call, then when a live player's cell changed, on ticks t with
   * (t − phase) a multiple of `every`; the phases spread the fields' rebuilds over different ticks.
   */
  const update=(ctx:SimContext,l:PlayersLayer,force=false)=>{
    if(ctx.tick===l.checked&&!force)return;
    // A field nobody used for longer than a refresh period (an intermission) holds the players of its last use: rebuild it
    // now, like a fresh (restored) sim does. A shorter gap (a body flipping in and out of the straight chase) keeps the phase.
    const idle=!(ctx.tick-l.checked<=every);
    l.checked=ctx.tick;
    const due=force||!l.ready||idle||(ctx.tick-l.phase)%every===0;
    if(!due)return;
    const v=cityGrid?.version??0, field=l.field, ox=field.originX, oy=field.originY, cs=field.cellSize;
    if(v!==l.gridVersion){
      const r=cityGrid?.changedSince?.(l.gridVersion);
      l.gridVersion=v;
      field.invalidate(r?{x0:r.x0-l.pad,y0:r.y0-l.pad,x1:r.x1+l.pad,y1:r.y1+l.pad}:{x0:0,y0:0,x1:field.width-1,y1:field.height-1});
    }
    const cells=l.scratch, built=l.built;
    let n=0;
    for(const p of ctx.players.values()){
      if(!chased(p))continue;
      const cx=Math.floor((p.x-ox)/cs), cy=Math.floor((p.y-oy)/cs);
      if(cx>=0&&cy>=0&&cx<field.width&&cy<field.height)cells[n++]=cx+cy*field.width;
    }
    cells.length=n;
    let same=l.ready&&n===built.length;
    for(let k=0;same&&k<n;k++)if(cells[k]!==built[k])same=false;
    if(same)return;
    const {goals,pool}=l;
    const open=(x:number,y:number)=>x>=0&&y>=0&&x<field.width&&y<field.height&&l.on.walkable(x,y);
    // Goals around each player: its own cell (narrow field), else the open nodes of the smallest ring that has any.
    goals.length=0;
    for(let k=0;k<n;k++){
      const cx=cells[k]%field.width, cy=(cells[k]-cx)/field.width, from=goals.length;
      for(let r=0;r<=l.ring&&goals.length===from;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(l.ring&&!open(cx+dx,cy+dy))continue;
        const q=pool[goals.length]??={x:0,y:0};q.x=ox+(cx+dx+.5)*cs;q.y=oy+(cy+dy+.5)*cs;goals.push(q);
      }
    }
    field.setTargets(goals);
    l.built=cells;l.scratch=built;l.ready=true;
  };
  const isPlayer=(ctx:SimContext,target:Point)=>{
    const id=(target as {id?:unknown}).id;
    return typeof id==='string'&&ctx.players.get(id)===target;
  };
  /**
   * A wide body's own disc stays clear from `a` to where it touches `b` (sampled every WIDE_SEGMENT_STEP). A body that
   * already overlaps a wall (moveSafely lets it walk out) is judged by the hero rule instead.
   */
  const clearWide=(a:Point,b:Point,terrain:CityTerrain,radius:number)=>{
    if(!terrain.clearDisc(a.x,a.y,radius))return clear(a,b,terrain);
    const d=Math.hypot(b.x-a.x,b.y-a.y), reach=d-radius-RADIUS;
    if(reach<=0)return true;
    const n=Math.ceil(reach/WIDE_SEGMENT_STEP), ux=(b.x-a.x)/d, uy=(b.y-a.y)/d;
    for(let i=1;i<=n;i++){
      const t=reach*i/n,x=a.x+ux*t,y=a.y+uy*t;
      if(!terrain.clearDisc(x,y,radius))return false;
      i+=skip(terrain.clearReach(x,y,radius),reach/n);
    }
    return true;
  };
  /**
   * Field direction into `out` (false when zero). When a step of NUDGE along it would put the body where it does not
   * fit (a wall's end that the blend of the cell centres clips), it heads for the centre of the cell its own cell
   * flows into.
   */
  const follow=(f:FlowField,e:EnemyState,out:Point,ctx:SimContext,terrain:CityTerrain|undefined)=>{
    f.directionAt(e.x,e.y,out);
    if(out.x===0&&out.y===0)return false;
    probe.x=e.x+out.x*NUDGE; probe.y=e.y+out.y*NUDGE;
    // A wide body that fits where it stands is checked with its own disc; one that does not (overlapping a wall, or the
    // boss, which collides by the hero rule, in a street only the hero fits) with the hero rule.
    const clips=terrain&&terrain.clearDisc(e.x,e.y,e.radius)?!terrain.clearDisc(probe.x,probe.y,e.radius):!walkable(probe,view(ctx));
    if(clips){
      const cs=f.cellSize, cx=Math.floor((e.x-f.originX)/cs), cy=Math.floor((e.y-f.originY)/cs), d=f.nextCell(cx,cy);
      if(d>=0){
        const tx=f.originX+(cx+DIRS[d].dx+.5)*cs-e.x, ty=f.originY+(cy+DIRS[d].dy+.5)*cs-e.y, l=Math.hypot(tx,ty);
        if(l>1e-6){out.x=tx/l;out.y=ty/l;}
      }
    }
    return true;
  };
  /**
   * The planner's flow toward planner.targetFor(e). At a barricade's goal cells that flow is zero: there the body heads
   * straight for that mouth, so it presses against the barricade it must break (cidade-06) instead of walking at its
   * target (a player or the wall behind the barricade) into the avenue's corner.
   */
  const baseFlow=(ctx:SimContext,e:EnemyState,out:Point)=>{
    const t=planner.targetFor(e);
    planner.directionFor(e,t,out);
    const mouth=t.kind==='barricade'&&out.x===0&&out.y===0?cityTerrainOf(ctx.terrain)?.asset.points.bocas[t.mouth]:undefined;
    if(mouth){const mx=mouth.x-e.x,my=mouth.y-e.y,l=Math.hypot(mx,my);if(l>1e-6){out.x=mx/l;out.y=my/l;}}
  };
  /** A holding body (PLAZA_HOLD_FLAG) is released when a live hero is inside the base or within PLAZA_HOLD_RADIUS of it. */
  const holdReleased=(ctx:SimContext,e:EnemyState)=>{
    for(const p of ctx.players.values()){
      if(!chased(p))continue;
      const dx=p.x-e.x, dy=p.y-e.y;
      if(dx*dx+dy*dy<=PLAZA_HOLD_RADIUS*PLAZA_HOLD_RADIUS||planner.insideBase(p))return true;
    }
    return false;
  };
  /** Holding: the planner's flow into the plaza; standing in it on a zero direction. Always steers. */
  const hold=(e:EnemyState,target:Point,out:Point)=>{
    planner.directionFor(e,planner.targetFor(e),out);
    return true;
  };
  /**
   * A field toward a structure target (the wall, BUG-20261013-E1) on the hero-size grid: rebuilt when the target moves
   * (never, in a run: the wall is placed once) and, like the players fields, re-reads the cells a barricade changed.
   * Built on its first use.
   */
  let structure:{field:FlowField;x:number;y:number;gridVersion:number}|undefined;
  const towardStructure=(ctx:SimContext,e:EnemyState,target:Point,out:Point,terrain:CityTerrain|undefined)=>{
    const v=cityGrid?.version??0, s=structure??={field:new FlowField(grid!,[]),x:NaN,y:NaN,gridVersion:v};
    if(s.x!==target.x||s.y!==target.y){s.x=target.x;s.y=target.y;s.gridVersion=v;s.field.setTargets([target]);}
    else if(v!==s.gridVersion){
      const r=cityGrid?.changedSince?.(s.gridVersion);
      s.gridVersion=v;
      s.field.invalidate(r??{x0:0,y0:0,x1:s.field.width-1,y1:s.field.height-1});
    }
    return follow(s.field,e,out,ctx,terrain);
  };
  /**
   * D-051 (card bichos-travados): a sleeper's goal (ninhos/sono.ts Sono.goal, a point with a `pace`: the alerta walking
   * to a noise, the perdeu home) on a field of its own, on the hero-size grid, one per goal cell, the GOAL_FIELDS last
   * used kept. The planner's flow leads to the plaza, not to the goal: at the plaza's edge (its flow zero inside) the
   * alerta turned to the goal's way out and back in for good. The fields are a pure function of the goal and the grid
   * (the cache only saves the rebuild), so the run stays the same whatever was cached.
   */
  const goalFields=new Map<number,{field:FlowField;gridVersion:number}>();
  let goalBuilt=-1;
  const isGoal=(target:Point)=>typeof (target as {pace?:unknown}).pace==='number';
  const towardGoal=(ctx:SimContext,e:EnemyState,target:Point,out:Point,terrain:CityTerrain|undefined)=>{
    const g=grid!,cs=g.cellSize,ox=g.originX??0,oy=g.originY??0,cx=Math.floor((target.x-ox)/cs),cy=Math.floor((target.y-oy)/cs);
    if(cx<0||cy<0||cx>=g.width||cy>=g.height)return false;
    const key=cy*g.width+cx,v=cityGrid?.version??0;
    let s=goalFields.get(key);
    if(s)goalFields.delete(key);
    else if(goalFields.size>=GOAL_FIELDS||goalFields.size&&goalBuilt===ctx.tick){
      // BUG-20261022-ORQ-minerva-acordar-trava: more goals than fields (a crowd that lost the hero walks to as many
      // homes) missed the cache every tick, and a new field reads the whole grid (~3 ms): 20+ a tick froze the room.
      // The oldest field takes the new goal instead (only its pass is redone, lazily; the grid check below brings it
      // up to date), and a tick builds at most one new field.
      const old=goalFields.keys().next().value!;
      s=goalFields.get(old)!;goalFields.delete(old);
      s.field.setTargets([{x:ox+(cx+.5)*cs,y:oy+(cy+.5)*cs}]);
    }
    else{s={field:new FlowField(g,[]),gridVersion:v};s.field.setTargets([{x:ox+(cx+.5)*cs,y:oy+(cy+.5)*cs}]);goalBuilt=ctx.tick;}
    goalFields.set(key,s);
    if(v!==s.gridVersion){
      const r=cityGrid?.changedSince?.(s.gridVersion);
      s.gridVersion=v;
      s.field.invalidate(r??{x0:0,y0:0,x1:s.field.width-1,y1:s.field.height-1});
    }
    if(s.field.atGoal(e.x,e.y))return false;
    return follow(s.field,e,out,ctx,terrain);
  };
  const run=(ctx:SimContext,e:EnemyState,target:Point,out:SteerOut,hero:boolean)=>{
    out.fit=0;
    if(e.memory?.retreat===1)return false;
    if(e.memory?.[PLAZA_HOLD_FLAG]===1){
      if(!holdReleased(ctx,e))return hold(e,target,out);
      e.memory[PLAZA_HOLD_FLAG]=0;
    }
    const field=view(ctx), dx=target.x-e.x, dy=target.y-e.y, terrain=!hero&&e.radius>WIDE_FROM?cityTerrainOf(field):undefined;
    if(dx*dx+dy*dy<=range2&&clear(e,target,field)&&(!terrain||clearWide(e,target,terrain,e.radius)))return false;
    if(grid&&isGoal(target)){
      const body=!hero&&e.radius>RADIUS?cityTerrainOf(field):undefined;
      if(!towardGoal(ctx,e,target,out,body))return false;
      if(body)out.fit=RADIUS;
      return true;
    }
    if(narrow&&e.memory?.[SIEGE_FLAG]!==1&&isPlayer(ctx,target)){
      // cidade-05c: one fixed order, wherever the player stands (base or not): the body's own size-class field, then
      // the hero-size players field, then the planner's flow (plaza, or the barricade that cut it off). A field is
      // left only where it does not reach the body, so the choice cannot flip back and forth across the edge of a
      // goal (v2 used the plaza flow first for a player in the base: a wide body its own field could not carry
      // ping-ponged at the plaza goal's edge between the plaza flow, zero inside, and the players field).
      if(terrain){
        let k=0;while(k<WIDE_RADII.length-1&&WIDE_RADII[k]<e.radius)k++;
        // Its own class, then (where that does not reach it) each smaller class, before the hero-size field.
        for(;k>=0;k--){
          const ls=wide[k].length?wide[k]:wide[k]=wideLayers(terrain,k);
          let best:FlowField|undefined, low=UNREACHABLE;
          for(const l of ls){
            update(ctx,l);
            const c=l.field.costAt(e.x,e.y);
            // In its goal ring: as close as it fits, the straight line from here.
            if(c===0)return false;
            if(c<low){low=c;best=l.field;}
          }
          // BUG-20261013-E1: a class narrower than the body (its own does not reach) lets it squeeze at that radius.
          if(best&&follow(best,e,out,ctx,terrain)){if(WIDE_RADII[k]<e.radius)out.fit=WIDE_RADII[k];return true;}
        }
      }
      update(ctx,narrow);
      if(narrow.field.atGoal(e.x,e.y))return false;
      if(follow(narrow.field,e,out,ctx,terrain)){if(terrain)out.fit=RADIUS;return true;}
    }
    baseFlow(ctx,e,out);
    if(out.x!==0||out.y!==0){
      // BUG-20261013-E8: the planner's fields are hero-size. A wide body (siege) whose own disc would clip a wall one
      // NUDGE along them is led where only the hero fits: on the strip between two blocks north of mouth N it crept up
      // the corner ever slower and stood there for good. There it squeezes by the hero rule, like on a players field
      // narrower than it (E1).
      if(!hero&&e.radius>RADIUS){
        const t=cityTerrainOf(field);
        if(t&&t.clearDisc(e.x,e.y,e.radius)&&!t.clearDisc(e.x+out.x*NUDGE,e.y+out.y*NUDGE,e.radius))out.fit=RADIUS;
      }
      return true;
    }
    // BUG-20261013-E1: inside the plaza (its flow is zero there) a siege body walked straight at the wall or a player
    // and stood against the fountain. Its own field instead: the players field for a player, the structure's field
    // for the wall, both hero-size (a wide body squeezes by the hero rule, like the boss).
    if(!narrow)return false;
    const body=!hero&&e.radius>RADIUS?cityTerrainOf(field):undefined;
    if(isPlayer(ctx,target)){update(ctx,narrow);if(!follow(narrow.field,e,out,ctx,body))return false;}
    else if(!towardStructure(ctx,e,target,out,body))return false;
    if(body)out.fit=RADIUS;
    return true;
  };
  const heroOnly=opts.heroOnly===true;
  const steer=(ctx:SimContext,e:EnemyState,target:Point,out:SteerOut)=>run(ctx,e,target,out,heroOnly);
  const hero=(ctx:SimContext,e:EnemyState,target:Point,out:SteerOut)=>run(ctx,e,target,out,true);
  return Object.defineProperties(steer,{
    hero:{value:hero,enumerable:true},
    playersField:{get:()=>narrow?.field,enumerable:true},
    widePlayersFields:{get:()=>wide.map(ls=>ls.map(l=>l.field)),enumerable:true},
    refresh:{value:(ctx:SimContext)=>{if(narrow)update(ctx,narrow,true);},enumerable:true},
    costTo:{value:(p:Point)=>{
      if(!narrow?.ready)return Infinity;
      const c=narrow.field.costAt(p.x,p.y);
      return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*narrow.field.cellSize;
    },enumerable:true},
  }) as CitySteer;
}
