/**
 * D-036 player movement effects set by hazards: the bêbado's burp slows ('arroto' → slowUntil), the pombos' poop
 * makes the player slide ('coco' → slipUntil + slip). The movement itself is shared with the client's prediction
 * (src/maps/prediction.ts moveStep); this module only sets and clears the state on the SimPlayer.
 *
 * Rules:
 * - the effect lands whether or not the hit hurts (armor can take the damage to 0; a 0-damage telegraph still slows);
 * - never on a player who cannot be hit (downed, eliminated, spectator, hp 0) or is invulnerable (revive i-frames,
 *   skills): the i-frames dodge the effect like they dodge the damage;
 * - a new hit refreshes the effect (slowUntil/slipUntil = tick + duration), it never stacks;
 * - the slide goes along the player's facing (always a unit vector on the server), or away from the poop's center when
 *   the facing is unusable; nothing when both are degenerate (on SLIP_GRID, so the wire carries it exactly);
 * - falling, getting up (revive) and a rematch clear every effect (clearMoveEffects).
 */
import {KNOCK_DOWN_SECONDS,KNOCK_SECONDS,PLAYER_SLIP_SECONDS,PLAYER_SLOW_SECONDS,ticks} from '../contract/index.ts';
import type {Point,SimPlayer,Telegraph,VehicleKind} from '../contract/index.ts';

export const SLOW_TICKS=ticks(PLAYER_SLOW_SECONDS);
export const SLIP_TICKS=ticks(PLAYER_SLIP_SECONDS);
export const KNOCK_TICKS=ticks(KNOCK_SECONDS),KNOCK_DOWN_TICKS=ticks(KNOCK_DOWN_SECONDS);
/**
 * The slide direction is kept on the wire's grid (protocol 4 sends it like a velocity, in 1/VEL_SCALE = 1/256 steps,
 * tests/sim/player-effects.test.ts checks they agree): the phone decodes the very vector the room slides along, so
 * its replay is exact. moveDirection normalizes it, on both sides alike.
 */
export const SLIP_GRID=256;
const unit=(v:Point|undefined)=>{
  if(!v)return undefined;
  const l=Math.hypot(v.x,v.y);
  if(!Number.isFinite(l)||l<1e-6)return undefined;
  const q={x:Math.round(v.x/l*SLIP_GRID)/SLIP_GRID||0,y:Math.round(v.y/l*SLIP_GRID)/SLIP_GRID||0};
  return q.x||q.y?q:undefined;
};

/** Applies the movement effect of telegraph `t` hitting `p` on `tick` (no-op for kinds without one). Returns whether it applied. */
export function applyTelegraphEffect(p:SimPlayer,t:Pick<Telegraph,'kind'|'x'|'y'>,tick:number):boolean{
  if(t.kind!=='arroto'&&t.kind!=='coco')return false;
  if(p.spectator||p.downed||p.eliminated||!(p.hp>0)||tick<(p.invulnerableUntil??0))return false;
  if(t.kind==='arroto'){p.slowUntil=Math.max(p.slowUntil??0,tick+SLOW_TICKS);return true;}
  const slip=unit(p.facing)??unit({x:p.x-t.x,y:p.y-t.y});
  if(!slip)return false;
  p.slipUntil=tick+SLIP_TICKS;p.slip=slip;
  return true;
}

/**
 * boss-fim-onda-1, the Tank's punch: telegraph `t` with a push throws `p` (away from a circle's centre; along a line's
 * direction), Telegraph.push u over KNOCK_TICKS, then down KNOCK_DOWN_TICKS more. Same rules as the effects above (not
 * on someone who cannot be hit or is invulnerable); a new throw replaces the last. Returns whether it threw.
 */
export function applyTelegraphPush(p:SimPlayer,t:Pick<Telegraph,'shape'|'x'|'y'|'dx'|'dy'|'push'>,tick:number):boolean{
  if(!(t.push!==undefined&&t.push>0))return false;
  if(p.spectator||p.downed||p.eliminated||!(p.hp>0)||tick<(p.invulnerableUntil??0))return false;
  const along=t.shape==='line'?unit({x:t.dx??0,y:t.dy??0}):undefined;
  const dir=along??unit({x:p.x-t.x,y:p.y-t.y})??unit(p.facing);
  if(!dir)return false;
  const per=t.push/KNOCK_TICKS;
  p.knock={x:dir.x*per,y:dir.y*per};p.knockUntil=tick+1+KNOCK_TICKS;p.downUntil=tick+1+KNOCK_TICKS+KNOCK_DOWN_TICKS;
  return true;
}

/** Drops every D-036 effect (fall, revive, rematch): an absolute tick must not outlive the moment it belongs to. */
export function clearMoveEffects(p:SimPlayer){
  delete p.slowUntil;delete p.slipUntil;delete p.slip;
  // boss-fim-onda-1: a throw and its fall end too.
  delete p.knock;delete p.knockUntil;delete p.downUntil;
  // D-047 Dona Cida's sweets end too (a fall, a rematch: their absolute ticks belong to that moment and that run).
  if(p.fastUntil!==undefined)delete p.fastUntil;
  if(p.mightUntil!==undefined)delete p.mightUntil;
  if(p.guardUntil!==undefined)delete p.guardUntil;
  // Veículos: so does a ride.
  if(p.ride!==undefined||p.rideUntil!==undefined){delete p.ride;delete p.rideUntil;}
}

/** The effect fields worth sending for `p` on `tick`: only the ones still active (a finished effect costs no bytes). */
export function activeMoveEffects(p:SimPlayer,tick:number):{slowUntil?:number;slipUntil?:number;slip?:Point;ride?:VehicleKind;rideUntil?:number}{
  const out:{slowUntil?:number;slipUntil?:number;slip?:Point;ride?:VehicleKind;rideUntil?:number}={};
  // Veículos: the ride drives the prediction like the effects below.
  if(p.ride!==undefined&&tick<(p.rideUntil??-Infinity)){out.ride=p.ride;out.rideUntil=p.rideUntil;}
  if(tick<(p.slowUntil??-Infinity))out.slowUntil=p.slowUntil;
  if(p.slip&&tick<(p.slipUntil??-Infinity)){out.slipUntil=p.slipUntil;out.slip={x:p.slip.x,y:p.slip.y};}
  return out;
}
