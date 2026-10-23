/**
 * Movement prediction of protocol 3 (one STEP per input): the room moves players with these exact numbers and the
 * phone replays its unacknowledged inputs on top of the room's position (client-side prediction and reconcile).
 *
 * D-036 movement effects (the bêbado's burp, the pombos' poop) are a pure function of the player's effect state and
 * the server tick, so the room and the phone step them the same way:
 * - tick < slipUntil: each step slides along `slip` at PLAYER_SLIP_SPEED (scaled to the world's hero speed; walls and sea stop it like walking), the
 *   stick's direction is ignored; like walking, a slide needs a step that walks (a player standing still does not slide,
 *   nor does one who only holds the attack or the skill: since D-051 those steps reach the room while standing, and a
 *   held attack slid the hero along the poop, BUG-20261022-ORQ-botao-direito-anda);
 * - else tick < slowUntil: walking at heroSpeed(terrain) × PLAYER_SLOW_MULT;
 * - else plain walking;
 * - D-047: while tick < fastUntil (Dona Cida's brigadeiro) the walk above goes × CIDA_FAST_MULT.
 * - Veículos: while tick < rideUntil the walk goes × RIDE_MULT[ride] instead (the larger of it and the brigadeiro);
 *   the cart turns the stick by CART_TURN; the crossfiteiro's last BURPEE_TICKS stand still (contract vehicles.ts).
 * - The player's stats.moveSpeed (class, weapon, the tênis, the "+velocidade" offer) scales every walk above, on
 *   top of the rest (BUG oferta-velocidade-nao-faz-nada); the slide is the poop's, not the legs', so it does not.
 *   The room passes the SimPlayer (its `stats`), the phone the wire's moveSpeed (PlayerRunView.moveSpeed).
 * Tick mapping of the replay: a frame of tick T carries the position after the player's step `ack` (applied on tick
 * T while walking: the room applies one step per tick), so the k-th unacknowledged input (k = 0, 1, …) is applied on
 * tick T+1+k (while an effect touches the steps behind a confirmed position, the room sends the live one instead:
 * multiplayer/simulation.ts confirmed). The effects reach the phone with that frame (PlayerRunView.slowUntil/slipUntil/slip).
 */
import {defaultTerrain,type TerrainField} from './terrain/field.ts';
import {heroSpeed,moveDirection,SPEED,walkable} from './world.ts';
import {floorOf,floorOn,onFloor,type Floor} from './city/viaduct.ts';
import {BURPEE_TICKS,CART_TURN,CIDA_FAST_MULT,PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT,RIDE_MULT,SIM_HZ,carSpeed} from '../contract/index.ts';
import type {PlayerInput,Point,VehicleKind} from '../contract/index.ts';
type Input=PlayerInput;
export const STEP = 1 / 20;
/** D-036 effect state of a player (SimPlayer and PlayerRunView carry the same fields). */
export interface MoveEffects {slowUntil?:number;slipUntil?:number;slip?:Point;
  /** D-047 Dona Cida's brigadeiro: walking × CIDA_FAST_MULT while tick < fastUntil (on top of a slow; not the slide). */
  fastUntil?:number;
  /** Veículos: the vehicle ridden while tick < rideUntil (contract vehicles.ts). */
  ride?:VehicleKind;rideUntil?:number;
  /** The player's stats (SimPlayer.stats): moveSpeed multiplies the walk (statMoveSpeed); absent, 1. */
  stats?:{readonly moveSpeed?:number}}
/**
 * Where the replay stands: the frame's tick and the player's effects in it. Absent: no effects (plain walking).
 * `cap` (D-052, the car): the most this player may walk per tick while moving the car (carSpeed(movers)/SIM_HZ).
 */
export interface MoveClock {tick:number;effects?:MoveEffects;cap?:number}
/**
 * A position with its floor (maps city/viaduct.ts; NEW-20261023-ORQ-mapa-175-com-viaduto): every step below collides on
 * the floor it starts on and returns the floor it ends on (the ramp switches it), so the room and the phone agree.
 */
export type FloorPoint=Point&{andar?:1};
const onto=(q:Point,floor:Floor):FloorPoint=>floor===1?{x:q.x,y:q.y,andar:1}:{x:q.x,y:q.y};
/** The slide direction on `tick`, or undefined when the player is not slipping then (or the vector is unusable). */
export function slipping(effects:MoveEffects|undefined,tick:number):Point|undefined{
  const s=effects?.slip;
  if(!s||!(tick<(effects!.slipUntil??-Infinity)))return undefined;
  return Number.isFinite(s.x)&&Number.isFinite(s.y)&&Math.hypot(s.x,s.y)>=.01?s:undefined;
}
export const slowed=(effects:MoveEffects|undefined,tick:number)=>tick<(effects?.slowUntil??-Infinity);
export const hasted=(effects:MoveEffects|undefined,tick:number)=>tick<(effects?.fastUntil??-Infinity);
/** The vehicle ridden on `tick`, or undefined. */
export const riding=(effects:MoveEffects|undefined,tick:number):VehicleKind|undefined=>
  effects?.ride!==undefined&&tick<(effects.rideUntil??-Infinity)&&Object.hasOwn(RIDE_MULT,effects.ride)?effects.ride:undefined;
/** The walk's multiplier on `tick` (brigadeiro, vehicle; the crossfiteiro's burpee is 0). */
export function walkMult(effects:MoveEffects|undefined,tick:number):number{
  const fast=hasted(effects,tick)?CIDA_FAST_MULT:1,ride=riding(effects,tick);
  if(!ride)return fast;
  if(ride==='crossfiteiro'&&tick>=effects!.rideUntil!-BURPEE_TICKS)return 0;
  return Math.max(fast,RIDE_MULT[ride]);
}
/**
 * The walk's stat multiplier: stats.moveSpeed in thousandths (what the wire carries, so the room and the phone take
 * the very same number), within STAT_LIMITS' 0.5..2; absent or unusable, 1.
 */
export function statMoveSpeed(effects:MoveEffects|undefined):number{
  const v=effects?.stats?.moveSpeed;
  if(v===undefined||!Number.isFinite(v))return 1;
  return Math.round(Math.min(2,Math.max(.5,v))*1000)/1000;
}
const COS_TURN=Math.cos(CART_TURN),SIN_TURN=Math.sin(CART_TURN);
/**
 * One movement tick of a player at server tick `tick` (the room's players system and the phone's replay): a slide
 * while slipping (any direction that walks: the slide's own is taken), else a walk, slowed while slowed. A step without
 * a direction (the attack or the skill held in place) stands, slipping or not. Collision-safe like moveDirection.
 */
export function moveStep(p:FloorPoint,direction:Point,tick:number,effects:MoveEffects|undefined,terrain:TerrainField=defaultTerrain):FloorPoint{
  const length=Math.hypot(direction.x,direction.y);
  if(!Number.isFinite(length)||length<.01)return p;
  const slide=slipping(effects,tick),floor=floorOf(p),ground=onFloor(terrain,floor);
  // The world's hero speed (city 1.99 u/s, D-026); slip keeps its ratio to walking so the city stays in proportion.
  const walk=heroSpeed(terrain);
  let q:Point;
  if(slide)q=moveDirection(p,slide,STEP,ground,PLAYER_SLIP_SPEED*walk/SPEED);
  else{
    const speed=(slowed(effects,tick)?walk*PLAYER_SLOW_MULT:walk)*walkMult(effects,tick)*statMoveSpeed(effects);
    const turned=riding(effects,tick)==='carrinho'?{x:direction.x*COS_TURN-direction.y*SIN_TURN,y:direction.x*SIN_TURN+direction.y*COS_TURN}:direction;
    q=moveDirection(p,turned,STEP,ground,speed);
  }
  return onto(q,floorOn(terrain,q.x,q.y,floor));
}
/**
 * D-052, a hero moving the car walks at most `cap` u this tick (the room's players system and the phone's replay): the
 * step from `from` to `to` is cut along its own line, and kept in place if that point is not walkable.
 */
export function capStep(from:FloorPoint,to:FloorPoint,cap:number|undefined,terrain:TerrainField=defaultTerrain):FloorPoint{
  const moved=Math.hypot(to.x-from.x,to.y-from.y);
  if(cap===undefined||!(moved>cap))return to;
  const q={x:from.x+(to.x-from.x)*cap/moved,y:from.y+(to.y-from.y)*cap/moved},floor=floorOf(from);
  return walkable(q,onFloor(terrain,floor))?onto(q,floorOn(terrain,q.x,q.y,floor)):onto(from,floor);
}
/** D-052: the cap of a hero among the car's movers (the room's moverCap, chaveiro/car.ts), else undefined (free). */
export function carStepCap(car:{movers?:readonly string[]}|undefined,id:string):number|undefined{
  return car?.movers?.includes(id)?carSpeed(car.movers.length)/SIM_HZ:undefined;
}
/** One input step; with `tick`/`effects` (D-036), the step the room takes on that tick; `cap` (D-052) as capStep. */
export function simulate(p:FloorPoint,input:Input,terrain:TerrainField=defaultTerrain,tick?:number,effects?:MoveEffects,cap?:number):FloorPoint {
  let to:FloorPoint;
  if(tick===undefined){
    const floor=floorOf(p),q=moveDirection(p,{x:input.x,y:input.y},STEP,onFloor(terrain,floor));
    to=onto(q,floorOn(terrain,q.x,q.y,floor));
  }else to=moveStep(p,{x:input.x,y:input.y},tick,effects,terrain);
  return capStep(p,to,cap,terrain);
}
/**
 * Replays the unacknowledged inputs over the room's position; with `clock`, input k lands on tick clock.tick+1+k (D-036)
 * and walks at most clock.cap per tick (D-052: the frame says this hero moves the car).
 */
export function reconcile(authoritative:FloorPoint,pending:Input[],terrain:TerrainField=defaultTerrain,clock?:MoveClock):FloorPoint {
  return pending.reduce<FloorPoint>((p,i,k)=>simulate(p,i,terrain,clock?clock.tick+1+k:undefined,clock?.effects,clock?.cap),onto(authoritative,floorOf(authoritative)));
}

export function interpolate(a:Point,b:Point,t:number):Point { const n=Math.max(0,Math.min(1,t));return {x:a.x+(b.x-a.x)*n,y:a.y+(b.y-a.y)*n}; }
