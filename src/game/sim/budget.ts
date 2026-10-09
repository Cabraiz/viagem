/**
 * Entity budgets for the horde run (VGM-032).
 * Caps keep the server tick and the snapshot size bounded; systems ask for room before creating entities.
 * XP is never dropped to respect a cap: gems are merged into bigger gems that carry the summed value.
 */
import type {PickupState} from './types.ts';

/** Live enemies (VS uses ~300 for periodic spawns). The director may receive a lower cap. */
export const MAX_ENEMIES=300;
/** Player and hostile projectiles together. */
export const MAX_PROJECTILES=400;
/** All pickups; XP gems merge above this, other kinds are never removed. */
export const MAX_PICKUPS=250;
export const MAX_TELEGRAPHS=24;

export const BUDGET=Object.freeze({
  enemies:MAX_ENEMIES,projectiles:MAX_PROJECTILES,pickups:MAX_PICKUPS,telegraphs:MAX_TELEGRAPHS,
});

/** Caps are whole, non-negative counts; NaN or negative caps mean no room. */
const limit=(cap:number)=>cap>=0?Math.floor(cap):0;

/** How many more entities fit under the cap (never negative). */
export function room(size:number,cap:number){return Math.max(0,limit(cap)-size);}
export function hasRoom(collection:{readonly size:number},cap:number,count=1){return room(collection.size,cap)>=count;}

/** Gems in the same cell merge first, so big gems stay near where the XP dropped. */
export const MERGE_CELL=2;

export interface MergeResult {
  /** Map keys of the gems absorbed and deleted from the map. */
  removed:string[];
  /** Map keys of the gems that received value. */
  grown:string[];
  /** Pickups still above the cap (only when there are not enough mergeable gems). */
  overBy:number;
}

/** A gem being pulled by a magnet is about to be collected; leave it alone. */
const mergeable=(p:PickupState)=>p.kind==='xp'&&!p.homing&&Number.isFinite(p.value);

type Gem={key:string;gem:PickupState};
/** Non-finite ticks sort last, so the comparator stays consistent. */
const tickOf=(p:PickupState)=>Number.isFinite(p.spawnTick)?p.spawnTick:Infinity;
/** Older gem first, then smaller key: the deterministic survivor of a merge. */
function older(a:Gem,b:Gem){
  const ta=tickOf(a.gem),tb=tickOf(b.gem);
  return ta!==tb?(ta<tb?-1:1):a.key<b.key?-1:a.key>b.key?1:0;
}

function absorb(target:PickupState,gem:PickupState){
  target.value+=gem.value;
  // Keep the longest lifetime so merging never makes XP expire sooner.
  target.expiresTick=target.expiresTick===undefined||gem.expiresTick===undefined?undefined:Math.max(target.expiresTick,gem.expiresTick);
}

/**
 * Brings `pickups` down to `cap` by merging XP gems. Conserves the summed XP value exactly
 * (for integer values) and only deletes gems whose value moved into a surviving gem.
 * Pass 1 merges gems sharing a MERGE_CELL cell into the oldest one there, scanning cells by
 * their oldest gem; pass 2 merges the newest remaining gems into the oldest gem overall.
 * Deterministic: depends only on map keys, spawn ticks and positions, not on map insertion order.
 */
export function mergeXpGems(pickups:Map<string,PickupState>,cap=MAX_PICKUPS,cell=MERGE_CELL):MergeResult{
  const result:MergeResult={removed:[],grown:[],overBy:0};
  let excess=pickups.size-limit(cap);
  if(excess<=0)return result;
  // Entries rather than ids, so a key that differs from pickup.id can never duplicate XP.
  const gems:Gem[]=[];
  for(const [key,gem] of pickups)if(mergeable(gem))gems.push({key,gem});
  gems.sort(older);
  const grown=new Set<string>();
  const merge=(target:Gem,source:Gem)=>{
    absorb(target.gem,source.gem);pickups.delete(source.key);result.removed.push(source.key);grown.add(target.key);excess--;
  };
  // Pass 1: local merges. Groups keep the sorted order, so each group's first gem is its oldest.
  const groups=new Map<string,Gem[]>();
  for(const entry of gems){
    const key=`${Math.floor(entry.gem.x/cell)},${Math.floor(entry.gem.y/cell)}`;
    const group=groups.get(key);
    if(group)group.push(entry);else groups.set(key,[entry]);
  }
  const merged=new Set<string>();
  for(const group of groups.values()){
    if(excess<=0)break;
    // Absorb the newest gems of the cell first; the oldest survives.
    for(let i=group.length-1;i>0&&excess>0;i--){merge(group[0],group[i]);merged.add(group[i].key);}
  }
  // Pass 2: still too many pickups spread across cells, fold the newest gems into the oldest one.
  if(excess>0){
    const rest=gems.filter(g=>!merged.has(g.key));
    for(let i=rest.length-1;i>0&&excess>0;i--)merge(rest[0],rest[i]);
  }
  result.grown=[...grown].filter(key=>pickups.has(key));
  result.overBy=Math.max(0,excess);
  return result;
}

/** Total XP lying on the ground; used by tests and debug HUD to check conservation. */
export function groundXp(pickups:Iterable<PickupState>){
  let total=0;for(const p of pickups)if(p.kind==='xp')total+=p.value;return total;
}
