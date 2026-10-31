/**
 * NEW-20261031-ORQ-itens-sem-nascer-colados (the user, 31/10: "E itens não podem ficar tão próximos assim, eles tão
 * nascendo um sobre o outro"): a crate (sim/crates.ts, every source: placed, start, near, trail, floor, respawn, an
 * elite's, the chefe's, a nest's) never appears closer than ITEM_MIN_GAP u to a live item on the ground (GROUND_ITEMS).
 * Taken spot: the nearest free one on rings GAP_STEP u apart out to GAP_REACH u, GAP_ANGLES each, the first one at
 * angle 0 (a drop next to another opens in a fan around the body); a crowded corner, rings 1 u apart out to GAP_FAR u
 * (the whole city), GAP_ARC u between candidates; none found, it stays. Pure and stateless (the checkpoint does not
 * change).
 */
import type {PickupKind,PickupState,Point} from '../contract/index.ts';
import {bocaFaixa,cityEntradas,type CityTerrain} from '../maps/index.ts';
import {CRATE_BODY_RADIUS} from '../rules/index.ts';
import {cityTerrainOf} from './city/grid.ts';
import type {SimContext} from './context.ts';

/** Centre to centre: two 3 u crate bodies (CRATE_BODY_RADIUS 1.5) with a hero's width between them. */
export const ITEM_MIN_GAP=5;
/** What lies on the ground and counts: crates, inventory items, the heal and the cédulas (not a parked vehicle, not xp). */
export const GROUND_ITEMS:ReadonlySet<PickupKind>=new Set(['chest','item','heal','grana']);
export const GAP_STEP=.5,GAP_REACH=24,GAP_ANGLES=48,GAP_FAR=240,GAP_ARC=2;

/** Whether (x, y) is ITEM_MIN_GAP from every live ground item but `except`. */
export function gapFree(pickups:ReadonlyMap<string,PickupState>,at:Point,except?:string):boolean{
  for(const p of pickups.values())if(p.id!==except&&GROUND_ITEMS.has(p.kind)&&(p.x-at.x)**2+(p.y-at.y)**2<ITEM_MIN_GAP**2)return false;
  return true;
}

/** `at` when it is gap-free; else the nearest gap-free spot `ok` accepts (see the header); none, `at`. */
export function clearSpot(ctx:SimContext,at:Point,ok:(p:Point)=>boolean,except?:string):Point{
  if(gapFree(ctx.pickups,at,except))return {x:at.x,y:at.y};
  for(let r=GAP_STEP;r<=GAP_FAR;r+=r<GAP_REACH?GAP_STEP:1){
    const angles=Math.max(GAP_ANGLES,Math.ceil(2*Math.PI*r/GAP_ARC));
    for(let k=0;k<angles;k++){
      const a=k*2*Math.PI/angles;
      const p={x:Math.round((at.x+Math.cos(a)*r)*100)/100,y:Math.round((at.y+Math.sin(a)*r)*100)/100};
      if(gapFree(ctx.pickups,p,except)&&ok(p))return p;
    }
  }
  return {x:at.x,y:at.y};
}

/** The candidates gap-free (`of` gives each one's spot); none, all of them (the spot is cleared when it is placed). */
export function roomy<T>(pickups:ReadonlyMap<string,PickupState>,candidates:readonly T[],of:(c:T)=>Point):T[]{
  const out=candidates.filter(c=>gapFree(pickups,of(c)));
  return out.length?out:[...candidates];
}

type Strip={x:number;y:number;w:number;h:number};
/** The entrances' free strips by MOUTH_CELL u cell, each in every cell its body-widened box touches. */
const MOUTH_CELL=8,stripsMemo=new WeakMap<object,Map<number,Strip[]>>();
const cellOf=(x:number,y:number)=>Math.floor(x/MOUTH_CELL)*4096+Math.floor(y/MOUTH_CELL);
/** Whether a crate body at (x, y) overlaps an entrance's free strip (crates.ts MOUTH_REACH). */
export function crateInMouth(city:CityTerrain,x:number,y:number):boolean{
  const a=city.asset,R=CRATE_BODY_RADIUS;
  let cells=stripsMemo.get(a);
  if(!cells){
    stripsMemo.set(a,cells=new Map());
    for(const f of cityEntradas(a).map(e=>bocaFaixa(a,e)))
      for(let i=Math.floor((f.x-R)/MOUTH_CELL);i<=Math.floor((f.x+f.w+R)/MOUTH_CELL);i++)
        for(let j=Math.floor((f.y-R)/MOUTH_CELL);j<=Math.floor((f.y+f.h+R)/MOUTH_CELL);j++){
          const k=i*4096+j,list=cells.get(k);
          if(list)list.push(f);else cells.set(k,[f]);
        }
  }
  return cells.get(cellOf(x,y))?.some(f=>x-R<f.x+f.w&&f.x<x+R&&y-R<f.y+f.h&&f.y<y+R)??false;
}

/** clearSpot for a crate: open ground for its body and off the street mouths (in the city), and `reached`. */
export function crateSpot(ctx:SimContext,at:Point,reached:(p:Point)=>boolean,except?:string):Point{
  const city=cityTerrainOf(ctx.terrain);
  return clearSpot(ctx,at,p=>(!city||city.clearDisc(p.x,p.y,CRATE_BODY_RADIUS)&&!crateInMouth(city,p.x,p.y))&&reached(p),except);
}
