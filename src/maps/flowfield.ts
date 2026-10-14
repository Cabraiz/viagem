/**
 * Multi-goal flow field over a cell grid: one Dijkstra (Dial's bucket queue) from every goal cell, then each cell
 * points at its cheapest legal neighbor. Hundreds of agents share one field and ask `directionAt` every tick.
 * No imports, no allocations per recompute, deterministic (fixed DIRS tie-break order). Lazy: a recompute only seeds
 * the goals; the pass runs as far as the cells asked need, and each cell's direction is worked out on its first ask
 * (pure functions of goals and walkability, so the answers never depend on what was asked before; see `ensure`).
 *
 * Goal pattern: the plaza is the goal. When barricades close its mouths and `reachable()` turns false for an agent,
 * the AI switches that agent to a second field whose targets are the walkable cells around the barricades.
 * Memory: ~27 bytes per cell per field (972 KiB at 192×192; +1 byte/cell when `clearance` > 0). Keep few fields —
 * one per goal set × body size class (see `clearance`) — never one per enemy.
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
  /** Extra integer cost for stepping into a cell that touches a blocked cell (8-neighborhood). Keeps paths off building corners. Default 4; floored, non-finite → 4, clamped to 0..255. */
  wallPenalty?:number;
  /**
   * Body clearance in cells (default 0; floored, non-finite → 0, clamped to 0..8). A cell counts as walkable only if
   * every cell within Chebyshev distance `clearance` is walkable and inside the grid. Use `FlowField.clearanceFor`.
   */
  clearance?:number;
}
/** Integer step costs (orthogonal, diagonal). */
export const STRAIGHT_COST=10, DIAGONAL_COST=14;
/** Cost of blocked, outside or goal-less cells. */
export const UNREACHABLE=0xffffffff;
/** Internal "no path" cost: the largest int32, so `cost` stays an Int32Array of small integers (fast typed-array reads). */
const INF=0x7fffffff;
/** `next` of a cell not worked out since the last recompute (see nextOf). */
const UNSET=-128;
/** Neighbor offsets in the fixed tie-break order. dx right, dy down (cell y grows with world y). */
export const DIRS:readonly {dx:number;dy:number}[]=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},{dx:1,dy:1},{dx:-1,dy:1},{dx:1,dy:-1},{dx:-1,dy:-1},
].map(d=>Object.freeze(d)));
const DX=Int8Array.from(DIRS,d=>d.dx), DY=Int8Array.from(DIRS,d=>d.dy);
const DC=Uint8Array.from(DIRS,d=>d.dx&&d.dy?DIAGONAL_COST:STRAIGHT_COST);
const OPP=Uint8Array.from(DIRS,d=>DIRS.findIndex(e=>e.dx===-d.dx&&e.dy===-d.dy));
const VX=Float64Array.from(DIRS,d=>d.dx/Math.hypot(d.dx,d.dy)), VY=Float64Array.from(DIRS,d=>d.dy/Math.hypot(d.dx,d.dy));
/** Floors `v`; non-finite → `def`; clamps to lo..hi. */
const intOption=(v:unknown,def:number,lo:number,hi:number)=>{const n=Math.floor(Number(v));return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):def;};

export class FlowField {
  readonly width:number; readonly height:number; readonly cellSize:number; readonly originX:number; readonly originY:number;
  /** Clearance in cells this field was built with (validated). */
  readonly clearance:number;
  private readonly grid:FlowGrid; private readonly penalty:number;
  /** `walk`: raw grid walkability; `open`: eroded by `clearance` (same array when clearance is 0). */
  private readonly walk:Uint8Array; private readonly open:Uint8Array; private readonly near:Uint8Array; private readonly isTarget:Uint8Array;
  /** Bit d set when the step from the cell along DIRS[d] is legal: inside the grid, onto an open cell, no corner cut. Kept with `near`. */
  private readonly legal:Uint8Array; private readonly off:Int32Array;
  /**
   * Lazy field (a pure memo: every answer is the exact one, whatever was asked before). A recompute only seeds the
   * goals; the Dial pass then runs bucket by bucket as far as the asked cells need (`ensure`): every cell cheaper than
   * `front` is final. A cell in a connected part of the grid without an active goal (`comp`, `goalComp`) is
   * unreachable at once, without running the pass out. `next` follows: an open cell's on its first ask (nextOf), the
   * blocked cells' all at once with their escape BFS (escape).
   */
  private readonly cost:Int32Array; private readonly next:Int8Array; private escaped=false; private front=0; private queued=0;
  /** Connected part of each open cell (legal steps; -1 blocked), rebuilt after walkability changes; goalComp[part] === `stamp` when it holds an active goal. */
  private readonly comp:Int32Array; private readonly goalComp:Uint16Array; private stamp=0; private compsDirty=true;
  /** Bucket queue: one doubly linked list per cost mod ring size; each cell sits in at most one bucket. qNext doubles as the BFS queue of escape and of the parts. */
  private readonly qNext:Int32Array; private readonly qPrev:Int32Array; private readonly heads:Int32Array;
  private readonly targets:Int32Array; private targetCount=0; private ver=0;
  /** Bumped on every recompute (constructor = 1). */
  get version(){return this.ver;}
  /**
   * Clearance (cells) for a round body of `radiusWorld`: 0 when radius < 0.5 cell, 1 when < 1.5 cells, … (max 8).
   * A field with clearance c opens corridors at least 2c+1 cells wide, strictly wider than the body's diameter.
   */
  static clearanceFor(radiusWorld:number,cellSize:number):number{const c=Math.floor(radiusWorld/cellSize+.5);return c>0?Math.min(8,c):0;}
  constructor(grid:FlowGrid,targets:readonly FlowPoint[],options?:FlowFieldOptions){
    const w=this.width=grid.width|0, h=this.height=grid.height|0, n=w*h;
    if(!(w>0&&h>0))throw new Error('flow field needs a non-empty grid');
    if(!(grid.cellSize>0))throw new Error('flow field needs cellSize > 0');
    this.cellSize=grid.cellSize; this.originX=grid.originX??0; this.originY=grid.originY??0; this.grid=grid;
    this.penalty=intOption(options?.wallPenalty??4,4,0,255); this.clearance=intOption(options?.clearance??0,0,0,8);
    this.walk=new Uint8Array(n); this.open=this.clearance?new Uint8Array(n):this.walk; this.near=new Uint8Array(n); this.isTarget=new Uint8Array(n);
    this.legal=new Uint8Array(n); this.off=Int32Array.from(DIRS,d=>d.dx+d.dy*w);
    this.cost=new Int32Array(n); this.next=new Int8Array(n); this.targets=new Int32Array(n); this.comp=new Int32Array(n); this.goalComp=new Uint16Array(n);
    this.qNext=new Int32Array(n); this.qPrev=new Int32Array(n); this.heads=new Int32Array(DIAGONAL_COST+this.penalty+1);
    this.readCells(0,0,w-1,h-1); if(this.clearance)this.erode(0,0,w-1,h-1); this.readNear(0,0,w-1,h-1);
    this.setTargets(targets);
  }
  /**
   * Replace goals and recompute. Targets outside the grid are ignored; targets on blocked cells (or cells closed by
   * `clearance`) are stored but inactive, and become active if a later `invalidate` opens their cell.
   */
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
  /**
   * Walkability changed inside `rect` (cells): re-read only those cells from grid.walkable, re-erode them (rect grown
   * by `clearance`) and their wall-penalty ring, then recompute. No-op when the rect misses the grid.
   */
  invalidate(rect:CellRect){this.refresh(rect,null);}
  /** Same as `invalidate` for several rects (e.g. all changes of one tick), recomputing once. */
  invalidateMany(rects:readonly CellRect[]){this.refresh(null,rects);}
  /** Integer cost-to-goal of the cell containing (x,y); UNREACHABLE when blocked, outside or no goal reachable. Goal cells cost 0. */
  costAt(x:number,y:number){return this.cellCost(Math.floor((x-this.originX)/this.cellSize),Math.floor((y-this.originY)/this.cellSize));}
  /** Cost by cell coordinates (same semantics). */
  cellCost(cx:number,cy:number){const i=this.cellIndex(cx,cy);if(i<0)return UNREACHABLE;this.ensure(i);const c=this.cost[i];return c===INF?UNREACHABLE:c;}
  /** True when the cell containing (x,y) is walkable and has a path to a goal. */
  reachable(x:number,y:number){return this.costAt(x,y)!==UNREACHABLE;}
  /** True when (x,y) lies in a goal cell. */
  atGoal(x:number,y:number){return this.costAt(x,y)===0;}
  /**
   * O(1), allocation-free when `out` is given. Unit vector toward the nearest goal, or (0,0) at a goal cell, when
   * unreachable or without goals. Outside positions clamp to the nearest edge cell. Blend of the 4 cell centers
   * around (x,y) with bilinear weights: each walkable reachable non-goal cell adds the unit vector from (x,y) to the
   * center of the cell it flows into (goal, blocked and unreachable cells are skipped); a degenerate blend falls back
   * to the containing cell's DIRS vector. Inside a blocked cell it returns that cell's DIRS vector: its cheapest legal
   * walkable neighbor, or the way out of a blocked area (see `nextCell`), so agents pushed into walls escape.
   */
  directionAt(x:number,y:number,out:FlowPoint={x:0,y:0}):FlowPoint{
    const w=this.width, h=this.height, {open,cost}=this;
    let gx=(x-this.originX)/this.cellSize, gy=(y-this.originY)/this.cellSize;
    if(gx!==gx||gy!==gy){out.x=0;out.y=0;return out;}
    gx=gx<0?0:gx>=w?w-1e-6:gx; gy=gy<0?0:gy>=h?h-1e-6:gy;
    const cx=gx|0, cy=gy|0, i=cx+cy*w, own=this.nextOf(i), c=cost[i]; // nextOf settles cell i
    if(!open[i]||c===0||c===INF||own<0){
      if(own<0){out.x=0;out.y=0;}else{out.x=VX[own];out.y=VY[own];}
      return out;
    }
    const bx=gx-.5, by=gy-.5, i0=Math.floor(bx), j0=Math.floor(by), fx=bx-i0, fy=by-j0;
    let sx=0, sy=0;
    for(let k=0;k<4;k++){
      const ii=i0+(k&1), jj=j0+(k>>1);
      if(ii<0||jj<0||ii>=w||jj>=h)continue;
      const j=ii+jj*w;
      if(!open[j])continue; // goal, blocked and unreachable cells are skipped
      const d=this.nextOf(j);
      if(d<0)continue;
      // Watershed: a neighbor flowing against this cell (equal costs, opposite exits) would cancel the blend and park the agent.
      if(VX[d]*VX[own]+VY[d]*VY[own]<0)continue;
      const wt=(k&1?fx:1-fx)*(k>>1?fy:1-fy);
      const tx=ii+DX[d]+.5-gx, ty=jj+DY[d]+.5-gy, tl=Math.sqrt(tx*tx+ty*ty)||1; // toward the next cell's center
      sx+=wt*tx/tl; sy+=wt*ty/tl;
    }
    const len=Math.sqrt(sx*sx+sy*sy);
    if(len<1e-6){out.x=VX[own];out.y=VY[own];}else{out.x=sx/len;out.y=sy/len;}
    return out;
  }
  /**
   * Neighbor index 0..7 (see DIRS) the cell points to, or -1 (goal, unreachable walkable cell, outside, or blocked
   * cell in a blocked region that touches no reachable cell). Blocked cells deep inside a blocked area point one
   * step closer (BFS layers, any of 8 directions) to a blocked cell with a legal exit.
   */
  nextCell(cx:number,cy:number){const i=this.cellIndex(cx,cy);return i<0?-1:this.nextOf(i);}

  private cellIndex(cx:number,cy:number){
    cx=Math.floor(cx); cy=Math.floor(cy);
    return cx>=0&&cy>=0&&cx<this.width&&cy<this.height?cx+cy*this.width:-1;
  }
  /** Re-read rects (pass 0), re-erode them grown by clearance (pass 1), refresh near flags grown by clearance+1 (pass 2), recompute once. */
  private refresh(one:CellRect|null,many:readonly CellRect[]|null){
    const w=this.width, h=this.height, c=this.clearance, m=one?1:many!.length;
    let hit=false;
    for(let p=0;p<3;p++){
      if(p===1&&!c)continue;
      const pad=p===0?0:p===1?c:c+1;
      for(let k=0;k<m;k++){
        const r=one??many![k];
        const x0=Math.max(0,Math.floor(Math.min(r.x0,r.x1))), x1=Math.min(w-1,Math.floor(Math.max(r.x0,r.x1)));
        const y0=Math.max(0,Math.floor(Math.min(r.y0,r.y1))), y1=Math.min(h-1,Math.floor(Math.max(r.y0,r.y1)));
        if(!(x0<=x1&&y0<=y1))continue; // rect entirely outside the grid: nothing to re-read
        hit=true;
        const ax=Math.max(0,x0-pad), ay=Math.max(0,y0-pad), bx=Math.min(w-1,x1+pad), by=Math.min(h-1,y1+pad);
        if(p===0)this.readCells(ax,ay,bx,by);else if(p===1)this.erode(ax,ay,bx,by);else this.readNear(ax,ay,bx,by);
      }
      if(!hit)return;
    }
    this.recompute();
  }
  private readCells(x0:number,y0:number,x1:number,y1:number){
    const {walk,grid,width:w}=this;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)walk[x+y*w]=grid.walkable(x,y)?1:0;
  }
  /** open = every cell within Chebyshev distance `clearance` walkable and in the grid. Separable; `cost` is scratch (recompute refills it). */
  private erode(x0:number,y0:number,x1:number,y1:number){
    const {walk,open,cost:tmp,width:w,height:h,clearance:c}=this;
    for(let y=Math.max(0,y0-c),ye=Math.min(h-1,y1+c);y<=ye;y++)for(let x=x0;x<=x1;x++){
      let ok=x>=c&&x+c<w?1:0;
      for(let k=x-c,i=k+y*w;ok&&k<=x+c;k++,i++)if(!walk[i])ok=0;
      tmp[x+y*w]=ok;
    }
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      let ok=y>=c&&y+c<h?1:0;
      for(let k=y-c;ok&&k<=y+c;k++)if(!tmp[x+k*w])ok=0;
      open[x+y*w]=ok;
    }
  }
  /** Near-wall flag (on eroded walkability): any 8-neighbor blocked or outside the grid. And the legal steps (see `legal`). */
  private readNear(x0:number,y0:number,x1:number,y1:number){
    const {open,near,legal,width:w,height:h}=this;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      let flag=x===0||y===0||x===w-1||y===h-1?1:0;
      for(let d=0;!flag&&d<8;d++)if(!open[x+DX[d]+(y+DY[d])*w])flag=1;
      near[x+y*w]=flag;
      let bits=0;
      for(let d=0;d<8;d++){
        const vx=x+DX[d], vy=y+DY[d];
        if(vx<0||vy<0||vx>=w||vy>=h||!open[vx+vy*w]||d>=4&&(!open[vx+y*w]||!open[x+vy*w]))continue; // no corner cutting
        bits|=1<<d;
      }
      legal[x+y*w]=bits;
    }
    this.compsDirty=true;
  }
  /** New goals or walkability: seed the active goals (cost 0) and mark their parts; the pass runs on demand (`ensure`). */
  private recompute(){
    const {open,cost,qNext,qPrev,heads,targets,comp,goalComp}=this;
    if(this.compsDirty)this.parts();
    cost.fill(INF); heads.fill(-1); this.next.fill(UNSET); this.escaped=false;
    this.ver++;
    // Part marks carry a 16-bit stamp per recompute; on wrap-around the old marks are cleared.
    const stamp=this.stamp=this.stamp===0xffff?1:this.stamp+1;
    if(stamp===1)goalComp.fill(0);
    let queued=0;
    for(let k=0;k<this.targetCount;k++){
      const i=targets[k];
      if(!open[i])continue; // stored but inactive while blocked
      cost[i]=0; const q=heads[0]; qNext[i]=q; qPrev[i]=-1; if(q>=0)qPrev[q]=i; heads[0]=i; queued++;
      goalComp[comp[i]]=stamp;
    }
    this.queued=queued; this.front=0;
  }
  /** Connected parts of the open cells over legal steps (symmetric), by BFS; qNext is free (called before seeding). */
  private parts(){
    const {open,legal,off,comp,qNext}=this, n=this.width*this.height;
    comp.fill(-1);
    let parts=0;
    for(let s=0;s<n;s++){
      if(!open[s]||comp[s]>=0)continue;
      comp[s]=parts; qNext[0]=s;
      for(let qa=0,qe=1;qa<qe;qa++){
        const u=qNext[qa];
        for(let m=legal[u];m!==0;m&=m-1){const v=u+off[31-Math.clz32(m&-m)];if(comp[v]<0){comp[v]=parts;qNext[qe++]=v;}}
      }
      parts++;
    }
    this.compsDirty=false;
  }
  /** Cell i's cost is final: blocked or in a part without a goal (unreachable), or the pass has gone past it. */
  private ensure(i:number){
    if(this.queued===0||this.cost[i]<this.front||!this.open[i]||this.goalComp[this.comp[i]]!==this.stamp)return;
    do this.settle(this.cost[i]===INF?this.front:this.cost[i]);while(this.queued>0&&this.cost[i]>=this.front);
  }
  /**
   * Dial's pass from `front` through bucket `until` (all of it with Infinity). The costs are the exact shortest
   * distances, whatever order equal-cost cells come out of a bucket, so the field is a pure function of goals and
   * walkability, and so is how far the pass has run when anything is read.
   */
  private settle(until:number){
    const {near,cost,legal,off,qNext,qPrev,heads,penalty}=this, ring=heads.length;
    let queued=this.queued, c=this.front;
    for(;queued>0&&c<=until;c++){
      const b=c%ring;
      for(let u=heads[b];u>=0;u=heads[b]){
        const q=qNext[u]; heads[b]=q; if(q>=0)qPrev[q]=-1; queued--;
        for(let m=legal[u];m!==0;m&=m-1){
          const d=31-Math.clz32(m&-m), v=u+off[d];
          const nc=c+DC[d]+(near[v]?penalty:0), old=cost[v];
          if(nc>=old)continue;
          if(old!==INF){ // still queued (settled cells can't improve): unlink from its bucket
            const p=qPrev[v], s=qNext[v];
            if(p<0)heads[old%ring]=s;else qNext[p]=s;
            if(s>=0)qPrev[s]=p;
          }else queued++;
          cost[v]=nc; const nb=nc%ring, hq=heads[nb]; qNext[v]=hq; qPrev[v]=-1; if(hq>=0)qPrev[hq]=v; heads[nb]=v;
        }
      }
    }
    this.queued=queued; this.front=c;
  }
  /**
   * The cell's `next`: its strictly cheapest legal neighbor (first in DIRS order on ties); else -1 for an open cell (a
   * goal, or unreachable), and for a blocked cell its way out through other blocked cells (`escape`).
   */
  private nextOf(i:number):number{
    const known=this.next[i];
    if(known!==UNSET)return known;
    const {cost,off,open}=this;
    // An open cell once settled: every neighbor cheaper than it is final. A blocked cell (cost INF): its neighbors.
    if(open[i])this.ensure(i);else for(let m=this.legal[i];m!==0;m&=m-1)this.ensure(i+off[31-Math.clz32(m&-m)]);
    let best=-1, bc=cost[i];
    for(let m=this.legal[i];m!==0;m&=m-1){const d=31-Math.clz32(m&-m), c=cost[i+off[d]];if(c<bc){best=d;bc=c;}}
    if(best<0&&!this.open[i]){this.escape();return this.next[i];}
    this.next[i]=best;
    return best;
  }
  /**
   * Every blocked cell's `next` (once per recompute, on the first ask for a blocked cell without a cheaper legal
   * neighbor; the pass is run out first): its cheapest legal walkable neighbor, else an escape BFS through blocked
   * cells, one layer at a time: a new cell points (first in DIRS order, any of 8 directions, no corner rule) at a
   * blocked cell of the previous layer. Layering makes cycles impossible. While its layer is open a cell holds -10-d
   * (d = best direction found so far, always < -1). qNext is free (the pass is over).
   */
  private escape(){
    if(this.escaped)return;
    this.escaped=true;
    if(this.queued>0)this.settle(Infinity);
    const {open,cost,legal,off,next,qNext,width:w,height:h}=this;
    let qe=0;
    for(let i=0,n=w*h;i<n;i++){
      if(open[i])continue;
      let best=-1, bc=cost[i];
      for(let m=legal[i];m!==0;m&=m-1){const d=31-Math.clz32(m&-m), c=cost[i+off[d]];if(c<bc){best=d;bc=c;}}
      next[i]=best;
      if(best>=0)qNext[qe++]=i;
    }
    for(let qa=0;qa<qe;){
      const lb=qe;
      for(let k=qa;k<lb;k++){
        const u=qNext[k], ux=u%w, uy=(u-ux)/w;
        for(let d=0;d<8;d++){
          const vx=ux+DX[d], vy=uy+DY[d];
          if(vx<0||vy<0||vx>=w||vy>=h)continue;
          const v=vx+vy*w, m=next[v];
          if(m>=0||open[v])continue;
          if(m===-1)qNext[qe++]=v;else if(-10-m<=OPP[d])continue;
          next[v]=-10-OPP[d];
        }
      }
      for(let k=lb;k<qe;k++){const v=qNext[k];next[v]=-10-next[v];}
      qa=lb;
    }
  }
}
