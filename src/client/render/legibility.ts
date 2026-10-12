/**
 * Legibility rules for the horde on a phone: readable chaos, not a soup of numbers.
 * Pure module (no Phaser) so node tests can pin the rules down.
 */

/** Hits on the same target inside this window add up into one number. */
export const DAMAGE_MERGE_MS=150;
/** Health bars show for this long after a hit (elite, boss and the tapped target always show). */
export const BAR_RECENT_MS=2500;

export type EffectsProfile='full'|'reduced';
export interface FxBudget {
  /** Damage numbers on screen at once. */
  numbers:number;
  /** New low-priority numbers per authoritative frame (priority ones always pass). */
  numbersPerPush:number;
  pops:number;
  starsPerKill:number;
  bubbles:number;
  /** Health bars of plain (not elite/boss/tapped) enemies at once: only the most recently hit keep one. */
  bars:number;
}
export const FX_BUDGET:Readonly<Record<EffectsProfile,Readonly<FxBudget>>>=Object.freeze({
  full:Object.freeze({numbers:25,numbersPerPush:8,pops:4,starsPerKill:5,bubbles:2,bars:30}),
  reduced:Object.freeze({numbers:10,numbersPerPush:3,pops:2,starsPerKill:2,bubbles:1,bars:12}),
});

export interface BarSubject {hp:number;maxHp:number;elite:boolean;boss:boolean;hitAt:number}
/** `recent`: whether the enemy is among the last `bars` hit (see RecentHits); omitted = no cap. */
export function barVisible(a:BarSubject,now:number,targeted:boolean,recent=true){
  if(a.boss||a.elite||targeted)return true;
  return recent&&a.hp<a.maxHp&&now-a.hitAt<BAR_RECENT_MS;
}

/**
 * The last `cap` distinct ids hit, in hit order (a Map keeps insertion order: delete + set moves an id to the end).
 * With 300 enemies and hits spread everywhere, "hit in the last 2.5 s" alone still means ~250 bars.
 */
export class RecentHits {
  private ids=new Map<string,true>();
  cap:number;
  constructor(cap:number){this.cap=Math.max(0,cap|0);}
  hit(id:string){
    this.ids.delete(id);this.ids.set(id,true);
    while(this.ids.size>this.cap){const first=this.ids.keys().next().value as string;this.ids.delete(first);}
  }
  has(id:string){return this.ids.has(id);}
  delete(id:string){this.ids.delete(id);}
  setCap(cap:number){this.cap=Math.max(0,cap|0);while(this.ids.size>this.cap){const first=this.ids.keys().next().value as string;this.ids.delete(first);}}
  clear(){this.ids.clear();}
  get size(){return this.ids.size;}
}

/** Crits, hits on the boss or an elite, and damage to the LOCAL player are never dropped (allies' hits are plain numbers). */
export function numberPriority(crit:boolean,selfHit:boolean,elite:boolean,boss:boolean){
  return crit||selfHit||elite||boss;
}

export interface RankedNumber {priority:boolean;self:boolean}
/**
 * Which live number (oldest first) a priority newcomer replaces on a full screen: the oldest plain one; if all are
 * priority, the oldest that is not damage on the local player; only when every number is local-player damage, the oldest.
 */
export function evictionIndex(count:number,at:(i:number)=>RankedNumber|undefined):number{
  let firstOther=-1;
  for(let i=0;i<count;i++){
    const n=at(i);if(!n)continue;
    if(!n.priority)return i;
    if(firstOther<0&&!n.self)firstOther=i;
  }
  return firstOther>=0?firstOther:0;
}

export type NumberAdmission='spawn'|'recycle'|'drop';
/**
 * Whether a new (not merged) number appears: below the cap it spawns; at the cap only priority
 * numbers get in, by recycling the oldest; low-priority numbers also respect the per-frame quota.
 */
export function admitNumber(active:number,cap:number,usedThisPush:number,perPush:number,priority:boolean):NumberAdmission{
  if(!priority&&usedThisPush>=perPush)return 'drop';
  if(active<cap)return 'spawn';
  return priority?'recycle':'drop';
}

/** A live number for the same target, born inside the merge window, absorbs the new hit. */
export function canMerge(n:{live:boolean;target:string;born:number}|undefined,target:string,now:number){
  return !!n&&n.live&&n.target===target&&now-n.born<DAMAGE_MERGE_MS;
}

/** Death pops: plain kills only below the budget; a boss or elite kill always gets its joke. */
export function admitPop(active:number,budget:number,important:boolean){
  return important||active<budget;
}
