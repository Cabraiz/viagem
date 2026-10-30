/**
 * NEW-20261025-ORQ-mapa-conexoes-sem-beco (o usuário 25/10: "faltou conexões entre os lugares, vi muito beco sem
 * saída"): the Cidade Nevada's street network seen as a graph of cells.
 *  - becos: the open ground (cells whose centre a hero stands on, reached from the plaza) thinned to its skeleton
 *    (Zhang–Suen); a branch from a skeleton end to the first junction at least BECO_MIN cells long is a dead end;
 *  - caminhada × linha reta: the walk (8-neighbour, no corner cutting) between places of interest and between loot
 *    points, over the straight line;
 *  - passagens: openPassages cuts holes 2 cells wide through thin walls, rubble and fences where the walk around is
 *    long (greedy, the biggest detour first), never into the plaza ring, a nest's block or yard, a cliff or the edge.
 * Uso: node --experimental-strip-types scripts/becos-cidade.ts [--png saida.png] [--json saida.json]
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SAMPLES_PER_CELL,cityAssetToData,decodeCityAsset,encodeCityAsset,type CityAsset,type CityAssetData,type CityBlock,type CityDecor,type CityPoint,type CityProp,type CityRect} from '../src/maps/city-asset.ts';
import {CITY_NEST_SPOTS,NEST_YARD_RADIUS} from '../src/maps/nests.ts';
import {overDeck,onRamp} from '../src/maps/city/viaduct.ts';
import {CityTerrain} from '../src/maps/city/terrain.ts';
import {citySafePlaces} from '../src/maps/safe-places.ts';
import {CAR_BODY_R,CAR_RADIUS} from '../src/contract/index.ts';
import {BIG_ROCKS,LINK,bigCliffRocks,lineShape} from '../src/maps/city-decor.ts';

/** A dead end: a skeleton branch at least this long (cells) from its end to a junction. */
export const BECO_MIN=3;
/** Walk over straight line the card asks for between places of interest (≤ ~1.4×). */
export const RATIO_GOAL=1.4;
/** Pairs closer than this (u) in straight line are not measured (a few steps; any wall doubles them). */
export const PAIR_MIN=15;
/** And farther than this (u): across the whole city the avenues are the way, and the ratio says little. */
export const PAIR_MAX=70;

export interface CityGraph {
  readonly a:CityAsset; readonly m:number; readonly u:number;
  /** 1 where a hero stands at the cell centre. */
  readonly open:Uint8Array;
  /** 1 where the cell is open and reached from the plaza (4-neighbour). */
  readonly city:Uint8Array;
  /** The block kind whose rect covers the cell ('' when none). */
  readonly kind:readonly string[];
  readonly blockOf:readonly (CityBlock|undefined)[];
  /** Cells of the safe places (maps/safe-places.ts: pockets behind one small opening, kept on purpose). */
  readonly safe:ReadonlySet<number>;
}

const cellOf=(g:{m:number;u:number},p:CityPoint)=>Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m;

export function cityGraph(a:CityAsset):CityGraph{
  const m=a.cells.w,u=a.unitsPerCell,open=new Uint8Array(m*m),city=new Uint8Array(m*m);
  for(let t=0;t<m*m;t++)open[t]=a.walkableAt((t%m+.5)*u,(Math.floor(t/m)+.5)*u)?1:0;
  const kind:string[]=new Array(m*m).fill(''),blockOf:(CityBlock|undefined)[]=new Array(m*m).fill(undefined);
  for(const b of a.blocks)for(const [x,y,w,h] of b.rects)
    for(let cy=Math.round(y/u);cy<Math.round((y+h)/u);cy++)for(let cx=Math.round(x/u);cx<Math.round((x+w)/u);cx++)
      if(cx>=0&&cy>=0&&cx<m&&cy<m){kind[cx+cy*m]=b.kind;blockOf[cx+cy*m]=b;}
  const s=cellOf({m,u},a.points.praca),q=[s];city[s]=1;
  for(let h=0;h<q.length;h++){const t=q[h],x=t%m,y=(t-x)/m;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy,n=X+Y*m;if(X>=0&&Y>=0&&X<m&&Y<m&&!city[n]&&open[n]){city[n]=1;q.push(n);}}}
  const safe=new Set<number>();for(const p of citySafePlaces(new CityTerrain(a,'becos')))for(const t of p.cells)safe.add(t);
  return {a,m,u,open,city,kind,blockOf,safe};
}

/** Walk distance (cells) from `from` over `ok` cells, 8-neighbour without cutting a corner (Dijkstra, 1 / √2). */
export function walk(ok:Uint8Array,m:number,from:number):Float64Array{
  const d=new Float64Array(m*m).fill(Infinity);d[from]=0;
  // Bucketed queue on tenths of a cell: the costs are 1 and 1.414, so 10 / 14 tenths.
  const buckets:number[][]=[[from]];
  for(let b=0;b<buckets.length;b++){const list=buckets[b];if(!list)continue;
    for(const t of list){const dt=Math.round(d[t]*10);if(dt!==b)continue;
      const x=t%m,y=(t-x)/m;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;
        const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const n=X+Y*m;if(!ok[n])continue;
        if(dx&&dy&&(!ok[x+dx+y*m]||!ok[x+(y+dy)*m]))continue;
        const step=dx&&dy?14:10,nd=b+step;
        if(nd<Math.round(d[n]*10)){d[n]=nd/10;(buckets[nd]??=[]).push(n);}
      }}}
  return d;
}

/** Zhang–Suen thinning of `ok` (1 = ground): its 1-cell skeleton. */
export function skeleton(ok:Uint8Array,m:number):Uint8Array{
  const s=ok.slice(),at=(x:number,y:number)=>x<0||y<0||x>=m||y>=m?0:s[x+y*m];
  for(let changed=true;changed;){changed=false;
    for(const pass of [0,1]){const del:number[]=[];
      for(let y=0;y<m;y++)for(let x=0;x<m;x++){if(!s[x+y*m])continue;
        const p=[at(x,y-1),at(x+1,y-1),at(x+1,y),at(x+1,y+1),at(x,y+1),at(x-1,y+1),at(x-1,y),at(x-1,y-1)];
        const B=p.reduce((a,b)=>a+b,0);if(B<2||B>6)continue;
        let A=0;for(let i=0;i<8;i++)if(!p[i]&&p[(i+1)%8])A++;if(A!==1)continue;
        if(pass===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
        del.push(x+y*m);}
      for(const t of del)s[t]=0;if(del.length)changed=true;}}
  return s;
}

export interface Beco {readonly end:CityPoint; readonly cells:readonly number[]; readonly length:number; readonly loot:boolean; readonly abrigo:boolean}
/**
 * The dead ends of the city's ground (branches of its skeleton ≥ BECO_MIN cells), with whether loot waits at the end
 * and whether the end is a safe place (abrigo: a pocket with one opening, a dead end on purpose).
 */
export function becos(g:CityGraph,min=BECO_MIN):Beco[]{
  const {m,u}=g,s=skeleton(g.city,m),nb=(t:number)=>{const x=t%m,y=(t-x)/m,out:number[]=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<m&&Y<m&&s[X+Y*m])out.push(X+Y*m);}return out;};
  const lootCells=new Set(g.a.loot.map(p=>cellOf(g,p)));
  const out:Beco[]=[];
  for(let t=0;t<m*m;t++){if(!s[t]||nb(t).length!==1)continue;
    const cells=[t];let prev=-1,cur=t,len=0;
    for(;;){const next=nb(cur).filter(n=>n!==prev&&!cells.includes(n));
      if(nb(cur).length>=3&&cur!==t)break;
      if(next.length!==1)break;
      const n=next[0];len+=(n%m!==cur%m&&Math.floor(n/m)!==Math.floor(cur/m))?Math.SQRT2:1;prev=cur;cur=n;cells.push(n);}
    if(len<min)continue;
    // Loot in it (within 2 cells of the branch) is a reason to walk in.
    const x=t%m,y=(t-x)/m;
    const loot=cells.some(c=>{const cx=c%m,cy=(c-cx)/m;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(lootCells.has(cx+dx+(cy+dy)*m))return true;return false;});
    out.push({end:{x:(x+.5)*u,y:(y+.5)*u},cells,length:len,loot,abrigo:g.safe.has(t)});
  }
  return out;
}

export interface Lugar {readonly id:string; readonly p:CityPoint}
/** The places of interest that do not move from run to run: plaza, start (the Uno), mouths, spawns, nests. */
export function lugares(a:CityAsset):Lugar[]{
  const P=a.points;
  return [{id:'praça',p:P.praca},{id:'início',p:P.inicio},
    ...Object.entries(P.bocas).map(([k,p])=>({id:`boca ${k}`,p})),
    ...(['spawnN','spawnS','spawnL','spawnO'] as const).map(k=>({id:k,p:P[k]})),
    ...CITY_NEST_SPOTS.map(n=>({id:n.id,p:{x:n.x,y:n.y}}))];
}

/** The nearest city cell to `p` (a point may sit on a wall cell's edge). */
function cityCell(g:CityGraph,p:CityPoint):number{
  const {m,u}=g;let best=-1,bd=Infinity;
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const x=Math.floor(p.x/u)+dx,y=Math.floor(p.y/u)+dy;if(x<0||y<0||x>=m||y>=m)continue;
    const t=x+y*m;if(!g.city[t])continue;const d=((x+.5)*u-p.x)**2+((y+.5)*u-p.y)**2;if(d<bd){bd=d;best=t;}}
  return best;
}

export interface Par {readonly a:string; readonly b:string; readonly reta:number; readonly anda:number; readonly ratio:number}
/** Walk / straight line for every pair of `pts` between PAIR_MIN and PAIR_MAX u apart. */
export function ratios(g:CityGraph,pts:readonly Lugar[]):Par[]{
  const cells=pts.map(p=>cityCell(g,p.p)),out:Par[]=[];
  for(let i=0;i<pts.length;i++){if(cells[i]<0)continue;const d=walk(g.city,g.m,cells[i]);
    for(let j=i+1;j<pts.length;j++){if(cells[j]<0)continue;
      const reta=Math.hypot(pts[i].p.x-pts[j].p.x,pts[i].p.y-pts[j].p.y);if(reta<PAIR_MIN||reta>PAIR_MAX)continue;
      const anda=d[cells[j]]*g.u;out.push({a:pts[i].id,b:pts[j].id,reta,anda,ratio:anda/reta});}}
  return out;
}

export interface Resumo {
  becos:number; becosSemMotivo:number; becoCells:number;
  lugares:{pares:number; acima:number; mediana:number; pior:Par[]};
  caixas:{pares:number; acima:number; mediana:number; p90:number};
}
const median=(v:number[])=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
const pct=(v:number[],q:number)=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(s.length*q))]:0;};
export function resumo(a:CityAsset):Resumo{
  const g=cityGraph(a),b=becos(g),L=ratios(g,lugares(a)),C=ratios(g,a.loot.map((p,i)=>({id:`caixa ${i}`,p})));
  return {becos:b.length,becosSemMotivo:b.filter(x=>!x.loot&&!x.abrigo).length,becoCells:b.reduce((s,x)=>s+x.cells.length,0),
    lugares:{pares:L.length,acima:L.filter(p=>p.ratio>RATIO_GOAL).length,mediana:median(L.map(p=>p.ratio)),pior:[...L].sort((x,y)=>y.ratio-x.ratio).slice(0,12)},
    caixas:{pares:C.length,acima:C.filter(p=>p.ratio>RATIO_GOAL).length,mediana:median(C.map(p=>p.ratio)),p90:pct(C.map(p=>p.ratio),.9)}};
}

// ——— Passages ———

/** No hole within this of the plaza's base point (u): the plaza is entered only by its 4 mouths (their barricades). */
export const PLAZA_KEEP=20;
/** Nor within a nest's yard + this (u), nor through a nest's building: a shortcut must not break a nest's defence. */
export const NEST_KEEP=4;
/** A hole goes through at most this many solid cells (a wall 1–2 cells thick, a heap of rubble). */
export const CUT_MAX_DEPTH=3;
/** It is worth it when the walk around is at least this many cells longer than through it. */
export const CUT_MIN_SAVE=18;
/** At most this many holes. */
export const CUT_MAX=60;
/** A dead end without loot is opened at its end when a hole there saves at least this (cells). */
export const BECO_MIN_SAVE=4;
/**
 * Kinds a hole may go through. A cliff is a terrace step (maps/city/relief.ts relaxes it into a ramp once open): only
 * between two grounds at most CLIFF_STEP apart (one shelf), so a hole there reads as a ramp, not a jump.
 */
const CUTTABLE=new Set(['wall','rubble','edge','cliff']);
export const CLIFF_STEP=1.6;

export interface Passagem {readonly cells:readonly number[]; readonly from:number; readonly to:number; readonly save:number; readonly kinds:readonly string[]}

/**
 * Cells no hole goes into: the plaza ring (PLAZA_KEEP), a nest's yard + NEST_KEEP or its building, a safe place or a
 * cell beside it, a viaduct's deck or ramp.
 */
export function passageBan(g:CityGraph):(t:number)=>boolean{
  const {a,m,u}=g,P=a.points;
  const near=(t:number,p:CityPoint,r:number)=>Math.hypot((t%m+.5)*u-p.x,(Math.floor(t/m)+.5)*u-p.y)<r;
  const nestBlocks=new Set(CITY_NEST_SPOTS.filter(n=>n.block).map(n=>n.block));
  return (t:number)=>{
    if(near(t,P.praca,PLAZA_KEEP))return true;
    for(const n of CITY_NEST_SPOTS)if(near(t,n,NEST_YARD_RADIUS[n.maxSize]+NEST_KEEP))return true;
    const b=g.blockOf[t];if(b&&nestBlocks.has(b.id))return true;
    // Nor into a safe place (a cell of it or beside it): its one small opening is the point.
    const tx=t%m,ty=(t-tx)/m;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(g.safe.has(tx+dx+(ty+dy)*m))return true;
    const x=(t%m+.5)*u,y=(Math.floor(t/m)+.5)*u;
    if(a.viaducts.some(v=>[-u,0,u].some(dx=>[-u,0,u].some(dy=>overDeck(v,u,x+dx,y+dy)||onRamp(v,u,x+dx,y+dy)))))return true;
    return false;
  };
}

/**
 * The holes to open, chosen greedily on `g` (which is not changed): each one 2 cells wide, straight (across or along),
 * through ≤ CUT_MAX_DEPTH cuttable solid cells between two city cells whose walk around is ≥ CUT_MIN_SAVE cells longer.
 * After each hole the walk is measured again (a hole near a chosen one saves less).
 */
export function choosePassages(g:CityGraph,max=CUT_MAX):Passagem[]{
  const {a,m,u}=g,ok=g.city.slice(),banned=passageBan(g);
  const cuttable=(t:number)=>!g.open[t]&&CUTTABLE.has(g.kind[t])&&!banned(t);
  // Every candidate: a start city cell, a direction, the solid run, the city cell after it; the 2nd lane beside it.
  type Cand={cells:number[];from:number;to:number;from2:number;to2:number};
  const cands:Cand[]=[];
  for(let t=0;t<m*m;t++){if(!g.city[t]||banned(t))continue;const x=t%m,y=(t-x)/m;
    for(const [dx,dy,sx,sy] of [[1,0,0,1],[0,1,1,0]] as const){
      const cells:number[]=[];let k=1;
      for(;k<=CUT_MAX_DEPTH+1;k++){const X=x+dx*k,Y=y+dy*k;if(X<0||Y<0||X>=m||Y>=m){k=99;break;}const n=X+Y*m;
        if(g.city[n])break;if(!cuttable(n)){k=99;break;}cells.push(n);}
      if(k>CUT_MAX_DEPTH+1||!cells.length)continue;
      const to=x+dx*k+(y+dy*k)*m;
      // The second lane (beside, same depth): its ends city cells, its middle cuttable or already open.
      const X2=x+sx,Y2=y+sy;if(X2>=m||Y2>=m)continue;const from2=X2+Y2*m,to2=X2+dx*k+(Y2+dy*k)*m;
      if(!g.city[from2]||!g.city[to2]||banned(from2))continue;
      let lane=true;const both=[...cells];
      for(let j=1;j<k;j++){const n=X2+dx*j+(Y2+dy*j)*m;if(g.city[n])continue;if(!cuttable(n)){lane=false;break;}both.push(n);}
      if(!lane)continue;
      const h=(t:number)=>a.heightAt((t%m+.5)*u,(Math.floor(t/m)+.5)*u);
      if(both.some(n=>g.kind[n]==='cliff')&&Math.max(Math.abs(h(t)-h(to)),Math.abs(h(from2)-h(to2)))>CLIFF_STEP)continue;
      cands.push({cells:both,from:t,to,from2,to2});
    }}
  const chosen:Passagem[]=[];
  const dist=new Map<number,Float64Array>();
  const d=(t:number)=>{let v=dist.get(t);if(!v){v=walk(ok,m,t);dist.set(t,v);}return v;};
  const take=(c:Cand)=>{
    const direct=Math.max(Math.abs(c.to%m-c.from%m),Math.abs(Math.floor(c.to/m)-Math.floor(c.from/m)));
    chosen.push({cells:c.cells,from:c.from,to:c.to,save:d(c.from)[c.to]-direct,kinds:[...new Set(c.cells.map(n=>g.kind[n]))]});
    for(const n of c.cells)ok[n]=1;dist.clear();
  };
  // 1. Every dead end without loot at its end: the best hole from its last cells (or around them), if it saves enough.
  for(const b of becos(g)){if(b.loot||b.abrigo||chosen.length>=max)continue;
    const tip=new Set<number>();
    for(const t of b.cells.slice(0,3)){const x=t%m,y=(t-x)/m;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<m&&Y<m)tip.add(X+Y*m);}}
    let best:Cand|undefined,bestSave=0;
    for(const c of cands){if(c.cells.every(n=>ok[n]))continue;if(!tip.has(c.from)&&!tip.has(c.to)&&!tip.has(c.from2)&&!tip.has(c.to2))continue;
      const direct=Math.max(Math.abs(c.to%m-c.from%m),Math.abs(Math.floor(c.to/m)-Math.floor(c.from/m)));
      const save=d(c.from)[c.to]-direct,score=save-c.cells.length*.5;
      if(save>=BECO_MIN_SAVE&&score>bestSave){bestSave=score;best=c;}}
    if(best)take(best);
  }
  // 2. The biggest detours left.
  while(chosen.length<max){
    let best:Cand|undefined,bestSave=0;
    for(const c of cands){if(c.cells.every(n=>ok[n]))continue;
      const direct=Math.max(Math.abs(c.to%m-c.from%m),Math.abs(Math.floor(c.to/m)-Math.floor(c.from/m)));
      const save=d(c.from)[c.to]-direct;
      // Prefer the thinner wall at the same saving.
      const score=save-c.cells.length*.5;
      if(save>=CUT_MIN_SAVE&&score>bestSave){bestSave=score;best=c;}}
    if(!best)break;
    take(best);
  }
  return chosen;
}

/** `rect` minus the cell (c, r) of size u: up to 4 rects. */
function cutRect([x,y,w,h]:CityRect,c:number,r:number,u:number):CityRect[]{
  const cx=c*u,cy=r*u,e=1e-6;
  if(cx>=x+w-e||cx+u<=x+e||cy>=y+h-e||cy+u<=y+e)return [[x,y,w,h]];
  const r3=(v:number)=>Math.round(v*1000)/1000,out:CityRect[]=[];
  if(cy>y+e)out.push([x,y,w,r3(cy-y)]);
  if(cy+u<y+h-e)out.push([x,r3(cy+u),w,r3(y+h-cy-u)]);
  const top=Math.max(y,cy),bot=Math.min(y+h,cy+u);
  if(cx>x+e)out.push([x,r3(top),r3(cx-x),r3(bot-top)]);
  if(cx+u<x+w-e)out.push([r3(cx+u),r3(top),r3(x+w-cx-u),r3(bot-top)]);
  return out;
}
const bboxOf=(rects:readonly CityRect[]):CityRect=>{
  const r3=(v:number)=>Math.round(v*1000)/1000;
  const x0=Math.min(...rects.map(r=>r[0])),y0=Math.min(...rects.map(r=>r[1])),x1=Math.max(...rects.map(r=>r[0]+r[2])),y1=Math.max(...rects.map(r=>r[1]+r[3]));
  return [r3(x0),r3(y0),r3(x1-x0),r3(y1-y0)];
};

/**
 * A prop taken off the map stays in the list as PROP_REMOVED, not solid: the client picks each prop's art by its index
 * (render/city/from-maps.ts `p${i}`), so dropping one would redraw every prop after it.
 */
export const PROP_REMOVED='removido';
const removed=(p:CityProp):CityProp=>({...p,kind:PROP_REMOVED,solid:false});

/**
 * The corners of `cells` set to a ramp between the corners of the `ground` cells around them: each free corner the mean
 * of its 4 neighbour corners that are free or ground corners, RAMP_PASSES times (a corner with none keeps its height).
 */
function rampCorners(data:CityAssetData,cells:readonly number[],ground:(t:number)=>boolean){
  const m=data.cells.w,H=m+1,h=data.heights,free=new Set<number>(),fixed=new Set<number>();
  const corners=(t:number)=>{const c=t%m,r=(t-c)/m;return [c+r*H,c+1+r*H,c+(r+1)*H,c+1+(r+1)*H];};
  for(const t of cells)for(const k of corners(t))free.add(k);
  for(const t of cells){const c=t%m,r=(t-c)/m;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=c+dx,Y=r+dy;if(X<0||Y<0||X>=m||Y>=m)continue;const n=X+Y*m;
      if(ground(n))for(const k of corners(n))if(!free.has(k))fixed.add(k);}}
  for(let pass=0;pass<RAMP_PASSES;pass++)for(const k of free){
    const x=k%H,y=(k-x)/H;let sum=0,n=0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=H||Y>=H)continue;const q=X+Y*H;if(free.has(q)||fixed.has(q)){sum+=h[q];n++;}}
    if(n)h[k]=Math.round(sum/n*100)/100;
  }
}
const RAMP_PASSES=40;

/**
 * Open `cells` in `data`: their samples walkable, their blocks' rects cut (a block left empty goes), the props and the
 * scenery pieces on them gone.
 */
export function openCells(data:CityAssetData,cells:readonly number[]):void{
  const m=data.cells.w,u=data.unitsPerCell!,S=SAMPLES_PER_CELL,sw=m*S;
  const set=new Set(cells);
  const was=(t:number)=>data.walkable[(Math.floor(t/m)*S+S/2)*sw+(t%m)*S+S/2]===1;
  // A cliff cell keeps the shelf's height on its corners: open, it would stand as a pale rock slab. Its corners are
  // relaxed (Jacobi) between the ground's on both sides: a ramp.
  const cliff=[...set].filter(t=>{const c=t%m,r=(t-c)/m;return data.blocks.some(b=>b.kind==='cliff'&&b.rects.some(([x,y,w,h])=>(c+.5)*u>x&&(c+.5)*u<x+w&&(r+.5)*u>y&&(r+.5)*u<y+h));});
  if(cliff.length)rampCorners(data,cliff,t=>!set.has(t)&&was(t));
  for(const t of set){const c=t%m,r=(t-c)/m;for(let j=0;j<S;j++)for(let i=0;i<S;i++)data.walkable[(r*S+j)*sw+c*S+i]=1;}
  const blocks:CityBlock[]=[];
  for(const b of data.blocks){
    let rects:CityRect[]=[...b.rects];
    for(const t of set){const c=t%m,r=(t-c)/m;rects=rects.flatMap(q=>cutRect(q,c,r,u));}
    if(!rects.length)continue;
    blocks.push(rects.length===b.rects.length&&rects.every((q,i)=>q===b.rects[i])?b:{...b,rects,bbox:bboxOf(rects)});
  }
  data.blocks=blocks;
  data.props=data.props.map(p=>set.has(Math.floor(p.x/u)+Math.floor(p.y/u)*m)?removed(p):p);
  if(data.decor){
    // A rock piece (2×2, 2×1) the hole went through: its cells left keep a 1×1 piece along the cliff (bare, a cliff
    // cell is drawn as a pale box).
    const isCliff=(c:number,r:number)=>c>=0&&r>=0&&c<m&&r<m&&!set.has(c+r*m)&&data.blocks.some(b=>b.kind==='cliff'&&b.rects.some(([x,y,w,h])=>(c+.5)*u>x&&(c+.5)*u<x+w&&(r+.5)*u>y&&(r+.5)*u<y+h));
    const decor:CityDecor[]=[],loose:CityDecor[]=[];
    for(const d of data.decor){
      const cut:[number,number][]=[];let hit=false;
      for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)if(set.has(c+r*m))hit=true;else cut.push([c,r]);
      if(!hit){decor.push(d);continue;}
      if(!d.id.startsWith('penhasco'))continue;
      for(const [c,r] of cut){if(!isCliff(c,r))continue;
        // As maps/city-decor.ts placeCityDecor draws a cliff cell.
        const links=(isCliff(c,r-1)?LINK.N:0)|(isCliff(c+1,r)?LINK.E:0)|(isCliff(c,r+1)?LINK.S:0)|(isCliff(c-1,r)?LINK.W:0);
        const {shape,rot}=lineShape(links);
        loose.push({id:shape==='quina'?'penhasco2-quina-externa':shape==='ponta'?'penhasco-ponta':'penhasco2-reto',c,r,w:1,h:1,rot,links});}
    }
    // And regrouped into big pieces where they fit (rochas-grandes).
    data.decor=[...decor,...bigCliffRocks(loose,BIG_ROCKS,cells.length)];
  }
}

/** Ruin props this close to the plaza's base point (u) go: the heaps at its 4 mouths. */
export const PLAZA_RUIN=14;
/** Nor this close (u) to the start or a spawn (tests/maps/cidade-import.test.ts keeps loot 6 u off them). */
export const KEY_KEEP=8;
/** A crate put at a dead end's end keeps this far (u) from any other loot point (compactar-cidade.ts LOOT_SPACING). */
export const LOOT_NEAR=11;

// ——— The Uno ———

/** Probe grid (u) of the car's reach. */
const PROBE=.5;
/** A heap of rubble goes when, taken off, it opens at least this to the Uno (u², as scripts/diag-uno-caminho.ts). */
export const RUBBLE_GAIN=4;

/** Probes (PROBE u) a disc of radius r reaches from `seed` probes or from the probe nearest `from`, over `walk` samples. */
function carReach(a:CityAsset,walkS:Uint8Array,from:CityPoint,r=CAR_RADIUS,box?:readonly [number,number,number,number],seed?:Uint8Array):Uint8Array{
  const {w:SW,h:SH,step:S}=a.samples,GW=Math.ceil(a.size.w/PROBE),GH=Math.ceil(a.size.h/PROBE);
  const fits=(x:number,y:number)=>{const reach=r-1e-6,r2=reach*reach,sx0=Math.floor((x-reach)/S),sx1=Math.floor((x+reach)/S),sy0=Math.floor((y-reach)/S),sy1=Math.floor((y+reach)/S);
    if(sx0<0||sy0<0||sx1>=SW||sy1>=SH)return false;
    for(let sy=sy0;sy<=sy1;sy++){const dy=y<sy*S?sy*S-y:y>(sy+1)*S?y-(sy+1)*S:0;
      for(let sx=sx0;sx<=sx1;sx++){const dx=x<sx*S?sx*S-x:x>(sx+1)*S?x-(sx+1)*S:0;if(dx*dx+dy*dy<r2&&!walkS[sx+sy*SW])return false;}}
    return true;};
  const [gx0,gy0,gx1,gy1]=box?[Math.max(0,Math.floor(box[0]/PROBE)),Math.max(0,Math.floor(box[1]/PROBE)),Math.min(GW-1,Math.floor(box[2]/PROBE)),Math.min(GH-1,Math.floor(box[3]/PROBE))]:[0,0,GW-1,GH-1];
  const ok=new Uint8Array(GW*GH),seen=new Uint8Array(GW*GH),q:number[]=[];
  for(let gy=gy0;gy<=gy1;gy++)for(let gx=gx0;gx<=gx1;gx++)ok[gx+gy*GW]=fits((gx+.5)*PROBE,(gy+.5)*PROBE)?1:0;
  const push=(i:number)=>{if(ok[i]&&!seen[i]){seen[i]=1;q.push(i);}};
  if(seed){for(let gy=gy0;gy<=gy1;gy++)for(let gx=gx0;gx<=gx1;gx++)if(seed[gx+gy*GW])push(gx+gy*GW);}
  else{let best=-1,bd=Infinity;
    for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){const i=Math.floor(from.x/PROBE)+dx+(Math.floor(from.y/PROBE)+dy)*GW;if(ok[i]&&dx*dx+dy*dy<bd){bd=dx*dx+dy*dy;best=i;}}
    if(best>=0)push(best);}
  for(let h=0;h<q.length;h++){const i=q[h],gx=i%GW,gy=(i-gx)/GW;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=gx+dx,y=gy+dy;if(x>=gx0&&x<=gx1&&y>=gy0&&y<=gy1)push(x+y*GW);}}
  return seen;
}
const countOf=(m:Uint8Array)=>{let n=0;for(const v of m)n+=v;return n;};
/** Share of the hero's ground (probes) the Uno reaches from the plaza, and whether it gets near each spawn. */
export function unoAlcance(a:CityAsset):{share:number;spawns:Record<string,boolean>}{
  const {w,h}=a.samples,W=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)W[x+y*w]=a.walkable(x,y)?1:0;
  const car=carReach(a,W,a.points.praca),hero=carReach(a,W,a.points.praca,.22),GW=Math.ceil(a.size.w/PROBE);
  const near=(p:CityPoint,d:number)=>{for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++)if(car[Math.floor(p.x/PROBE)+dx+(Math.floor(p.y/PROBE)+dy)*GW])return true;return false;};
  const P=a.points;
  return {share:countOf(car)/countOf(hero),spawns:Object.fromEntries((['spawnN','spawnS','spawnL','spawnO'] as const).map(k=>[k,near(P[k],6)]))};
}

/**
 * The heaps of rubble that shut the Uno out of streets, taken off one by one (the one that opens most first) while one
 * opens ≥ RUBBLE_GAIN u² to it. Returns their ids; `data` loses them.
 */
export function rubbleForUno(data:CityAssetData):string[]{
  const out:string[]=[],m=data.cells.w,u=data.unitsPerCell!;
  const cellsOf=(b:CityBlock)=>{const cells:number[]=[];
    for(const [x,y,w,h] of b.rects)for(let cy=Math.round(y/u);cy<Math.round((y+h)/u);cy++)for(let cx=Math.round(x/u);cx<Math.round((x+w)/u);cx++)cells.push(cx+cy*m);
    return cells;};
  let safe:ReadonlySet<number>|undefined;
  for(let pass=0;pass<40;pass++){
    const d=decodeCityAsset(encodeCityAsset(data));if(!d.ok)throw new Error(d.error);const a=d.asset,{w:SW,h:SH,step:S}=a.samples;
    // Nor a heap by a safe place (it may be what keeps its opening small).
    safe??=cityGraph(a).safe;
    const bySafe=(b:CityBlock)=>cellsOf(b).some(t=>{const x=t%m,y=(t-x)/m;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(safe!.has(x+dx+(y+dy)*m))return true;return false;});
    const base=new Uint8Array(SW*SH);for(let y=0;y<SH;y++)for(let x=0;x<SW;x++)base[x+y*SW]=a.walkable(x,y)?1:0;
    const reach=carReach(a,base,a.points.praca);
    let best:CityBlock|undefined,bestGain=0;
    for(const b of a.blocks){if(b.kind!=='rubble'||bySafe(b))continue;
      const W=base.slice();
      for(const [x,y,w,h] of b.rects)for(let sy=Math.floor(y/S+1e-6);sy<Math.ceil((y+h)/S-1e-6);sy++)for(let sx=Math.floor(x/S+1e-6);sx<Math.ceil((x+w)/S-1e-6);sx++)if(sx>=0&&sy>=0&&sx<SW&&sy<SH)W[sx+sy*SW]=1;
      const [x0,y0,bw,bh]=b.bbox,box=[x0-12,y0-12,x0+bw+12,y0+bh+12] as const;
      const gain=(countOf(carReach(a,W,a.points.praca,CAR_RADIUS,box,reach))-countOf(carReach(a,base,a.points.praca,CAR_RADIUS,box,reach)))*PROBE*PROBE;
      if(gain>=RUBBLE_GAIN&&gain>bestGain){bestGain=gain;best=b;}}
    if(!best)break;
    openCells(data,cellsOf(best));out.push(best.id);
  }
  return out;
}

/** The asset with its dead ends opened (a new version). */
export function abrirBecos(data:CityAssetData):{data:CityAssetData;passagens:Passagem[];rubble:string[];ruins:number;lootAdded:number;lootMoved:number}{
  const out:CityAssetData={...data,walkable:data.walkable.slice(),heights:data.heights.slice()};
  // 1. The rubble the car hits.
  const rubble=rubbleForUno(out);
  // The heaps of ruin at the plaza's mouths, by the Uno where the run starts: they read as rubble across its way out.
  const P=out.points.praca,atMouth=(p:CityProp)=>p.kind==='ruin'&&Math.hypot(p.x-P.x,p.y-P.y)<PLAZA_RUIN;
  const ruins=out.props.filter(atMouth).length;
  out.props=out.props.map(p=>atMouth(p)?removed(p):p);
  // 2. The holes.
  const first=decodeCityAsset(encodeCityAsset(out));if(!first.ok)throw new Error(first.error);
  const passagens=choosePassages(cityGraph(first.asset));
  openCells(out,passagens.flatMap(p=>p.cells));
  // The holes may put a heap in the Uno's way that was off it: once more.
  rubble.push(...rubbleForUno(out));
  const m=out.cells.w,u=out.unitsPerCell!;
  // 3. A dead end left (no hole saves enough there, or it is by a nest or the plaza) gets a reason: a crate at its end.
  const second=decodeCityAsset(encodeCityAsset(out));if(!second.ok)throw new Error(second.error);
  const loot=[...out.loot],r3=(v:number)=>Math.round(v*1000)/1000;let added=0,moved=0;
  const g2=cityGraph(second.asset),P2=out.points,keys=[P2.inicio,P2.spawnN,P2.spawnS,P2.spawnL,P2.spawnO];
  const roomy=(t:number)=>[1,-1,m,-m].every(k=>g2.city[t+k]);
  for(const b of becos(g2)){if(b.loot||b.abrigo)continue;
    // The crate's body needs room (open ground on the 4 sides, else it pushes the opener off): the deepest such cell.
    const spot=b.cells.find(roomy);if(spot===undefined)continue;
    const end={x:r3((spot%m+.5)*u),y:r3((Math.floor(spot/m)+.5)*u)},d=(q:CityPoint)=>Math.hypot(q.x-end.x,q.y-end.y);
    if(d(P2.praca)<PLAZA_KEEP||keys.some(k=>d(k)<KEY_KEEP))continue;
    const near=loot.map((q,i)=>({q,i})).filter(({q})=>d(q)<LOOT_NEAR).sort((x,y)=>d(x.q)-d(y.q));
    if(!near.length){loot.push(end);added++;continue;}
    // A crate already near: it moves to the end when that keeps it as far from the others.
    const {i}=near[0];
    if(loot.every((q,j)=>j===i||d(q)>=LOOT_NEAR)){loot[i]=end;moved++;}
  }
  out.loot=loot;
  out.version=data.version+1;
  return {data:out,passagens,rubble,ruins,lootAdded:added,lootMoved:moved};
}

// ——— Streets wide enough for the Uno (NEW-20261027-ORQ-uno-anda-mapa-todo) ———

/** A widened lane fits a disc this wide (u): the car's body with 0.1 u to spare on each side. */
export const UNO_LANE_R=CAR_RADIUS+.1;
/** The plaza, its mouths and the spawns: the Uno gets there with this much room (u, over its radius; the pushers' slack). */
export const UNO_POINT_ROOM=.3;
/** A loot point counts as reached when the car's centre gets this close (u, square: as scripts/diag-uno-caminho.ts). */
export const UNO_LOOT_NEAR=3;
/** Path cost of a probe that needs a cut, over one that does not: the way around wins up to this many probes longer. */
const WIDEN_PENALTY=12;
/** The same for a probe whose cut goes through a cliff. */
const CLIFF_PENALTY=36;
/** At most this many cells opened for one loot point (more: it moves to the street instead, see moveLootToUno). */
export const WIDEN_MAX_CELLS=30;

interface UnoField {GW:number;GH:number;reach:Uint8Array;near:(p:CityPoint)=>boolean}
function unoField(a:CityAsset,r=CAR_RADIUS,round=false):UnoField{
  const {w,h}=a.samples,W=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)W[x+y*w]=a.walkable(x,y)?1:0;
  const reach=carReach(a,W,a.points.praca,r),GW=Math.ceil(a.size.w/PROBE),GH=Math.ceil(a.size.h/PROBE),d=Math.round(UNO_LOOT_NEAR/PROBE);
  const near=(p:CityPoint)=>{for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++){if(round&&dx*dx+dy*dy>d*d)continue;const gx=Math.floor(p.x/PROBE)+dx,gy=Math.floor(p.y/PROBE)+dy;if(gx>=0&&gy>=0&&gx<GW&&gy<GH&&reach[gx+gy*GW])return true;}return false;};
  return {GW,GH,reach,near};
}
/** The loot points the Uno, from the plaza, gets within UNO_LOOT_NEAR of. */
export function unoLoot(a:CityAsset):{reached:number;total:number;out:CityPoint[]}{
  const f=unoField(a),out=a.loot.filter(p=>!f.near(p));
  return {reached:a.loot.length-out.length,total:a.loot.length,out};
}

/**
 * The cells to open so the Uno reaches `target`: the cheapest way (probes the lane disc UNO_LANE_R fits, a probe that
 * fits only once cuttable cells open costs WIDEN_PENALTY more) from the car's reach to within UNO_LOOT_NEAR of it; the
 * cells under the lane disc of every probe on it that are still solid. Undefined: no way (a building, a nest, the plaza).
 */
function widenTo(a:CityAsset,g:CityGraph,allowed:(t:number)=>boolean,f:UnoField,target:CityPoint,lane=UNO_LANE_R):number[]|undefined{
  const {w:SW,h:SH,step:S}=a.samples,{GW,GH}=f,m=g.m,K=SAMPLES_PER_CELL;
  const W=new Uint8Array(SW*SH),Wopt=new Uint8Array(SW*SH);
  for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){const i=x+y*SW;W[i]=a.walkable(x,y)?1:0;Wopt[i]=W[i]||allowed(Math.floor(x/K)+Math.floor(y/K)*m)?1:0;}
  const R=lane-1e-6,R2=R*R;
  // The solid samples (of `Wx`) under the disc at probe i; -1 off the map.
  const solidUnder=(Wx:Uint8Array,i:number,out?:number[])=>{const x=(i%GW+.5)*PROBE,y=(Math.floor(i/GW)+.5)*PROBE;
    const sx0=Math.floor((x-R)/S),sx1=Math.floor((x+R)/S),sy0=Math.floor((y-R)/S),sy1=Math.floor((y+R)/S);
    if(sx0<0||sy0<0||sx1>=SW||sy1>=SH)return -1;let n=0;
    for(let sy=sy0;sy<=sy1;sy++){const dy=y<sy*S?sy*S-y:y>(sy+1)*S?y-(sy+1)*S:0;
      for(let sx=sx0;sx<=sx1;sx++){const dx=x<sx*S?sx*S-x:x>(sx+1)*S?x-(sx+1)*S:0;if(dx*dx+dy*dy<R2&&!Wx[sx+sy*SW]){n++;out?.push(sx+sy*SW);}}}
    return n;};
  // Probes near the target; only the box around the car's reach and the target is searched.
  const tx=Math.floor(target.x/PROBE),ty=Math.floor(target.y/PROBE),d=Math.round(UNO_LOOT_NEAR/PROBE);
  const goal=(i:number)=>Math.abs(i%GW-tx)<=d&&Math.abs(Math.floor(i/GW)-ty)<=d;
  const cost=new Float64Array(GW*GH).fill(Infinity),from=new Int32Array(GW*GH).fill(-1),fitsOpt=new Int8Array(GW*GH).fill(-1),cut=new Int8Array(GW*GH).fill(-1);
  const okOpt=(i:number)=>{if(fitsOpt[i]<0)fitsOpt[i]=solidUnder(Wopt,i)===0?1:0;return fitsOpt[i]===1;};
  // 0: the lane fits; 1: it cuts; 2: it cuts a cliff (a rock massif goes: the way through a wall wins, CLIFF_PENALTY).
  const needs=(i:number)=>{if(cut[i]<0){const s:number[]=[];cut[i]=solidUnder(W,i,s)===0?0:s.some(k=>g.kind[Math.floor((k%SW)/K)+Math.floor(Math.floor(k/SW)/K)*m]==='cliff')?2:1;}return cut[i]>0;};
  // Dijkstra (binary heap) from every probe of the car's reach.
  const heap:number[]=[],less=(p:number,q:number)=>cost[heap[p]]<cost[heap[q]];
  const push=(i:number)=>{heap.push(i);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(!less(k,p))break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
  const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let s=k;if(l<heap.length&&less(l,s))s=l;if(r<heap.length&&less(r,s))s=r;if(s===k)break;[heap[s],heap[k]]=[heap[k],heap[s]];k=s;}}return top;};
  for(let i=0;i<GW*GH;i++)if(f.reach[i]&&okOpt(i)){cost[i]=0;push(i);}
  let end=-1;
  while(heap.length){const i=pop();if(goal(i)){end=i;break;}
    const gx=i%GW,gy=(i-gx)/GW,c=cost[i];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const X=gx+dx,Y=gy+dy;if(X<0||Y<0||X>=GW||Y>=GH)continue;const n=X+Y*GW;
      if(!okOpt(n))continue;const nc=c+(dx&&dy?1.414:1)+(needs(n)?cut[n]===2?CLIFF_PENALTY:WIDEN_PENALTY:0);
      if(nc<cost[n]){cost[n]=nc;from[n]=i;push(n);}}}
  if(end<0)return undefined;
  const cells=new Set<number>();
  for(let i=end;i>=0&&cost[i]>0;i=from[i]){if(!needs(i))continue;const s:number[]=[];solidUnder(W,i,s);for(const k of s)cells.add(Math.floor((k%SW)/K)+Math.floor(Math.floor(k/SW)/K)*m);}
  return [...cells];
}

/** The cells a widened lane may take: open ones, and cuttable ones off passageBan inside the playable area (see WIDEN_KINDS). */
function allowedIn(a:CityAsset,g:CityGraph):(t:number)=>boolean{
  const ban=passageBan(g),{m,u}=g;
  const allowed=(t:number)=>{const cx=t%m,cy=(t-cx)/m,x=(cx+.5)*u,y=(cy+.5)*u,pl=a.playable;
    if(g.open[t])return true;
    if(ban(t)||!WIDEN_KINDS.has(g.kind[t])||x-u<pl.x||y-u<pl.y||x+u>pl.x+pl.w||y+u>pl.y+pl.h)return false;
    return g.kind[t]!=='cliff'||gentle(t);};
  // A cliff cell goes only between grounds at most CLIFF_STEP apart (one shelf: it reads as a ramp, as choosePassages).
  const gentle=(t:number)=>{const cx=t%m,cy=(t-cx)/m;let lo=Infinity,hi=-Infinity;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const n=cx+dx+(cy+dy)*m;if(cx+dx<0||cy+dy<0||cx+dx>=m||cy+dy>=m||!g.open[n])continue;
      const h=a.heightAt((cx+dx+.5)*u,(cy+dy+.5)*u);lo=Math.min(lo,h);hi=Math.max(hi,h);}
    return hi-lo<=CLIFF_STEP;};
  return allowed;
}

/**
 * Widens the narrow streets the Uno does not get down (the user, 27/10: "é para podermos andar com o carro pelo jogo
 * todo"): first to the plaza's mouths and the spawns (with UNO_POINT_ROOM to spare), then to the loot points, the cheapest
 * first, at most WIDEN_MAX_CELLS for one. Only through cuttable cells (allowedIn: walls, rubble, the map's edge, a cliff
 * of one shelf, a cell a prop shut; never a building, the plaza ring, a nest's yard, beside a safe place or a viaduct:
 * passageBan) and never when that breaks the defence (a safe place changes, or a spawn's walk to the plaza gets
 * shorter: the cut is undone). Then the rubble the lanes put in its way goes, and the loot the car still misses (inside a
 * safe place, or behind a building) moves out to the nearest street it reaches (moveLootToUno). `data` changes in place.
 */
export function alargarParaUno(data:CityAssetData):{cells:number[];widened:number;moved:number;refused:number;rubble:string[];before:number;after:number;total:number}{
  const decode=()=>{const d=decodeCityAsset(encodeCityAsset(data));if(!d.ok)throw new Error(d.error);return d.asset;};
  let a=decode();const before=unoLoot(a).reached,opened:number[]=[];let widened=0,refused=0;
  // The defence (tests/maps/mapa-becos.test.ts): the safe places stay as they are, the hordes walk as far to the plaza.
  const defence=(x:CityAsset)=>{const g=cityGraph(x),P=x.points,cell=(p:CityPoint)=>Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m,d=walk(g.city,g.m,cell(P.praca));
    return {safe:[...g.safe].sort((p,q)=>p-q).join(','),walks:[P.spawnN,P.spawnS,P.spawnL,P.spawnO].map(p=>d[cell(p)])};};
  const kept=defence(a);
  // Opens `cells` unless that breaks the defence (then `data` goes back as it was).
  const tryOpen=(cells:readonly number[])=>{const was=structuredClone(data);openCells(data,cells);const next=decode(),now=defence(next);
    if(now.safe!==kept.safe||now.walks.some((w,i)=>w<kept.walks[i]-1)){Object.assign(data,was);refused++;return false;}
    a=next;opened.push(...cells);widened++;return true;};
  const inSafe=(g:CityGraph,p:CityPoint)=>g.safe.has(Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m);
  // 1. The plaza's mouths and the spawns, with room to spare (any length: the car must get there).
  const B=a.points.bocas;
  for(const p of [B.N,B.S,B.L,B.O,a.points.spawnN,a.points.spawnS,a.points.spawnL,a.points.spawnO]){
    const f=unoField(a,CAR_RADIUS+UNO_POINT_ROOM);if(f.near(p))continue;
    const g=cityGraph(a),cells=widenTo(a,g,allowedIn(a,g),f,p,CAR_RADIUS+UNO_POINT_ROOM);
    if(process.env.ALARGAR_LOG)console.log('ponto',p.x.toFixed(0),p.y.toFixed(0),cells?.length??'sem caminho');
    if(cells?.length)tryOpen(cells);
  }
  // 2. The loot, the cheapest first; never into a safe place (its crate moves out, below).
  const skip=new Set<string>(),key=(p:CityPoint)=>`${p.x},${p.y}`;
  for(let pass=0;pass<2*a.loot.length;pass++){
    const g=cityGraph(a),allowed=allowedIn(a,g);
    const f=unoField(a),out=a.loot.filter(p=>!f.near(p)&&!skip.has(key(p))&&!inSafe(g,p));
    let best:{p:CityPoint;cells:number[]}|undefined;
    for(const p of out){const cells=widenTo(a,g,allowed,f,p);
      if(!cells||cells.length>WIDEN_MAX_CELLS){if(process.env.ALARGAR_LOG)console.log('skip',p.x.toFixed(0),p.y.toFixed(0),cells?.length??'sem caminho');skip.add(key(p));continue;}
      if(!best||cells.length<best.cells.length)best={p,cells};}
    if(!best)break;
    const ok=tryOpen(best.cells);
    if(process.env.ALARGAR_LOG)console.log(ok?'alarga':'recusa',best.p.x.toFixed(0),best.p.y.toFixed(0),best.cells.length);
    if(!ok)skip.add(key(best.p));
  }
  // The lanes may put a heap in the Uno's way that was off it (as abrirBecos).
  const rubble=rubbleForUno(data);
  // The 1×1 rock pieces the cuts left beside the old ones: regrouped into big pieces together (rochas-grandes).
  if(data.decor&&opened.length)data.decor=bigCliffRocks(data.decor,BIG_ROCKS,opened.length);
  a=decode();
  const moved=moveLootToUno(data,a,decode);
  a=decode();
  return {cells:opened,widened,moved,refused,rubble,before,after:unoLoot(a).reached,total:a.loot.length};
}
/** Kinds a widened lane cuts (a cliff only as one shelf; a building never), '' a cell shut by a prop. */
const WIDEN_KINDS=new Set(['wall','rubble','edge','cliff','']);

/**
 * The loot points the Uno still misses go to the nearest spot (≤ LOOT_MOVE_MAX u) that it reaches, where the crate has
 * open ground around it (a hero opens it from any side) and keeps KEY_KEEP from the start and the spawns. First pass:
 * only spots LOOT_NEAR from the other loot (the spread the Poisson draw gave). Second pass: LOOT_NEAR/2, kept only while
 * ≥ LOOT_WIDE_KEEP of the crates stay LOOT_NEAR from all others and no dead end loses its crate (caixas-espalhadas,
 * mapa-becos). Returns how many moved.
 */
export const LOOT_MOVE_MAX=20;
/** Share of the loot points that keeps LOOT_NEAR from every other (caixas-espalhadas wants .9; one point of margin). */
const LOOT_WIDE_KEEP=.9;
function moveLootToUno(data:CityAssetData,a:CityAsset,decode:()=>CityAsset,f=unoField(a)):number{
  const P=a.points,keys=[P.inicio,P.spawnN,P.spawnS,P.spawnL,P.spawnO],r3=(v:number)=>Math.round(v*1000)/1000;
  const loot=[...data.loot];let moved=0;
  const g=cityGraph(a),m=g.m,u=g.u,roomy=(x:number,y:number)=>{const t=Math.floor(x/u)+Math.floor(y/u)*m;return [0,1,-1,m,-m].every(k=>g.city[t+k]);};
  const spot=(i:number,gap:number)=>{const p=loot[i];let best:CityPoint|undefined,bd=Infinity;
    const R=Math.ceil(LOOT_MOVE_MAX/PROBE);
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
      const gx=Math.floor(p.x/PROBE)+dx,gy=Math.floor(p.y/PROBE)+dy;if(gx<0||gy<0||gx>=f.GW||gy>=f.GH||!f.reach[gx+gy*f.GW])continue;
      const q={x:r3((gx+.5)*PROBE),y:r3((gy+.5)*PROBE)},d=Math.hypot(q.x-p.x,q.y-p.y);
      if(d>=bd||d>LOOT_MOVE_MAX||!roomy(q.x,q.y))continue;
      if(Math.hypot(q.x-P.praca.x,q.y-P.praca.y)<PLAZA_KEEP||keys.some(k=>Math.hypot(q.x-k.x,q.y-k.y)<KEY_KEEP))continue;
      if(loot.some((o,j)=>j!==i&&Math.hypot(o.x-q.x,o.y-q.y)<gap))continue;
      best=q;bd=d;}
    return best;};
  const missed=()=>loot.map((p,i)=>({p,i})).filter(({p})=>!f.near(p)).map(({i})=>i);
  const wide=()=>loot.filter(p=>loot.every(q=>q===p||Math.hypot(p.x-q.x,p.y-q.y)>=LOOT_NEAR)).length;
  const emptyEnds=()=>{data.loot=[...loot];return resumo(decode()).becosSemMotivo;},ends=emptyEnds();
  for(const gap of [LOOT_NEAR,LOOT_NEAR/2])for(const i of missed()){const q=spot(i,gap);if(!q)continue;const was=loot[i];loot[i]=q;
    if((gap===LOOT_NEAR||wide()>=Math.ceil(loot.length*LOOT_WIDE_KEEP)+1)&&emptyEnds()<=ends)moved++;else loot[i]=was;}
  data.loot=loot;
  return moved;
}

// ——— Picture ———

/** RGB picture of the city (px per cell): ground, blocks by kind, dead ends red, places, loot, the holes cyan. */
export async function picture(a:CityAsset,path:string,opts:{px?:number;holes?:readonly number[];title?:string}={}){
  const {default:sharp}=await import('sharp');
  const g=cityGraph(a),{m,u}=g,px=opts.px??7,W=m*px,img=Buffer.alloc(W*W*3);
  const put=(x:number,y:number,c:readonly number[])=>{if(x<0||y<0||x>=W||y>=W)return;const i=(x+y*W)*3;img[i]=c[0];img[i+1]=c[1];img[i+2]=c[2];};
  const cell=(t:number,c:readonly number[],inset=0)=>{const x=t%m,y=(t-x)/m;for(let j=inset;j<px-inset;j++)for(let i=inset;i<px-inset;i++)put(x*px+i,y*px+j,c);};
  const KIND:Record<string,number[]>={building:[70,70,80],wall:[120,95,70],rubble:[200,120,40],cliff:[90,110,140],edge:[20,20,20],'':[150,150,150]};
  for(let t=0;t<m*m;t++)cell(t,g.city[t]?[236,236,228]:g.open[t]?[190,190,180]:KIND[g.kind[t]]??KIND['']);
  for(const b of becos(g))for(const t of b.cells)cell(t,b.loot||b.abrigo?[240,170,170]:[220,30,30],1);
  for(const t of opts.holes??[])cell(t,[0,200,230]);
  const dot=(p:CityPoint,r:number,c:readonly number[])=>{const cx=p.x/u*px,cy=p.y/u*px;
    for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++)if((x-cx)**2+(y-cy)**2<=r*r)put(x,y,c);};
  for(const p of a.loot)dot(p,2,[230,190,0]);
  for(const L of lugares(a))dot(L.p,L.id.startsWith('ninho')?6:L.id==='praça'?8:5,L.id.startsWith('ninho')?[200,0,200]:L.id.startsWith('spawn')?[110,40,200]:L.id==='início'?[0,140,0]:[0,90,220]);
  await sharp(img,{raw:{width:W,height:W,channels:3}}).png().toFile(path);
}

if(process.argv[1]?.replace(/\\/g,'/').endsWith('scripts/becos-cidade.ts')){
  const args=process.argv.slice(2),flag=(n:string)=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
  const path=flag('--asset')??fileURLToPath(new URL('../public/maps/cidade-nevada.json',import.meta.url));
  const d=decodeCityAsset(readFileSync(path,'utf8'));if(!d.ok)throw new Error(d.error);
  const r=resumo(d.asset);
  const fmt=(p:Par)=>`${p.a} → ${p.b}: reta ${p.reta.toFixed(0)} u, anda ${p.anda.toFixed(0)} u (${p.ratio.toFixed(2)}×)`;
  console.log(`versão ${d.asset.version}: ${r.becos} becos (${r.becosSemMotivo} sem motivo: nem caixa no fim nem abrigo; ${r.becoCells} células), ${citySafePlaces(new CityTerrain(d.asset,'becos')).length} abrigos`);
  console.log(`lugares (${PAIR_MIN}–${PAIR_MAX} u): ${r.lugares.pares} pares, ${r.lugares.acima} acima de ${RATIO_GOAL}×, mediana ${r.lugares.mediana.toFixed(2)}×`);
  for(const p of r.lugares.pior)console.log(`  ${fmt(p)}`);
  console.log(`caixas (${PAIR_MIN}–${PAIR_MAX} u): ${r.caixas.pares} pares, ${r.caixas.acima} (${(100*r.caixas.acima/r.caixas.pares).toFixed(0)} %) acima de ${RATIO_GOAL}×, mediana ${r.caixas.mediana.toFixed(2)}×, p90 ${r.caixas.p90.toFixed(2)}×`);
  const spawnWalk=(a:CityAsset)=>{const g=cityGraph(a),d=walk(g.city,g.m,cityCell(g,a.points.praca));
    return (['spawnN','spawnS','spawnL','spawnO'] as const).map(k=>`${k} ${(d[cityCell(g,a.points[k])]*g.u).toFixed(0)} u`).join(', ');};
  console.log(`spawn → praça a pé: ${spawnWalk(d.asset)}`);
  if(args.includes('--propor')){
    const out=abrirBecos(cityAssetToData(d.asset));
    console.log(`entulho tirado: ${out.rubble.length} blocos + ${out.ruins} ruínas nas bocas da praça; caixas no fim de beco: ${out.lootAdded} novas, ${out.lootMoved} trazidas de perto`);
    for(const p of out.passagens)console.log(`  buraco ${p.kinds.join('+')} ${p.cells.length} células em (${(p.from%d.asset.cells.w)},${Math.floor(p.from/d.asset.cells.w)}) poupa ${p.save.toFixed(0)} células`);
    const after=decodeCityAsset(encodeCityAsset(out.data));if(!after.ok)throw new Error(after.error);
    const r2=resumo(after.asset);
    console.log(`depois: ${r2.becos} becos (${r2.becosSemMotivo} sem motivo), lugares acima ${r2.lugares.acima}/${r2.lugares.pares} med ${r2.lugares.mediana.toFixed(2)}, caixas acima ${r2.caixas.acima}/${r2.caixas.pares} med ${r2.caixas.mediana.toFixed(2)} p90 ${r2.caixas.p90.toFixed(2)}`);
    for(const p of r2.lugares.pior)console.log(`  ${fmt(p)}`);
    console.log(`spawn → praça a pé depois: ${spawnWalk(after.asset)}`);
    const png2=flag('--png-depois');if(png2)await picture(after.asset,png2,{holes:out.passagens.flatMap(p=>p.cells)});
    const js=flag('--json');if(js)writeFileSync(js,JSON.stringify({passagens:out.passagens},null,1));
  }
  // --antes v.json: the cells open here and shut there are drawn as holes (cyan).
  const antes=flag('--antes');let holes:number[]=[];
  if(antes){const b=decodeCityAsset(readFileSync(antes,'utf8'));if(!b.ok)throw new Error(b.error);const m=d.asset.cells.w,u=d.asset.unitsPerCell;
    for(let t=0;t<m*m;t++){const x=(t%m+.5)*u,y=(Math.floor(t/m)+.5)*u;if(d.asset.walkableAt(x,y)&&!b.asset.walkableAt(x,y))holes.push(t);}}
  const png=flag('--png');if(png)await picture(d.asset,png,{holes});
}

/**
 * NEW-20261028-ORQ-uno-atravessa-tralha (the user, 28/10: "muitas tralhas que vão me atrapalhar a caminhar com o carro
 * pelo jogo todo"; a zinc fence alone in the open snow): a fence that closes nothing is junk in the street. A loose
 * fence: a group of fence pieces (the 6 wall families, 8-neighbour) of at most CERCA_SOLTA_MAX cells, touching no other
 * block, whose open sides all meet within CERCA_SOLTA_PAD cells around it (the ground goes round it, no yard behind).
 */
export const CERCA_SOLTA_MAX=6,CERCA_SOLTA_PAD=3;
const FENCE=/^(alambrado|cerca-madeira|grade|muro-condominio|muro-pichado|tapume)-/;
export function cercasSoltas(data:CityAssetData):number[][]{
  const m=data.cells.w,u=data.unitsPerCell!,fence=new Set<number>(),solid=new Uint8Array(m*m),other=new Uint8Array(m*m);
  for(const d of data.decor??[])if(FENCE.test(d.id))for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)fence.add(c+r*m);
  for(const b of data.blocks)for(const [x,y,w,h] of b.rects)
    for(let r=Math.floor(y/u+1e-6);r<Math.ceil((y+h)/u-1e-6);r++)for(let c=Math.floor(x/u+1e-6);c<Math.ceil((x+w)/u-1e-6);c++){solid[c+r*m]=1;if(b.kind!=='wall')other[c+r*m]=1;}
  const seen=new Set<number>(),out:number[][]=[];
  for(const k of [...fence].sort((p,q)=>p-q)){
    if(seen.has(k))continue;
    const group=[k];seen.add(k);
    for(let i=0;i<group.length;i++){const c=group[i]%m,r=(group[i]-c)/m;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const n=(c+dc)+(r+dr)*m;if(fence.has(n)&&!seen.has(n)){seen.add(n);group.push(n);}}}
    if(group.length>CERCA_SOLTA_MAX)continue;
    const inGroup=new Set(group);let c0=m,c1=0,r0=m,r1=0,touches=false;
    for(const t of group){const c=t%m,r=(t-c)/m;c0=Math.min(c0,c);c1=Math.max(c1,c);r0=Math.min(r0,r);r1=Math.max(r1,r);
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const n=(c+dc)+(r+dr)*m;if(!inGroup.has(n)&&!fence.has(n)&&other[n])touches=true;}}
    if(touches)continue;
    c0-=CERCA_SOLTA_PAD;c1+=CERCA_SOLTA_PAD;r0-=CERCA_SOLTA_PAD;r1+=CERCA_SOLTA_PAD;
    const open=(c:number,r:number)=>c>=Math.max(c0,0)&&c<=Math.min(c1,m-1)&&r>=Math.max(r0,0)&&r<=Math.min(r1,m-1)&&!solid[c+r*m];
    const sides:number[]=[];
    for(const t of group){const c=t%m,r=(t-c)/m;for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]])if(open(c+dc,r+dr))sides.push(c+dc+(r+dr)*m);}
    if(!sides.length)continue;
    const met=new Set([sides[0]]),q=[sides[0]];
    for(let i=0;i<q.length;i++){const c=q[i]%m,r=(q[i]-c)/m;
      for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=(c+dc)+(r+dr)*m;if(open(c+dc,r+dr)&&!met.has(n)){met.add(n);q.push(n);}}}
    if(sides.every(t=>met.has(t)))out.push(group.sort((p,q)=>p-q));
  }
  return out;
}
/** Takes the loose fences out (openCells), each only while the defence holds (as alargarParaUno). Returns the groups taken. */
export function tirarCercasSoltas(data:CityAssetData):{taken:number[][];refused:number}{
  const decode=()=>{const d=decodeCityAsset(encodeCityAsset(data));if(!d.ok)throw new Error(d.error);return d.asset;};
  const defence=(x:CityAsset)=>{const g=cityGraph(x),P=x.points,cell=(p:CityPoint)=>Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m,d=walk(g.city,g.m,cell(P.praca));
    return {safe:[...g.safe].sort((p,q)=>p-q).join(','),walks:[P.spawnN,P.spawnS,P.spawnL,P.spawnO].map(p=>d[cell(p)])};};
  const kept=defence(decode()),taken:number[][]=[];let refused=0;
  for(const group of cercasSoltas(data)){
    const was=structuredClone(data);openCells(data,group);const now=defence(decode());
    if(now.safe!==kept.safe||now.walks.some((w,i)=>w<kept.walks[i]-1)){Object.assign(data,was);refused++;continue;}
    taken.push(group);
  }
  return {taken,refused};
}

// ——— The hero's ground, open to the Uno's body (NEW-20261028-ORQ-uno-atravessa-tralha) ———

/** The hero's disc on the map (u: maps PLAYER_RADIUS). */
const HERO_R=.35;
/** A widened lane for the body fits a disc this wide (u): carBodyDiscs' radius with 0.1 u to spare on each side. */
export const UNO_BODY_LANE=CAR_BODY_R+.1;
/** The share of the hero's ground (off the safe places) the Uno's body gets within UNO_LOOT_NEAR of, aimed for. */
export const UNO_AREA_GOAL=.99;
/** At most this many cells opened for one patch of ground the Uno misses. */
export const AREA_MAX_CELLS=40;
/** Patches smaller than this (probes) are left: a nook, not a street. */
const AREA_MIN_PATCH=8;

/**
 * The hero's ground the Uno's body misses: probes the hero reaches from the plaza, off the safe places, further than
 * UNO_LOOT_NEAR from every probe the body (a disc of CAR_BODY_R) reaches. Share: 1 − missed / hero's.
 */
export function unoArea(a:CityAsset):{share:number;missed:Uint8Array;GW:number}{
  const {w,h}=a.samples,W=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)W[x+y*w]=a.walkable(x,y)?1:0;
  const car=carReach(a,W,a.points.praca,CAR_BODY_R),hero=carReach(a,W,a.points.praca,HERO_R),GW=Math.ceil(a.size.w/PROBE),GH=Math.ceil(a.size.h/PROBE);
  const g=cityGraph(a),d=Math.round(UNO_LOOT_NEAR/PROBE),near=new Uint8Array(GW*GH);
  for(let i=0;i<GW*GH;i++)if(car[i]){const x=i%GW,y=(i-x)/GW;
    for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++){if(dx*dx+dy*dy>d*d)continue;const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<GW&&Y<GH)near[X+Y*GW]=1;}}
  const missed=new Uint8Array(GW*GH);let all=0,miss=0;
  for(let i=0;i<GW*GH;i++){if(!hero[i])continue;const t=Math.floor((i%GW+.5)*PROBE/g.u)+Math.floor((Math.floor(i/GW)+.5)*PROBE/g.u)*g.m;
    if(g.safe.has(t))continue;all++;if(!near[i]){missed[i]=1;miss++;}}
  return {share:all?1-miss/all:1,missed,GW};
}

/**
 * Widens the narrow ways into the hero's ground the Uno's body misses (unoArea), the biggest patch first, while the share
 * is under UNO_AREA_GOAL: the cheapest lane (widenTo, UNO_BODY_LANE) to the patch's middle, at most AREA_MAX_CELLS, only
 * through cuttable cells (allowedIn) and only while the defence holds (as alargarParaUno). `data` changes in place.
 */
export function alargarAreaUno(data:CityAssetData):{cells:number[];widened:number;refused:number;moved:number;before:number;after:number}{
  const decode=()=>{const d=decodeCityAsset(encodeCityAsset(data));if(!d.ok)throw new Error(d.error);return d.asset;};
  let a=decode();const before=unoArea(a).share,opened:number[]=[];let widened=0,refused=0;
  const defence=(x:CityAsset)=>{const g=cityGraph(x),P=x.points,cell=(p:CityPoint)=>Math.floor(p.x/g.u)+Math.floor(p.y/g.u)*g.m,d=walk(g.city,g.m,cell(P.praca));
    return {safe:[...g.safe].sort((p,q)=>p-q).join(','),walks:[P.spawnN,P.spawnS,P.spawnL,P.spawnO].map(p=>d[cell(p)])};};
  const kept=defence(a),skip=new Set<number>();
  for(let pass=0;pass<200;pass++){
    const {share,missed,GW}=unoArea(a);if(share>=UNO_AREA_GOAL)break;
    // The patches (8-neighbour) of missed probes, the biggest first; one with a skipped probe is skipped.
    const seen=new Uint8Array(missed.length),patches:number[][]=[];
    for(let i=0;i<missed.length;i++){if(!missed[i]||seen[i])continue;const q=[i];seen[i]=1;
      for(let k=0;k<q.length;k++){const x=q[k]%GW,y=(q[k]-x)/GW;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const n=x+dx+(y+dy)*GW;if(x+dx>=0&&x+dx<GW&&n>=0&&n<missed.length&&missed[n]&&!seen[n]){seen[n]=1;q.push(n);}}}
      if(q.length>=AREA_MIN_PATCH&&!q.some(t=>skip.has(t)))patches.push(q);}
    // A loot point off the safe places the body misses (the card: every crate) goes first, as a patch of its own.
    const g0=cityGraph(a);
    for(const l of a.loot){const i=Math.floor(l.x/PROBE)+Math.floor(l.y/PROBE)*GW;
      if(missed[i]&&!skip.has(i)&&!g0.safe.has(Math.floor(l.x/g0.u)+Math.floor(l.y/g0.u)*g0.m)){patches.unshift([i]);break;}}
    if(!patches.length)break;
    if(patches[0].length>1)patches.sort((p,q)=>q.length-p.length);
    const patch=patches[0];let mx=0,my=0;for(const t of patch){mx+=t%GW;my+=Math.floor(t/GW);}mx/=patch.length;my/=patch.length;
    const mid=patch.reduce((b,t)=>(t%GW-mx)**2+(Math.floor(t/GW)-my)**2<(b%GW-mx)**2+(Math.floor(b/GW)-my)**2?t:b);
    const target={x:(mid%GW+.5)*PROBE,y:(Math.floor(mid/GW)+.5)*PROBE};
    const g=cityGraph(a),cells=widenTo(a,g,allowedIn(a,g),unoField(a,CAR_BODY_R),target,UNO_BODY_LANE);
    const no=()=>{for(const t of patch)skip.add(t);};
    if(!cells?.length||cells.length>AREA_MAX_CELLS){if(process.env.ALARGAR_LOG)console.log('área skip',target.x.toFixed(0),target.y.toFixed(0),patch.length,cells?.length??'sem caminho');no();continue;}
    const was=structuredClone(data);openCells(data,cells);const next=decode(),now=defence(next);
    if(now.safe!==kept.safe||now.walks.some((w,i)=>w<kept.walks[i]-1)){Object.assign(data,was);refused++;no();continue;}
    if(process.env.ALARGAR_LOG)console.log('área alarga',target.x.toFixed(0),target.y.toFixed(0),patch.length,cells.length);
    a=next;opened.push(...cells);widened++;
  }
  if(data.decor&&opened.length)data.decor=bigCliffRocks(data.decor,BIG_ROCKS,opened.length);
  // The loot the body still misses (behind a building) moves out to the nearest street it reaches (as alargarParaUno).
  a=decode();const moved=moveLootToUno(data,a,decode,unoField(a,CAR_BODY_R,true));
  return {cells:opened,widened,refused,moved,before,after:unoArea(decode()).share};
}
