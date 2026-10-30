/**
 * The bico shops' candidates off the street mouths (card NEW-20261030-ORQ-lojas-bico-fora-das-bocas), what a run hands
 * planBanks (system.ts): shopCandidates(city, car, crates), the ring and the loot points with every lot moved out of the
 * entrances' free strips (lojasForaDasBocas); lotInMouth(city, x, y) tells a lot in a strip.
 */
import {bocaFaixa,cityEntradas,type CityTerrain,type Point,type Rect} from '../../maps/index.ts';
import {BICO} from '../../rules/index.ts';
import {RING_CLEAR,TAU,ringCandidates,type BankCandidate} from './system.ts';

/**
 * Shops off the street mouths (NEW-20261030-ORQ-lojas-bico-fora-das-bocas; E2 30/10: 594 of 600 shops in 200 seeds had
 * their lot on an entrance's free strip, maps/city/entradas.ts bocaFaixa; not solid, but a whole building in the mouth).
 * A candidate whose lot (the BICO.lote disc the shop stands in, any turn) overlaps a strip moves to the nearest spot where
 * a hero fits (RING_CLEAR) and the whole lot is off every strip: rings SHOP_MOUTH_STEP u apart out to SHOP_MOUTH_REACH u,
 * SHOP_MOUTH_ANGLES each, SHOP_SPACING u from the other candidates when it can (else the nearest at all). It keeps its
 * order and crate id; a ring spot's `lot` is measured again. None found, it is dropped. Same method as the crates
 * (sim/crates.ts foraDasBocas).
 */
export const SHOP_MOUTH_REACH=24,SHOP_MOUTH_STEP=.5,SHOP_MOUTH_ANGLES=48,SHOP_SPACING=4;
/** Grid cell (u) of the strips' lookup: each cell lists the strips a lot centred in it may touch. */
const STRIP_CELL=4;
interface StripGrid {cells:Map<number,Rect[]>}
const stripsMemo=new WeakMap<object,StripGrid>();
const cellKey=(i:number,j:number)=>i*65536+j;
function stripGrid(city:CityTerrain):StripGrid{
  const a=city.asset,R=BICO.lote;
  let g=stripsMemo.get(a);
  if(g)return g;
  g={cells:new Map()};
  for(const f of cityEntradas(a).map(e=>bocaFaixa(a,e))){
    for(let i=Math.floor((f.x-R)/STRIP_CELL);i<=Math.floor((f.x+f.w+R)/STRIP_CELL);i++)
      for(let j=Math.floor((f.y-R)/STRIP_CELL);j<=Math.floor((f.y+f.h+R)/STRIP_CELL);j++){
        const k=cellKey(i,j),list=g.cells.get(k);
        if(list)list.push(f);else g.cells.set(k,[f]);
      }
  }
  stripsMemo.set(a,g);
  return g;
}
/** Whether a shop's lot (a BICO.lote disc) at (x, y) overlaps an entrance's free strip. */
export function lotInMouth(city:CityTerrain,x:number,y:number):boolean{
  const list=stripGrid(city).cells.get(cellKey(Math.floor(x/STRIP_CELL),Math.floor(y/STRIP_CELL)));
  return !!list&&list.some(f=>Math.hypot(x-Math.max(f.x,Math.min(x,f.x+f.w)),y-Math.max(f.y,Math.min(y,f.y+f.h)))<BICO.lote);
}
/**
 * The bank candidates with every lot in a mouth's strip moved out of it (see SHOP_MOUTH_REACH); the others as they were.
 * A moved loot point is no longer that crate's place (no id: the crate stays in the run, CRATE_CLEAR still applies).
 */
export function lojasForaDasBocas(city:CityTerrain,candidates:readonly BankCandidate[]):BankCandidate[]{
  const out:BankCandidate[]=[],taken=candidates.filter(p=>!lotInMouth(city,p.x,p.y));
  for(const p of candidates){
    if(!lotInMouth(city,p.x,p.y)){out.push(p);continue;}
    let near:Point|undefined;
    search:for(let n=1;n*SHOP_MOUTH_STEP<=SHOP_MOUTH_REACH;n++)for(let k=0;k<SHOP_MOUTH_ANGLES;k++){
      const r=n*SHOP_MOUTH_STEP,a=k*TAU/SHOP_MOUTH_ANGLES;
      const x=Math.round((p.x+Math.cos(a)*r)*100)/100,y=Math.round((p.y+Math.sin(a)*r)*100)/100;
      if(lotInMouth(city,x,y)||!city.clearDisc(x,y,RING_CLEAR))continue;
      near??={x,y};
      if(taken.some(q=>Math.hypot(q.x-x,q.y-y)<SHOP_SPACING))continue;
      near={x,y};break search;
    }
    if(!near)continue;
    const moved:BankCandidate=city.clearDisc(near.x,near.y,BICO.lote)?{x:near.x,y:near.y,lot:true}:{x:near.x,y:near.y};
    out.push(moved);taken.push(moved);
  }
  return out;
}

const candidatesMemo=new WeakMap<object,Map<string,readonly BankCandidate[]>>();
/**
 * What a run offers planBanks (assemble.ts): the street ring around the car first, the loot points (`crates`, cityLoot
 * nodes) as a fallback, all off the mouths (lojasForaDasBocas). The same city, car and crates give the same list (memo).
 */
export function shopCandidates(city:CityTerrain,car:Point,crates:readonly BankCandidate[]):readonly BankCandidate[]{
  let memo=candidatesMemo.get(city.asset);
  if(!memo)candidatesMemo.set(city.asset,memo=new Map());
  const key=`${car.x},${car.y}|${crates.map(c=>`${c.id}@${c.x},${c.y}`).join(';')}`;
  let out=memo.get(key);
  if(!out)memo.set(key,out=lojasForaDasBocas(city,[...ringCandidates(car,(x,y,r)=>city.clearDisc(x,y,r)),...crates]));
  return out;
}
