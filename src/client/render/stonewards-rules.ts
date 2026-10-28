/** Pure rules of the Stonewards renderer (VGM-046B), kept apart from Phaser so node tests can import them. */
import type {NodeView,StructureView} from '../../contract/index.ts';

/**
 * What a structure is on the map, from its wire `kind` (a free string, multiplayer/simulation.ts structureViews):
 * the wall 'muralha', a city barricade 'barricada' (cidade-06) or a forge tower 'torre-chinelo'. Any other kind is
 * not drawn (never as a tower: a barricade counted as a tower drew a sandal on every plaza mouth).
 */
export type StructureRole='wall'|'barricade'|'tower'|'barraca';
export const WALL_KIND='muralha',BARRICADE_KIND='barricada',TOWER_KIND='torre-chinelo',BARRACA_KIND='barraca';
export function structureRole(kind:string):StructureRole|undefined{
  return kind===WALL_KIND?'wall':kind===BARRICADE_KIND?'barricade':kind===TOWER_KIND?'tower':kind===BARRACA_KIND?'barraca':undefined;
}
/**
 * NEW-20261023-ORQ-barracas-no-caminho, a feirinha barraca's look (pure, tested). The art (public/art/city/base/barraca.webp)
 * has BARRACA_LONAS lonas × inteira | danificada | quebrada, 2 views (the second mirrored: the other diagonal); the
 * feirinhas' barracas are never hurt, so always inteira.
 * - lona: from the id (every phone draws the same stall), 1..lonas;
 * - column: the view's parity turned by the id, so a feirinha is not one stall copied and a camera turn flips them all.
 */
export function barracaHash(id:string){
  let h=2166136261;
  for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);
  return h>>>0;
}
export const barracaLona=(id:string,lonas:number)=>`lona-${1+barracaHash(id)%Math.max(1,lonas)}`;
export const barracaColumn=(view:number,id:string)=>((Math.round(view)+(barracaHash(id)>>>4))%2+2)%2;

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
 * tower's sandal. Their bars hang a CSS gap above them. The barricade (city only): its far post, 48 above an end of the
 * pile that itself sits up to 21 world px (1 u along an axis) above the centre, i.e. ≈ 48 + 21 / CITY_VIEW_SCALE.
 */
export const STRUCTURE_TOP={muralha:100,torre:66,barricada:88} as const;
/** CSS px between a structure's top and the top of its bar. */
export const STRUCTURE_BAR_GAP_CSS={muralha:12,torre:8,barricada:8} as const;
/**
 * Top of a structure's bar (world px, pure, tested) over feet at `feetY`: the art's top × `scale` (framing.ts
 * CITY_VIEW_SCALE in the city, 1 elsewhere: the art is drawn at the endless map's size times it) plus the CSS gap ×
 * `css` (world px per CSS px, 1/zoom). So under the city zoom the bar keeps the endless map's CSS distance from the feet.
 */
export function structureBarY(kind:keyof typeof STRUCTURE_TOP,feetY:number,css:number,scale=1){
  return feetY-STRUCTURE_TOP[kind]*scale-STRUCTURE_BAR_GAP_CSS[kind]*css;
}

/**
 * Damage stage of a wall or barricade (agreed with the art, ART-IDS): 0 whole above 66% of its life, 1 damaged above
 * 33%, 2 about to fall above 0, 3 broken at 0 or when the server says it is down (pure, tested). The art's state names
 * (base-art.ts baseState) and the procedural barricade both read it, so the two never disagree.
 */
export type DamageStage=0|1|2|3;
export const DAMAGE_WHOLE=.66,DAMAGE_HALF=.33;
export function damageStage(ratio:number,down=false):DamageStage{
  const r=Number.isFinite(ratio)?ratio:0;
  return down||r<=0?3:r>DAMAGE_WHOLE?0:r>DAMAGE_HALF?1:2;
}

/** A barricade's bar: hidden while whole (full life) and once down; otherwise the wall bar's fraction and low cue. */
export function barricadeBar(hp:number,maxHp:number){
  const bar=wallBar(hp,maxHp);
  return {...bar,show:bar.fraction>0&&bar.fraction<1};
}

/**
 * Half the length (world u) of the pile drawn across a plaza mouth: the server's barricade disc is at least 1 u in
 * radius (sim/stonewards/barricades.ts BARRICADE_MIN_R) and the view carries no radius, so the pile spans 2 u.
 */
export const BARRICADE_HALF_SPAN=1;
/**
 * Where a barricade's pile lies (pure, tested): its two ends (world u), across the line from the wall (the plaza's
 * fountain) to the barricade, and `turn`, the quarter turns of that line from +y (0: the barricade sits on the wall's
 * +y side; 1: −x; 2: −y; 3: +x, the same rotation as a camera view, render/projector.ts). An art column is then
 * (view + turn) mod 4: the sheet's column 0 is a barricade on the +y side seen from view 0. With no wall (or on it),
 * the pile lies along x and turn is 0.
 */
export function barricadeSpan(b:{x:number;y:number},wall?:{x:number;y:number},half=BARRICADE_HALF_SPAN){
  let rx=wall?b.x-wall.x:0,ry=wall?b.y-wall.y:1;
  const len=Math.hypot(rx,ry);
  if(len<1e-6){rx=0;ry=1;}else{rx/=len;ry/=len;}
  // Across the radial line: (−ry, rx).
  const px=-ry,py=rx;
  const turn=((Math.round((Math.atan2(ry,rx)-Math.PI/2)/(Math.PI/2))%4)+4)%4;
  return {ax:b.x-px*half,ay:b.y-py*half,bx:b.x+px*half,by:b.y+py*half,turn};
}

/**
 * A free-build barricade (D-052: it carries its grid cell c/r and rot): it lies along its footprint, 2 cells along x
 * (rot 0, the art's column 0 like a barricade on the wall's +y side) or along y (rot 1, a quarter turn), centred on x,y.
 */
export function freeBarricadeSpan(b:{x:number;y:number;rot?:number},cell:number){
  const half=cell,along=b.rot===1;
  return along?{ax:b.x,ay:b.y-half,bx:b.x,by:b.y+half,turn:1}:{ax:b.x-half,ay:b.y,bx:b.x+half,by:b.y,turn:0};
}
/** A barricade of the free build (it has a grid cell) rather than one across a plaza mouth. */
export const isFreeBarricade=(s:{c?:number})=>s.c!==undefined;

/** Ids whose life dropped since the last view (`before`: hp by id), for the hit flash (pure, tested). */
export function hpDropped(before:ReadonlyMap<string,number>,after:readonly StructureView[]){
  const out:string[]=[];
  for(const s of after){const old=before.get(s.id);if(old!==undefined&&s.hp<old)out.push(s.id);}
  return out;
}
/**
 * NEW-20261028-ORQ-uno-atravessa-tralha: the map's tralha squares (ids TRALHA_PREFIX, sim/towers/tralha.ts) gone since
 * the last view with the Uno's centre within RUN_OVER_NEAR u of them: the Uno ran them over (a coleta or a horde far from
 * the car gets no burst).
 */
export function ranOver(before:ReadonlyMap<string,StructureView>,after:readonly StructureView[],car:{x:number;y:number}|undefined):StructureView[]{
  if(!car)return [];
  const now=new Set(after.map(s=>s.id)),out:StructureView[]=[];
  for(const [id,s] of before)if(!now.has(id)&&id.startsWith('tralha')&&Math.hypot(s.x-car.x,s.y-car.y)<=RUN_OVER_NEAR)out.push(s);
  return out;
}
export const RUN_OVER_NEAR=4;
/** The burst of junk a run-over square throws (ms), and its chunks: angle, speed (px/s at zoom 1), size, colour slot. */
export const RUN_OVER_MS=650;
export function runOverChunks(seed:number,n=14){
  const out:{a:number;v:number;size:number;tint:number}[]=[];
  let h=(seed*2654435761)>>>0;const rnd=()=>{h=(h^(h>>>15))*2246822507>>>0;h=(h^(h>>>13))*3266489909>>>0;return ((h^=h>>>16)>>>0)/4294967296;};
  for(let i=0;i<n;i++)out.push({a:(i+rnd()*.8)/n*Math.PI*2,v:90+rnd()*130,size:7+rnd()*8,tint:i%3});
  return out;
}
/** How long a hit structure flashes (ms); never with reduced effects (UX checklist B9). */
export const HIT_FLASH_MS=140;
