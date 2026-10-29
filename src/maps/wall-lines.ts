/**
 * Wall and fence lines of Cidade Nevada drawn as one continuous line each (BUG-20261022-ORQ-grades-sem-padrao).
 *
 * The map's wall blocks are bands mostly 2 cells thick (some 1, a few stair-stepped or thicker bits). One piece per cell
 * with the shape of its neighbours (city-decor.ts lineShape) turned every cell of a 2-thick band into a T: two rows of
 * crossed pieces that closed nothing ("grades espalhadas em X"). Here each wall is read as the line along its middle:
 *  - the half-cell lattice (sub units, 2 per cell): a lattice point is inside when the 4 half cells around it are wall;
 *  - those points are thinned (Zhang–Suen) to a 1-point skeleton, centred in the band (a 2-thick band: the line
 *    between its two rows; a 1-thick one: through its cells), then made 4-connected (a diagonal step gets the corner
 *    point) and stripped of short spurs (corner artefacts of the thinning);
 *  - the skeleton's edges form straight runs; each run is cut into pieces one cell long, back to back, the posts
 *    shared at the ends (L corners, T and + junctions meet on one point); a run of an odd half-cell length stops half a
 *    cell short at a free end, or overlaps its last piece by half a cell between two junctions. Every piece is the
 *    straight art (`reto`) turned along its run: no corner or T art.
 * Pure and deterministic: the result depends only on the wall cells.
 */

/** A straight run of the line in sub units (half cells): along x ('h', at y = k) or along y ('v', at x = k), from a to b. */
export interface WallRun {o:'h'|'v';k:number;a:number;b:number}
/** A piece: its centre in sub units (cx, cy) and the axis it runs along. */
export interface WallPiece {cx:number;cy:number;o:'h'|'v'}

/** Spurs at most this long (sub units) hanging off a junction are thinning artefacts: removed. */
export const WALL_SPUR=2;

/** The skeleton of the wall cells (`wall(c, r)`, a W×H cell grid) as straight runs on the half-cell lattice. */
export function wallRuns(W:number,H:number,wall:(c:number,r:number)=>boolean):WallRun[]{
  const NW=2*W+1,NH=2*H+1;
  const m=(x:number,y:number)=>x>=0&&y>=0&&x<2*W&&y<2*H&&wall(x>>1,y>>1);
  const g=new Uint8Array(NW*NH),inside=(x:number,y:number)=>m(x-1,y-1)&&m(x,y-1)&&m(x-1,y)&&m(x,y);
  for(let y=1;y<NH-1;y++)for(let x=1;x<NW-1;x++)if(inside(x,y))g[y*NW+x]=1;
  const at=(x:number,y:number)=>x>=0&&y>=0&&x<NW&&y<NH?g[y*NW+x]:0;
  thin(g,NW,NH,at);
  // 4-connected: a diagonal pair with no shared neighbour gets one corner (the inside one, x step first).
  for(let y=0;y<NH;y++)for(let x=0;x<NW;x++){
    if(!g[y*NW+x])continue;
    for(const dx of [-1,1]){
      const dy=1;
      if(!at(x+dx,y+dy)||at(x+dx,y)||at(x,y+dy))continue;
      if(inside(x+dx,y))g[y*NW+x+dx]=1;else g[(y+dy)*NW+x]=1;
    }
  }
  const deg=(x:number,y:number)=>at(x+1,y)+at(x-1,y)+at(x,y+1)+at(x,y-1);
  // Spurs: walk from each end point to the first junction; a short branch is removed.
  for(let y=0;y<NH;y++)for(let x=0;x<NW;x++){
    if(!g[y*NW+x]||deg(x,y)!==1)continue;
    const path:[number,number][]=[[x,y]];let px=x,py=y,prev=-1;
    for(;;){
      let next:[number,number]|undefined;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=px+dx,ny=py+dy;if(at(nx,ny)&&ny*NW+nx!==prev){next=[nx,ny];break;}}
      if(!next)break;
      if(deg(next[0],next[1])>=3){
        if(path.length<=WALL_SPUR)for(const [qx,qy] of path)g[qy*NW+qx]=0;
        break;
      }
      prev=py*NW+px;[px,py]=next;path.push(next);
      if(path.length>WALL_SPUR+1)break;
    }
  }
  // A squared corner may stand on the wall's edge (a notch in the map's corner): 3 of the 4 half cells around it.
  const near=(x:number,y:number)=>+m(x-1,y-1)+ +m(x,y-1)+ +m(x-1,y)+ +m(x,y)>=3;
  for(let round=0;round<4&&squareCorners(collect(NW,NH,at),g,NW,near,deg);round++);
  for(let pass=0;pass<3;pass++){
    for(let round=0;round<1000&&straighten(collect(NW,NH,at),g,NW,near,deg);round++);
    if(!tidy(g,NW,NH,at,deg))break;
  }
  // The thinning shortens the free ends: each one goes on straight to the end of its wall (the half cells either side
  // of each step are wall).
  for(let y=0;y<NH;y++)for(let x=0;x<NW;x++){
    if(!g[y*NW+x]||deg(x,y)!==1)continue;
    const [dx,dy]=([[1,0],[-1,0],[0,1],[0,-1]] as const).find(([dx,dy])=>at(x-dx,y-dy))!;
    for(let px=x,py=y;;){
      // Sub cells either side of the edge from (px, py) to (px+dx, py+dy).
      const sx=dx>0?px:px-1,sy=dy>0?py:py-1;
      const ok=dx?m(sx,py-1)&&m(sx,py):m(px-1,sy)&&m(px,sy);
      if(!ok||at(px+dx,py+dy))break;
      px+=dx;py+=dy;g[py*NW+px]=1;
    }
  }
  return collect(NW,NH,at);
}

/**
 * The straight runs of the skeleton's edges, cut at every junction (a point with a neighbour across the run), so the
 * pieces laid on them put a post on each junction and never a piece's middle on a crossing (an X).
 */
function collect(NW:number,NH:number,at:(x:number,y:number)=>number):WallRun[]{
  const runs:WallRun[]=[];
  for(let y=0;y<NH;y++){
    let a=-1;
    for(let x=0;x<NW;x++){
      const on=x+1<NW&&at(x,y)&&at(x+1,y);
      if(on&&a<0)a=x;
      else if(a>=0&&x>a&&(!on||at(x,y-1)||at(x,y+1))){runs.push({o:'h',k:y,a,b:x});a=on?x:-1;}
    }
  }
  for(let x=0;x<NW;x++){
    let a=-1;
    for(let y=0;y<NH;y++){
      const on=y+1<NH&&at(x,y)&&at(x,y+1);
      if(on&&a<0)a=y;
      else if(a>=0&&y>a&&(!on||at(x-1,y)||at(x+1,y))){runs.push({o:'v',k:x,a,b:y});a=on?y:-1;}
    }
  }
  return runs;
}

/**
 * Squares the corners the thinning cut (a staircase of half-cell steps between an x run and a y run that end within a
 * cell of each other): both runs are carried to the point where their lines cross, when the way there is on the
 * wall (`near`), and the steps between them (points with at most 2 neighbours) go. True when something changed.
 */
function squareCorners(runs:readonly WallRun[],g:Uint8Array,NW:number,inside:(x:number,y:number)=>boolean,deg:(x:number,y:number)=>number){
  let changed=false;
  const ends=(r:WallRun)=>(['a','b'] as const).map(e=>({p:pt(r,r[e]),dir:e==='b'?1:-1}));
  for(const r of runs)if(r.o==='h'&&r.b-r.a>=2)for(const q of runs)if(q.o==='v'&&q.b-q.a>=2){
    for(const e1 of ends(r))for(const e2 of ends(q)){
      const [x1,y1]=e1.p,[x2,y2]=e2.p;
      if(Math.max(Math.abs(x1-x2),Math.abs(y1-y2))>2||(x1===x2&&y1===y2))continue;
      const px=q.k,py=r.k;
      if((px-x1)*e1.dir<0||(py-y2)*e2.dir<0||(px===x1&&py===y2))continue;
      let ok=true;
      for(let x=Math.min(x1,px);x<=Math.max(x1,px);x++)if(!inside(x,py))ok=false;
      for(let y=Math.min(y2,py);y<=Math.max(y2,py);y++)if(!inside(px,y))ok=false;
      if(!ok)continue;
      const keep=new Set<number>();
      for(let x=Math.min(x1,px);x<=Math.max(x1,px);x++)keep.add(py*NW+x);
      for(let y=Math.min(y2,py);y<=Math.max(y2,py);y++)keep.add(y*NW+px);
      const drop:number[]=[];
      for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++)for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++){
        const i=y*NW+x;
        if(g[i]&&!keep.has(i)&&deg(x,y)<=2)drop.push(i);
      }
      for(const i of drop)g[i]=0;
      for(const i of keep)if(!g[i]){g[i]=1;changed=true;}
      if(drop.length)changed=true;
    }
  }
  return changed;
}

/**
 * Straightens the half-cell steps (a run 1 sub long between two parallel runs going opposite ways: a Z): the shorter
 * of the two moves half a cell onto the other's line when it is a plain chain (no other run joins it but at its far
 * end, which keeps its point so whatever joins there stays joined). True when something changed.
 */
function straighten(runs:readonly WallRun[],g:Uint8Array,NW:number,near:(x:number,y:number)=>boolean,deg:(x:number,y:number)=>number){
  for(const j of runs){
    if(j.b-j.a!==1)continue;
    const o=j.o==='h'?'v':'h',p=pt(j,j.a),q=pt(j,j.b);
    // The parallel runs ending on each end of the step (o runs: their k is the step's along coordinate).
    const endOn=(r:WallRun,[x,y]:[number,number])=>{const [ax,ay]=pt(r,r.a),[bx,by]=pt(r,r.b);return ax===x&&ay===y?'a':bx===x&&by===y?'b':undefined;};
    const A=runs.find(r=>r.o===o&&endOn(r,p)),B=runs.find(r=>r.o===o&&endOn(r,q));
    if(!A||!B||endOn(A,p)===endOn(B,q))continue;
    const [from,to,eFrom]=A.b-A.a<=B.b-B.a?[A,B,endOn(A,p)!]:[B,A,endOn(B,q)!];
    const far=eFrom==='a'?from.b:from.a,lo=Math.min(from.a,from.b),hi=Math.max(from.a,from.b);
    const idx=(along:number,k:number)=>{const [x,y]=o==='h'?[along,k]:[k,along];return y*NW+x;};
    const xy=(along:number,k:number):[number,number]=>o==='h'?[along,k]:[k,along];
    let ok=true;
    for(let t=lo;t<=hi;t++){
      if(!near(...xy(t,to.k)))ok=false;
      if(t!==lo&&t!==hi&&deg(...xy(t,from.k))!==2)ok=false;
    }
    if(!ok)continue;
    const keepFar=deg(...xy(far,from.k))>1;
    for(let t=lo;t<=hi;t++){
      g[idx(t,to.k)]=1;
      if(!(t===far&&keepFar))g[idx(t,from.k)]=0;
    }
    return true;
  }
  return false;
}

/**
 * Small leftovers: a half-cell hook at a line's end (an end point whose neighbour does not go on straight) and the
 * little squares of 2×2 points the passes above may leave at a junction (a point of the square joined to nothing else).
 */
function tidy(g:Uint8Array,NW:number,NH:number,at:(x:number,y:number)=>number,deg:(x:number,y:number)=>number){
  let changed=false;
  const N4=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<NH;y++)for(let x=0;x<NW;x++){
    if(!g[y*NW+x]||deg(x,y)!==1)continue;
    const [dx,dy]=N4.find(([dx,dy])=>at(x+dx,y+dy))!,nx=x+dx,ny=y+dy;
    if(deg(nx,ny)>=2&&!at(nx+dx,ny+dy)){g[y*NW+x]=0;changed=true;}
  }
  for(let y=0;y+1<NH;y++)for(let x=0;x+1<NW;x++){
    if(!(at(x,y)&&at(x+1,y)&&at(x,y+1)&&at(x+1,y+1)))continue;
    const lone=([[x,y],[x+1,y],[x,y+1],[x+1,y+1]] as const).find(([px,py])=>deg(px,py)===2);
    if(lone){g[lone[1]*NW+lone[0]]=0;changed=true;}
  }
  return changed;
}

/** Zhang–Suen thinning in place (8-neighbourhood), to a skeleton one point wide. */
function thin(g:Uint8Array,NW:number,NH:number,at:(x:number,y:number)=>number){
  const del:number[]=[];
  for(let changed=true;changed;){
    changed=false;
    for(const step of [0,1]){
      del.length=0;
      for(let y=1;y<NH-1;y++)for(let x=1;x<NW-1;x++){
        if(!g[y*NW+x])continue;
        const p2=at(x,y-1),p3=at(x+1,y-1),p4=at(x+1,y),p5=at(x+1,y+1),p6=at(x,y+1),p7=at(x-1,y+1),p8=at(x-1,y),p9=at(x-1,y-1);
        const b=p2+p3+p4+p5+p6+p7+p8+p9;
        if(b<2||b>6)continue;
        const s=[p2,p3,p4,p5,p6,p7,p8,p9,p2];let a=0;for(let i=0;i<8;i++)if(!s[i]&&s[i+1])a++;
        if(a!==1)continue;
        if(step===0?(p2*p4*p6||p4*p6*p8):(p2*p4*p8||p2*p6*p8))continue;
        del.push(y*NW+x);
      }
      for(const i of del)g[i]=0;
      if(del.length)changed=true;
    }
  }
}

/** Point of a run at `along`, in sub coordinates. */
const pt=(r:WallRun,along:number):[number,number]=>r.o==='h'?[along,r.k]:[r.k,along];

/**
 * The pieces of the runs: one cell (2 sub) long each, back to back. A run of an odd length leaves its half cell at a
 * free end (an end no other run touches: the line just stops half a cell sooner, inside its wall) or, between two
 * junctions, overlaps its last piece by half (NEW-20261029-ORQ-cercas-nordeste-ligadas: no piece over another where a
 * free end can take the slack).
 */
export function wallPieces(runs:readonly WallRun[]):WallPiece[]{
  const ends=new Map<number,number>(),key=([x,y]:[number,number])=>y*0x10000+x;
  for(const r of runs)for(const e of [r.a,r.b]){const k=key(pt(r,e));ends.set(k,(ends.get(k)??0)+1);}
  const out:WallPiece[]=[];
  for(const r of runs){
    const len=r.b-r.a,n=Math.floor(len/2),put=(along:number)=>{const [cx,cy]=pt(r,along);out.push({cx,cy,o:r.o});};
    const freeA=ends.get(key(pt(r,r.a)))===1,freeB=ends.get(key(pt(r,r.b)))===1;
    const from=len%2&&freeA&&!freeB?r.a+1:r.a;
    for(let i=0;i<n;i++)put(from+1+2*i);
    if(len%2&&n&&!freeA&&!freeB)put(r.b-1);
  }
  return out;
}

/**
 * The cell rect whose centre is the piece's centre (CityDecor c, r, w, h; the render draws a wall piece at the centre of
 * its cells): 1 cell on an axis where the centre is mid-cell, 2 where it is on a cell edge.
 */
export function pieceRect(p:WallPiece):{c:number;r:number;w:number;h:number}{
  const span=(s:number)=>s%2?{at:(s-1)/2,n:1}:{at:s/2-1,n:2};
  const x=span(p.cx),y=span(p.cy);
  return {c:x.at,r:y.at,w:x.n,h:y.n};
}
