/**
 * Card danca-no-jogo (23/10): the user's dances play in the match, not in the menu. A hero that stands still for
 * DANCE_IDLE_MS (no walk, no swing, no push, no flinch) starts dancing on its own, facing the camera, until it moves;
 * any input of the local player cuts it at once. Each client decides it for every figure it draws (a remote hero's
 * stillness is seen from its moves and swings), so nothing goes on the wire. Pure (no Phaser).
 */

/** Standing still this long (ms of the scene clock) starts the dance. */
export const DANCE_IDLE_MS=5000;
/** The dance sheet starts downloading this long before it plays, so the first pose is usually there on time. */
export const DANCE_PREFETCH_MS=3000;
/**
 * The menu dance runs 128 poses over 36 s, read slowly on the podium; in the match it plays this much faster so the
 * move reads at a figure's size (≈ 7 poses a second).
 */
export const DANCE_RATE=2;

/**
 * What the scene knows about one figure this frame. `allowed`: it may dance at all (alive, on its feet, not riding,
 * slipping or out of the run: see danceAllowed). `poke`: the scene-clock time of the local player's last input (own
 * hero only): an input restarts the wait.
 */
export interface DanceCue {allowed:boolean;poke?:number}

/** The wait and the dance of one figure. */
export class DanceGate {
  private quietSince?:number;
  /**
   * `still`: the figure rests this frame (CharacterSprites: motion idle, not pushing, no flinch). Returns the dance's
   * start (scene clock) while it dances, else undefined; `prefetch` tells when to start downloading the sheet.
   */
  prefetch=false;
  update(now:number,still:boolean,cue?:DanceCue):number|undefined{
    if(!cue||!cue.allowed||!still||this.quietSince===undefined||now<this.quietSince)this.quietSince=now;
    if(cue?.poke!==undefined&&cue.poke>this.quietSince)this.quietSince=Math.min(now,cue.poke);
    const quiet=now-this.quietSince;
    this.prefetch=quiet>=DANCE_IDLE_MS-DANCE_PREFETCH_MS;
    return quiet>=DANCE_IDLE_MS?this.quietSince+DANCE_IDLE_MS:undefined;
  }
}

/** The fields of a player's run state (PlayerRunView) that forbid dancing. */
export interface DanceState {
  hp:number;online?:boolean;spectator?:boolean;downed?:unknown;eliminated?:boolean;
  ride?:unknown;rideUntil?:number;slipUntil?:number;
}
/**
 * A figure may dance only alive and on its feet, in the run, with its feet on the ground: not downed or out, not
 * riding a vehicle (the moto, the burpee's leap), not sliding on pigeon poop. `tick`: the run's current tick.
 */
export function danceAllowed(p:DanceState|undefined,tick:number):boolean{
  if(!p||!(p.hp>0)||p.online===false||p.spectator||p.downed||p.eliminated)return false;
  if(p.ride&&(p.rideUntil??Infinity)>tick)return false;
  return !((p.slipUntil??0)>tick);
}
