/**
 * The run's rotation (D-040, NEW-20261013-ORQ-papeis-de-inimigo step 3): every run draws 12 to 18 roster entries, by
 * role, and the director composes each regular round from them by role (rules/waves.ts planRound with a RoundRoster).
 *  - rounds 1-3 (early): corredores, enxames and exactly one palhaço;
 *  - rounds 4-6 (mid): + arremessadores, atiradores, suportes (and maybe a voador);
 *  - rounds 7-9 (late): + kamikazes, refletores, invocadores and the "elites" of the card, the brutamontes;
 *  - two mini-chefes: one replaces round 5's elite, the other comes alone in round 8; round 10 keeps the boss.
 * P0 entries first (only they have their own lines); P1, then P2, only when a role has too few P0 entries.
 * The rotation is JSON (director state, checkpoints and reconnects keep it) and depends only on the rng it is drawn with.
 *
 * ROSTER_ONLY_WITH_ART (the user's request, arte-do-roster-no-render): only entries with imported art are drawn (the
 * generated ENEMY_ART_IDS), so the old cartoon stand-ins leave the runs as the artist's enemies arrive. A slot takes at
 * most the art entries its role has (none: the slot is empty and its share goes to the round's other roles, waves.ts);
 * a band whose slots have no art at all keeps today's draw there, and so do the mini-chefes until two of them have art.
 * A round whose own band lost roles (no art for its corredores or palhaço) borrows art entries of later bands' lighter
 * roles (BORROW_ORDER: one entry per role, the kamikaze from round 2), at the band's numbers (BORROW_TUNE), and its
 * body count never goes above the round table's (rules/waves.ts): decision D of the Orquestrador, 13/10/2026.
 */
import type {Rng} from '../contract/index.ts';
import {ROSTER,type RosterEntry} from './enemy-roster.ts';
import type {EnemyRole} from './enemy-roles.ts';
import {ENEMY_ART_IDS} from './enemy-art-ids.ts';

/** Draw only roster entries with imported art (see above). Data flag: false brings back the whole roster. */
export const ROSTER_ONLY_WITH_ART=true;
let onlyWithArt=ROSTER_ONLY_WITH_ART;
/**
 * The default every later draw in this process uses (tests and tools: the deterministic run tests play the whole roster,
 * tests/rules/enemy-art-ids.test.ts the art-only one). The game never calls it.
 */
export function setRosterOnlyWithArt(on:boolean){onlyWithArt=on;}
export interface RotationOptions {
  /** Default ROSTER_ONLY_WITH_ART. */
  onlyWithArt?:boolean;
  /** The ids with art (default the generated ENEMY_ART_IDS). */
  artIds?:readonly string[];
}

export type RoundBand='early'|'mid'|'late';
export const ROUND_BANDS:readonly RoundBand[]=['early','mid','late'];
/** Band of a round: 1-3 early, 4-6 mid, 7 and on late (round 10's escorts draw from the whole rotation). */
export const bandOf=(round:number):RoundBand=>round<=3?'early':round<=6?'mid':'late';
export const ROTATION_SIZE={min:12,max:18} as const;
/** Rounds of the two mini-chefes: the first replaces that round's elite, the second comes alone (outside the budget). */
export const MINI_ROUNDS=[5,8] as const;

export interface RotationSlot {role:Exclude<EnemyRole,'chefe'|'mini-chefe'>;band:RoundBand;min:number;max:number}
/** Entries per role: the minimums add up to 12 with the two mini-chefes, the maximums to 18. */
export const ROTATION_SLOTS:readonly RotationSlot[]=Object.freeze([
  {role:'corredor',band:'early',min:1,max:3},{role:'enxame',band:'early',min:1,max:2},{role:'palhaco',band:'early',min:1,max:1},
  {role:'arremessador',band:'mid',min:1,max:1},{role:'atirador',band:'mid',min:1,max:2},{role:'suporte',band:'mid',min:1,max:1},
  {role:'voador',band:'mid',min:0,max:1},
  {role:'kamikaze',band:'late',min:1,max:1},{role:'refletor',band:'late',min:1,max:1},{role:'invocador',band:'late',min:1,max:1},
  {role:'brutamontes',band:'late',min:1,max:2},
].map(s=>Object.freeze(s as RotationSlot)));
export const MINI_COUNT=MINI_ROUNDS.length;
/**
 * Art only (card inimigos-variedade, the user 25/10: "muitos inimigos repetidos e iguais"): the early fodder slots the
 * map's loose sleepers draw from (assemble.ts SLEEPER_ROSTER.solto, the early band) take more entries, so the city is
 * not five kinds. A role's entries share its numbers (catalog.ts rosterDef: the role's profile), so the mix changes and
 * the threat does not; these are the lightest sheets of the roster (~1-6 MB decoded each against a ~9 MB median).
 * Within its role's art entries, like every art-only slot.
 */
export const ART_SLOT_WIDEN:Readonly<Partial<Record<EnemyRole,{readonly min:number;readonly max:number}>>>=Object.freeze({
  corredor:Object.freeze({min:3,max:4}),enxame:Object.freeze({min:2,max:3}),
});

/** JSON-safe rotation of a run (DirectorState.rotation). */
export interface Rotation {
  /** Roster ids per role, in draw order. */
  roles:Partial<Record<EnemyRole,string[]>>;
  /** Mini-chefes for MINI_ROUNDS, in that order. */
  mini:string[];
}
/** What one round may draw from: the roles of its band and the ones before, and its mini-chefe if any. */
export interface RoundRoster {
  roles:Partial<Record<EnemyRole,readonly string[]>>;
  /**
   * The band lost roles (a slot with a minimum has no entry: art only): the round's bodies stay at most the table's,
   * and a missing role's share goes to `borrowed` (else spreads over the roles it has).
   */
  short?:true;
  /** Later bands' roles borrowed into this round (one entry each), played at BORROW_TUNE of its band. */
  borrowed?:readonly EnemyRole[];
  /** Round 5: the elite's kind. */
  elite?:string;
  /** Round 8: a mini-chefe alone, outside the regular budget. */
  solo?:string;
}

const PRIORITY_ORDER=['P0','P1','P2'] as const;
const candidates=(role:EnemyRole,only?:ReadonlySet<string>):readonly RosterEntry[]=>ROSTER.filter(e=>e.role===role&&(!only||only.has(e.id)));
/** `count` distinct entries of `role` (only those in `only` when given): shuffled P0 first, then P1, then P2. */
function pick(rng:Rng,role:EnemyRole,count:number,only?:ReadonlySet<string>):string[]{
  const out:string[]=[];
  for(const p of PRIORITY_ORDER){
    if(out.length>=count)break;
    const pool=candidates(role,only).filter(e=>e.priority===p).map(e=>e.id);
    for(let i=pool.length-1;i>0;i--){const j=rng.int(0,i);[pool[i],pool[j]]=[pool[j],pool[i]];}
    out.push(...pool.slice(0,count-out.length));
  }
  return out;
}
/** Total entries of a rotation (roles and mini-chefes). */
export const rotationSize=(r:Rotation)=>Object.values(r.roles).reduce((n,ids)=>n+(ids?.length??0),0)+r.mini.length;

/**
 * What each slot may draw from: `only` (the art ids, or undefined for the whole roster) and its min..max. With art only,
 * a slot's max is its role's art entries (min no higher), unless its band has no art in any slot (today's draw there).
 */
export interface SlotPool {slot:RotationSlot;only?:ReadonlySet<string>;min:number;max:number}
export function slotPools(options:RotationOptions={}):{slots:SlotPool[];mini?:ReadonlySet<string>}{
  if(!(options.onlyWithArt??onlyWithArt))return {slots:ROTATION_SLOTS.map(slot=>({slot,min:slot.min,max:slot.max}))};
  const art=new Set(options.artIds??ENEMY_ART_IDS);
  const have=(role:EnemyRole)=>candidates(role,art).length;
  const bandHasArt=(band:RoundBand)=>ROTATION_SLOTS.some(s=>s.band===band&&have(s.role)>0);
  const slots=ROTATION_SLOTS.map(slot=>{
    if(!bandHasArt(slot.band))return {slot,min:slot.min,max:slot.max};
    const wide=ART_SLOT_WIDEN[slot.role],max=Math.min(wide?.max??slot.max,have(slot.role));
    return {slot,only:art,min:Math.min(wide?.min??slot.min,max),max};
  });
  return {slots,...(have('mini-chefe')>=MINI_COUNT?{mini:art}:{})};
}
/**
 * Draws a run's rotation: 12-18 entries (ROTATION_SLOTS + two mini-chefes), P0 first; with art only (the default,
 * ROSTER_ONLY_WITH_ART) fewer when the art entries run out. Deterministic for the rng state.
 */
export function drawRotation(rng:Rng,options:RotationOptions={}):Rotation{
  const {slots,mini}=slotPools(options);
  const size=rng.int(ROTATION_SIZE.min,ROTATION_SIZE.max);
  const counts=slots.map(s=>s.min);
  let left=size-MINI_COUNT-counts.reduce((a,b)=>a+b,0);
  while(left>0){
    const open=slots.map((s,i)=>i).filter(i=>counts[i]<slots[i].max);
    if(!open.length)break;
    counts[open[rng.int(0,open.length-1)]]++;left--;
  }
  const roles:Rotation['roles']={};
  slots.forEach((s,i)=>{if(counts[i]>0)roles[s.slot.role]=pick(rng,s.slot.role,counts[i],s.only);});
  return {roles,mini:pick(rng,'mini-chefe',MINI_COUNT,mini)};
}

/** A later band's role a short round may borrow, from round `fromRound` on. */
export interface BorrowRule {role:EnemyRole;fromRound:number}
/** The lighter roles first: thrower and shooter at once, the kamikaze from round 2 (decision D). */
export const BORROW_ORDER:readonly BorrowRule[]=Object.freeze([
  {role:'arremessador',fromRound:1},{role:'atirador',fromRound:1},{role:'kamikaze',fromRound:2},
].map(r=>Object.freeze(r as BorrowRule)));
/** A borrowed entry's numbers in a band: × hp, × damage (every hit it deals), × cadence (the cooldown between its throws or shots). */
export interface BandTune {hp:number;damage:number;cadence:number}
export const BORROW_TUNE:Readonly<Record<RoundBand,BandTune>>=Object.freeze({
  early:Object.freeze({hp:.6,damage:.4,cadence:2.2}),
  mid:Object.freeze({hp:.85,damage:.8,cadence:1.3}),
  late:Object.freeze({hp:1,damage:1,cadence:1}),
});
export const BAND_RANK:Readonly<Record<RoundBand,number>>={early:0,mid:1,late:2};
const SLOT_BAND=new Map<EnemyRole,RoundBand>(ROTATION_SLOTS.map(s=>[s.role,s.band]));
/** The part of `rotation` round `index` draws from. */
export function roundRoster(rotation:Rotation,index:number):RoundRoster{
  const band=BAND_RANK[bandOf(index)],roles:RoundRoster['roles']={};
  // short: a slot of this band or an earlier one has no entry; own: one of this band's own (only then it borrows).
  let short=false,own=false;
  for(const s of ROTATION_SLOTS){
    if(BAND_RANK[s.band]>band)continue;
    const ids=rotation.roles[s.role];
    if(ids?.length)roles[s.role]=ids;else if(s.min>0){short=true;if(BAND_RANK[s.band]===band)own=true;}
  }
  const borrowed:EnemyRole[]=[];
  if(own)for(const r of BORROW_ORDER){
    const ids=rotation.roles[r.role];
    if(index<r.fromRound||!ids?.length||BAND_RANK[SLOT_BAND.get(r.role)!]<=band)continue;
    roles[r.role]=[ids[0]];borrowed.push(r.role);
  }
  const at=(MINI_ROUNDS as readonly number[]).indexOf(index),mini=at>=0?rotation.mini[at]:undefined;
  return {roles,...(short?{short:true as const}:{}),...(borrowed.length?{borrowed}:{}),...(mini&&at===0?{elite:mini}:{}),...(mini&&at===1?{solo:mini}:{})};
}

/** Every id a rotation can spawn (for the client preload and the tests). */
export const rotationIds=(r:Rotation)=>[...Object.values(r.roles).flatMap(ids=>ids??[]),...r.mini];
/**
 * A stored rotation (checkpoint, restore) drawRotation could have made: only ROTATION_SLOTS roles, each with its
 * min..max entries of that role, MINI_COUNT mini-chefes, no entry twice. Anything else (a corrupt or old checkpoint)
 * is refused, and the director draws a new one instead of planning rounds from a rotation missing a role.
 */
export function isRotation(value:unknown,options:RotationOptions={}):value is Rotation{
  if(!value||typeof value!=='object')return false;
  const r=value as Rotation;
  if(!Array.isArray(r.mini)||r.mini.length!==MINI_COUNT||!r.roles||typeof r.roles!=='object'||Array.isArray(r.roles))return false;
  const role=new Map(ROSTER.map(e=>[e.id,e.role]));
  if(!r.mini.every(id=>role.get(id)==='mini-chefe'))return false;
  if(!Object.keys(r.roles).every(k=>ROTATION_SLOTS.some(s=>s.role===k)))return false;
  // Art only, a slot may be short or empty (its role had no art when the rotation was drawn: a checkpoint keeps its cast
  // after new art arrives, roundRoster marks the round short); never more than ROTATION_SLOTS' max (ART_SLOT_WIDEN's for
  // its slots). Whole roster: the mins.
  const artOnly=options.onlyWithArt??onlyWithArt;
  const ok=slotPools(options).slots.every(({slot:s,min:least})=>{
    const min=artOnly?0:least;
    const ids=r.roles[s.role];
    if(ids===undefined)return min===0;
    const max=artOnly?ART_SLOT_WIDEN[s.role]?.max??s.max:s.max;
    return Array.isArray(ids)&&ids.length>=min&&ids.length<=max&&ids.every(id=>role.get(id)===s.role);
  });
  const all=rotationIds(r);
  return ok&&new Set(all).size===all.length;
}
