/**
 * Multi-goal flow field over a cell grid: one Dijkstra (Dial's bucket queue) from every goal cell, then each cell
 * points at its cheapest legal neighbor. Hundreds of agents share one field and ask `directionAt` every tick.
 * No imports, no allocations per recompute, deterministic (fixed DIRS tie-break order).
 */
export interface FlowGrid {
  width:number; height:number;          // cells
  cellSize:number;                      // world units per cell (> 0)
  originX?:number; originY?:number;     // world position of cell (0,0)'s top-left corner, default 0
  walkable(cx:number,cy:number):boolean; // only called with 0<=cx<width, 0<=cy<height
}
export interface FlowPoint {x:number;y:number}          // world units
export interface CellRect {x0:number;y0:number;x1:number;y1:number} // inclusive cell bounds, clamped to the grid
export interface FlowFieldOptions {
  /** Extra integer cost for stepping into a cell that touches a blocked cell (8-neighborhood). Keeps paths off building corners. Default 4. */
  wallPenalty?:number;
}
/** Integer step costs (orthogonal, diagonal). */
export const STRAIGHT_COST=10, DIAGONAL_COST=14;
/** Cost of blocked, outside or goal-less cells. */
export const UNREACHABLE=0xffffffff;
/** Neighbor offsets in the fixed tie-break order. dx right, dy down (cell y grows with world y). */
export const DIRS:readonly {dx:number;dy:number}[]=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:-1,dy:1},{dx:1,dy:-1},{dx:-1,dy:-1},
].map(d=>Object.freeze(d)));
const DX=Int8Array.from(DIRS,d=>d.dx), DY=Int8Array.from(DIRS,d=>d.dy);
const DC=Uint8Array.from(DIRS,d=>d.dx&&d.dy?DIAGONAL_COST:STRAIGHT_COST);
const VX=Float64Array.from(DIRS,d=>d.dx/Math.hypot(d.dx,d.dy)), VY=Float64Array.from(DIRS,d=>d.dy/Math.hypot(d.dx,d.dy));

export class FlowField {
  readonly width:number; readonly height:number; readonly cellSize:number; readonly originX:number; readonly originY:number;
  private readonly grid:FlowGrid; private readonly penalty:number;
  private readonly walk:Uint8Array; private readonly near:Uint8Array; private readonly isTarget:Uint8Array;
  private readonly cost:Uint32Array; private readonly next:Int8Array;
  /** Bucket queue: one doubly linked list per cost mod ring size; each cell sits in at most one bucket. */
  private readonly qNext:Int32Array; private readonly qPrev:Int32Array; private readonly heads:Int32Array;
  private readonly targets:Int32Array; private targetCount=0; private ver=0;
  /** Bumped on every recompute (constructor = 1). */
  get version(){return this.ver;}
  constructor(grid:FlowGrid,targets:readonly FlowPoint[],options?:FlowFieldOptions){
    const w=this.width=grid.width|0, h=this.height=grid.height|0, n=w*h;
    if(!(w>0&&h>0))throw new Error('flow field needs a non-empty grid');
    if(!(grid.cellSize>0))throw new Error('flow field needs cellSize > 0');
    this.cellSize=grid.cellSize; this.originX=grid.originX??0; this.originY=grid.originY??0; this.grid=grid;
    this.penalty=Math.max(0,Math.floor(options?.wallPenalty??4));
    this.walk=new Uint8Array(n); this.near=new Uint8Array(n); this.isTarget=new Uint8Array(n);
    this.cost=new Uint32Array(n); this.next=new Int8Array(n); this.targets=new Int32Array(n);
    this.qNext=new Int32Array(n); this.qPrev=new Int32Array(n); this.heads=new Int32Array(DIAGONAL_COST+this.penalty+1);
    this.readCells(0,0,w-1,h-1); this.readNear(0,0,w-1,h-1);
    this.setTargets(targets);
  }
  /** Replace goals and recompute. Targets outside the grid or on blocked cells are ignored. */
  setTargets(targets:readonly FlowPoint[]){
    const {targets:list,isTarget}=this;
    for(let k=0;k<this.targetCount;k++)isTarget[list[k]]=0;
    this.targetCount=0;
    for(const t of targets){
      const i=this.cellIndex(Math.floor((t.x-this.originX)/this.cellSize),Math.floor((t.y-this.originY)/this.cellSize));
      if(i>=0&&!isTarget[i]){isTarget[i]=1;list[this.targetCount++]=i;}
    }
    this.recompute();
  }
  /** Walkability changed inside `rect` (cells): re-read only those cells from grid.walkable (plus their wall-penalty ring) and recompute. */
  invalidate(rect:CellRect){
    const w=this.width, h=this.height;
    const x0=Math.max(0,Math.floor(Math.min(rect.x0,rect.x1))), x1=Math.min(w-1,Math.floor(Math.max(rect.x0,rect.x1)));
    const y0=Math.max(0,Math.floor(Math.min(rect.y0,rect.y1))), y1=Math.min(h-1,Math.floor(Math.max(rect.y0,rect.y1)));
    if(!(x0<=x1&&y0<=y1))return; // rect entirely outside the grid: nothing to re-read
    this.readCells(x0,y0,x1,y1);
    this.readNear(Math.max(0,x0-1),Math.max(0,y0-1),Math.min(w-1,x1+1),Math.min(h-1,y1+1));
    this.recompute();
  }
  /** Integer cost-to-goal of the cell containing (x,y); UNREACHABLE when blocked, outside or no goal reachable. Goal cells cost 0. */
  costAt(x:number,y:number){return this.cellCost(Math.floor((x-this.originX)/this.cellSize),Math.floor((y-this.originY)/this.cellSize));}
  /** Cost by cell coordinates (same semantics). */
  cellCost(cx:number,cy:number){const i=this.cellIndex(cx,cy);return i<0?UNREACHABLE:this.cost[i];}
  /** True when the cell containing (x,y) is walkable and has a path to a goal. */
  reachable(x:number,y:number){return this.costAt(x,y)!==UNREACHABLE;}
  /** True when (x,y) lies in a goal cell. */
  atGoal(x:number,y:number){return this.costAt(x,y)===0;}
  /**
   * O(1), allocation-free when `out` is given. Unit vector toward the nearest goal, or (0,0) at a goal cell, when
   * unreachable or without goals. Outside positions clamp to the nearest edge cell. Bilinear blend of the vectors of
   * the 4 surrounding walkable reachable cell centers (falls back to the containing cell when degenerate); inside a
   * blocked cell it points to the cheapest legal walkable neighbor so agents pushed into walls escape.
   */
  directionAt(x:number,y:number,out:FlowPoint={x:0,y:0}):FlowPoint{
    const w=this.width, h=this.height, {walk,cost,next}=this;
    let gx=(x-this.originX)/this.cellSize, gy=(y-this.originY)/this.cellSize;
    if(gx!==gx||gy!==gy){out.x=0;out.y=0;return out;}
    gx=gx<0?0:gx>=w?w-1e-6:gx; gy=gy<0?0:gy>=h?h-1e-6:gy;
    const cx=gx|0, cy=gy|0, i=cx+cy*w, c=cost[i], own=next[i];
    if(!walk[i]||c===0||c===UNREACHABLE||own<0){
      if(own<0){out.x=0;out.y=0;}else{out.x=VX[own];out.y=VY[own];}
      return out;
    }
    const bx=gx-.5, by=gy-.5, i0=Math.floor(bx), j0=Math.floor(by), fx=bx-i0, fy=by-j0;
    let sx=0, sy=0;
    for(let k=0;k<4;k++){
      const ii=i0+(k&1), jj=j0+(k>>1);
      if(ii<0||jj<0||ii>=w||jj>=h)continue;
      const j=ii+jj*w, d=next[j];
      if(d<0||!walk[j])continue; // goal cells add a zero vector; blocked/unreachable cells are skipped
      const wt=(k&1?fx:1-fx)*(k>>1?fy:1-fy);
      sx+=wt*VX[d]; sy+=wt*VY[d];
    }
    const len=Math.sqrt(sx*sx+sy*sy);
    if(len<1e-6){out.x=VX[own];out.y=VY[own];}else{out.x=sx/len;out.y=sy/len;}
    return out;
  }
  /** Neighbor index 0..7 (see DIRS) the cell points to, or -1 (goal, blocked without exit, unreachable, outside). */
  nextCell(cx:number,cy:number){const i=this.cellIndex(cx,cy);return i<0?-1:this.next[i];}

  private cellIndex(cx:number,cy:number){
    cx=Math.floor(cx); cy=Math.floor(cy);
    return cx>=0&&cy>=0&&cx<this.width&&cy<this.height?cx+cy*this.width:-1;
  }
  private readCells(x0:number,y0:number,x1:number,y1:number){
    const {walk,grid,width:w}=this;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)walk[x+y*w]=grid.walkable(x,y)?1:0;
  }
  /** Near-wall flag: any 8-neighbor blocked or outside the grid. */
  private readNear(x0:number,y0:number,x1:number,y1:number){
    const {walk,near,width:w,height:h}=this;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      let flag=x===0||y===0||x===w-1||y===h-1?1:0;
      for(let d=0;!flag&&d<8;d++)if(!walk[x+DX[d]+(y+DY[d])*w])flag=1;
      near[x+y*w]=flag;
    }
  }
  private recompute(){
    const {walk,near,cost,next,qNext,qPrev,heads,targets,width:w,height:h,penalty}=this, n=w*h, ring=heads.length;
    cost.fill(UNREACHABLE); heads.fill(-1);
    let queued=0;
    for(let k=0;k<this.targetCount;k++){
      const i=targets[k];
      if(!walk[i])continue;
      cost[i]=0; const q=heads[0]; qNext[i]=q; qPrev[i]=-1; if(q>=0)qPrev[q]=i; heads[0]=i; queued++;
    }
    for(let c=0;queued>0;c++){
      const b=c%ring;
      for(let u=heads[b];u>=0;u=heads[b]){
        const q=qNext[u]; heads[b]=q; if(q>=0)qPrev[q]=-1; queued--;
        const ux=u%w, uy=(u-ux)/w;
        for(let d=0;d<8;d++){
          const vx=ux+DX[d], vy=uy+DY[d];
          if(vx<0||vy<0||vx>=w||vy>=h)continue;
          const v=vx+vy*w;
          if(!walk[v]||d>=4&&(!walk[vx+uy*w]||!walk[ux+vy*w]))continue; // no corner cutting
          const nc=c+DC[d]+(near[v]?penalty:0), old=cost[v];
          if(nc>=old)continue;
          if(old!==UNREACHABLE){ // still queued (settled cells can't improve): unlink from its bucket
            const p=qPrev[v], s=qNext[v];
            if(p<0)heads[old%ring]=s;else qNext[p]=s;
            if(s>=0)qPrev[s]=p;
          }else queued++;
          cost[v]=nc; const nb=nc%ring, hq=heads[nb]; qNext[v]=hq; qPrev[v]=-1; if(hq>=0)qPrev[hq]=v; heads[nb]=v;
        }
      }
    }
    // Each cell points at its strictly cheapest legal neighbor (first in DIRS order on ties); blocked cells at their exit.
    for(let i=0;i<n;i++){
      const ux=i%w, uy=(i-ux)/w;
      let best=-1, bc=cost[i];
      for(let d=0;d<8;d++){
        const vx=ux+DX[d], vy=uy+DY[d];
        if(vx<0||vy<0||vx>=w||vy>=h)continue;
        const v=vx+vy*w;
        if(cost[v]>=bc||!walk[v]||d>=4&&(!walk[vx+uy*w]||!walk[ux+vy*w]))continue;
        best=d; bc=cost[v];
      }
      next[i]=best;
    }
    this.ver++;
  }
}
