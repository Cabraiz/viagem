/**
 * Lookups over the roster (enemy-roster.ts) and the role profiles (enemy-roles.ts), shared by the sim (enemy defs, the
 * director's rotation) and the client (fallback texture, death pop, cause copy, kill-cam). Pure.
 */
import {HELD_ROSTER,ROSTER,type RosterEntry} from './enemy-roster.ts';
import {ROLE_PROFILES,isLegacyKind,type EnemyRole,type LegacyKind,type RoleProfile} from './enemy-roles.ts';

// The held entries (out of the wave draw) are found by id too, so the sim can spawn them (tests, debug, a flag).
const BY_ID:ReadonlyMap<string,RosterEntry>=new Map([...ROSTER,...HELD_ROSTER].map(e=>[e.id,e]));
/** Every roster id, the nine hand-tuned kinds first, then the packs in order. */
export const ROSTER_IDS:readonly string[]=Object.freeze(ROSTER.map(e=>e.id));
export const rosterEntry=(id:string):RosterEntry|undefined=>BY_ID.get(id);
export const isRosterId=(id:string)=>BY_ID.has(id);
export const roleOf=(kind:string):EnemyRole|undefined=>BY_ID.get(kind)?.role;
export const roleProfileOf=(kind:string):RoleProfile|undefined=>{const e=BY_ID.get(kind);return e?ROLE_PROFILES[e.role]:undefined;};
/** The hand-tuned kind drawn for `kind` until it has art: itself for the nine, else its role's base; undefined when unknown. */
export const fallbackKind=(kind:string):LegacyKind|undefined=>isLegacyKind(kind)?kind:roleProfileOf(kind)?.base;
/** Accent color of a roster entry that is drawn with a fallback texture (the nine draw their own: undefined). */
export const fallbackAccent=(kind:string):number|undefined=>{const e=BY_ID.get(kind);return e&&!e.legacy?e.accent:undefined;};

export interface EntryLines {name:string;barks:readonly string[];deathLines:readonly string[];reactionLines:readonly string[];pops:readonly string[];cause:string;gag:string}
const LINES=new Map<string,EntryLines>();
/**
 * Copy of a pack entry: its own barks, death lines and pop (P0), else its role's generic ones; reactions and the cause
 * line always come from the role. Undefined for unknown ids. (The nine keep their lists in sim/enemies/catalog.ts and
 * the client; for them this only gives the role's lines.)
 */
export function entryLines(kind:string):EntryLines|undefined{
  const cached=LINES.get(kind);if(cached)return cached;
  const e=BY_ID.get(kind);if(!e)return undefined;
  const r=ROLE_PROFILES[e.role];
  const lines:EntryLines=Object.freeze({name:e.name,barks:e.barks??r.barks,deathLines:e.deathLines??r.deathLines,reactionLines:r.reactionLines,
    pops:e.pop?Object.freeze([e.pop]):r.pops,cause:r.cause,gag:e.gag});
  LINES.set(kind,lines);
  return lines;
}
