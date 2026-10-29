/**
 * The city's entrances (NEW-20261029-ORQ-sem-tralha-nas-entradas): the mouth of every narrow passage, and what counts
 * as narrowing one. The map's tralha keeps off them (sim/towers/tralha.ts) and the sidewalk scenery keeps out of their
 * middle (scripts/cenario-cidade.ts). Pure, on the asset's walkable grid; memoised per asset.
 */
import type {CityAsset,CityPoint} from '../city-asset.ts';

/** A passage is at most this many map cells across, runs at least this deep and opens by at least this much. */
const PASSAGE_MAX=5,PASSAGE_DEPTH=2,OPENS_BY=2,RUN_CAP=14;
/** The passage of an entrance: this many cells along it, each way from the mouth's cell. */
export const BOCA_FUNDO=2;
/** A piece narrows a mouth when it leaves less than this (u) free in a row across the passage. */
export const BOCA_LIVRE=2.5;
const memo=new WeakMap<object,readonly CityPoint[]>();
const walker=(a:CityAsset)=>{
  const C=a.unitsPerCell,{w,h}=a.cells;
  return (c:number,r:number)=>c>=0&&r>=0&&c<w&&r<h&&a.walkableAt((c+.5)*C,(r+.5)*C);
};

/**
 * The mouth of every passage (a street, gate or gap between blocks at most PASSAGE_MAX map cells across that runs
 * PASSAGE_DEPTH cells deep, so a notch in a wall is none) where the walkable ground across it widens by OPENS_BY cells
 * or more (an avenue, a square, a crossing). The point is the middle of the passage's last cell.
 */
export function cityEntradas(a:CityAsset):readonly CityPoint[]{
  const had=memo.get(a);
  if(had)return had;
  const C=a.unitsPerCell,{w,h}=a.cells,walk=walker(a);
  const reach=(c:number,r:number,dx:number,dy:number)=>{let k=0;while(k<RUN_CAP&&walk(c+(k+1)*dx,r+(k+1)*dy))k++;return k;};
  const across=(c:number,r:number,dx:number,dy:number)=>walk(c,r)?1+reach(c,r,dx,dy)+reach(c,r,-dx,-dy):0;
  const out:CityPoint[]=[],seen=new Set<string>();
  for(let r=0;r<h;r++)for(let c=0;c<w;c++){
    if(!walk(c,r))continue;
    for(const [ax,ay] of [[1,0],[0,1]] as const){
      const wide=across(c,r,ax,ay);
      if(wide>PASSAGE_MAX)continue;
      for(const s of [1,-1]){
        const dx=ay*s,dy=ax*s;
        if(across(c+dx,r+dy,ax,ay)<wide+OPENS_BY)continue;
        let deep=true;
        for(let k=1;k<=PASSAGE_DEPTH&&deep;k++){const v=across(c-k*dx,r-k*dy,ax,ay);deep=v>0&&v<=PASSAGE_MAX;}
        if(!deep)continue;
        const mid=(reach(c,r,ax,ay)-reach(c,r,-ax,-ay))/2,mc=c+mid*ax,mr=r+mid*ay,key=`${mc},${mr}`;
        if(seen.has(key))continue;
        seen.add(key);out.push({x:(mc+.5)*C,y:(mr+.5)*C});
      }
    }
  }
  memo.set(a,out);
  return out;
}

/**
 * The passage at an entrance: across goes the way the ground is narrower at the mouth; for each cell along it
 * (BOCA_FUNDO each way, walkable ones), the row of walkable cells across (up to 8 each way).
 */
export function bocaPassagem(a:CityAsset,e:CityPoint):{c:number;r:number}[][]{
  const C=a.unitsPerCell,walk=walker(a),ec=Math.floor(e.x/C),er=Math.floor(e.y/C);
  const side=(c:number,r:number,dx:number,dy:number)=>{let k=0;while(k<8&&walk(c+(k+1)*dx,r+(k+1)*dy))k++;return k;};
  const acrossX=side(ec,er,1,0)+side(ec,er,-1,0)<=side(ec,er,0,1)+side(ec,er,0,-1);
  const [ax,ay]=acrossX?[1,0]:[0,1],[lx,ly]=acrossX?[0,1]:[1,0];
  const rows:{c:number;r:number}[][]=[];
  for(let t=-BOCA_FUNDO;t<=BOCA_FUNDO;t++){
    const c0=ec+t*lx,r0=er+t*ly;
    if(!walk(c0,r0))continue;
    const lo=side(c0,r0,-ax,-ay),hi=side(c0,r0,ax,ay),row=[];
    for(let k=-lo;k<=hi;k++)row.push({c:c0+k*ax,r:r0+k*ay});
    rows.push(row);
  }
  return rows;
}

/** Whether a piece on cells (c, r, w, h) narrows the entrance `e`: in a row of its passage it takes the middle cell or leaves less than BOCA_LIVRE free. */
export function estreitaBoca(a:CityAsset,e:CityPoint,p:{c:number;r:number;w:number;h:number}):boolean{
  const covers=(q:{c:number;r:number})=>q.c>=p.c&&q.c<p.c+p.w&&q.r>=p.r&&q.r<p.r+p.h;
  for(const row of bocaPassagem(a,e)){
    if(!row.some(covers))continue;
    if(covers(row[Math.floor(row.length/2)]))return true;
    let best=0,run=0;
    for(const q of row){run=covers(q)?0:run+1;best=Math.max(best,run);}
    if(best*a.unitsPerCell<BOCA_LIVRE)return true;
  }
  return false;
}
