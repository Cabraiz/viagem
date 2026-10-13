/**
 * Round 1 of the city as a walk to the plaza (card cidade-08): while the run is in round 1 and the local hero is not yet
 * in the plaza, the announcement slot shows "Vai pra praça!" with the distance left and an arrow along the WALKING
 * route. The straight bearing to the plaza walks a novice into a building (it parks ≈(103,148) south-east of it);
 * the arrow follows the same flow field the horde's plaza goal uses instead: FlowField over the city's walkable cells
 * (the hero rule at each cell centre, as src/sim/city/grid.ts cityFlowGrid) toward `asset.points.praca`.
 *
 * "In the plaza" is a client copy of the planner's insideBase (src/sim/city/avenues.ts, which the client cannot import):
 * the plaza cells (a flood from the centroid of the 4 `bocas`, capped at the farthest one and closed by the mouth lines)
 * plus the mouth lines themselves (a disc of MOUTH_HALF_WIDTH at each boca). tests/client/city-tutorial-hud.test.ts
 * checks it cell by cell against the planner.
 *
 * Built once per terrain (a few ms, lazily on the first round-1 frame) and cached; per frame it is O(1): the field's
 * directionAt, and the route length memoised per cell. No DOM: the HUD row is in hud/objective.ts.
 */
import {FlowField,DIRS,UNREACHABLE,walkable,rotateVector,type FlowGrid,type FlowPoint,type CityTerrain} from './deps.ts';

/** The planner's mouth line half width (avenues.ts AvenuePlannerOptions.mouthHalfWidth default, 2.6 u). */
export const MOUTH_HALF_WIDTH=2.6;
const MOUTH_LINE=1,PLAZA_CELL=2;
const BOCAS=['N','S','L','O'] as const;

/** The part of the city terrain the route reads (maps CityTerrain): its asset and the hero rule's collision. */
export type RouteTerrain=Pick<CityTerrain,'asset'|'clearDisc'|'world'>;
/** The city terrain behind any terrain (world 'cidade' with its decoded asset), else undefined. */
export function routeTerrainOf(terrain:unknown):RouteTerrain|undefined{
  const t=terrain as Partial<CityTerrain>|undefined;
  return t&&t.world==='cidade'&&t.asset?.points?.praca&&t.asset.cells&&typeof t.clearDisc==='function'?t as RouteTerrain:undefined;
}

/** The walking route to the plaza over one city (cityRouteOf caches one per terrain). */
export class CityRoute {
  readonly field:FlowField;
  readonly width:number;readonly height:number;readonly cellSize:number;
  /** Per cell: MOUTH_LINE, PLAZA_CELL or 0 (the planner's `base`). */
  private readonly base:Uint8Array;
  /** Route length (u) from each cell's centre to the first plaza cell along the field; NaN until asked. */
  private readonly left:Float64Array;
  private readonly trail:Int32Array;
  constructor(terrain:RouteTerrain){
    const asset=terrain.asset,w=this.width=asset.cells.w,h=this.height=asset.cells.h,cs=this.cellSize=asset.unitsPerCell;
    // The sim's grid (cityFlowGrid): one cell per asset cell, walkable when the hero's disc fits at its centre.
    const cells=new Uint8Array(w*h),probe={x:0,y:0};
    for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++){probe.x=(cx+.5)*cs;probe.y=(cy+.5)*cs;cells[cx+cy*w]=walkable(probe,terrain as CityTerrain)?1:0;}
    const grid:FlowGrid={width:w,height:h,cellSize:cs,originX:0,originY:0,walkable:(cx,cy)=>cells[cx+cy*w]===1};
    this.base=plazaCells(grid,asset.points);
    this.field=new FlowField(grid,[asset.points.praca]);
    this.left=new Float64Array(w*h).fill(NaN);this.trail=new Int32Array(w*h);
  }
  private cellOf(p:FlowPoint){
    const cx=Math.floor(p.x/this.cellSize),cy=Math.floor(p.y/this.cellSize);
    return Number.isFinite(cx)&&Number.isFinite(cy)&&cx>=0&&cy>=0&&cx<this.width&&cy<this.height?cx+cy*this.width:-1;
  }
  /** The hero stands in the plaza: the planner's insideBase (a plaza cell or a mouth line cell). */
  inside(p:FlowPoint){const i=this.cellOf(p);return i>=0&&this.base[i]!==0;}
  /** Unit vector along the walking route at p ((0,0) at the goal or where the plaza cannot be reached). */
  direction(p:FlowPoint,out:FlowPoint={x:0,y:0}){return this.field.directionAt(p.x,p.y,out);}
  /**
   * Walking distance (u ≈ m) left from p to the plaza's edge along the route the arrow follows; Infinity when the plaza
   * cannot be reached from there. Memoised per cell, so a frame costs O(1) once the cells of the way are known.
   */
  distance(p:FlowPoint){
    const start=this.cellOf(p);
    if(start<0)return Infinity;
    const {left,trail,base,width:w,cellSize:cs}=this;
    let i=start,n=0,tail=0;
    // Walk down the field to a cell already known, a plaza cell, or a dead end; then fill the trail backwards.
    while(true){
      if(!Number.isNaN(left[i])){tail=left[i];break;}
      if(base[i]!==0){left[i]=0;tail=0;break;}
      const cx=i%w,cy=(i-cx)/w,d=this.field.nextCell(cx,cy);
      if(d<0||n>=trail.length){tail=Infinity;left[i]=Infinity;break;}
      trail[n++]=i;i=cx+DIRS[d].dx+(cy+DIRS[d].dy)*w;
    }
    for(let k=n-1;k>=0;k--){
      const a=trail[k],b=k+1<n?trail[k+1]:i,step=(a%w!==b%w&&((a/w)|0)!==((b/w)|0)?Math.SQRT2:1)*cs;
      tail=tail+step;left[a]=tail;
    }
    return left[start];
  }
}

/**
 * The planner's base cells (avenues.ts constructor): mouth lines (a MOUTH_HALF_WIDTH disc at each boca), then a flood
 * (8-neighbourhood, no corner cutting) over walkable non-mouth-line cells from the centroid of the bocas (falling back to
 * `praca`), within the farthest boca's distance of that centroid.
 */
export function plazaCells(grid:FlowGrid,points:{praca:FlowPoint;bocas:Readonly<Record<'N'|'S'|'L'|'O',FlowPoint>>}):Uint8Array{
  const w=grid.width,h=grid.height,cs=grid.cellSize,ox=grid.originX??0,oy=grid.originY??0,base=new Uint8Array(w*h);
  const cellOf=(p:FlowPoint)=>{const cx=Math.floor((p.x-ox)/cs),cy=Math.floor((p.y-oy)/cs);return cx>=0&&cy>=0&&cx<w&&cy<h?cx+cy*w:-1;};
  for(const m of BOCAS){
    const c=points.bocas[m],ccx=Math.floor((c.x-ox)/cs),ccy=Math.floor((c.y-oy)/cs);
    const x0=Math.max(0,Math.floor((c.x-MOUTH_HALF_WIDTH-ox)/cs)),x1=Math.min(w-1,Math.floor((c.x+MOUTH_HALF_WIDTH-ox)/cs));
    const y0=Math.max(0,Math.floor((c.y-MOUTH_HALF_WIDTH-oy)/cs)),y1=Math.min(h-1,Math.floor((c.y+MOUTH_HALF_WIDTH-oy)/cs));
    for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++)
      if(Math.hypot(ox+(cx+.5)*cs-c.x,oy+(cy+.5)*cs-c.y)<=MOUTH_HALF_WIDTH||cx===ccx&&cy===ccy)base[cx+cy*w]=MOUTH_LINE;
  }
  let x=0,y=0;for(const m of BOCAS){x+=points.bocas[m].x;y+=points.bocas[m].y;}
  const center={x:x/4,y:y/4},open=(i:number)=>i>=0&&grid.walkable(i%w,(i/w)|0);
  let seed=cellOf(center);
  if(!open(seed))seed=cellOf(points.praca);
  if(!open(seed)||base[seed])return base;
  const cap=Math.max(...BOCAS.map(m=>Math.hypot(points.bocas[m].x-center.x,points.bocas[m].y-center.y)));
  const ok=(cx:number,cy:number)=>cx>=0&&cy>=0&&cx<w&&cy<h&&base[cx+cy*w]!==MOUTH_LINE&&grid.walkable(cx,cy);
  const mark=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let qa=0,qe=0;mark[seed]=1;queue[qe++]=seed;
  while(qa<qe){
    const u=queue[qa++],ux=u%w,uy=(u-ux)/w;
    for(let d=0;d<8;d++){
      const vx=ux+DIRS[d].dx,vy=uy+DIRS[d].dy,v=vx+vy*w;
      if(vx<0||vy<0||vx>=w||vy>=h||mark[v]||!ok(vx,vy)||d>=4&&(!ok(vx,uy)||!ok(ux,vy)))continue;
      if(Math.hypot(ox+(vx+.5)*cs-center.x,oy+(vy+.5)*cs-center.y)>cap)continue;
      mark[v]=1;queue[qe++]=v;
    }
  }
  for(let i=0;i<w*h;i++)if(mark[i])base[i]=PLAZA_CELL;
  return base;
}

const routes=new WeakMap<object,CityRoute>();
/** The route of a city terrain, built on the first call and kept while the terrain lives. */
export function cityRouteOf(terrain:RouteTerrain):CityRoute{
  let r=routes.get(terrain);
  if(!r){r=new CityRoute(terrain);routes.set(terrain,r);}
  return r;
}

/**
 * Screen bearing (degrees, 0 = right, clockwise: y grows down) of a world direction under the camera view (0..3), with
 * the projection's own math (projection.ts projectView: x = (q.x − q.y)·42, y = (q.x + q.y)·21 after rotateVector).
 */
export function screenBearing(d:FlowPoint,view:number){
  const q=rotateVector(d,view);
  return Math.atan2((q.x+q.y)*21,(q.x-q.y)*42)*180/Math.PI;
}

/** What the row says: the distance left (m, whole) and the arrow's screen bearing; either may be missing. */
export interface CityObjective {meters?:number;bearing?:number}
export interface CityObjectiveInput {
  /** The run's terrain (a city, or anything else: then no objective). */
  terrain:unknown;
  /** The run's round now (RunView.round); index 1 is the opening countdown and round 1's wave. */
  round?:{index:number;phase:string};
  /** The local hero can walk (on the field, not downed, out or spectating). */
  standing:boolean;
  /** The local hero's predicted spot. */
  hero?:FlowPoint;
  /** Camera view (0..3). */
  view:number;
}
/**
 * The round-1 walk to the plaza, per run: shown from the opening countdown through round 1 while the hero is out of the
 * plaza; once the hero gets in it stays done for the rest of round 1 (a fight that spills out of the gate does not bring
 * the nag back); any other round, world or no round (lobby, result) resets it for the next run.
 */
export class CityObjectiveTracker {
  private reached=false;
  private readonly dir={x:0,y:0};
  reset(){this.reached=false;}
  step(input:CityObjectiveInput):CityObjective|undefined{
    const terrain=routeTerrainOf(input.terrain);
    if(!terrain||input.round?.index!==1||input.round.phase==='end'){this.reached=false;return undefined;}
    if(this.reached||!input.standing||!input.hero)return undefined;
    const route=cityRouteOf(terrain),hero=input.hero;
    if(route.inside(hero)){this.reached=true;return undefined;}
    const d=route.direction(hero,this.dir),m=route.distance(hero);
    return {...(Number.isFinite(m)?{meters:Math.round(m)}:{}),...(d.x||d.y?{bearing:screenBearing(d,input.view)}:{})};
  }
}

/** Copy of the row (house voice: dry imperative; one joke at most, D-033, no real brand or person). */
export const OBJECTIVE_TEXT='Vai pra praça!';
/** The second line when the joystick is still to learn: the walk lesson folds into the objective (coach.ts). */
export const OBJECTIVE_WALK='Arrasta pra andar';
/** The second line otherwise: the Helicóptero da Firma came down at the start (≤ 28 characters). */
export const OBJECTIVE_JOKE='O heli caiu. Você, não.';
/** "72 m" (the edge arrows' distanceText rule, capped at 999). */
export const objectiveMeters=(m:number)=>`${Math.min(999,Math.max(0,Math.round(m)))} m`;
