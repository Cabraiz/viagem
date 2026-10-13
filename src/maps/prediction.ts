/**
 * Movement prediction of protocol 3 (one STEP per input): the room moves players with these exact numbers and the
 * phone replays its unacknowledged inputs on top of the room's position (client-side prediction and reconcile).
 *
 * D-036 movement effects (the bêbado's burp, the pombos' poop) are a pure function of the player's effect state and
 * the server tick, so the room and the phone step them the same way:
 * - tick < slipUntil: each step slides along `slip` at PLAYER_SLIP_SPEED (walls and sea stop it like walking), the
 *   stick's direction is ignored; like walking, a slide needs a step (a player standing still does not slide);
 * - else tick < slowUntil: walking at SPEED × PLAYER_SLOW_MULT;
 * - else plain walking.
 * Tick mapping of the replay: a frame of tick T carries the position after the player's step `ack` (applied on tick
 * T while walking: the room applies one step per tick), so the k-th unacknowledged input (k = 0, 1, …) is applied on
 * tick T+1+k (while an effect touches the steps behind a confirmed position, the room sends the live one instead:
 * multiplayer/simulation.ts confirmed). The effects reach the phone with that frame (PlayerRunView.slowUntil/slipUntil/slip).
 */
import {defaultTerrain,type TerrainField} from './terrain/field.ts';
import {moveDirection,SPEED} from './world.ts';
import {PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT} from '../contract/index.ts';
import type {PlayerInput,Point} from '../contract/index.ts';
type Input=PlayerInput;
export const STEP = 1 / 20;
/** D-036 effect state of a player (SimPlayer and PlayerRunView carry the same fields). */
export interface MoveEffects {slowUntil?:number;slipUntil?:number;slip?:Point}
/** Where the replay stands: the frame's tick and the player's effects in it. Absent: no effects (plain walking). */
export interface MoveClock {tick:number;effects?:MoveEffects}
/** The slide direction on `tick`, or undefined when the player is not slipping then (or the vector is unusable). */
export function slipping(effects:MoveEffects|undefined,tick:number):Point|undefined{
  const s=effects?.slip;
  if(!s||!(tick<(effects!.slipUntil??-Infinity)))return undefined;
  return Number.isFinite(s.x)&&Number.isFinite(s.y)&&Math.hypot(s.x,s.y)>=.01?s:undefined;
}
export const slowed=(effects:MoveEffects|undefined,tick:number)=>tick<(effects?.slowUntil??-Infinity);
/**
 * One movement tick of a player at server tick `tick` (the room's players system and the phone's replay): a slide
 * while slipping (direction ignored), else a walk, slowed while slowed. Collision-safe like moveDirection.
 */
export function moveStep(p:Point,direction:Point,tick:number,effects:MoveEffects|undefined,terrain:TerrainField=defaultTerrain):Point{
  const slide=slipping(effects,tick);
  if(slide)return moveDirection(p,slide,STEP,terrain,PLAYER_SLIP_SPEED);
  return moveDirection(p,direction,STEP,terrain,slowed(effects,tick)?SPEED*PLAYER_SLOW_MULT:SPEED);
}
/** One input step; with `tick`/`effects` (D-036), the step the room takes on that tick. */
export function simulate(p:Point,input:Input,terrain:TerrainField=defaultTerrain,tick?:number,effects?:MoveEffects):Point {
  return tick===undefined?moveDirection(p,{x:input.x,y:input.y},STEP,terrain):moveStep(p,{x:input.x,y:input.y},tick,effects,terrain);
}
/** Replays the unacknowledged inputs over the room's position; with `clock`, input k lands on tick clock.tick+1+k (D-036). */
export function reconcile(authoritative:Point,pending:Input[],terrain:TerrainField=defaultTerrain,clock?:MoveClock):Point {
  return pending.reduce((p,i,k)=>simulate(p,i,terrain,clock?clock.tick+1+k:undefined,clock?.effects),{...authoritative});
}
export function interpolate(a:Point,b:Point,t:number):Point { const n=Math.max(0,Math.min(1,t));return {x:a.x+(b.x-a.x)*n,y:a.y+(b.y-a.y)*n}; }
