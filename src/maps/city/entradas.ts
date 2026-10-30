/**
 * The city's entrances (NEW-20261029-ORQ-sem-tralha-nas-entradas, widened by NEW-20261030-ORQ-entradas-livres-de-tudo):
 * the mouth of every street, avenue, gate or passage between blocks, of any width up to ENTRADA_LARGURA_MAX, where it
 * opens into wider ground; and what counts as narrowing one. Nothing solid stands near a mouth (sim/towers/tralha.ts,
 * barracas.ts, maps/nests.ts) and the sidewalk scenery keeps out of its middle strip (scripts/cenario-cidade.ts). Pure,
 * on the asset's walkable grid; memoised per asset.
 */
import type {CityAsset,CityPoint} from '../city-asset.ts';

/**
 * A narrow passage is at most PASSAGE_MAX map cells across, runs at least PASSAGE_DEPTH deep and opens by at least
 * OPENS_BY; a wider street (the user, 30/10: "obstáculos em entradas são horríveis", the tralha at the mouth of an
 * 8-cell street) opens by half its width and keeps within a quarter of it along its depth.
 */
const PASSAGE_MAX=5,PASSAGE_DEPTH=2,OPENS_BY=2,RUN_CAP=40;
/** The widest street (map cells across) whose mouth is an entrance. */
export const ENTRADA_LARGURA_MAX=24;
/**
 * The free zone of a mouth: its whole width across, from ENTRADA_DENTRO into the street to ENTRADA_FORA out into the
 * wider ground (u, from the middle of the mouth's cell row). A cell each way: the maze-like city is mostly mouths, and a
 * deeper zone leaves the feirinhas no open ground FEIRA_GAP apart.
 */
export const ENTRADA_DENTRO=1.5,ENTRADA_FORA=1.5;
/** The passage of an entrance: this many cells along it, each way from the mouth's cell. */
export const BOCA_FUNDO=2;
/** A piece narrows a mouth when it leaves less than this (u) free in a row across the passage. */
export const BOCA_LIVRE=2.5;
/**
 * An entrance: the middle of its mouth (x, y), the mouth's first and last walkable cell centres across (lo, hi), how
 * many map cells across it is (largura) and the axis across (ax, ay: 1,0 = across x).
 */
export interface CityBoca extends CityPoint {lo:CityPoint;hi:CityPoint;largura:number;ax:0|1;ay:0|1;
  /** Out of the street into the wider ground (a unit step along the street: -1, 0 or 1). */
  ox:number;oy:number}
const memo=new WeakMap<object,readonly CityBoca[]>();
const walker=(a:CityAsset)=>{
  const C=a.unitsPerCell,{w,h}=a.cells;
  return (c:number,r:number)=>c>=0&&r>=0&&c<w&&r<h&&a.walkableAt((c+.5)*C,(r+.5)*C);
};
const opensBy=(wide:number)=>wide<=PASSAGE_MAX?OPENS_BY:Math.ceil(wide/2);
const depthMax=(wide:number)=>wide<=PASSAGE_MAX?PASSAGE_MAX:wide+Math.floor(wide/4);

/**
 * The mouth of every passage (a street, gate or gap between blocks at most ENTRADA_LARGURA_MAX map cells across that
 * runs PASSAGE_DEPTH cells deep about as wide, so a notch in a wall is none) where the walkable ground across it widens
 * (opensBy: an avenue, a square, a crossing). The point is the middle of the passage's last cell row.
 */
export function cityEntradas(a:CityAsset):readonly CityBoca[]{
  const had=memo.get(a);
  if(had)return had;
  const C=a.unitsPerCell,{w,h}=a.cells,walk=walker(a);
  const reach=(c:number,r:number,dx:number,dy:number)=>{let k=0;while(k<RUN_CAP&&walk(c+(k+1)*dx,r+(k+1)*dy))k++;return k;};
  const across=(c:number,r:number,dx:number,dy:number)=>walk(c,r)?1+reach(c,r,dx,dy)+reach(c,r,-dx,-dy):0;
  const out:CityBoca[]=[],seen=new Set<string>();
  const at=(c:number,r:number)=>({x:(c+.5)*C,y:(r+.5)*C});
  for(let r=0;r<h;r++)for(let c=0;c<w;c++){
    if(!walk(c,r))continue;
    for(const [ax,ay] of [[1,0],[0,1]] as const){
      const wide=across(c,r,ax,ay);
      if(wide>ENTRADA_LARGURA_MAX)continue;
      for(const s of [1,-1]){
        const dx=ay*s,dy=ax*s;
        if(across(c+dx,r+dy,ax,ay)<wide+opensBy(wide))continue;
        let deep=true;
        for(let k=1;k<=PASSAGE_DEPTH&&deep;k++){const v=across(c-k*dx,r-k*dy,ax,ay);deep=v>0&&v<=depthMax(wide);}
        if(!deep)continue;
        const lo=reach(c,r,-ax,-ay),hi=reach(c,r,ax,ay),mid=(hi-lo)/2,mc=c+mid*ax,mr=r+mid*ay,key=`${mc},${mr}`;
        if(seen.has(key))continue;
        seen.add(key);
        out.push({...at(mc,mr),lo:at(c-lo*ax,r-lo*ay),hi:at(c+hi*ax,r+hi*ay),largura:wide,ax,ay,ox:dx,oy:dy});
      }
    }
  }
  memo.set(a,out);
  return out;
}

type Rect={x:number;y:number;w:number;h:number};
/** The mouth's free zone (u, see ENTRADA_DENTRO). */
export function bocaZona(a:CityAsset,e:CityBoca):Rect{
  const half=a.unitsPerCell/2;
  const x0=Math.min(e.lo.x,e.hi.x)-half,x1=Math.max(e.lo.x,e.hi.x)+half,y0=Math.min(e.lo.y,e.hi.y)-half,y1=Math.max(e.lo.y,e.hi.y)+half;
  // Along the street: DENTRO back against the way out, FORA along it.
  const back=(o:number)=>o>0?ENTRADA_DENTRO:ENTRADA_FORA,fwd=(o:number)=>o>0?ENTRADA_FORA:ENTRADA_DENTRO;
  if(e.ax)return {x:x0,y:e.y-back(e.oy),w:x1-x0,h:back(e.oy)+fwd(e.oy)};
  return {x:e.x-back(e.ox),y:y0,w:back(e.ox)+fwd(e.ox),h:y1-y0};
}
/**
 * The mouth's free strip, where nothing solid stands (the map's tralha, the barracas, a nest): its whole free zone, of
 * any width (ORQ 30/10: "a largura INTEIRA fica livre", the user twice about any obstacle at an entrance).
 */
export const bocaFaixa=(a:CityAsset,e:CityBoca):Rect=>bocaZona(a,e);
/** Whether a rect (u), grown by `folga`, overlaps the free strip of any entrance (the strip run `fundo` u further into the street). */
export function naBoca(a:CityAsset,r:Rect,folga=0,fundo=0):boolean{
  for(const e of cityEntradas(a)){
    const f=bocaFaixa(a,e),z={x:f.x-(e.ox>0?fundo:0),y:f.y-(e.oy>0?fundo:0),w:f.w+(e.ox?fundo:0),h:f.h+(e.oy?fundo:0)};
    if(r.x-folga<z.x+z.w&&z.x<r.x+r.w+folga&&r.y-folga<z.y+z.h&&z.y<r.y+r.h+folga)return true;
  }
  return false;
}

/**
 * The passage at an entrance: across goes the mouth's axis (a bare point: the way the ground is narrower); for each
 * cell along it (BOCA_FUNDO each way, walkable ones), the row of walkable cells across.
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

/**
 * The narrow entrances (at most PASSAGE_MAX cells across), the ones the sidewalk scenery keeps out of the middle of
 * (scripts/cenario-cidade.ts semDecorNasBocas): the scenery blocks nothing, and a wide mouth reads open beside it.
 */
export const entradasEstreitas=(a:CityAsset)=>cityEntradas(a).filter(e=>e.largura<=PASSAGE_MAX);

/**
 * Whether a piece on cells (c, r, w, h) narrows the entrance `e`: in a row of its passage it takes the middle cell or
 * leaves less than BOCA_LIVRE free.
 */
export function estreitaBoca(a:CityAsset,e:CityPoint|CityBoca,p:{c:number;r:number;w:number;h:number}):boolean{
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
