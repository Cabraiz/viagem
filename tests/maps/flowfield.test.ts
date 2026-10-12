import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowField,DIRS,STRAIGHT_COST,DIAGONAL_COST,UNREACHABLE,type CellRect,type FlowFieldOptions,type FlowGrid,type FlowPoint} from '../../src/maps/flowfield.ts';

// ---------- helpers (black box: everything below is derived from the contract only) ----------
const D8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
interface TestMap {w:number;h:number;cs:number;ox:number;oy:number;open:Uint8Array;grid:FlowGrid;goals:FlowPoint[];goalCells:number[];reads:{n:number}}
const mk=(w:number,h:number,cs:number,open:Uint8Array,goalCells:number[],ox=0,oy=0):TestMap=>{
  const reads={n:0};
  const walkable=(x:number,y:number)=>{
    // Contract: only called with integer in-range cells.
    if(!(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<w&&y<h))throw new Error(`walkable(${x},${y}) out of range`);
    reads.n++;return open[y*w+x]===1;
  };
  const grid:FlowGrid=ox||oy?{width:w,height:h,cellSize:cs,originX:ox,originY:oy,walkable}:{width:w,height:h,cellSize:cs,walkable};
  return {w,h,cs,ox,oy,open,grid,goalCells,reads,goals:goalCells.map(i=>({x:ox+(i%w+.5)*cs,y:oy+(Math.floor(i/w)+.5)*cs}))};
};
/** '#' blocked, '.' walkable, 'G' walkable goal (goal point = cell center). */
const ascii=(rows:string[],cs=1,ox=0,oy=0)=>{
  const h=rows.length,w=rows[0].length,open=new Uint8Array(w*h),goals:number[]=[];
  rows.forEach((r,y)=>{assert.equal(r.length,w,`row ${y} width`);for(let x=0;x<w;x++){open[y*w+x]=r[x]==='#'?0:1;if(r[x]==='G')goals.push(y*w+x);}});
  return mk(w,h,cs,open,goals,ox,oy);
};
const ctr=(m:TestMap,cx:number,cy:number):FlowPoint=>({x:m.ox+(cx+.5)*m.cs,y:m.oy+(cy+.5)*m.cs});
const unit=(k:number)=>{const [dx,dy]=D8[k],l=Math.hypot(dx,dy);return {x:dx/l,y:dy/l};};
/** Unit vector from world point q to the center of the cell DIRS[k] away from cell (cx,cy). */
const towardCenter=(m:TestMap,cx:number,cy:number,k:number,q:FlowPoint)=>{const c=ctr(m,cx+D8[k][0],cy+D8[k][1]),dx=c.x-q.x,dy=c.y-q.y,l=Math.hypot(dx,dy);return {x:dx/l,y:dy/l};};
const zero=(p:FlowPoint)=>p.x===0&&p.y===0;
const near=(p:FlowPoint,q:FlowPoint,eps=1e-9)=>Math.abs(p.x-q.x)<=eps&&Math.abs(p.y-q.y)<=eps;
const isOpen=(m:TestMap,x:number,y:number)=>x>=0&&y>=0&&x<m.w&&y<m.h&&m.open[y*m.w+x]===1;
/** Legal move from (x,y) along DIRS[k]: target walkable and, for diagonals, both orthogonals walkable (no corner cutting). */
const legal=(m:TestMap,x:number,y:number,k:number)=>{const [dx,dy]=D8[k];return isOpen(m,x+dx,y+dy)&&(k<4||(isOpen(m,x+dx,y)&&isOpen(m,x,y+dy)));};
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};
const median=(a:number[])=>{const s=[...a].sort((p,q)=>p-q),n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;};

/** The map as a field with `clearance` c sees it: a cell stays open only if every cell within Chebyshev distance c is open and inside the grid. */
const eroded=(m:TestMap,c:number):TestMap=>{
  const open=new Uint8Array(m.w*m.h);
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){let ok=1;for(let dy=-c;ok&&dy<=c;dy++)for(let dx=-c;ok&&dx<=c;dx++)if(!isOpen(m,x+dx,y+dy))ok=0;open[y*m.w+x]=ok;}
  return {...m,open};
};
/**
 * Reference multi-source Dijkstra on a binary heap: straight 10, diagonal 14, no corner cutting, plus `pen` when entering a
 * near-wall cell (any 8-neighbor blocked or outside the grid). Goal cells that are not open are inactive.
 */
const refCosts=(m:TestMap,goalCells=m.goalCells,pen=0)=>{
  const {w,h}=m,cost=new Float64Array(w*h).fill(Infinity),heap:[number,number][]=[];
  const push=(c:number,i:number)=>{heap.push([c,i]);for(let k=heap.length-1;k>0;){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
  const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;for(let k=0;;){const l=2*k+1,r=l+1;let s=k;if(l<heap.length&&heap[l][0]<heap[s][0])s=l;if(r<heap.length&&heap[r][0]<heap[s][0])s=r;if(s===k)break;[heap[s],heap[k]]=[heap[k],heap[s]];k=s;}}return top;};
  const nearWall=(x:number,y:number)=>D8.some(([dx,dy])=>!isOpen(m,x+dx,y+dy));
  for(const i of goalCells)if(m.open[i]&&cost[i]!==0){cost[i]=0;push(0,i);}
  while(heap.length){
    const [c,i]=pop();if(c!==cost[i])continue;const x=i%w,y=(i-x)/w;
    for(let k=0;k<8;k++){if(!legal(m,x,y,k))continue;const vx=x+D8[k][0],vy=y+D8[k][1],j=vy*w+vx,nc=c+(k<4?10:14)+(nearWall(vx,vy)?pen:0);if(nc<cost[j]){cost[j]=nc;push(nc,j);}}
  }
  return cost;
};
const sameCosts=(f:FlowField,ref:Float64Array,m:TestMap,msg:string)=>{
  for(let i=0;i<m.w*m.h;i++){const got=f.cellCost(i%m.w,Math.floor(i/m.w)),want=ref[i]===Infinity?UNREACHABLE:ref[i];if(got!==want)assert.fail(`${msg}: cost (${i%m.w},${Math.floor(i/m.w)}) ${got} vs reference ${want}`);}
};
/** Every walkable reachable non-goal cell steps legally to a strictly cheaper cell (so nextCell can never cycle); goal/unreachable cells have -1. */
const checkDescent=(f:FlowField,m:TestMap,label:string)=>{
  let n=0;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    if(!isOpen(m,x,y))continue;
    const c=f.cellCost(x,y),k=f.nextCell(x,y);
    if(c===UNREACHABLE||c===0){if(k!==-1)assert.fail(`${label}: (${x},${y}) cost ${c} has next ${k}`);continue;}
    if(!(k>=0&&legal(m,x,y,k)))assert.fail(`${label}: (${x},${y}) next ${k} is not a legal move`);
    const nc=f.cellCost(x+D8[k][0],y+D8[k][1]);if(!(nc<c))assert.fail(`${label}: (${x},${y}) cost ${c} -> ${nc}`);
    n++;
  }
  return n;
};
const dump=(f:FlowField,m:TestMap)=>{const c:number[]=[],n:number[]=[];for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){c.push(f.cellCost(x,y));n.push(f.nextCell(x,y));}return {c,n};};
const sameField=(a:{c:number[];n:number[]},b:{c:number[];n:number[]},w:number,msg:string)=>{
  for(let i=0;i<a.c.length;i++)if(a.c[i]!==b.c[i]||a.n[i]!==b.n[i])assert.fail(`${msg}: cell (${i%w},${Math.floor(i/w)}) cost ${a.c[i]} vs ${b.c[i]}, next ${a.n[i]} vs ${b.n[i]}`);
};
/** Does an agent's bounding square (half-size r) at world (x,y) overlap a blocked or outside cell? */
const overlaps=(m:TestMap,x:number,y:number,r:number)=>{
  const x0=Math.floor((x-r-m.ox)/m.cs),x1=Math.ceil((x+r-m.ox)/m.cs)-1,y0=Math.floor((y-r-m.oy)/m.cs),y1=Math.ceil((y+r-m.oy)/m.cs)-1;
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++)if(!isOpen(m,cx,cy))return true;
  return false;
};
/** Moves by directionAt with axis-separated collision; stops at a goal cell. */
const walk=(f:FlowField,m:TestMap,x:number,y:number,r:number,step:number,max:number,onStep?:(x:number,y:number,d:FlowPoint)=>void)=>{
  const d={x:0,y:0};
  for(let i=0;i<max;i++){
    if(f.atGoal(x,y))return {steps:i,arrived:true,x,y};
    f.directionAt(x,y,d);onStep?.(x,y,d);
    const nx=x+d.x*step;if(!overlaps(m,nx,y,r))x=nx;
    const ny=y+d.y*step;if(!overlaps(m,x,ny,r))y=ny;
  }
  return {steps:max,arrived:f.atGoal(x,y),x,y};
};
/**
 * Spawns agents uniformly anywhere on the map (re-drawing spots whose box of half-size radius*cellSize overlaps a wall or
 * whose cell is unreachable), walks each at 0.09 cell/tick with a budget of 3x its cost in steps, records the stuck ones.
 */
const crowd=(f:FlowField,m:TestMap,radius:number,agents:number,rnd:()=>number,label:string,stuck:string[])=>{
  const r=radius*m.cs,step=.09*m.cs;let walked=0,maxTicks=0;
  for(let a=0;a<agents;a++){
    let x=0,y=0,t=0;
    do{x=m.ox+rnd()*m.w*m.cs;y=m.oy+rnd()*m.h*m.cs;t++;}while((overlaps(m,x,y,r)||!f.reachable(x,y))&&t<1000);
    if(t>=1000)continue;
    const cost=f.costAt(x,y),budget=Math.ceil(cost/10/.09*3)+200,res=walk(f,m,x,y,r,step,budget);walked++;
    if(res.arrived)maxTicks=Math.max(maxTicks,res.steps);
    else if(stuck.length<12)stuck.push(`${label} r=${radius} start (${((x-m.ox)/m.cs).toFixed(3)},${((y-m.oy)/m.cs).toFixed(3)}) cost ${cost} -> stuck at (${((res.x-m.ox)/m.cs).toFixed(3)},${((res.y-m.oy)/m.cs).toFixed(3)}) cells, cell cost ${f.costAt(res.x,res.y)}`);
    else stuck.push(label);
  }
  return {walked,maxTicks};
};

/** Deterministic 192x192 city: outer wall ring, rectangular blocks, 2-6 cell streets, 1-cell alleys, central plaza goal. */
interface City extends TestMap {alleys:{x0:number;x1:number;y:number}[];deadEnds:{x0:number;x1:number;y:number}[];cols:[number,number][];rows:[number,number][]}
const city=(seed=20261012):City=>{
  const W=192,H=192,rnd=lcg(seed),ri=(a:number,b:number)=>a+Math.floor(rnd()*(b-a+1)),open=new Uint8Array(W*H).fill(1);
  const fill=(x0:number,y0:number,x1:number,y1:number,v:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)open[y*W+x]=v;};
  const spans=()=>{const out:[number,number][]=[];for(let p=1+ri(2,6);;){const len=ri(6,16);if(p+len-1>W-4)break;out.push([p,p+len-1]);p+=len+ri(2,6);}return out;};
  const cols=spans(),rows=spans(),alleys:City['alleys']=[],deadEnds:City['deadEnds']=[];
  const offPlaza=(x0:number,x1:number,y0:number,y1:number)=>x1<84||x0>108||y1<84||y0>108;
  for(const [y0,y1] of rows)for(const [x0,x1] of cols){
    fill(x0,y0,x1,y1,0);const r=rnd();
    if(r<.12){const y=ri(y0+2,y1-2);fill(x0,y,x1,y,1);if(offPlaza(x0,x1,y0,y1))alleys.push({x0,x1,y});} // horizontal through alley
    else if(r<.2){const x=ri(x0+2,x1-2);fill(x,y0,x,y1,1);} // vertical through alley
    else if(r<.27){const y=ri(y0+2,y1-2),xe=x0+((x1-x0)>>1);fill(x0,y,xe,y,1);if(offPlaza(x0,x1,y0,y1))deadEnds.push({x0,x1:xe,y});} // dead-end alley
  }
  fill(88,88,104,104,1); // central plaza
  fill(0,0,W-1,0,0);fill(0,H-1,W-1,H-1,0);fill(0,0,0,H-1,0);fill(W-1,0,W-1,H-1,0); // outer wall ring
  return {...mk(W,H,.88,open,[96*W+96]),alleys,deadEnds,cols,rows};
};
/** Seeded noise map (like the reviewer's fuzz.ts): each cell blocked with probability p, goal in the middle. */
const noiseMap=(seed:number,W=40,p=.28)=>{const r=lcg(seed),open=new Uint8Array(W*W);for(let i=0;i<W*W;i++)open[i]=r()<p?0:1;const g=(W>>1)*W+(W>>1);open[g]=1;return mk(W,W,1,open,[g]);};
/** Seeded room map (like fuzz.ts): scattered 1x1..4x4 blocked rectangles, goal in the middle. */
const roomsMap=(seed:number,W=48)=>{
  const r=lcg(seed),open=new Uint8Array(W*W).fill(1);
  for(let k=0;k<W*W/40;k++){const x=Math.floor(r()*W),y=Math.floor(r()*W),a=1+Math.floor(r()*4),b=1+Math.floor(r()*4);for(let yy=y;yy<Math.min(W,y+b);yy++)for(let xx=x;xx<Math.min(W,x+a);xx++)open[yy*W+xx]=0;}
  const g=(W>>1)*W+(W>>1);open[g]=1;return mk(W,W,1,open,[g]);
};

// ---------- tests ----------
test('1. costs follow the 10/14 metric from the goal; default wall penalty makes wall-hugging cells cost more',()=>{
  assert.equal(STRAIGHT_COST,10);assert.equal(DIAGONAL_COST,14);assert.equal(UNREACHABLE,0xffffffff);
  assert.deepEqual(DIRS.map(d=>[d.dx,d.dy]),D8);
  // Open 9x9 field, goal in the middle.
  const o=ascii(['.........','.........','.........','.........','....G....','.........','.........','.........','.........']);
  const f0=new FlowField(o.grid,o.goals,{wallPenalty:0}),fd=new FlowField(o.grid,o.goals);
  assert.equal(f0.width,9);assert.equal(f0.height,9);assert.equal(f0.cellSize,1);assert.equal(f0.originX,0);assert.equal(f0.originY,0);
  assert.equal(f0.cellCost(4,4),0);assert.equal(f0.cellCost(5,4),10);assert.equal(f0.cellCost(5,5),14);assert.equal(f0.cellCost(7,5),34);assert.equal(f0.cellCost(0,0),56);
  for(let y=0;y<9;y++)for(let x=0;x<9;x++){
    const dx=Math.abs(x-4),dy=Math.abs(y-4),oct=14*Math.min(dx,dy)+10*(Math.max(dx,dy)-Math.min(dx,dy));
    assert.equal(f0.cellCost(x,y),oct,`octile (${x},${y})`);
    assert.equal(f0.costAt(x+.5,y+.5),oct);
    const interior=x>0&&y>0&&x<8&&y<8,cd=fd.cellCost(x,y);
    if(interior)assert.equal(cd,oct,`default penalty leaves open interior (${x},${y}) untouched`);else assert.ok(cd>=oct,`penalty never lowers cost (${x},${y})`);
  }
  assert.ok(f0.atGoal(4.5,4.5));assert.ok(!f0.atGoal(5.5,4.5));
  assert.ok(near(f0.directionAt(6.5,4.5),{x:-1,y:0}),'east of goal points west');
  assert.ok(near(f0.directionAt(6.5,6.5),{x:-Math.SQRT1_2,y:-Math.SQRT1_2},1e-6),'diagonal points NW');
  assert.ok(near(f0.directionAt(4.5,4.5),{x:0,y:0}),'goal cell has zero vector');
  // Straight 1-wide corridor with a world origin offset: every corridor cell touches a wall.
  const c=ascii(['###########','#G........#','###########'],.5,-10,5);
  const c0=new FlowField(c.grid,c.goals,{wallPenalty:0}),cd=new FlowField(c.grid,c.goals);
  assert.equal(cd.originX,-10);assert.equal(cd.originY,5);assert.equal(cd.cellSize,.5);
  for(let k=1;k<=9;k++){
    const p=ctr(c,k,1);
    assert.equal(c0.cellCost(k,1),10*(k-1));assert.equal(c0.costAt(p.x,p.y),10*(k-1));
    assert.equal(cd.cellCost(k,1),14*(k-1),'default wallPenalty 4 on every step into a wall-hugging cell');
    if(k>1)assert.ok(near(cd.directionAt(p.x,p.y),{x:-1,y:0}));
  }
  assert.ok(cd.atGoal(ctr(c,1,1).x,ctr(c,1,1).y));
  assert.equal(cd.costAt(-10.01,5.75),UNREACHABLE,'outside the grid has no cost');
  // Whole city against the reference Dijkstra (no penalty).
  const m=city();sameCosts(new FlowField(m.grid,m.goals,{wallPenalty:0}),refCosts(m),m,'city');
});

test('2. no corner cutting: never a diagonal past a blocked orthogonal',()=>{
  const m=ascii(['.....','.G#..','.#...','.....','.....']);
  const f=new FlowField(m.grid,m.goals,{wallPenalty:0});
  assert.equal(f.cellCost(2,2),60,'(2,2) must walk around the blocked L, not cut to the goal (would be 14)');
  assert.ok([0,2].includes(f.nextCell(2,2)),`(2,2) next ${f.nextCell(2,2)} should be E or S`);
  assert.equal(f.cellCost(0,2),20);assert.equal(f.cellCost(2,0),20);
  const check=(m:TestMap,f:FlowField,label:string)=>{
    let diag=0;
    for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){const k=f.nextCell(x,y);if(k<0)continue;
      const [dx,dy]=D8[k];
      if(!isOpen(m,x+dx,y+dy)){ // only blocked cells may step into blocked cells (escape from deep inside a wall)
        if(isOpen(m,x,y))assert.fail(`${label}: walkable (${x},${y}) next ${k} points into a wall`);continue;}
      if(k>=4)diag++;
      if(!legal(m,x,y,k))assert.fail(`${label}: (${x},${y}) next ${k} cuts a corner`);}
    return diag;
  };
  check(m,f,'L');check(m,new FlowField(m.grid,m.goals),'L default');
  const c=city();
  assert.ok(check(c,new FlowField(c.grid,c.goals),'city')>100,'diagonals are still used in open areas');
});

const MAZE=[
  '###############',
  '#G#...#...#...#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#.#.#.#.#.#.#.#',
  '#...#...#...#.#',
  '###############'];
test('3. maze: one long winding path, walker reaches the goal, cost strictly decreases',()=>{
  const m=ascii(MAZE),f0=new FlowField(m.grid,m.goals,{wallPenalty:0}),f=new FlowField(m.grid,m.goals);
  let walkable=0;for(const v of m.open)walkable+=v;
  assert.equal(walkable,69);
  assert.equal(f0.cellCost(13,9),680,'68 straight steps');assert.equal(f.cellCost(13,9),68*14,'every maze cell touches a wall');
  sameCosts(f0,refCosts(m),m,'maze');sameCosts(f,refCosts(m,m.goalCells,4),m,'maze default penalty');
  // nextCell chain from the far end visits every cell once.
  let x=13,y=9,n=0;const seen=new Set<number>();
  while(f.nextCell(x,y)>=0){seen.add(y*m.w+x);const k=f.nextCell(x,y),nx=x+D8[k][0],ny=y+D8[k][1];assert.ok(f.cellCost(nx,ny)<f.cellCost(x,y));x=nx;y=ny;n++;}
  assert.equal(n,68);assert.equal(x,1);assert.equal(y,1);assert.equal(seen.size,68);
  // Walker with collision.
  const cells:number[]=[];
  const r=walk(f,m,13.5,9.5,.25,.1,68*10*2,(px,py)=>{const i=Math.floor(py)*m.w+Math.floor(px);if(cells[cells.length-1]!==i)cells.push(i);});
  assert.ok(r.arrived,`walker stuck at (${r.x.toFixed(2)},${r.y.toFixed(2)}) after ${r.steps} steps`);
  for(let i=1;i<cells.length;i++){const a=f.cellCost(cells[i-1]%m.w,Math.floor(cells[i-1]/m.w)),b=f.cellCost(cells[i]%m.w,Math.floor(cells[i]/m.w));assert.ok(b<a,`cost went ${a} -> ${b} along the walk`);}
});

test('4. unreachable pocket, blocked cells and outside positions',()=>{
  const m=ascii(['#########','#G..#...#','#...#.#.#','#...#...#','#########']);
  const f=new FlowField(m.grid,m.goals);
  for(const [x,y] of [[5,1],[7,3],[5,3]]){
    const p=ctr(m,x,y);
    assert.equal(f.cellCost(x,y),UNREACHABLE);assert.equal(f.costAt(p.x,p.y),UNREACHABLE);
    assert.equal(f.reachable(p.x,p.y),false);assert.equal(f.atGoal(p.x,p.y),false);
    assert.ok(zero(f.directionAt(p.x,p.y)));assert.equal(f.nextCell(x,y),-1);
  }
  assert.ok(f.reachable(3.5,3.5));assert.notEqual(f.cellCost(3,3),UNREACHABLE);
  // Blocked cells: never a cost; a wall touching reachable ground escapes through a legal move.
  assert.equal(f.cellCost(4,2),UNREACHABLE);assert.equal(f.reachable(4.5,2.5),false);
  assert.equal(f.nextCell(4,2),1,'wall between region and pocket escapes west (diagonals cut corners, east is unreachable)');
  assert.ok(near(f.directionAt(4.5,2.5),{x:-1,y:0}));
  // A blocked cell whose blocked region touches no walkable reachable cell keeps -1 / (0,0).
  assert.equal(f.nextCell(6,2),-1,'isolated blocked cell surrounded only by the unreachable pocket');assert.ok(zero(f.directionAt(6.5,2.5)));
  // A wall cell with no legal walkable exit of its own steps through the wall toward one that has an exit.
  const k00=f.nextCell(0,0);
  assert.ok([0,2].includes(k00),`corner wall (0,0) only reaches the goal through the walls (1,0)/(0,1), next ${k00}`);
  assert.ok(near(f.directionAt(.5,.5),unit(k00)),'corner wall direction');
  const k82=f.nextCell(8,2);
  assert.ok([2,3].includes(k82),`(8,2) borders only the pocket: it follows the outer wall ring (N or S), next ${k82}`);
  // Outside: costs are UNREACHABLE, directions clamp to the edge cell.
  assert.equal(f.costAt(-3,2.5),UNREACHABLE);assert.equal(f.reachable(-3,2.5),false);assert.equal(f.atGoal(-3,1.5),false);
  assert.ok(near(f.directionAt(-3,2.5),{x:1,y:0}),'left of the grid clamps to blocked (0,2), which escapes east');
  assert.ok(near(f.directionAt(100,2.5),unit(k82)),'right of the grid clamps to blocked (8,2)');
  const o=ascii(['G.....']),fo=new FlowField(o.grid,o.goals);
  assert.ok(near(fo.directionAt(50,.5),{x:-1,y:0}));
  for(const [qy,ey] of [[-20,0],[20,1-1e-9]]){
    const d=fo.directionAt(3.5,qy);
    assert.ok(near(d,fo.directionAt(3.5,ey),1e-4),`(3.5,${qy}) clamps onto the edge of cell (3,0)`);
    assert.ok(d.x<-.8,`(3.5,${qy}) heads west: ${d.x.toFixed(3)},${d.y.toFixed(3)}`);
  }
  assert.ok(zero(fo.directionAt(-9,.5)),'clamped onto the goal cell');
  assert.equal(fo.costAt(50,.5),UNREACHABLE);assert.equal(fo.costAt(3.5,-.01),UNREACHABLE);
});

test('5. two goals: cost is the min of each single-goal field, cells flow to the nearer goal; setTargets([]) clears; blocked targets wait inactive',()=>{
  const m=ascii([
    '.....................',
    '.....................',
    '..........#..........',
    '..........#..........',
    '..........#..........',
    '..G.......#.......G..',
    '..........#..........',
    '...#####..#..........',
    '..........#..........',
    '.....................',
    '.....................']);
  assert.equal(m.goals.length,2);
  const [a,b]=m.goals,fa=new FlowField(m.grid,[a]),fb=new FlowField(m.grid,[b]),f=new FlowField(m.grid,[a,b]);
  const ga=m.goalCells[0],gb=m.goalCells[1];let toA=0,toB=0;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    const ca=fa.cellCost(x,y),cb=fb.cellCost(x,y),c=f.cellCost(x,y);
    assert.equal(c,Math.min(ca,cb),`(${x},${y})`);
    if(c===UNREACHABLE||c===0)continue;
    let cx=x,cy=y;for(let k=f.nextCell(cx,cy);k>=0;k=f.nextCell(cx,cy)){cx+=D8[k][0];cy+=D8[k][1];}
    const end=cy*m.w+cx;assert.ok(end===ga||end===gb);
    if(ca<cb){assert.equal(end,ga,`(${x},${y}) flows to the farther goal`);toA++;}
    if(cb<ca){assert.equal(end,gb,`(${x},${y}) flows to the farther goal`);toB++;}
  }
  assert.ok(toA>20&&toB>20);
  assert.ok(f.atGoal(a.x,a.y)&&f.atGoal(b.x,b.y));
  const v=f.version;f.setTargets([]);assert.equal(f.version,v+1);
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){assert.equal(f.cellCost(x,y),UNREACHABLE);assert.equal(f.nextCell(x,y),-1);}
  assert.ok(zero(f.directionAt(5.5,5.5)));assert.equal(f.reachable(5.5,5.5),false);assert.equal(f.atGoal(a.x,a.y),false);
  f.setTargets([{x:3.5,y:7.5},{x:-4,y:2},{x:50,y:50}]); // a blocked cell (stored, inactive) and two outside points
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)assert.equal(f.cellCost(x,y),UNREACHABLE);
  // Opening the blocked target cell activates it; closing it again deactivates it.
  m.open[7*m.w+3]=1;f.invalidate({x0:3,y0:7,x1:3,y1:7});
  assert.equal(f.cellCost(3,7),0,'blocked target becomes a goal once invalidate opens its cell');
  sameField(dump(f,m),dump(new FlowField(m.grid,[{x:3.5,y:7.5}]),m),m.w,'activated target vs fresh');
  m.open[7*m.w+3]=0;f.invalidate({x0:3,y0:7,x1:3,y1:7});
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)assert.equal(f.cellCost(x,y),UNREACHABLE);
  f.setTargets([a]);sameField(dump(f,m),dump(fa,m),m.w,'setTargets([a]) vs fresh');
});

test('6. no cycles: every reachable cell of the city follows nextCell to a goal with strictly decreasing cost',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals);
  let cells=0,steps=0,longest=0;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    if(!isOpen(m,x,y)){assert.equal(f.cellCost(x,y),UNREACHABLE);continue;}
    let c=f.cellCost(x,y);assert.notEqual(c,UNREACHABLE,`generator: walkable (${x},${y}) should be reachable`);
    if(c===0){assert.ok(m.goalCells.includes(y*m.w+x));assert.equal(f.nextCell(x,y),-1);continue;}
    let cx=x,cy=y,n=0;cells++;
    for(let k=f.nextCell(cx,cy);k>=0;k=f.nextCell(cx,cy)){
      if(!legal(m,cx,cy,k))assert.fail(`illegal step from (${cx},${cy}) dir ${k}`);
      cx+=D8[k][0];cy+=D8[k][1];const nc=f.cellCost(cx,cy);
      if(!(nc<c))assert.fail(`chain from (${x},${y}): cost ${c} -> ${nc} at (${cx},${cy})`);
      c=nc;n++;
    }
    assert.equal(c,0,`chain from (${x},${y}) stopped at non-goal (${cx},${cy})`);assert.ok(m.goalCells.includes(cy*m.w+cx));
    steps+=n;if(n>longest)longest=n;
  }
  assert.ok(cells>15000,`city has ${cells} walkable cells`);
  console.log(`[info] city: ${cells} chains, ${steps} steps, longest ${longest}`);
});

test('7. determinism: same inputs give identical fields; version bumps on every recompute',()=>{
  const m=city(),g2={x:20.5*m.cs,y:170.5*m.cs};
  assert.ok(isOpen(m,20,170),'second goal on a street');
  const a=new FlowField(m.grid,[m.goals[0],g2]),b=new FlowField(m.grid,[m.goals[0],g2]),c=new FlowField(m.grid,[g2,m.goals[0]]);
  const da=dump(a,m);sameField(da,dump(b,m),m.w,'same inputs');sameField(da,dump(c,m),m.w,'target order');
  const rnd=lcg(7),pa={x:0,y:0},pb={x:0,y:0},W=m.w*m.cs;
  for(let i=0;i<3000;i++){
    const x=rnd()*(W+4)-2,y=rnd()*(W+4)-2;
    assert.equal(a.directionAt(x,y,pa),pa,'returns `out` when given');b.directionAt(x,y,pb);
    assert.ok(pa.x===pb.x&&pa.y===pb.y,`directionAt(${x},${y}) differs`);
    const l=Math.hypot(pa.x,pa.y);assert.ok(l===0||Math.abs(l-1)<1e-9,`not a unit vector: ${l}`);
    const fresh=a.directionAt(x,y);assert.ok(fresh.x===pa.x&&fresh.y===pa.y);
  }
  assert.equal(a.version,1);
  a.setTargets([m.goals[0]]);assert.equal(a.version,2);
  a.invalidate({x0:10,y0:10,x1:12,y1:12});assert.equal(a.version,3);
  a.setTargets([m.goals[0],g2]);assert.equal(a.version,4);sameField(dump(a,m),da,m.w,'after setTargets back');
});

test('8. invalidate: a barricade reroutes paths, reopening restores the original field exactly',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals),fresh=()=>dump(new FlowField(m.grid,m.goals),m);
  assert.ok(m.reads.n<=m.w*m.h,`constructor read walkable ${m.reads.n} times`);
  const orig=dump(f,m),idx=(x:number,y:number)=>y*m.w+x;
  const setCells=(x0:number,y0:number,x1:number,y1:number,v:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)m.open[idx(x,y)]=v;};
  const inval=(x0:number,y0:number,x1:number,y1:number)=>{const v=f.version;m.reads.n=0;f.invalidate({x0,y0,x1,y1});assert.equal(f.version,v+1);
    assert.ok(m.reads.n<=(x1-x0+5)*(y1-y0+5),`invalidate read walkable ${m.reads.n} times for a ${x1-x0+1}x${y1-y0+1} rect`);};
  // (a) Through alley: block the alley cell next to its cheaper end.
  const al=m.alleys[0];assert.ok(al,'generator made a through alley');
  const left=orig.c[idx(al.x0,al.y)]<=orig.c[idx(al.x1,al.y)],bx=left?al.x0+1:al.x1-1,step=left?1:-1,behind=bx+step;
  const towardBarricade=left?1:0; // DIRS index pointing from `behind` to the barricade (W=1 when left, E=0 when right)
  assert.equal(orig.n[idx(behind,al.y)],towardBarricade,'the cell behind relied on the barricade cell');
  setCells(bx,al.y,bx,al.y,0);inval(bx,al.y,bx,al.y);
  let s=dump(f,m);sameField(s,fresh(),m.w,'alley barricade vs fresh');
  assert.equal(s.c[idx(bx,al.y)],UNREACHABLE);
  assert.ok(s.c[idx(behind,al.y)]>orig.c[idx(behind,al.y)],'cost behind the barricade increases');
  assert.equal(s.n[idx(behind,al.y)],1-towardBarricade,'the cell behind now flows the other way');
  for(let i=0;i<s.c.length;i++){
    assert.ok(s.c[i]>=orig.c[i]||orig.c[i]===UNREACHABLE);const k=s.n[i];
    if(k>=0&&m.open[i])assert.notEqual(idx(i%m.w+D8[k][0],Math.floor(i/m.w)+D8[k][1]),idx(bx,al.y),'no walkable cell points into the barricade');
  }
  setCells(bx,al.y,bx,al.y,1);inval(bx,al.y,bx,al.y);sameField(dump(f,m),orig,m.w,'alley reopened');
  // (b) Dead-end alley: block its mouth, the interior becomes unreachable.
  const de=m.deadEnds[0];assert.ok(de,'generator made a dead-end alley');
  assert.notEqual(orig.c[idx(de.x1,de.y)],UNREACHABLE);
  setCells(de.x0,de.y,de.x0,de.y,0);inval(de.x0,de.y,de.x0,de.y);
  s=dump(f,m);sameField(s,fresh(),m.w,'dead-end barricade vs fresh');
  for(let x=de.x0+1;x<=de.x1;x++){const p=ctr(m,x,de.y);assert.equal(s.c[idx(x,de.y)],UNREACHABLE);assert.equal(s.n[idx(x,de.y)],-1);assert.equal(f.reachable(p.x,p.y),false);assert.ok(zero(f.directionAt(p.x,p.y)));}
  assert.equal(s.n[idx(de.x0,de.y)],1,'the barricade cell itself escapes west to the street');
  // (c) 3x3 barricade across a street, on top of (b).
  const sx=m.cols[1][1]+1,sy=(m.rows[1][0]+m.rows[1][1])>>1,saved:number[]=[];
  for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)saved.push(m.open[idx(x,y)]);
  const before=s;setCells(sx,sy-1,sx+2,sy+1,0);inval(sx,sy-1,sx+2,sy+1);
  s=dump(f,m);sameField(s,fresh(),m.w,'street barricade vs fresh');
  let up=0;for(let i=0;i<s.c.length;i++){assert.ok(s.c[i]>=before.c[i]||before.c[i]===UNREACHABLE);if(s.c[i]>before.c[i]&&s.c[i]!==UNREACHABLE)up++;}
  assert.ok(up>0,'some costs increase behind the street barricade');
  // Reopen everything.
  let j=0;for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)m.open[idx(x,y)]=saved[j++];
  inval(sx,sy-1,sx+2,sy+1);setCells(de.x0,de.y,de.x0,de.y,1);inval(de.x0,de.y,de.x0,de.y);
  s=dump(f,m);sameField(s,orig,m.w,'reopened vs original');sameField(s,fresh(),m.w,'reopened vs fresh');
});

test('9. agents spawned anywhere inside a cell (radius 0.25 and 0.45 cell) follow directionAt with axis-separated collision to the goal: city, noise and room maps, 0 stuck',()=>{
  const stuck:string[]=[];let walked=0,maxTicks=0;
  const add=(r:{walked:number;maxTicks:number})=>{walked+=r.walked;maxTicks=Math.max(maxTicks,r.maxTicks);};
  const m=city(),f=new FlowField(m.grid,m.goals),rc=lcg(99);
  for(const r of [.25,.45])add(crowd(f,m,r,300,rc,'city',stuck));
  // Same maps, spawn sequence and walker as the reviewer's fuzz.ts (axis mode).
  for(let s=1;s<=20;s++){const n=noiseMap(s),fn=new FlowField(n.grid,n.goals),rn=lcg(s*77);for(const r of [.25,.45])add(crowd(fn,n,r,150,rn,`noise#${s}`,stuck));}
  for(let s=1;s<=10;s++){const n=roomsMap(s),fn=new FlowField(n.grid,n.goals),rn=lcg(s*77);for(const r of [.25,.45])add(crowd(fn,n,r,150,rn,`rooms#${s}`,stuck));}
  console.log(`[info] agents: ${walked} walked, max ticks used ${maxTicks}, stuck ${stuck.length}`);
  assert.ok(walked>9000,`only ${walked} agents could be spawned`);
  assert.deepEqual(stuck,[]);
});

test('10. inside a blocked cell: walls touching walkable ground escape to their lowest-cost legal neighbor, deeper wall cells step toward the nearest such wall',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals),rnd=lcg(5),N=m.w*m.h,layer=new Int32Array(N).fill(-1),queue:number[]=[];
  let edge=0,deep=0;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    if(isOpen(m,x,y))continue;
    let best=UNREACHABLE;for(let k=0;k<8;k++)if(legal(m,x,y,k))best=Math.min(best,f.cellCost(x+D8[k][0],y+D8[k][1]));
    if(best===UNREACHABLE)continue;
    const k=f.nextCell(x,y),p=ctr(m,x,y);
    edge++;layer[y*m.w+x]=0;queue.push(y*m.w+x);
    assert.ok(k>=0&&legal(m,x,y,k),`(${x},${y}) next ${k}`);
    assert.equal(f.cellCost(x+D8[k][0],y+D8[k][1]),best,`(${x},${y}) escapes to its lowest-cost neighbor`);
    assert.ok(near(f.directionAt(p.x,p.y),unit(k),1e-9),`(${x},${y}) center direction`);
    const q={x:(x+.1+rnd()*.8)*m.cs,y:(y+.1+rnd()*.8)*m.cs},d=f.directionAt(q.x,q.y);
    assert.ok(near(d,unit(k),1e-9)||near(d,towardCenter(m,x,y,k,q),1e-9),`(${x},${y}) off-center direction`);
    // One cell along the escape vector lands on walkable ground.
    const ex=Math.floor((p.x+d.x*m.cs*Math.SQRT2*.75)/m.cs),ey=Math.floor((p.y+d.y*m.cs*Math.SQRT2*.75)/m.cs);
    assert.ok(isOpen(m,ex,ey),`(${x},${y}) escape lands on (${ex},${ey})`);
  }
  // Reference BFS through blocked cells (8 directions) from the walls that have an exit.
  for(let q=0;q<queue.length;q++){const u=queue[q],ux=u%m.w,uy=(u-ux)/m.w;
    for(const [dx,dy] of D8){const vx=ux+dx,vy=uy+dy;if(vx<0||vy<0||vx>=m.w||vy>=m.h||isOpen(m,vx,vy)||layer[vy*m.w+vx]>=0)continue;layer[vy*m.w+vx]=layer[u]+1;queue.push(vy*m.w+vx);}}
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    const L=layer[y*m.w+x];if(isOpen(m,x,y)||L===0)continue;
    const k=f.nextCell(x,y),p=ctr(m,x,y);
    if(L<0){assert.equal(k,-1,`(${x},${y}) is in a wall region without exit`);assert.ok(zero(f.directionAt(p.x,p.y)));continue;}
    deep++;
    assert.ok(k>=0,`(${x},${y}) deep in a wall (layer ${L}) has no next`);
    const tx=x+D8[k][0],ty=y+D8[k][1];
    assert.ok(!isOpen(m,tx,ty)&&layer[ty*m.w+tx]===L-1,`(${x},${y}) layer ${L} steps to (${tx},${ty}) layer ${layer[ty*m.w+tx]}`);
    assert.ok(near(f.directionAt(p.x,p.y),unit(k),1e-9),`(${x},${y}) deep center direction`);
  }
  assert.ok(edge>1000,`${edge} building cells border a street`);
  assert.ok(deep>1000,`${deep} building cells lie deeper inside`);
});

test('11. L-shaped corridor: walkers arrive and the heading turns at most 100° between consecutive 0.1-cell steps',()=>{
  const rows=['################','#.G.############'];
  for(let i=0;i<10;i++)rows.push('#...############');
  rows.push('#..............#','#..............#','#..............#','################');
  const m=ascii(rows),f=new FlowField(m.grid,m.goals);
  for(const [sx,sy] of [[13.5,13.5],[13.5,12.4],[14.6,14.6],[9.2,12.3]]){
    let prev:FlowPoint|null=null,worst=0;
    const res=walk(f,m,sx,sy,.25,.1,2000,(_x,_y,d)=>{
      assert.ok(Math.hypot(d.x,d.y)>.5,'non-zero direction before the goal');
      if(prev){const ang=Math.abs(Math.atan2(prev.x*d.y-prev.y*d.x,prev.x*d.x+prev.y*d.y))*180/Math.PI;worst=Math.max(worst,ang);}
      prev={x:d.x,y:d.y};
    });
    assert.ok(res.arrived,`walker from (${sx},${sy}) stuck at (${res.x.toFixed(2)},${res.y.toFixed(2)})`);
    assert.ok(worst<=100,`direction turned ${worst.toFixed(1)}° in one 0.1-cell step from (${sx},${sy})`);
  }
});

test('12. regression (review corner.ts): radius 0.25 walkers in a concave dog-leg reach the goal from every start spot',()=>{
  const m=ascii(['GGGG','##.#','#..#','#.##','#G##','####']),f=new FlowField(m.grid,m.goals);
  const r=walk(f,m,2.2,2.3,.25,.09,2000);
  assert.ok(r.arrived,`reviewer's walker stuck at (${r.x.toFixed(3)},${r.y.toFixed(3)})`);
  let n=0;
  for(const [cx,cy] of [[2,1],[1,2],[2,2],[1,3]])for(let i=0;i<10;i++)for(let j=0;j<10;j++){
    const x=cx+.05+i*.1,y=cy+.05+j*.1;if(overlaps(m,x,y,.25))continue;n++;
    const res=walk(f,m,x,y,.25,.09,600);
    assert.ok(res.arrived,`walker from (${x.toFixed(2)},${y.toFixed(2)}) stuck at (${res.x.toFixed(3)},${res.y.toFixed(3)})`);
  }
  assert.ok(n>=100,`${n} start spots`);
});

test('13. wide bodies: clearanceFor picks the size class; radius 0.6 and 1.3 cell agents on a clearance field cross the city, 0 stuck',()=>{
  assert.equal(typeof FlowField.clearanceFor,'function');
  for(const [r,cs,want] of [[.22,.88,0],[.48,.88,1],[.9,.88,1],[1.5,.88,2],[0,1,0],[.49,1,0],[.51,1,1],[1.49,1,1],[1.51,1,2],[3.2,1,3]] as const)
    assert.equal(FlowField.clearanceFor(r,cs),want,`clearanceFor(${r},${cs})`);
  const m=city(),stuck:string[]=[],rnd=lcg(4242);let walked=0,maxTicks=0;
  for(const radius of [.6,1.3]){
    const clearance=FlowField.clearanceFor(radius*m.cs,m.cs);assert.equal(clearance,1);
    const f=new FlowField(m.grid,m.goals,{clearance});
    for(const al of m.alleys)for(let x=al.x0;x<=al.x1;x++)assert.equal(f.cellCost(x,al.y),UNREACHABLE,`1-cell alley (${x},${al.y}) is too narrow for clearance 1`);
    const res=crowd(f,m,radius,300,rnd,'city',stuck);walked+=res.walked;maxTicks=Math.max(maxTicks,res.maxTicks);
  }
  console.log(`[info] wide agents: ${walked} walked, max ticks used ${maxTicks}, stuck ${stuck.length}`);
  assert.ok(walked>=500,`only ${walked} wide agents could be spawned`);
  assert.deepEqual(stuck,[]);
});

test('14. clearance: 1- and 2-cell alleys are closed to clearance 1 while a 3-cell street is used; matches the eroded reference; invalidate matches a fresh field',()=>{
  // Left room (goal) and right room joined by a 1-wide (row 2), a 2-wide (rows 7-8) and a 3-wide (rows 13-15) corridor.
  const W=24,H=20,open=new Uint8Array(W*H),fill=(x0:number,y0:number,x1:number,y1:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)open[y*W+x]=1;};
  fill(1,1,6,18);fill(17,1,22,18);fill(7,2,16,2);fill(7,7,16,8);fill(7,13,16,15);
  const m=mk(W,H,1,open,[2*W+3]);
  const chain=(f:FlowField,x:number,y:number)=>{const out:number[][]=[];for(let k=f.nextCell(x,y);k>=0;k=f.nextCell(x,y)){x+=D8[k][0];y+=D8[k][1];out.push([x,y]);if(out.length>500)assert.fail('chain too long');}return out;};
  const inCorr=(c:number[][],y0:number,y1:number)=>c.some(([x,y])=>x>=7&&x<=16&&y>=y0&&y<=y1);
  const f0=new FlowField(m.grid,m.goals);
  assert.ok(inCorr(chain(f0,20,2),2,2),'clearance 0 takes the short 1-cell alley');
  const f1=new FlowField(m.grid,m.goals,{clearance:1});
  for(let x=7;x<=16;x++){
    for(const y of [2,7,8,13,15])assert.equal(f1.cellCost(x,y),UNREACHABLE,`(${x},${y}) is closed to clearance 1`);
    assert.notEqual(f1.cellCost(x,14),UNREACHABLE,`(${x},14) is the 3-cell street's center lane`);
  }
  const c1=chain(f1,20,2);
  assert.ok(inCorr(c1,14,14)&&!inCorr(c1,0,12),'clearance 1 detours through the 3-cell street');
  assert.equal(c1.at(-1)!.join(),'3,2','and still reaches the goal');
  const e1=eroded(m,1);sameCosts(f1,refCosts(e1,m.goalCells,4),m,'clearance 1 vs eroded reference');checkDescent(f1,e1,'clearance 1');
  const f2=new FlowField(m.grid,[ctr(m,3,9)],{clearance:2});
  assert.equal(f2.cellCost(3,9),0);assert.equal(f2.cellCost(20,9),UNREACHABLE,'clearance 2: even the 3-cell street is too narrow');
  sameCosts(f2,refCosts(eroded(m,2),[9*W+3],4),m,'clearance 2 vs eroded reference');
  // Targets on cells the erosion closes are inactive.
  const t=new FlowField(m.grid,[ctr(m,1,1),ctr(m,10,2)],{clearance:1});
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)assert.equal(t.cellCost(x,y),UNREACHABLE);
  t.setTargets([ctr(m,1,1),m.goals[0]]);sameField(dump(t,m),dump(f1,m),W,'eroded target ignored next to an active one');
  // Random edits: invalidate (clearance 1 and 2) matches a fresh field, its reference and its directions.
  let runs=0;
  for(let s=1;s<=60;s++){
    const r=lcg(s),w=3+Math.floor(r()*14),h=3+Math.floor(r()*14),op=new Uint8Array(w*h);for(let i=0;i<w*h;i++)op[i]=r()<.15?0:1;
    const g=mk(w,h,.7,op,[],-3.3,2.1),clearance=1+(s%2),tg=Array.from({length:1+Math.floor(r()*4)},()=>({x:-3.3+r()*w*.7,y:2.1+r()*h*.7}));
    const opts:FlowFieldOptions={wallPenalty:Math.floor(r()*8),clearance},f=new FlowField(g.grid,tg,opts);
    for(let k=0;k<8;k++){
      const ax=Math.floor(r()*w),ay=Math.floor(r()*h),bx=Math.min(w-1,ax+Math.floor(r()*3)),by=Math.min(h-1,ay+Math.floor(r()*3)),v=r()<.5?0:1;
      for(let y=ay;y<=by;y++)for(let x=ax;x<=bx;x++)op[y*w+x]=v;
      const mode=k%4,rect=mode===0?{x0:ax,y0:ay,x1:bx,y1:by}:mode===1?{x0:bx,y0:by,x1:ax,y1:ay}:mode===2?{x0:ax-5,y0:ay-.5,x1:bx+.9,y1:by+20}:{x0:ax+.2,y0:ay,x1:bx+.99,y1:by};
      f.invalidate(rect);const fr=new FlowField(g.grid,tg,opts);runs++;
      sameField(dump(f,g),dump(fr,g),w,`seed ${s} edit ${k} clearance ${clearance}`);
      const P={x:0,y:0},Q={x:0,y:0};for(let i=0;i<30;i++){const px=-5+r()*(w+4),py=r()*(h+4);f.directionAt(px,py,P);fr.directionAt(px,py,Q);if(P.x!==Q.x||P.y!==Q.y)assert.fail(`seed ${s} edit ${k}: directionAt(${px},${py}) differs`);}
    }
    const goalCells=tg.map(p=>Math.floor((p.y-2.1)/.7)*w+Math.floor((p.x+3.3)/.7)),e=eroded(g,clearance);
    sameCosts(f,refCosts(e,goalCells,opts.wallPenalty),g,`seed ${s} after edits vs eroded reference`);checkDescent(f,e,`seed ${s}`);
  }
  assert.equal(runs,480);
  // City: a 3x3 barricade with clearance 1, then reopened.
  const c=city(),fc=new FlowField(c.grid,c.goals,{clearance:1}),orig=dump(fc,c),sx=c.cols[3][1]+1,sy=(c.rows[3][0]+c.rows[3][1])>>1,saved:number[]=[];
  for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++){saved.push(c.open[y*c.w+x]);c.open[y*c.w+x]=0;}
  fc.invalidate({x0:sx,y0:sy-1,x1:sx+2,y1:sy+1});sameField(dump(fc,c),dump(new FlowField(c.grid,c.goals,{clearance:1}),c),c.w,'city clearance 1 barricade vs fresh');
  let j=0;for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)c.open[y*c.w+x]=saved[j++];
  fc.invalidate({x0:sx,y0:sy-1,x1:sx+2,y1:sy+1});sameField(dump(fc,c),orig,c.w,'city clearance 1 reopened');
});

test('15. option validation: odd wallPenalty/clearance values construct quickly and behave like their clamped integer',()=>{
  const W=64,open=new Uint8Array(W*W);
  for(let y=0;y<W;y++)for(let x=0;x<W;x++)open[y*W+x]=x%4===2&&y%8!==(x%8===2?7:0)?0:1; // serpentine walls (reviewer's pen.ts)
  const m=mk(W,W,1,open,[4*W+4]);
  const build=(o:FlowFieldOptions,label:string)=>{const t=performance.now(),f=new FlowField(m.grid,m.goals,o),ms=performance.now()-t;
    assert.ok(ms<50,`${label}: constructor took ${ms.toFixed(1)} ms`);return f;};
  const same=(o:FlowFieldOptions,label:string,as:FlowFieldOptions)=>{
    const f=build(o,label);sameField(dump(f,m),dump(new FlowField(m.grid,m.goals,as),m),W,`${label} behaves like ${JSON.stringify(as)}`);
    const clr=as.clearance??0,e=clr?eroded(m,clr):m;
    if(clr<8)assert.ok(checkDescent(f,e,label)>=50,`${label}: field has reachable cells`);
    return f;
  };
  same({wallPenalty:NaN},'wallPenalty NaN',{});
  same({wallPenalty:Infinity},'wallPenalty Infinity',{wallPenalty:4});
  same({wallPenalty:-Infinity},'wallPenalty -Infinity',{wallPenalty:4});
  same({wallPenalty:-5},'wallPenalty -5',{wallPenalty:0});
  same({wallPenalty:2.7},'wallPenalty 2.7',{wallPenalty:2});
  same({wallPenalty:'7' as unknown as number},'wallPenalty "7"',{wallPenalty:7});
  const big=same({wallPenalty:1e9},'wallPenalty 1e9',{wallPenalty:255});
  sameCosts(big,refCosts(m,m.goalCells,255),m,'wallPenalty 255 vs reference');
  same({clearance:NaN},'clearance NaN',{});
  same({clearance:Infinity},'clearance Infinity',{clearance:0});
  same({clearance:-3},'clearance -3',{clearance:0});
  same({clearance:1.9},'clearance 1.9',{clearance:1});
  same({clearance:100},'clearance 100',{clearance:8});
  same({wallPenalty:NaN,clearance:NaN},'both NaN',{wallPenalty:4,clearance:0});
});

test('16. buried agent: inside the middle of a raised 3x3 barricade it still gets a direction and reaches walkable ground',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals),orig=dump(f,m),idx=(x:number,y:number)=>y*m.w+x;
  const sx=m.cols[1][1]+1,sy=(m.rows[1][0]+m.rows[1][1])>>1,mx=sx+1,saved:number[]=[];
  assert.ok(isOpen(m,mx,sy)&&isOpen(m,mx,sy-2)&&isOpen(m,mx,sy+2),'barricade sits in a street');
  for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++){saved.push(m.open[idx(x,y)]);m.open[idx(x,y)]=0;}
  f.invalidate({x0:sx,y0:sy-1,x1:sx+2,y1:sy+1});
  const p=ctr(m,mx,sy),d=f.directionAt(p.x,p.y),k=f.nextCell(mx,sy);
  assert.ok(!zero(d),'buried agent gets a direction');assert.ok(k>=0,'buried cell has a next');assert.ok(near(d,unit(k)),'and it matches nextCell');
  let x=mx,y=sy,steps=0;
  while(!isOpen(m,x,y)){const n=f.nextCell(x,y);assert.ok(n>=0,`(${x},${y}) dead end inside the barricade`);x+=D8[n][0];y+=D8[n][1];steps++;assert.ok(steps<=3);}
  assert.equal(steps,2,'nearest exit: one step to the barricade rim, one onto the street');
  assert.notEqual(f.cellCost(x,y),UNREACHABLE,'and the street cell is reachable');
  // Moving along directionAt (no collision while inside the wall) gets out within a couple of cells.
  let px=p.x,py=p.y,t=0;const step=.09*m.cs,q={x:0,y:0};
  for(;t<60&&!f.reachable(px,py);t++){f.directionAt(px,py,q);assert.ok(!zero(q),`zero direction at (${(px/m.cs).toFixed(2)},${(py/m.cs).toFixed(2)})`);px+=q.x*step;py+=q.y*step;}
  assert.ok(f.reachable(px,py),`still inside the barricade after ${t} ticks`);
  let j=0;for(let y2=sy-1;y2<=sy+1;y2++)for(let x2=sx;x2<=sx+2;x2++)m.open[idx(x2,y2)]=saved[j++];
  f.invalidate({x0:sx,y0:sy-1,x1:sx+2,y1:sy+1});sameField(dump(f,m),orig,m.w,'barricade lowered');
});

test('17. invalidateMany: same field as one invalidate per rect, version bumped once',()=>{
  const m=city(),idx=(x:number,y:number)=>y*m.w+x;
  const a=new FlowField(m.grid,m.goals),b=new FlowField(m.grid,m.goals),c1=new FlowField(m.grid,m.goals,{clearance:1}),orig=dump(b,m),orig1=dump(c1,m);
  assert.equal(typeof b.invalidateMany,'function');
  const al=m.alleys[0],de=m.deadEnds[0],sx=m.cols[2][1]+1,sy=(m.rows[2][0]+m.rows[2][1])>>1;
  const edits:{rect:CellRect;cells:[number,number,number,number]}[]=[
    {rect:{x0:al.x0+1,y0:al.y,x1:al.x0+1,y1:al.y},cells:[al.x0+1,al.y,al.x0+1,al.y]},
    {rect:{x0:de.x0,y0:de.y,x1:de.x0,y1:de.y},cells:[de.x0,de.y,de.x0,de.y]},
    {rect:{x0:sx+2,y0:sy+1,x1:sx,y1:sy-1},cells:[sx,sy-1,sx+2,sy+1]}, // reversed corners
    {rect:{x0:-4,y0:-4,x1:2,y1:2.5},cells:[1,1,2,2]},                  // partly outside, fractional
  ];
  const saved=edits.map(({cells:[x0,y0,x1,y1]})=>{const s:number[]=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){s.push(m.open[idx(x,y)]);m.open[idx(x,y)]=0;}return s;});
  const rects=edits.map(e=>e.rect);
  const va=a.version,vb=b.version;
  for(const r of rects)a.invalidate(r);
  b.invalidateMany(rects);c1.invalidateMany(rects);
  assert.equal(a.version,va+rects.length);assert.equal(b.version,vb+1,'invalidateMany recomputes once');
  const db=dump(b,m);sameField(db,dump(a,m),m.w,'invalidateMany vs invalidate per rect');
  sameField(db,dump(new FlowField(m.grid,m.goals),m),m.w,'invalidateMany vs fresh');
  sameField(dump(c1,m),dump(new FlowField(m.grid,m.goals,{clearance:1}),m),m.w,'invalidateMany clearance 1 vs fresh');
  edits.forEach(({cells:[x0,y0,x1,y1]},i)=>{let j=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)m.open[idx(x,y)]=saved[i][j++];});
  b.invalidateMany(rects);c1.invalidateMany(rects);
  sameField(dump(b,m),orig,m.w,'all reopened');sameField(dump(c1,m),orig1,m.w,'all reopened, clearance 1');
});

test('18. wall penalty 0/1/4/13 matches a reference heap Dijkstra on random maps',()=>{
  let cells=0;
  for(let s=1;s<=160;s++){
    const r=lcg(s),w=2+Math.floor(r()*30),h=2+Math.floor(r()*30),open=new Uint8Array(w*h);for(let i=0;i<w*h;i++)open[i]=r()<.35?0:1;
    const pen=[0,1,4,13][s%4],tg:number[]=[];for(let k=0;k<1+Math.floor(r()*3);k++)tg.push(Math.floor(r()*w*h));
    const m=mk(w,h,1,open,tg),f=new FlowField(m.grid,m.goals,{wallPenalty:pen});
    sameCosts(f,refCosts(m,tg,pen),m,`seed ${s} wallPenalty ${pen}`);checkDescent(f,m,`seed ${s}`);cells+=w*h;
  }
  assert.ok(cells>20000,`${cells} cells compared`);
});

test('19. benchmark: 192x192 full compute and 3x3 invalidate (best median of 3 batches; clearance 0 and 1), directionAt for 300 agents',()=>{
  const m=city(),sx=m.cols[2][1]+1,sy=(m.rows[2][0]+m.rows[2][1])>>1,rect={x0:sx,y0:sy-1,x1:sx+2,y1:sy+1},saved:number[]=[];
  for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)saved.push(m.open[y*m.w+x]);
  const res:Record<number,{full:number[];inv:number[]}>={0:{full:[],inv:[]},1:{full:[],inv:[]}};
  for(const clearance of [0,1])for(let i=0;i<3;i++)new FlowField(m.grid,m.goals,{clearance}); // warm-up
  for(let batch=0;batch<3;batch++)for(const clearance of [0,1]){
    const opts={clearance},full:number[]=[],inv:number[]=[];
    for(let i=0;i<8;i++){const t=performance.now();new FlowField(m.grid,m.goals,opts);full.push(performance.now()-t);}
    const f=new FlowField(m.grid,m.goals,opts);
    for(let i=0;i<12;i++){
      let j=0;for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)m.open[y*m.w+x]=i%2?saved[j++]:0;
      const t=performance.now();f.invalidate(rect);if(i>=2)inv.push(performance.now()-t);
    }
    res[clearance].full.push(median(full));res[clearance].inv.push(median(inv));
  }
  const fmt=(a:number[])=>`${a.map(v=>v.toFixed(2)).join(' / ')} ms (best ${Math.min(...a).toFixed(2)})`;
  for(const c of [0,1]){
    console.log(`[bench] flowfield 192x192 clearance ${c} full: batch medians ${fmt(res[c].full)}`);
    console.log(`[bench] flowfield 192x192 clearance ${c} invalidate 3x3: batch medians ${fmt(res[c].inv)}`);
  }
  const f=new FlowField(m.grid,m.goals),rnd=lcg(3),px:number[]=[],py:number[]=[],out={x:0,y:0};
  while(px.length<300){const cx=Math.floor(rnd()*m.w),cy=Math.floor(rnd()*m.h);if(isOpen(m,cx,cy)){px.push((cx+rnd())*m.cs);py.push((cy+rnd())*m.cs);}}
  let sum=0;const t0=performance.now();
  for(let t=0;t<100;t++)for(let a=0;a<300;a++){f.directionAt(px[a]+t*.003,py[a]-t*.002,out);sum+=out.x+out.y;}
  const per=(performance.now()-t0)/100;
  console.log(`[bench] flowfield directionAt 300 agents x 100 ticks: ${per.toFixed(3)} ms/tick (${(per*1e6/300).toFixed(0)} ns/call, checksum ${sum.toFixed(3)})`);
  assert.ok(Math.min(...res[0].full)<=25,`full compute best median ${Math.min(...res[0].full).toFixed(2)} ms > 25`);
  assert.ok(Math.min(...res[0].inv)<=5,`invalidate best median ${Math.min(...res[0].inv).toFixed(2)} ms > 5`);
});
