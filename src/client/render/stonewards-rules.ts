/** Pure rules of the Stonewards renderer (VGM-046B), kept apart from Phaser so node tests can import them. */
import type {NodeView} from '../../contract/view.ts';

/** Life share under which the wall's bar turns Laranja Cone (and gains its notch). */
export const WALL_LOW=.3;
/** What the wall bar shows: fraction and whether it is low (pure, tested). */
export function wallBar(hp:number,maxHp:number){
  const fraction=maxHp>0&&Number.isFinite(hp)?Math.max(0,Math.min(1,hp/maxHp)):0;
  return {fraction,low:fraction>0&&fraction<WALL_LOW};
}
/** Units that came out of each node between two views: remaining dropped by n → n × value (pure, tested). */
export function gatheredSince(before:ReadonlyMap<string,NodeView>,after:readonly NodeView[]){
  const out:{node:NodeView;amount:number}[]=[];
  for(const n of after){
    const old=before.get(n.id);
    if(old&&n.remaining<old.remaining)out.push({node:n,amount:(old.remaining-n.remaining)*n.value});
  }
  return out;
}

