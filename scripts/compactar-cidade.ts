// NEW-20261023-ORQ-mapa-175-com-viaduto (etapa 2, O2 approved by the user 23/10): the Cidade Nevada with its distances
// CITY_COMPACT (1.75×) shorter and its walls as thick as today. The layout is resampled on the SAME cell (1.496 u):
// 192² → 110² cells. Bodies, props, buildings and the wall thickness keep their size; streets, rooms, yards and the
// plaza shrink.
//   - solid cells: a target cell is solid when the centre of a solid source cell falls in it (block of the majority).
//     A wall 1 cell thick stays 1 cell thick and stays continuous (two neighbour source cells map to the same or to
//     neighbour target cells, since the step 1/1.75 is under 1);
//   - open ground keeps its topology: each open region of the source (4-neighbour) must stay ONE region, and two regions
//     must not merge. Where the solid cells closed a region's own ground (a 1–2 cell door), the cheapest cells that only
//     that region maps to are opened again (repair), then every 1-cell door is widened to 2 where the region allows;
//   - buildings keep today's size around their mapped centre, slid up to 2 cells when that closes a room; the ones that
//     still do not fit shrink (the big ones from 1/BIG_SHRINK, card decision 2); open slivers they cut off close;
//   - the plaza loses its three fountains (PLAZA_DROP) with their basins' water, and its base point goes to the centre of
//     its four mouths;
//   - water and heights are sampled at the mapped point (a lake shrinks, a cliff keeps its height);
//   - props move to their mapped point and keep their ground (open or block), else they are dropped (counted in the log);
//   - points (start, mouths, spawns): the mapped point, moved to the nearest open cell centre of the city's main ground
//     when the mapped one is closed or cut off;
//   - loot: generated anew (the user 23/10: "bem mais caixas pelo mapa e mais espalhadas"): spreadLoot.
// The result has no decor (scripts/cenario-cidade.ts places it after, version + 1).
//   node --experimental-strip-types scripts/compactar-cidade.ts [--check]
// --check: only verify that public/ holds exactly what this script writes, write nothing.
// The source is the asset of SOURCE_COMMIT without its decor (cenario-cidade.ts undecorate), read with git.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SAMPLES_PER_CELL,cityAssetToData,decodeCityAsset,encodeCityAsset,type CityAsset,type CityAssetData,type CityBlock,type CityPoint,type CityRect} from '../src/maps/city-asset.ts';
import {CITY_COMPACT} from '../src/rules/scale.ts';
import {RAMP_FOOT_CELLS,groundSolidCells,overDeck,onRamp,type CityViaduct} from '../src/maps/city/viaduct.ts';


const root=(path:string)=>fileURLToPath(new URL(`../${path}`,import.meta.url));
const JSON_PATH=root('public/maps/cidade-nevada.json'),MANIFEST_PATH=root('public/maps/cidade-nevada.manifest.json');
/** The commit whose asset (version 3, the 1.7× city with decor) is the source. */
export const SOURCE_COMMIT='e9c0cd68';
/** The 4 biggest buildings do not fit at today's size in their shrunk block: they shrink this much (card decision 2). */
export const BIG_SHRINK=1.3;
/** Shorter side (cells) from which a building is one of the big ones. */
export const BIG_MIN_CELLS=10;
/**
 * The plaza's three frozen fountains (the central ring, its two side pieces and their basins): the plaza 1.75× smaller
 * cannot hold them with the base, its four mouths and the build sites (the plaza point would sit on the S mouth line),
 * so they are not carried over; the base point (praca) goes to the centre of the four mouths, open ground now.
 */
export const PLAZA_DROP:readonly string[]=['b-0110','b-0111','b-0112','b-0113','b-0114','b-0115'];
/** Open source regions smaller than this (cells) may vanish (pockets of a few cells between rubble). */
export const KEEP_REGION=6;
/** An open pocket the compaction cut off from its region closes when smaller than this (cells); bigger ones stay. */
export const POCKET_KEEP=40;
/** A building may cut off at most this many cells of a region (beyond its own footprint). */
export const CUT_MAX=6;
/**
 * Nor lengthen the walk from the plaza to a spawn or the start by more than this (cells): a building that closes an
 * avenue keeps the city connected the long way round, and the moto, the enemies and the heroes would take it.
 */
export const DETOUR_MAX=4;
/** Loot: minimum distance between two points (u), and the cell of the coverage grid every open district must fill. */
export const LOOT_SPACING=11,LOOT_DISTRICT=22;
/** No loot point within this of the plaza centre (u): the plaza has its own crates (cityLoot.aroundPlaza). */
export const LOOT_FROM_PLAZA=14;
/** Nor within this of the start and the four spawns (u). */
export const LOOT_FROM_KEY=6;

type Json=Record<string,any>;
const N4=[[1,0],[-1,0],[0,1],[0,-1]] as const;
const r3=(v:number)=>Math.round(v*1000)/1000;

export interface Compacted {
  data:CityAssetData;
  /** Target cell → block index in data.blocks (−1 open). */
  cellBlock:Int32Array;
  log:Record<string,number|string>;
}

/** Map a source point (u) to the target map (u), before any snap. */
export const mapPoint=(p:CityPoint,k:number):CityPoint=>({x:p.x/k,y:p.y/k});

/** Source cells → block index (−1 open): a cell is solid when ≥ half its samples are, the block with most samples. */
function sourceCells(a:CityAsset):Int32Array{
  const n=a.cells.w,st=a.samples.step,S=a.samples.w,samp=new Int32Array(S*S).fill(-1);
  a.blocks.forEach((b,bi)=>{if(PLAZA_DROP.includes(b.id))return;for(const [x,y,w,h] of b.rects)
    for(let sy=Math.round(y/st);sy<Math.round((y+h)/st);sy++)for(let sx=Math.round(x/st);sx<Math.round((x+w)/st);sx++)if(sx>=0&&sy>=0&&sx<S&&sy<S)samp[sx+sy*S]=bi;});
  const out=new Int32Array(n*n).fill(-1),P=SAMPLES_PER_CELL;
  for(let cy=0;cy<n;cy++)for(let cx=0;cx<n;cx++){
    const votes=new Map<number,number>();let solid=0;
    for(let j=0;j<P;j++)for(let i=0;i<P;i++){const b=samp[(cx*P+i)+(cy*P+j)*S];if(b>=0){solid++;votes.set(b,(votes.get(b)??0)+1);}}
    if(solid*2<P*P)continue;
    let best=-1,bv=0;for(const [b,v] of votes)if(v>bv||(v===bv&&b<best)){best=b;bv=v;}
    out[cx+cy*n]=best;
  }
  // A small block no cell kept (a rubble sliver): its bbox centre's cell, so every block survives.
  const has=new Uint8Array(a.blocks.length);for(const b of out)if(b>=0)has[b]=1;
  a.blocks.forEach((b,bi)=>{if(has[bi]||PLAZA_DROP.includes(b.id))return;const cx=Math.floor((b.bbox[0]+b.bbox[2]/2)/a.unitsPerCell),cy=Math.floor((b.bbox[1]+b.bbox[3]/2)/a.unitsPerCell);
    if(cx>=0&&cy>=0&&cx<n&&cy<n&&out[cx+cy*n]<0)out[cx+cy*n]=bi;});
  return out;
}

/** 4-neighbour labels of the cells where `open(i)`; −1 elsewhere. */
function label(n:number,open:(i:number)=>boolean):{L:Int32Array;size:number[]}{
  const L=new Int32Array(n*n).fill(-1),size:number[]=[];
  for(let i=0;i<n*n;i++){
    if(L[i]>=0||!open(i))continue;
    const id=size.length,stack=[i];L[i]=id;let s=0;
    while(stack.length){const j=stack.pop()!,x=j%n,y=(j-x)/n;s++;
      for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=n||Y>=n)continue;const q=X+Y*n;if(L[q]<0&&open(q)){L[q]=id;stack.push(q);}}}
    size.push(s);
  }
  return {L,size};
}

/** Building cells (target) of block b at scale s, centred on its mapped bbox centre. */
function buildingCells(b:CityBlock,u:number,k:number,s:number,m:number,ox=0,oy=0):number[]{
  const [bx,by,bw,bh]=b.bbox,cx=(bx+bw/2)/k+ox*u,cy=(by+bh/2)/k+oy*u,out=new Set<number>();
  // Scaled shape: a target cell is in when its centre, taken back to the source shape, falls inside one of the rects.
  const W=bw*s,H=bh*s,x0=Math.round(cx/u-W/u/2),y0=Math.round(cy/u-H/u/2),cw=Math.max(1,Math.round(W/u)),ch=Math.max(1,Math.round(H/u));
  for(let j=0;j<ch;j++)for(let i=0;i<cw;i++){
    const sx=bx+((i+.5)/cw)*bw,sy=by+((j+.5)/ch)*bh;
    if(!b.rects.some(([x,y,w,h])=>sx>=x&&sx<x+w&&sy>=y&&sy<y+h))continue;
    const X=x0+i,Y=y0+j;if(X>=0&&Y>=0&&X<m&&Y<m)out.add(X+Y*m);
  }
  return [...out];
}

/** Cells (target) → merged rects [x,y,w,h] in u: row runs, then runs of equal span stacked. */
function cellsToRects(cells:number[],m:number,u:number):CityRect[]{
  const set=new Set(cells),runs:[number,number,number][]=[];
  for(let y=0;y<m;y++){let x=0;while(x<m){if(!set.has(x+y*m)){x++;continue;}const x0=x;while(x<m&&set.has(x+y*m))x++;runs.push([y,x0,x-x0]);}}
  const open=new Map<string,[number,number,number,number]>(),out:[number,number,number,number][]=[];
  for(const [y,x,w] of runs){const key=`${x},${w}`,o=open.get(key);
    if(o&&o[1]+o[3]===y)o[3]++;else{if(o)out.push(o);open.set(key,[x,y,w,1]);}}
  out.push(...open.values());
  out.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  return out.map(([x,y,w,h])=>[r3(x*u),r3(y*u),r3(w*u),r3(h*u)] as const);
}

/** The compacted asset data (no decor, no loot yet) from the source asset (no decor). */
export function compactCity(src:CityAsset,k=CITY_COMPACT):Compacted{
  const n=src.cells.w,m=Math.round(n/k),K=n/m,u=src.unitsPerCell,log:Record<string,number|string>={};
  if(src.cells.h!==n)throw new Error('square maps only');
  const sc=sourceCells(src),isBuilding=(b:number)=>b>=0&&src.blocks[b].kind==='building';
  const tc=(c:number)=>Math.min(m-1,Math.floor((c+.5)/K));
  // 1. Solid cells by the centre rule (buildings later, at their own size).
  const votes:Map<number,number>[]=Array.from({length:m*m},()=>new Map());
  for(let cy=0;cy<n;cy++)for(let cx=0;cx<n;cx++){const b=sc[cx+cy*n];if(b<0||isBuilding(b))continue;const v=votes[tc(cx)+tc(cy)*m];v.set(b,(v.get(b)??0)+1);}
  const cell=new Int32Array(m*m).fill(-1);
  for(let i=0;i<m*m;i++){let best=-1,bv=0;for(const [b,v] of votes[i])if(v>bv||(v===bv&&b<best)){best=b;bv=v;}cell[i]=best;}
  // 2. Source regions and the regions each target cell receives (centres of their open cells).
  const sr=label(n,i=>sc[i]<0);
  const regionsAt:number[][]=Array.from({length:m*m},()=>[]);
  const regionCount=new Map<string,number>();
  for(let cy=0;cy<n;cy++)for(let cx=0;cx<n;cx++){const r=sr.L[cx+cy*n];if(r<0)continue;const t=tc(cx)+tc(cy)*m,list=regionsAt[t];
    if(!list.includes(r))list.push(r);regionCount.set(`${t}:${r}`,(regionCount.get(`${t}:${r}`)??0)+1);}
  const ownedBy=(t:number)=>regionsAt[t].length===1?regionsAt[t][0]:-1;
  const bcell=new Int32Array(m*m).fill(-1);
  const carvable=(t:number,r:number)=>cell[t]>=0&&bcell[t]<0&&src.blocks[cell[t]].kind!=='edge'&&ownedBy(t)===r;
  const regionCells=new Map<number,number[]>();
  for(let t=0;t<m*m;t++)for(const r of regionsAt[t]){let l=regionCells.get(r);if(!l)regionCells.set(r,l=[]);l.push(t);}
  const kept=[...sr.size.keys()].filter(r=>sr.size[r]>=KEEP_REGION);
  /** Target components (4-neighbour) of region r's own open cells. */
  const compsOfRegion=(r:number)=>{const mine=regionCells.get(r)??[],set=new Set(mine),tl=label(m,i=>cell[i]<0&&set.has(i));
    const comps=new Map<number,number>();for(const t of mine)if(tl.L[t]>=0)comps.set(tl.L[t],(comps.get(tl.L[t])??0)+1);return {mine,set,tl,comps};};
  // 3. Repair: each kept source region must be one target region; carve its own cells (never a building or the edge).
  let carved=0;
  for(const r of kept){
    const {mine,set:mineSet,tl,comps}=compsOfRegion(r);
    if(comps.size===1)continue;
    if(comps.size===0){
      // Lost pocket: open its best own cell (most of its centres).
      let best=-1,bv=0;for(const t of mine){if(!carvable(t,r))continue;const v=regionCount.get(`${t}:${r}`)??0;if(v>bv){bv=v;best=t;}}
      if(best>=0){cell[best]=-1;carved++;}
      continue;
    }
    // Join every component to the biggest by the cheapest carve (0-1 BFS over the region's own cells).
    const main=[...comps].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
    const joined=new Set([main]);
    while(joined.size<comps.size){
      // 0-1 BFS: open cells cost 0, carving a solid cell of the region's own costs 1.
      const dist=new Map<number,number>(),prev=new Map<number,number>(),dq:number[]=[];let head=0;
      for(const t of mine)if(tl.L[t]>=0&&joined.has(tl.L[t])){dist.set(t,0);dq.push(t);}
      let hit=-1;
      while(head<dq.length){
        const t=dq[head++],dt=dist.get(t)!,x=t%m,y=(t-x)/m;
        if(tl.L[t]>=0&&!joined.has(tl.L[t])){hit=t;break;}
        for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const q=X+Y*m;
          if(!mineSet.has(q))continue;const open=cell[q]<0;if(!open&&!carvable(q,r))continue;
          const d=dt+(open?0:1);if(d<(dist.get(q)??Infinity)){dist.set(q,d);prev.set(q,t);if(open){dq.splice(head,0,q);}else dq.push(q);}}
      }
      if(hit<0){log[`unjoined-${r}`]=comps.size-joined.size;break;}
      joined.add(tl.L[hit]);
      for(let t=hit;prev.has(t);t=prev.get(t)!)if(cell[t]>=0){cell[t]=-1;carved++;}
    }
  }
  log.carved=carved;
  // 4. Doors ≥ 2 cells (the plan): an open cell with solid on both sides of an axis opens one side when that side is its
  //    region's own and opening it touches no other region.
  let widened=0;
  const onlyMine=(q:number,r:number)=>N4.every(([dx,dy])=>{const X=q%m+dx,Y=Math.floor(q/m)+dy;if(X<0||Y<0||X>=m||Y>=m)return true;const z=X+Y*m;return cell[z]>=0||regionsAt[z].length===0||regionsAt[z].every(o=>o===r);});
  for(let pass=0;pass<2;pass++)for(let t=0;t<m*m;t++){
    if(cell[t]>=0)continue;const x=t%m,y=(t-x)/m,r=ownedBy(t);if(r<0)continue;
    for(const [ax,ay] of [[1,0],[0,1]] as const){
      if(x-ax<0||y-ay<0||x+ax>=m||y+ay>=m)continue;
      const a=x-ax+(y-ay)*m,b=x+ax+(y+ay)*m;
      if(cell[a]<0||cell[b]<0)continue;
      const side=[a,b].find(q=>carvable(q,r)&&onlyMine(q,r));
      if(side!==undefined){cell[side]=-1;widened++;}
    }
  }
  log.widened=widened;
  // 4b. Avenues: the source's shortest walk (4-neighbour) from the plaza to each spawn and to the start, mapped, stays
  //     open. Rocks a cell or two apart on the source (an open yard between cliff pieces) can meet on the shorter grid
  //     and close a street the city still reaches the long way round, which the region repair does not see.
  {
    const srcCell=(p:CityPoint)=>Math.floor(p.x/u)+Math.floor(p.y/u)*n;
    const from=srcCell(src.points.praca),prev=new Int32Array(n*n).fill(-2),queue=[from];prev[from]=-1;
    for(let h=0;h<queue.length;h++){const t=queue[h],x=t%n,y=(t-x)/n;for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=n||Y>=n)continue;const q=X+Y*n;if(prev[q]===-2&&sc[q]<0){prev[q]=t;queue.push(q);}}}
    let opened=0,blocked=0;
    const P=src.points;
    for(const k of [P.spawnN,P.spawnS,P.spawnL,P.spawnO,P.inicio]){
      for(let c=srcCell(k);c>=0&&prev[c]!==-2;c=prev[c]){
        const t=tc(c%n)+tc(Math.floor(c/n))*m;if(cell[t]<0)continue;
        if(carvable(t,sr.L[c])){cell[t]=-1;opened++;}else blocked++;
      }
    }
    log.avenueOpened=opened;log.avenueBlocked=blocked;
  }
  // 5. Buildings, biggest first, at the largest scale (today's size first; the big ones from 1/BIG_SHRINK) that overlaps
  //    no other building, leaves every region as connected as it was and closes no avenue (DETOUR_MAX).
  const order=src.blocks.map((b,bi)=>[b,bi] as const).filter(([b])=>b.kind==='building').sort((p,q)=>q[0].bbox[2]*q[0].bbox[3]-p[0].bbox[2]*p[0].bbox[3]||p[1]-q[1]);
  const scales:string[]=[];
  /** Per kept region, the cells of it in its biggest real component (all open cells, 4-neighbour). */
  const mainSizes=()=>{const tl=label(m,i=>cell[i]<0),count=new Map<string,number>();
    for(let t=0;t<m*m;t++)if(cell[t]<0)for(const r of regionsAt[t])count.set(`${r}:${tl.L[t]}`,(count.get(`${r}:${tl.L[t]}`)??0)+1);
    const out=new Map<number,number>();for(const [key,c] of count){const r=+key.split(':')[0];if(c>(out.get(r)??0))out.set(r,c);}return out;};
  let before=mainSizes();
  // The walk (cells, 4-neighbour) from the plaza's mapped cell to the mapped spawns and start.
  const keyCells=[src.points.praca,src.points.spawnN,src.points.spawnS,src.points.spawnL,src.points.spawnO,src.points.inicio]
    .map(p=>tc(Math.floor(p.x/u))+tc(Math.floor(p.y/u))*m);
  const walks=()=>{
    const d=new Int32Array(m*m).fill(-1),queue=[keyCells[0]];d[keyCells[0]]=0;
    for(let h=0;h<queue.length;h++){const t=queue[h],x=t%m,y=(t-x)/m;for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const q=X+Y*m;if(d[q]<0&&cell[q]<0){d[q]=d[t]+1;queue.push(q);}}}
    // A key cell on a solid cell (a point the snap moves later) reads its nearest open neighbour.
    return keyCells.slice(1).map(t=>{if(d[t]>=0)return d[t];let best=Infinity;for(const [dx,dy] of [...N4,[1,1],[-1,1],[1,-1],[-1,-1]]){const q=t+dx+dy*m;if(q>=0&&q<m*m&&d[q]>=0)best=Math.min(best,d[q]+1);}return best;});
  };
  let walk=walks();
  for(const [b,bi] of order){
    const big=Math.min(b.bbox[2],b.bbox[3])/u>=BIG_MIN_CELLS;
    const tries=[1,1/1.15,1/1.3,1/1.5,1/K].filter(s=>!big||s<=1/BIG_SHRINK+1e-9);
    let placed=0;
    const offsets=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]] as const;
    let shift='';
    tryAll:for(const s of tries)for(const [ox,oy] of offsets){
      const cells=buildingCells(b,u,K,s,m,ox,oy);
      if(!cells.length||cells.some(t=>bcell[t]>=0))continue;
      const saved=cells.map(t=>cell[t]);
      for(const t of cells)cell[t]=bi;
      // A building may take its own cells from a region, and cut off at most CUT_MAX more (slivers step 6 closes).
      const now=mainSizes(),cover=new Map<number,number>();for(const t of cells)if(saved[cells.indexOf(t)]<0)for(const r of regionsAt[t])cover.set(r,(cover.get(r)??0)+1);
      const bad=kept.filter(r=>(before.get(r)??0)-(now.get(r)??0)-(cover.get(r)??0)>CUT_MAX);
      const nowWalk=bad.length?walk:walks();
      if(!bad.length&&nowWalk.every((w,i)=>w<=walk[i]+DETOUR_MAX)){for(const t of cells)bcell[t]=bi;placed=s;before=now;walk=nowWalk;if(ox||oy)shift=`(${ox},${oy})`;break tryAll;}
      cells.forEach((t,i)=>{cell[t]=saved[i];});
    }
    if(!placed){
      // Never dropped: its mapped size (1/K) on whatever is there.
      const cells=buildingCells(b,u,K,1/K,m).filter(t=>bcell[t]<0);for(const t of cells){cell[t]=bi;bcell[t]=bi;}placed=1/K;
    }
    scales.push(`${b.id}:${(1/placed).toFixed(2)}${shift}`);
  }
  log.buildings=scales.filter(s=>!s.endsWith(':1.00')).join(' ');
  // 6. Open specks no kept region reaches (notches of the edge, gaps between rubble) close with their neighbour block.
  {
    // Kept: the biggest real component of each kept region (and any component of KEEP_REGION cells or more).
    const tl=label(m,i=>cell[i]<0),has=new Set<number>(),best=new Map<number,[number,number]>(),cnt=new Map<string,number>();
    for(let t=0;t<m*m;t++)if(cell[t]<0)for(const r of regionsAt[t]){if(sr.size[r]<KEEP_REGION)continue;const key=`${r}:${tl.L[t]}`,c=(cnt.get(key)??0)+1;cnt.set(key,c);
      const b=best.get(r);if(!b||c>b[1])best.set(r,[tl.L[t],c]);}
    for(const [,b] of best)has.add(b[0]);
    tl.size.forEach((sz,c)=>{if(sz>=POCKET_KEEP)has.add(c);});
    let filled=0;
    for(let pass=0;pass<4;pass++)for(let t=0;t<m*m;t++){
      if(cell[t]>=0||has.has(tl.L[t]))continue;
      const x=t%m,y=(t-x)/m;let nb=-1;
      for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const z=cell[X+Y*m];if(z>=0&&src.blocks[z].kind!=='building'){nb=z;break;}}
      if(nb>=0){cell[t]=nb;filled++;}
    }
    log.specksFilled=filled;
  }
  // 7. A block that kept no cell (a rubble sliver, a small cliff outvoted by its neighbour) takes back the solid cell its
  //    centre maps to when that cell's block keeps others: only the label changes, never the ground. Every id survives.
  {
    const count=new Map<number,number>();for(const b of cell)if(b>=0)count.set(b,(count.get(b)??0)+1);
    let relabelled=0;
    src.blocks.forEach((b,bi)=>{
      if(count.has(bi)||PLAZA_DROP.includes(b.id))return;
      const cx=Math.floor((b.bbox[0]+b.bbox[2]/2)/u),cy=Math.floor((b.bbox[1]+b.bbox[3]/2)/u),t0=tc(cx)+tc(cy)*m;
      // The mapped cell, else the nearest solid neighbour of it (3×3).
      const near=[t0,...[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]].map(([dx,dy])=>t0+dx+dy*m)];
      const t=near.find(q=>q>=0&&q<m*m&&cell[q]>=0&&bcell[q]<0&&(count.get(cell[q])??0)>1);
      if(t===undefined)return;
      count.set(cell[t],count.get(cell[t])!-1);cell[t]=bi;count.set(bi,1);relabelled++;
    });
    log.relabelled=relabelled;
  }
  // 8. Merge and split check.
  const tl=label(m,i=>cell[i]<0);
  const regionsOf=new Map<number,Set<number>>(),compsOf=new Map<number,Set<number>>();
  for(let t=0;t<m*m;t++){if(cell[t]>=0)continue;const c=tl.L[t];for(const r of regionsAt[t]){if(sr.size[r]<KEEP_REGION)continue;
    let a=regionsOf.get(c);if(!a)regionsOf.set(c,a=new Set());a.add(r);let b=compsOf.get(r);if(!b)compsOf.set(r,b=new Set());b.add(c);}}
  log.sourceRegions=kept.length;
  log.split=[...compsOf.values()].filter(s=>s.size>1).length;
  log.lost=kept.filter(r=>!compsOf.has(r)).length;
  log.merged=[...regionsOf.values()].filter(s=>s.size>1).length;
  log.targetRegions=tl.size.length;
  return {data:writeData(src,cell,K,m,log),cellBlock:cell,log};
}

function writeData(src:CityAsset,cell:Int32Array,K:number,m:number,log:Record<string,number|string>):CityAssetData{
  const u=src.unitsPerCell,P=SAMPLES_PER_CELL,S=m*P;
  const blocks:Json[]=[];
  const byBlock=new Map<number,number[]>();for(let t=0;t<m*m;t++)if(cell[t]>=0){let l=byBlock.get(cell[t]);if(!l)byBlock.set(cell[t],l=[]);l.push(t);}
  src.blocks.forEach((b,bi)=>{const cells=byBlock.get(bi);if(!cells)return;
    const rects=cellsToRects(cells,m,u);let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const [x,y,w,h] of rects){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+w);y1=Math.max(y1,y+h);}
    blocks.push({id:b.id,kind:b.kind,bbox:[r3(x0),r3(y0),r3(x1-x0),r3(y1-y0)],rects});});
  log.blocks=blocks.length;log.blocksDropped=src.blocks.length-blocks.length;
  const walkable=new Uint8Array(S*S),water=src.waterBits?new Uint8Array(S*S):undefined;
  // The dropped fountains' basins go with them (the plaza is paved now): their water would still place the fountain's
  // art (render/city/art-plan.ts fountainLot) over the base point, where the Uno and the team stand.
  // The basin runs between the fountains' blocks too: the box around all of them.
  const sk=src.samples.w/src.cells.w,dropped=src.blocks.filter(b=>PLAZA_DROP.includes(b.id)).map(b=>b.bbox);
  const bx0=Math.min(...dropped.map(b=>b[0])),by0=Math.min(...dropped.map(b=>b[1])),bx1=Math.max(...dropped.map(b=>b[0]+b[2])),by1=Math.max(...dropped.map(b=>b[1]+b[3]));
  const inDropped=(X:number,Y:number)=>{const x=(X+.5)/sk*u,y=(Y+.5)/sk*u;return x>=bx0&&x<bx1&&y>=by0&&y<by1;};
  for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){
    const i=sx+sy*S,t=Math.floor(sx/P)+Math.floor(sy/P)*m;
    walkable[i]=cell[t]<0?1:0;
    if(water&&walkable[i]){const X=Math.min(src.samples.w-1,Math.floor((sx+.5)*K)),Y=Math.min(src.samples.h-1,Math.floor((sy+.5)*K));water[i]=src.water(X,Y)&&!inDropped(X,Y)?1:0;}
  }
  const heights=new Float32Array((m+1)*(m+1));
  for(let y=0;y<=m;y++)for(let x=0;x<=m;x++)heights[x+y*(m+1)]=src.heightAt(x*u*K,y*u*K);
  const isOpen=(p:CityPoint)=>{const cx=Math.floor(p.x/u),cy=Math.floor(p.y/u);return cx>=0&&cy>=0&&cx<m&&cy<m&&cell[cx+cy*m]<0;};
  // Points go to the city's main ground (the component of the plaza's mapped cell): never into a pocket a building closed.
  const comp=label(m,i=>cell[i]<0).L,pq=mapPoint(src.points.praca,K);
  let main=-1,md=Infinity;
  for(let t=0;t<m*m;t++){if(comp[t]<0)continue;const d=((t%m+.5)*u-pq.x)**2+((Math.floor(t/m)+.5)*u-pq.y)**2;if(d<md){md=d;main=comp[t];}}
  const onMain=(p:CityPoint)=>isOpen(p)&&comp[Math.floor(p.x/u)+Math.floor(p.y/u)*m]===main;
  const snap=(p:CityPoint):CityPoint=>{
    const q=mapPoint(p,K);if(onMain(q))return {x:r3(q.x),y:r3(q.y)};
    let best:CityPoint|undefined,bd=Infinity;
    for(let t=0;t<m*m;t++){if(cell[t]>=0||comp[t]!==main)continue;const x=(t%m+.5)*u,y=(Math.floor(t/m)+.5)*u,d=(x-q.x)**2+(y-q.y)**2;if(d<bd){bd=d;best={x:r3(x),y:r3(y)};}}
    return best!;
  };
  const sp=src.points,bocas={N:snap(sp.bocas.N),S:snap(sp.bocas.S),L:snap(sp.bocas.L),O:snap(sp.bocas.O)};
  // The base point: the centre of the four mouths (the avenue planner's plaza centre), at its cell centre.
  const mid=Object.values(bocas).reduce((q,b)=>({x:q.x+b.x/4,y:q.y+b.y/4}),{x:0,y:0});
  const praca=snap({x:(Math.floor(mid.x/u)+.5)*u*K,y:(Math.floor(mid.y/u)+.5)*u*K});
  const points={inicio:snap(sp.inicio),praca,spawnN:snap(sp.spawnN),spawnS:snap(sp.spawnS),spawnL:snap(sp.spawnL),spawnO:snap(sp.spawnO),
    bocas};
  let propsDropped=0;
  // A prop keeps its ground: one on open ground (a car, a bench) stays on open ground, one on a block (a rock on a cliff)
  // stays on a block; the others are dropped.
  const props=src.props.flatMap(p=>{const q=mapPoint(p,K);if(isOpen(q)!==src.walkableAt(p.x,p.y)){propsDropped++;return [];}return [{...p,x:r3(q.x),y:r3(q.y)}];});
  log.propsDropped=propsDropped;
  const pl=src.playable;
  return {id:src.id,version:src.version+1,name:src.name,cells:{w:m,h:m},unitsPerCell:u,
    playable:{x:r3(pl.x/K),y:r3(pl.y/K),w:r3(pl.w/K),h:r3(pl.h/K)},
    walkable,...(water?{water}:{}),heights,points:points as CityAssetData['points'],blocks:blocks as CityBlock[],props,loot:[],
    source:{sha256:src.source!.sha256,note:`${src.source!.note}; distâncias ÷${CITY_COMPACT} com as paredes na mesma espessura (NEW-20261023-ORQ-mapa-175-com-viaduto, scripts/compactar-cidade.ts)`}};
}

/** Seeded uniform [0,1) (mulberry32): the loot draw is a pure function of the layout. */
function mulberry(seed:number){let a=seed>>>0;return()=>{a=a+0x6d2b79f5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export const LOOT_SEED=20261023;

/**
 * Loot points over the whole city (the user 23/10: "bem mais caixas pelo mapa e mais espalhadas, estão muito
 * aglomeradas"): cell centres the heroes reach from the plaza, with open ground on all 4 sides (never in a doorway),
 * LOOT_FROM_PLAZA u or more from the plaza and LOOT_FROM_KEY from the start and the spawns; a Poisson-disc draw (no two
 * closer than LOOT_SPACING) in seeded order, then every LOOT_DISTRICT square with room for a crate and none yet gets the
 * candidate nearest its centre (at least LOOT_SPACING / 2 from the others). Sorted by row.
 */
export function spreadLoot(a:CityAsset,seed=LOOT_SEED):CityPoint[]{
  const m=a.cells.w,u=a.unitsPerCell,open=new Uint8Array(m*m);
  for(let t=0;t<m*m;t++)open[t]=a.walkableAt((t%m+.5)*u,(Math.floor(t/m)+.5)*u)?1:0;
  const start=Math.floor(a.points.praca.x/u)+Math.floor(a.points.praca.y/u)*m,seen=new Uint8Array(m*m),queue=[start];seen[start]=1;
  for(let h=0;h<queue.length;h++){const t=queue[h],x=t%m,y=(t-x)/m;for(const [dx,dy] of N4){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const q=X+Y*m;if(open[q]&&!seen[q]){seen[q]=1;queue.push(q);}}}
  const pl=a.playable,P=a.points.praca,cands:CityPoint[]=[],{inicio,spawnN,spawnS,spawnL,spawnO}=a.points,keys=[inicio,spawnN,spawnS,spawnL,spawnO];
  for(const t of queue){const x=t%m,y=(t-x)/m;
    if(!N4.every(([dx,dy])=>open[(x+dx)+(y+dy)*m]))continue;
    const p={x:r3((x+.5)*u),y:r3((y+.5)*u)};
    if(p.x<pl.x||p.y<pl.y||p.x>pl.x+pl.w||p.y>pl.y+pl.h||Math.hypot(p.x-P.x,p.y-P.y)<LOOT_FROM_PLAZA)continue;
    if(keys.some(k=>Math.hypot(p.x-k.x,p.y-k.y)<LOOT_FROM_KEY))continue;
    // Nor on or beside a viaduct: a crate is a ground pickup, the deck's floor has none (its start keeps LOOT_FROM_KEY).
    if(nearViaduct(a,p.x,p.y,u))continue;

    cands.push(p);}
  const rnd=mulberry(seed),order=cands.map(c=>[rnd(),c] as const).sort((p,q)=>p[0]-q[0]).map(([,c])=>c);
  const out:CityPoint[]=[],far=(p:CityPoint,d:number)=>out.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>=d);
  for(const c of order)if(far(c,LOOT_SPACING))out.push(c);
  for(let gy=pl.y;gy<pl.y+pl.h;gy+=LOOT_DISTRICT)for(let gx=pl.x;gx<pl.x+pl.w;gx+=LOOT_DISTRICT){
    const inside=cands.filter(c=>c.x>=gx&&c.x<gx+LOOT_DISTRICT&&c.y>=gy&&c.y<gy+LOOT_DISTRICT);
    if(!inside.length||out.some(c=>c.x>=gx&&c.x<gx+LOOT_DISTRICT&&c.y>=gy&&c.y<gy+LOOT_DISTRICT))continue;
    const cx=gx+LOOT_DISTRICT/2,cy=gy+LOOT_DISTRICT/2;
    inside.sort((p,q)=>Math.hypot(p.x-cx,p.y-cy)-Math.hypot(q.x-cx,q.y-cy));
    const pick=inside.find(c=>far(c,LOOT_SPACING/2));if(pick)out.push(pick);
  }
  return out.sort((p,q)=>p.y-q.y||p.x-q.x);
}

/**
 * The main viaduct (etapa 3, plans/mapa-175-viaduto.md §4): North–South over the centre-north street (columns 51–54 of
 * the 110² grid), from the map's north edge (row 5) down a ramp toward the plaza's N mouth. Deck 4 cells wide (6 u)
 * and 19 long, over the pocket at the edge and the street along it; ramp 12 cells (18 u, ~11°) in the street's wide stretch (rows
 * 24–35), whose 2 columns west of it (49–50) stay open ground (column 55 has the cliff stubs): the N avenue still runs from spawn N to its mouth beside
 * the ramp (the ramp in the 4-cell stretch of rows 39–45 closed it, and the N route, its build sites and a nest went with
 * it). 3.5 u over the street; pillars on both sides at rows 14 and 21, clear of the street it crosses (rows 10–13); none
 * in the pocket at the edge (rows 5–9), where a pillar left a corner that wide bodies chasing a team there stuck in.
 * The north end, at the edge, is closed (the pile-up of cars, art only): the ramp is the deck's only way up or down.
 */
export const VIADUCT:CityViaduct=Object.freeze({
  id:'viaduto-principal',deck:Object.freeze([51,5,4,19] as const),
  ramp:Object.freeze({rect:Object.freeze([51,24,4,12] as const),up:'N' as const}),
  pillars:Object.freeze([14,21].flatMap(r=>[Object.freeze([51,r] as const),Object.freeze([54,r] as const)])),
  height:3.5,
});
/**
 * The Uno where the run starts, on the deck (cells): its middle, by the closed north end, so the walk down the deck and
 * the ramp to the plaza is about the one the tutorial was tuned for (~73 u; cityRunStart).
 */
export const VIADUCT_START={c:53,r:7.5} as const;

/**
 * The viaduct on the compacted layout: its block in the asset, its pillars and the ramp's embankment solid on the
 * ground, the start on the deck, and no prop on the viaduct's footprint or beside it. A block that lies
 * wholly on the ramp, beside it or within RAMP_FOOT_CELLS of its foot goes (a wall stub of 4 cells stood where it lands, in

 * front of the N mouth), its cells open ground again. Throws when a
 * ramp cell or the start's is not open ground (the layout changed under it); the deck may pass over anything (the
 * cliff stubs beside the street), a pillar may stand on a solid cell.
 */
export function addViaduct(data:CityAssetData,v:CityViaduct=VIADUCT):void{
  const m=data.cells.w,u=data.unitsPerCell!,S=SAMPLES_PER_CELL,sw=m*S;
  const open=(c:number,r:number)=>{for(let j=0;j<S;j++)for(let i=0;i<S;i++)if(!data.walkable[(r*S+j)*sw+c*S+i])return false;return true;};
  const [rc,rr,rw,rh]=v.ramp.rect,F=RAMP_FOOT_CELLS;
  // The ramp, RAMP_FOOT_CELLS past its foot and a cell on each side.
  const landing=v.ramp.up==='N'?[rc-1,rr,rw+2,rh+F]:v.ramp.up==='S'?[rc-1,rr-F,rw+2,rh+F]:v.ramp.up==='W'?[rc,rr-1,rw+F,rh+2]:[rc-F,rr-1,rw+F,rh+2];
  const within=([x,y,w,h]:CityRect)=>x>=landing[0]*u-1e-3&&y>=landing[1]*u-1e-3&&x+w<=(landing[0]+landing[2])*u+1e-3&&y+h<=(landing[1]+landing[3])*u+1e-3;
  data.blocks=data.blocks.filter(b=>{
    if(!b.rects.every(within))return true;
    for(const [x,y,w,h] of b.rects)for(let r=Math.round(y/u);r<Math.round((y+h)/u);r++)for(let c=Math.round(x/u);c<Math.round((x+w)/u);c++)
      for(let j=0;j<S;j++)for(let i=0;i<S;i++)data.walkable[(r*S+j)*sw+c*S+i]=1;
    return false;
  });
  for(let r=rr;r<rr+rh;r++)for(let c=rc;c<rc+rw;c++)if(!open(c,r))throw new Error(`viaduct ${v.id}: ramp cell (${c},${r}) is not open ground`);
  if(!open(Math.floor(VIADUCT_START.c),Math.floor(VIADUCT_START.r))||!open(Math.floor(VIADUCT_START.c)-1,Math.floor(VIADUCT_START.r)))throw new Error(`viaduct ${v.id}: the start is not over open ground`);

  for(const [c,r] of groundSolidCells(v))for(let j=0;j<S;j++)for(let i=0;i<S;i++)data.walkable[(r*S+j)*sw+c*S+i]=0;
  data.viaducts=[v];
  data.points={...data.points,inicio:{x:r3(VIADUCT_START.c*u),y:r3(VIADUCT_START.r*u)}};
  // No prop on the ramp, under the deck or beside them (a parked car there stood through the deck on screen).
  data.props=data.props.filter(p=>![-u,0,u].some(dx=>[-u,0,u].some(dy=>onRamp(v,u,p.x+dx,p.y+dy)||overDeck(v,u,p.x+dx,p.y+dy))));
}
/** True when (x, y) (u) is on a viaduct of `a` or within `margin` u of one (deck or ramp). */
export const nearViaduct=(a:CityAsset,x:number,y:number,margin=0)=>a.viaducts.some(v=>{
  const u=a.unitsPerCell;
  for(const dx of [-margin,0,margin])for(const dy of [-margin,0,margin])if(overDeck(v,u,x+dx,y+dy)||onRamp(v,u,x+dx,y+dy))return true;
  return false;
});

/** The compacted city without decor (version SOURCE + 1), its viaduct added and its loot spread anew. */
export async function compactBase():Promise<{data:CityAssetData;log:Record<string,number|string>}>{
  const out=compactCity(await sourceAsset());
  addViaduct(out.data);
  const first=decodeCityAsset(encodeCityAsset(out.data));
  if(!first.ok)throw new Error(first.error);
  out.data.loot=spreadLoot(first.asset);
  out.log.loot=out.data.loot.length;
  return out;
}

/** The compacted asset text without decor (version SOURCE + 1), its viaduct added and its loot spread anew. */
export async function compactText():Promise<{text:string;log:Record<string,number|string>}>{
  const out=await compactBase();
  return {text:encodeCityAsset(out.data),log:out.log};
}

/** Whether this checkout has SOURCE_COMMIT (the CI checkout is shallow: it has not). */
export function sourceAvailable():boolean{
  try{execFileSync('git',['cat-file','-e',`${SOURCE_COMMIT}^{commit}`],{cwd:root('.'),stdio:'ignore'});return true;}
  catch{return false;}
}

/** The source asset: SOURCE_COMMIT's, without its decor. */
export async function sourceAsset():Promise<CityAsset>{
  const {undecorate}=await import('./cenario-cidade.ts');
  const text=execFileSync('git',['show',`${SOURCE_COMMIT}:public/maps/cidade-nevada.json`],{cwd:root('.'),encoding:'utf8',maxBuffer:64<<20});
  const d=decodeCityAsset(undecorate(text));
  if(!d.ok)throw new Error(d.error);
  return d.asset;
}

/**
 * The asset this script writes: the compacted city with its scenery placed (cenario-cidade.ts decorate, version + 1),
 * then its dead ends opened (scripts/becos-cidade.ts abrirBecos, version + 1: mapa-conexoes-sem-beco). The passages come
 * after the scenery so the scenery stays where it was (placed anew on the opened ground, a place with life closed a
 * street the Uno drove down); the pieces on an opened cell go. Last, the streets too narrow for the Uno widen
 * (becos-cidade.ts alargarParaUno, version + 1: uno-anda-mapa-todo), then the narrow ways into the hero's ground widen for
 * the Uno's body and the loose fences in the open go (becos-cidade.ts alargarAreaUno, tirarCercasSoltas, version + 1:
 * uno-atravessa-tralha), and the sidewalk objects in the middle of an entrance go (cenario-cidade.ts semDecorNasBocas,
 * version + 1: sem-tralha-nas-entradas); then the tall pieces and the graffiti on the walls (altos-grafites-cidade.ts
 * altosEGrafites, version + 1: cidade-decor-alto-e-grafite).
 */
export async function compactedAsset():Promise<{text:string;log:Record<string,number|string>}>{
  const {decorate,semDecorNasBocas}=await import('./cenario-cidade.ts');
  const {abrirBecos,alargarParaUno,tirarCercasSoltas,alargarAreaUno}=await import('./becos-cidade.ts');
  const {text,log}=await compactText();
  const decorated=decodeCityAsset(decorate(text));
  if(!decorated.ok)throw new Error(decorated.error);
  const opened=abrirBecos(cityAssetToData(decorated.asset));
  Object.assign(log,{passagens:opened.passagens.length,entulho:opened.rubble.length,ruinas:opened.ruins,caixasBeco:opened.lootAdded,caixasMovidas:opened.lootMoved});
  // Then the narrow streets the Uno does not get down (version + 1: uno-anda-mapa-todo).
  const wide=alargarParaUno(opened.data);opened.data.version++;
  Object.assign(log,{celulasAlargadas:wide.cells.length,ruasAlargadas:wide.widened,alargarRecusado:wide.refused,entulhoUno:wide.rubble.length,caixasAoUno:wide.moved,caixasUno:`${wide.before}→${wide.after}/${wide.total}`});
  // The hero's ground the Uno's body misses: its narrow ways widened (version + 1: uno-atravessa-tralha).
  const area=alargarAreaUno(opened.data);opened.data.version++;
  Object.assign(log,{celulasArea:area.cells.length,areaAlargada:area.widened,areaRecusada:area.refused,caixasAoCorpo:area.moved,areaUno:`${(100*area.before).toFixed(1)}→${(100*area.after).toFixed(1)}%`});
  // Then the loose fences in the open, junk in the Uno's way (the widening may have left a bit of one alone).
  const loose=tirarCercasSoltas(opened.data);
  Object.assign(log,{cercasSoltas:loose.taken.length,celulasCerca:loose.taken.flat().length,cercaRecusada:loose.refused});
  // The sidewalk objects that narrow an entrance (version + 1: sem-tralha-nas-entradas).
  const bocas=semDecorNasBocas(opened.data);opened.data.version++;
  Object.assign(log,{decorNasBocas:bocas.length});
  // What the mouths lost comes back on the walls: tall pieces and graffiti (version + 1: cidade-decor-alto-e-grafite).
  const {altosEGrafites}=await import('./altos-grafites-cidade.ts');
  const altos=altosEGrafites(opened.data,bocas);opened.data.version++;
  Object.assign(log,{altos:altos.altos.length,grafites:altos.grafites.length});
  return {text:encodeCityAsset(opened.data),log};
}

if(process.argv[1]?.replace(/\\/g,'/').endsWith('scripts/compactar-cidade.ts')){
  const {text,log}=await compactedAsset();
  const decoded=decodeCityAsset(text);
  if(!decoded.ok)throw new Error(`the compacted asset does not decode: ${decoded.error}`);
  const hash=createHash('sha256').update(text).digest('hex'),bytes=Buffer.byteLength(text);
  console.log(JSON.stringify(log));
  if(process.argv.includes('--check')){
    if(readFileSync(JSON_PATH,'utf8')!==text){console.error('public/maps/cidade-nevada.json is not what scripts/compactar-cidade.ts writes');process.exit(1);}
    console.log(`ok: version ${decoded.asset.version}, ${hash}`);
  }else{
    writeFileSync(JSON_PATH,text);
    writeFileSync(MANIFEST_PATH,JSON.stringify({id:decoded.asset.id,version:decoded.asset.version,hash,bytes},null,2)+'\n');
    console.log(`written: version ${decoded.asset.version}, ${decoded.asset.cells.w}×${decoded.asset.cells.h} cells, ${decoded.asset.loot.length} loot, ${decoded.asset.decor.length} decor, ${bytes} bytes, ${hash}`);
  }
}
