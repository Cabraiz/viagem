import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowField,DIRS,STRAIGHT_COST,DIAGONAL_COST,UNREACHABLE,type FlowGrid,type FlowPoint} from '../../src/maps/flowfield.ts';

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
const zero=(p:FlowPoint)=>p.x===0&&p.y===0;
const near=(p:FlowPoint,q:FlowPoint,eps=1e-9)=>Math.abs(p.x-q.x)<=eps&&Math.abs(p.y-q.y)<=eps;
const isOpen=(m:TestMap,x:number,y:number)=>x>=0&&y>=0&&x<m.w&&y<m.h&&m.open[y*m.w+x]===1;
/** Legal move from (x,y) along DIRS[k]: target walkable and, for diagonals, both orthogonals walkable (no corner cutting). */
const legal=(m:TestMap,x:number,y:number,k:number)=>{const [dx,dy]=D8[k];return isOpen(m,x+dx,y+dy)&&(k<4||(isOpen(m,x+dx,y)&&isOpen(m,x,y+dy)));};
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};
const median=(a:number[])=>{const s=[...a].sort((p,q)=>p-q),n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;};

/** Reference multi-source Dijkstra (straight 10, diagonal 14, no corner cutting, no wall penalty). */
const refCosts=(m:TestMap,goalCells=m.goalCells)=>{
  const {w,h}=m,cost=new Float64Array(w*h).fill(Infinity),buckets:number[][]=[];
  for(const i of goalCells){cost[i]=0;(buckets[0]??=[]).push(i);}
  for(let c=0;c<buckets.length;c++){const b=buckets[c];if(!b)continue;for(const i of b){
    if(cost[i]!==c)continue;const x=i%w,y=(i-x)/w;
    for(let k=0;k<8;k++){if(!legal(m,x,y,k))continue;const j=(y+D8[k][1])*w+x+D8[k][0],nc=c+(k<4?10:14);if(nc<cost[j]){cost[j]=nc;(buckets[nc]??=[]).push(j);}}
  }}
  return cost;
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
  // Whole city against a reference Dijkstra (no penalty).
  const m=city(),fc=new FlowField(m.grid,m.goals,{wallPenalty:0}),ref=refCosts(m);
  for(let i=0;i<m.w*m.h;i++){const got=fc.cellCost(i%m.w,Math.floor(i/m.w)),want=ref[i]===Infinity?UNREACHABLE:ref[i];if(got!==want)assert.fail(`city cost (${i%m.w},${Math.floor(i/m.w)}): ${got} vs reference ${want}`);}
});

test('2. no corner cutting: never a diagonal past a blocked orthogonal',()=>{
  const m=ascii(['.....','.G#..','.#...','.....','.....']);
  const f=new FlowField(m.grid,m.goals,{wallPenalty:0});
  assert.equal(f.cellCost(2,2),60,'(2,2) must walk around the blocked L, not cut to the goal (would be 14)');
  assert.ok([0,2].includes(f.nextCell(2,2)),`(2,2) next ${f.nextCell(2,2)} should be E or S`);
  assert.equal(f.cellCost(0,2),20);assert.equal(f.cellCost(2,0),20);
  const check=(m:TestMap,f:FlowField,label:string)=>{
    let diag=0;
    for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){const k=f.nextCell(x,y);if(k<0)continue;if(k>=4)diag++;
      if(!legal(m,x,y,k))assert.fail(`${label}: (${x},${y}) next ${k} is not a legal move (blocked target or corner cut)`);}
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
  const ref=refCosts(m);for(let i=0;i<m.w*m.h;i++)assert.equal(f0.cellCost(i%m.w,Math.floor(i/m.w)),ref[i]===Infinity?UNREACHABLE:ref[i]);
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
  // Blocked cells: never a cost; escape only through legal moves.
  assert.equal(f.cellCost(4,2),UNREACHABLE);assert.equal(f.reachable(4.5,2.5),false);
  assert.equal(f.nextCell(4,2),1,'wall between region and pocket escapes west (diagonals cut corners, east is unreachable)');
  assert.ok(near(f.directionAt(4.5,2.5),{x:-1,y:0}));
  assert.equal(f.nextCell(6,2),-1,'blocked cell surrounded by the unreachable pocket');assert.ok(zero(f.directionAt(6.5,2.5)));
  assert.equal(f.nextCell(0,0),-1,'corner wall whose only walkable neighbor is a corner-cutting diagonal');assert.ok(zero(f.directionAt(.5,.5)));
  // Outside: costs are UNREACHABLE, directions clamp to the edge cell.
  assert.equal(f.costAt(-3,2.5),UNREACHABLE);assert.equal(f.reachable(-3,2.5),false);assert.equal(f.atGoal(-3,1.5),false);
  assert.ok(near(f.directionAt(-3,2.5),{x:1,y:0}),'left of the grid clamps to blocked (0,2), which escapes east');
  assert.ok(zero(f.directionAt(100,2.5)),'right of the grid clamps next to the pocket');
  const o=ascii(['G.....']),fo=new FlowField(o.grid,o.goals);
  assert.ok(near(fo.directionAt(50,.5),{x:-1,y:0}));assert.ok(near(fo.directionAt(3.5,-20),{x:-1,y:0}));assert.ok(near(fo.directionAt(3.5,20),{x:-1,y:0}));
  assert.ok(zero(fo.directionAt(-9,.5)),'clamped onto the goal cell');
  assert.equal(fo.costAt(50,.5),UNREACHABLE);assert.equal(fo.costAt(3.5,-.01),UNREACHABLE);
});

test('5. two goals: cost is the min of each single-goal field, cells flow to the nearer goal, setTargets([]) clears',()=>{
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
  f.setTargets([{x:3.5,y:7.5},{x:-4,y:2},{x:50,y:50}]); // blocked cell and outside points are ignored
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
  for(let i=0;i<s.c.length;i++){assert.ok(s.c[i]>=orig.c[i]||orig.c[i]===UNREACHABLE);const k=s.n[i];if(k>=0)assert.notEqual(idx(i%m.w+D8[k][0],Math.floor(i/m.w)+D8[k][1]),idx(bx,al.y),'nothing points into the barricade');}
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

test('9. 300 agents following directionAt with grid collision never get stuck',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals),rnd=lcg(99),r=.25*m.cs,step=2*.9/20;
  let maxSteps=0,maxBudget=0;const stuck:string[]=[];
  for(let a=0;a<300;a++){
    let cx=0,cy=0;do{cx=Math.floor(rnd()*m.w);cy=Math.floor(rnd()*m.h);}while(!isOpen(m,cx,cy));
    const x=(cx+.5+(rnd()-.5)*.5)*m.cs,y=(cy+.5+(rnd()-.5)*.5)*m.cs,cost=f.cellCost(cx,cy);
    if(cost===UNREACHABLE)continue;
    const budget=Math.ceil(cost/10*m.cs/step*1.5)+40,res=walk(f,m,x,y,r,step,budget);
    maxBudget=Math.max(maxBudget,budget);
    if(!res.arrived)stuck.push(`agent ${a} from cell (${cx},${cy}) cost ${cost}: at (${(res.x/m.cs).toFixed(2)},${(res.y/m.cs).toFixed(2)}) cells after ${res.steps} ticks`);
    else maxSteps=Math.max(maxSteps,res.steps);
  }
  console.log(`[info] agents: max ticks used ${maxSteps} (largest budget ${maxBudget}), stuck ${stuck.length}`);
  assert.deepEqual(stuck,[]);
});

test('10. a position inside a blocked cell escapes toward its lowest-cost legal walkable neighbor',()=>{
  const m=city(),f=new FlowField(m.grid,m.goals),rnd=lcg(5);let edge=0;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){
    if(isOpen(m,x,y))continue;
    let best=UNREACHABLE;for(let k=0;k<8;k++)if(legal(m,x,y,k))best=Math.min(best,f.cellCost(x+D8[k][0],y+D8[k][1]));
    const k=f.nextCell(x,y),p=ctr(m,x,y);
    if(best===UNREACHABLE){assert.equal(k,-1,`(${x},${y}) has no exit`);assert.ok(zero(f.directionAt(p.x,p.y)));continue;}
    edge++;
    assert.ok(k>=0&&legal(m,x,y,k),`(${x},${y}) next ${k}`);
    assert.equal(f.cellCost(x+D8[k][0],y+D8[k][1]),best,`(${x},${y}) escapes to its lowest-cost neighbor`);
    assert.ok(near(f.directionAt(p.x,p.y),unit(k),1e-9),`(${x},${y}) center direction`);
    const q={x:(x+.1+rnd()*.8)*m.cs,y:(y+.1+rnd()*.8)*m.cs},d=f.directionAt(q.x,q.y);
    assert.ok(near(d,unit(k),1e-9),`(${x},${y}) off-center direction`);
    // One cell along the escape vector lands on walkable ground.
    const ex=Math.floor((p.x+d.x*m.cs*Math.SQRT2*.75)/m.cs),ey=Math.floor((p.y+d.y*m.cs*Math.SQRT2*.75)/m.cs);
    assert.ok(isOpen(m,ex,ey),`(${x},${y}) escape lands on (${ex},${ey})`);
  }
  assert.ok(edge>1000,`${edge} building cells border a street`);
});

test('11. smoothness: direction never jitters along an L-shaped corridor',()=>{
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
    assert.ok(worst<=100,`direction flipped ${worst.toFixed(1)}° in one 0.1-cell step from (${sx},${sy})`);
  }
});

test('12. benchmark: 192x192 full compute, 3x3 invalidate, directionAt for 300 agents',()=>{
  const m=city();
  for(let i=0;i<5;i++)new FlowField(m.grid,m.goals);
  const full:number[]=[];
  for(let i=0;i<20;i++){const t=performance.now();new FlowField(m.grid,m.goals);full.push(performance.now()-t);}
  console.log(`[bench] flowfield 192x192 full: median ${median(full).toFixed(2)} ms, max ${Math.max(...full).toFixed(2)} ms`);
  const f=new FlowField(m.grid,m.goals),sx=m.cols[2][1]+1,sy=(m.rows[2][0]+m.rows[2][1])>>1,rect={x0:sx,y0:sy-1,x1:sx+2,y1:sy+1},saved:number[]=[];
  for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)saved.push(m.open[y*m.w+x]);
  const inv:number[]=[];
  for(let i=0;i<26;i++){
    let j=0;for(let y=sy-1;y<=sy+1;y++)for(let x=sx;x<=sx+2;x++)m.open[y*m.w+x]=i%2?saved[j++]:0;
    const t=performance.now();f.invalidate(rect);if(i>=6)inv.push(performance.now()-t);
  }
  console.log(`[bench] flowfield invalidate 3x3: median ${median(inv).toFixed(2)} ms, max ${Math.max(...inv).toFixed(2)} ms`);
  const rnd=lcg(3),px:number[]=[],py:number[]=[],out={x:0,y:0};
  while(px.length<300){const cx=Math.floor(rnd()*m.w),cy=Math.floor(rnd()*m.h);if(isOpen(m,cx,cy)){px.push((cx+rnd())*m.cs);py.push((cy+rnd())*m.cs);}}
  let sum=0;const t0=performance.now();
  for(let t=0;t<100;t++)for(let a=0;a<300;a++){f.directionAt(px[a]+t*.003,py[a]-t*.002,out);sum+=out.x+out.y;}
  const per=(performance.now()-t0)/100;
  console.log(`[bench] flowfield directionAt 300 agents x 100 ticks: ${per.toFixed(3)} ms/tick (${(per*1e6/300).toFixed(0)} ns/call, checksum ${sum.toFixed(3)})`);
  assert.ok(median(full)<=25,`full compute median ${median(full).toFixed(2)} ms > 25`);
  assert.ok(median(inv)<=5,`invalidate median ${median(inv).toFixed(2)} ms > 5`);
});
