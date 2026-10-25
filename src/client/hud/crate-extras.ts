/**
 * Caixas no minimapa WC3 (card NEW-20261025-ORQ-uno-caminho-caixas-vender, item 2; o usuário rodou o mapa todo e achou
 * só 3 caixas): as caixas que o quadro traz (as do raio de interesse, já sem as que este jogador não vê, hiddenFor) como
 * extras do minimapa, kind 'caixa' na cor da raridade (o pickup 'chest' leva a raridade no `value`, sim/crates.ts).
 * Pure.
 */
import {RARITY_COLOR} from '../render/arsenal-rules.ts';
import type {MmExtra} from './wc-minimap/minimap.ts';

export const CRATE_MM_KIND='caixa';
const hex=(n:number)=>'#'+n.toString(16).padStart(6,'0').toUpperCase();
const COLORS:readonly string[]=[1,2,3,4,5].map(r=>hex(RARITY_COLOR[r as 1|2|3|4|5]));

/** The crates of a view as minimap extras (a rarity outside 1..5 draws as verde). */
export function crateExtras(pickups:readonly {kind:string;x:number;y:number;value?:number}[]|undefined):MmExtra[]{
  const out:MmExtra[]=[];
  for(const k of pickups??[]){
    if(k.kind!=='chest')continue;
    const r=Math.min(5,Math.max(1,Math.round(k.value??1)));
    out.push({kind:CRATE_MM_KIND,x:k.x,y:k.y,color:COLORS[r-1]});
  }
  return out;
}
