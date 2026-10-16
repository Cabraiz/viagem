/**
 * D-051 (ataque manual, Wild Rift): the auto aim of the manual combat, pure so the server's weapons system decides with
 * it and the client's reticle (step 2) calls the very same function, so it shows the server's pick. The caller hands the
 * candidates already in its weapon's reach and alive, from whatever lists it has (the live index, the D-051 nests'
 * sleepers, the chosen one looked up by id); this never queries anything, it only orders them:
 *  1. the chosen target (tap, drag, A + click: PlayerInput.target);
 *  2. whoever hit me within AGGRO_TICKS (SimPlayer.lastHitBy), unless it is posing (its shot would come back);
 *  3. the nearest, the boss counting BOSS_BONUS closer (targetDistance), those posing (reflecting) after every other
 *     one, ties by id. Hysteresis: the current auto target stays ahead of a nearer one unless that one is at least
 *     SWITCH_MARGIN closer (effective distances), so the aim does not flicker between two critters.
 */
import type {Point} from '../contract/index.ts';
import {ticks} from '../contract/index.ts';

/** "Who is hitting me" lasts 2 s (40 ticks at SIM_HZ). */
export const AGGRO_TICKS=ticks(2);
/** The boss counts 30 % closer than it is (approved order: the nearest, the boss weighted, not "the boss first"). */
export const BOSS_BONUS=.3;
/** A new auto target must be 20 % closer (effective distance) to take the current one's place. */
export const SWITCH_MARGIN=.2;

export interface TargetCandidate extends Point {id:string;boss?:boolean;
  /** Posing right now (an influencer: the shot would come back): only after every other candidate. */
  reflecting?:boolean}
export interface TargetContext {
  tick:number;
  /** The chosen target's id (PlayerInput.target). */
  chosen?:string;
  /** SimPlayer.lastHitBy. */
  lastHit?:{id:string;tick:number};
  /** The current auto target (SimPlayer.autoTarget), kept by the hysteresis. */
  current?:string;
}

/** Distance the aim compares: the real one, × (1 − BOSS_BONUS) for the boss. */
export const targetDistance=(from:Point,e:Pick<TargetCandidate,'x'|'y'|'boss'>)=>Math.hypot(e.x-from.x,e.y-from.y)*(e.boss?1-BOSS_BONUS:1);

/**
 * The candidates in fire order, and `auto`: the auto aim's pick (the first after the chosen one), the next `current`.
 * Pure and deterministic (ties by id); the input list is not changed.
 */
export function attackTargets<T extends TargetCandidate>(from:Point,candidates:readonly T[],ctx:TargetContext):{order:T[];auto?:string}{
  const order:T[]=[];
  const chosen=ctx.chosen!==undefined?candidates.find(e=>e.id===ctx.chosen):undefined;
  if(chosen)order.push(chosen);
  const hit=ctx.lastHit&&ctx.tick-ctx.lastHit.tick<=AGGRO_TICKS?candidates.find(e=>e.id===ctx.lastHit!.id&&e!==chosen&&!e.reflecting):undefined;
  if(hit)order.push(hit);
  const rest=candidates.filter(e=>e!==chosen&&e!==hit).map(e=>({e,d:targetDistance(from,e),late:e.reflecting?1:0}))
    .sort((a,b)=>a.late-b.late||a.d-b.d||(a.e.id<b.e.id?-1:a.e.id>b.e.id?1:0));
  if(!hit&&rest.length>1&&ctx.current!==undefined){
    const i=rest.findIndex(r=>r.e.id===ctx.current);
    // The current one keeps its place unless the best is SWITCH_MARGIN closer (same group: posing ones stay last).
    if(i>0&&rest[i].late===rest[0].late&&rest[0].d>rest[i].d*(1-SWITCH_MARGIN))rest.unshift(...rest.splice(i,1));
  }
  for(const r of rest)order.push(r.e);
  const auto=order[chosen?1:0]?.id;
  return auto!==undefined?{order,auto}:{order};
}
