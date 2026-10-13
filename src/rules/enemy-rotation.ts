/**
 * The run's rotation (D-040, NEW-20261013-ORQ-papeis-de-inimigo step 3): every run draws 12 to 18 roster entries, by
 * role, and the director composes each regular round from them by role (rules/waves.ts planRound with a RoundRoster).
 *  - rounds 1-3 (early): corredores, enxames and exactly one palhaço;
 *  - rounds 4-6 (mid): + arremessadores, atiradores, suportes (and maybe a voador);
 *  - rounds 7-9 (late): + kamikazes, refletores, invocadores and the "elites" of the card, the brutamontes;
 *  - two mini-chefes: one replaces round 5's elite, the other comes alone in round 8; round 10 keeps the boss.
 * P0 entries first (only they have their own lines); P1, then P2, only when a role has too few P0 entries.
 * The rotation is JSON (director state, checkpoints and reconnects keep it) and depends only on the rng it is drawn with.
 */
import type {Rng} from '../contract/index.ts';
import {ROSTER,type RosterEntry} from './enemy-roster.ts';
import type {EnemyRole} from './enemy-roles.ts';

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
  /** Round 5: the elite's kind. */
  elite?:string;
  /** Round 8: a mini-chefe alone, outside the regular budget. */
  solo?:string;
}

const PRIORITY_ORDER=['P0','P1','P2'] as const;
const candidates=(role:EnemyRole):readonly RosterEntry[]=>ROSTER.filter(e=>e.role===role);
/** `count` distinct entries of `role`: shuffled P0 first, then P1, then P2. */
function pick(rng:Rng,role:EnemyRole,count:number):string[]{
  const out:string[]=[];
  for(const p of PRIORITY_ORDER){
    if(out.length>=count)break;
    const pool=candidates(role).filter(e=>e.priority===p).map(e=>e.id);
    for(let i=pool.length-1;i>0;i--){const j=rng.int(0,i);[pool[i],pool[j]]=[pool[j],pool[i]];}
    out.push(...pool.slice(0,count-out.length));
  }
  return out;
}
/** Total entries of a rotation (roles and mini-chefes). */
export const rotationSize=(r:Rotation)=>Object.values(r.roles).reduce((n,ids)=>n+(ids?.length??0),0)+r.mini.length;

/** Draws a run's rotation: 12-18 entries (ROTATION_SLOTS + two mini-chefes), P0 first. Deterministic for the rng state. */
export function drawRotation(rng:Rng):Rotation{
  const size=rng.int(ROTATION_SIZE.min,ROTATION_SIZE.max);
  const counts=ROTATION_SLOTS.map(s=>s.min);
  let left=size-MINI_COUNT-counts.reduce((a,b)=>a+b,0);
  while(left>0){
    const open=ROTATION_SLOTS.map((s,i)=>i).filter(i=>counts[i]<ROTATION_SLOTS[i].max);
    if(!open.length)break;
    counts[open[rng.int(0,open.length-1)]]++;left--;
  }
  const roles:Rotation['roles']={};
  ROTATION_SLOTS.forEach((s,i)=>{if(counts[i]>0)roles[s.role]=pick(rng,s.role,counts[i]);});
  return {roles,mini:pick(rng,'mini-chefe',MINI_COUNT)};
}

const BAND_RANK:Readonly<Record<RoundBand,number>>={early:0,mid:1,late:2};
/** The part of `rotation` round `index` draws from. */
export function roundRoster(rotation:Rotation,index:number):RoundRoster{
  const band=BAND_RANK[bandOf(index)],roles:RoundRoster['roles']={};
  for(const s of ROTATION_SLOTS){const ids=rotation.roles[s.role];if(ids?.length&&BAND_RANK[s.band]<=band)roles[s.role]=ids;}
  const at=(MINI_ROUNDS as readonly number[]).indexOf(index),mini=at>=0?rotation.mini[at]:undefined;
  return {roles,...(mini&&at===0?{elite:mini}:{}),...(mini&&at===1?{solo:mini}:{})};
}

/** Every id a rotation can spawn (for the client preload and the tests). */
export const rotationIds=(r:Rotation)=>[...Object.values(r.roles).flatMap(ids=>ids??[]),...r.mini];
/**
 * A stored rotation (checkpoint, restore) drawRotation could have made: only ROTATION_SLOTS roles, each with its
 * min..max entries of that role, MINI_COUNT mini-chefes, no entry twice. Anything else (a corrupt or old checkpoint)
 * is refused, and the director draws a new one instead of planning rounds from a rotation missing a role.
 */
export function isRotation(value:unknown):value is Rotation{
  if(!value||typeof value!=='object')return false;
  const r=value as Rotation;
  if(!Array.isArray(r.mini)||r.mini.length!==MINI_COUNT||!r.roles||typeof r.roles!=='object'||Array.isArray(r.roles))return false;
  const role=new Map(ROSTER.map(e=>[e.id,e.role]));
  if(!r.mini.every(id=>role.get(id)==='mini-chefe'))return false;
  if(!Object.keys(r.roles).every(k=>ROTATION_SLOTS.some(s=>s.role===k)))return false;
  const ok=ROTATION_SLOTS.every(s=>{
    const ids=r.roles[s.role];
    if(ids===undefined)return s.min===0;
    return Array.isArray(ids)&&ids.length>=s.min&&ids.length<=s.max&&ids.every(id=>role.get(id)===s.role);
  });
  const all=rotationIds(r);
  return ok&&new Set(all).size===all.length;
}
