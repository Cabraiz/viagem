/** Pure rules of the Stonewards renderer (VGM-046B), kept apart from Phaser so node tests can import them. */
import type {NodeView} from '../../contract/index.ts';

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

/**
 * Tops of the drawn structures (world px above the feet, at the endless map's size): the wall's flag pole and the
 * tower's sandal. Their bars hang a CSS gap above them.
 */
export const STRUCTURE_TOP={muralha:100,torre:66} as const;
/** CSS px between a structure's top and the top of its bar. */
export const STRUCTURE_BAR_GAP_CSS={muralha:12,torre:8} as const;
/**
 * Top of a structure's bar (world px, pure, tested) over feet at `feetY`: the art's top × `scale` (framing.ts
 * CITY_VIEW_SCALE in the city, 1 elsewhere: the art is drawn at the endless map's size times it) plus the CSS gap ×
 * `css` (world px per CSS px, 1/zoom). So under the city zoom the bar keeps the endless map's CSS distance from the feet.
 */
export function structureBarY(kind:keyof typeof STRUCTURE_TOP,feetY:number,css:number,scale=1){
  return feetY-STRUCTURE_TOP[kind]*scale-STRUCTURE_BAR_GAP_CSS[kind]*css;
}
