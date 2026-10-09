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
}
export const FX_BUDGET:Readonly<Record<EffectsProfile,Readonly<FxBudget>>>=Object.freeze({
  full:Object.freeze({numbers:25,numbersPerPush:8,pops:7,starsPerKill:5,bubbles:2}),
  reduced:Object.freeze({numbers:10,numbersPerPush:3,pops:3,starsPerKill:2,bubbles:1}),
});

export interface BarSubject {hp:number;maxHp:number;elite:boolean;boss:boolean;hitAt:number}
export function barVisible(a:BarSubject,now:number,targeted:boolean){
  if(a.boss||a.elite||targeted)return true;
  return a.hp<a.maxHp&&now-a.hitAt<BAR_RECENT_MS;
}

/** Crits, hits on the boss or an elite, and damage to players are never dropped. */
export function numberPriority(hit:{crit:boolean;hostile:boolean;elite:boolean;boss:boolean}){
  return hit.crit||hit.hostile||hit.elite||hit.boss;
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
