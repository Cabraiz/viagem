/**
 * Critter groups of the city (doc §3): one grid of GROUP_CELL world units aligned to the city, the busiest free cell
 * becomes a seed and takes its occupied ring of 8 (one ring only, so a group spans at most 3 cells, 24 u). The groups
 * make the edge arrows (≥ GROUP_MIN, near, off screen, at most GROUP_ARROWS).
 * Pure and deterministic: the result does not depend on the input order.
 */
import {CITY_MAP_SCALE} from './deps.ts';

export interface EnemyPoint {id:string;x:number;y:number;boss?:boolean}
export interface EnemyGroup {
  /** The seed cell ("cx,cy"): stable while the group's busiest cell stays the same. */
  key:string;
  /** Mean position of its critters (world units). */
  x:number;y:number;count:number;ids:string[]}
/**
 * GROUP_CELL (u) is a crowd's size, people-scale (the critters did not grow); GROUP_RANGE (u, how far a group still gets an
 * arrow) is a map length: 60 u on the .w3x map × CITY_MAP_SCALE (NEW-20261013-ORQ-cidade-escala-1-7).
 */
export const GROUP_CELL=8,GROUP_MIN=5,GROUP_RANGE=60*CITY_MAP_SCALE,GROUP_ARROWS=2;
/** A shown arrow stays while its group keeps this many critters (hysteresis). */
export const GROUP_SHOW=3;
/** Hysteresis: a shown arrow stays while its group is among this many nearest. */
export const GROUP_KEEP_NEAREST=3;

const byId=(a:EnemyPoint,b:EnemyPoint)=>a.id<b.id?-1:a.id>b.id?1:a.x-b.x||a.y-b.y;
const byKey=(a:string,b:string)=>a<b?-1:a>b?1:0;

/** Groups of `enemies` (callers leave the boss out); every critter lands in exactly one group. Biggest first, then key. */
export function clusterEnemies(enemies:readonly EnemyPoint[],cell=GROUP_CELL):EnemyGroup[]{
  const cells=new Map<string,{cx:number;cy:number;list:EnemyPoint[]}>();
  for(const e of enemies){
    const cx=Math.floor(e.x/cell),cy=Math.floor(e.y/cell),k=`${cx},${cy}`;
    let c=cells.get(k);if(!c)cells.set(k,c={cx,cy,list:[]});c.list.push(e);
  }
  // Busiest first, then the cell index (row by row, as the grid is stored: row 0 = north).
  const order=[...cells.values()].sort((a,b)=>b.list.length-a.list.length||a.cy-b.cy||a.cx-b.cx);
  const taken=new Set<string>(),out:EnemyGroup[]=[];
  for(const seed of order){
    const key=`${seed.cx},${seed.cy}`;if(taken.has(key))continue;
    taken.add(key);const members=[...seed.list];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const k=`${seed.cx+dx},${seed.cy+dy}`,c=cells.get(k);
      if(c&&!taken.has(k)){taken.add(k);members.push(...c.list);}
    }
    members.sort(byId);
    let sx=0,sy=0;for(const m of members){sx+=m.x;sy+=m.y;}
    out.push({key,x:sx/members.length,y:sy/members.length,count:members.length,ids:members.map(m=>m.id)});
  }
  return out.sort((a,b)=>b.count-a.count||byKey(a.key,b.key));
}

export interface PickOptions {min?:number;range?:number;max?:number;previous?:ReadonlySet<string>}
/**
 * The groups that get an edge arrow: off screen, within `range` world units of the hero, nearest first (tie: bigger,
 * then key), at most `max`. New ones need `min` critters; one shown before (`previous`) stays while it has GROUP_SHOW
 * and is among the GROUP_KEEP_NEAREST nearest, so arrows do not blink when a group thins out by one or two.
 */
export function pickGroupArrows(groups:readonly EnemyGroup[],hero:{x:number;y:number},isOnScreen:(p:{x:number;y:number})=>boolean,opts:PickOptions={}):EnemyGroup[]{
  const min=opts.min??GROUP_MIN,range=opts.range??GROUP_RANGE,max=opts.max??GROUP_ARROWS,previous=opts.previous;
  const dist=(g:EnemyGroup)=>Math.hypot(g.x-hero.x,g.y-hero.y);
  const near=groups.filter(g=>g.count>=GROUP_SHOW&&dist(g)<=range&&!isOnScreen(g))
    .sort((a,b)=>dist(a)-dist(b)||b.count-a.count||byKey(a.key,b.key));
  const nearest=new Set(near.slice(0,GROUP_KEEP_NEAREST).map(g=>g.key));
  const kept=previous?near.filter(g=>previous.has(g.key)&&nearest.has(g.key)).slice(0,max):[];
  const picked=[...kept,...near.filter(g=>g.count>=min&&!kept.includes(g))].slice(0,max);
  return picked.sort((a,b)=>dist(a)-dist(b)||b.count-a.count||byKey(a.key,b.key));
}

/** The count on a group's ficha: "99+" at the ceiling. */
export const groupCountText=(count:number)=>count>99?'99+':String(Math.max(0,Math.floor(count)));
