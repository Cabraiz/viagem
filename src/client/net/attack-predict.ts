/**
 * BUG-20261027-ORQ-tiro-delay-1s-predicao (the user: "como Clash Royale"): the local hero's attack shows on the press,
 * not when the room's frame says so. Measured on viagem.cyou: press → the room's swing on screen 0.3 s on a PC, 0.6-0.8 s
 * on 4G (the 50 ms step, the 10 Hz slot, LEAD_STEPS, the tick, the frame every 2 ticks, the round trip).
 *
 * The room stays the authority: the damage, the kills and the hp come only from it. What the phone draws on its own
 * is the hero's swing, the shot's flash (render/arsenal-fx.ts) and its sound, marked as waiting for the room's copy;
 * when the room's swing (attackTick) or its 'fire' comes within MATCH_MS it is the same attack, so it is not drawn
 * again. A press the weapon's cooldown would refuse is not predicted: the cooldown per weapon is learned from the
 * room's own fires (the client has no weapon catalog, OWNERS.md), and a press within it waits for the room as before.
 * Pure (no Phaser, no socket), so node tests it.
 */

/** A predicted attack waits this long for the room's copy (4G worst seen: ~1.2 s to the damage). */
export const MATCH_MS=1500;
/** The room's swing restarts at most every ATTACK_ANIMATION_TICKS (12) × 50 ms (multiplayer/simulation.ts). */
export const SWING_GAP_MS=600;
/** Room tick (ms), for the gaps between the room's fires. */
const TICK_MS=50;
/** Server fires remembered (by eventId), so the renderer and the audio take the same decision. */
const MEMO=128;

export class AttackPredictor {
  /** The local hero's swing count: grows by one on each swing to draw (SpriteMotion's attackTick for this hero). */
  swings=0;
  private waitSwing:number[]=[];
  private waitFire:{at:number;weapon:string}[]=[];
  private lastSwingAt=-Infinity;
  private lastFireAt=new Map<string,number>();
  /** Least gap (ms) seen between two of the room's fires of a weapon: its cooldown, as far as we know. */
  private cooldown=new Map<string,number>();
  private serverTick?:number;
  private lastServerFire?:{weapon:string;tick:number};
  /** The room's fires of the shot already predicted (a shotgun's pellets are one 'fire' each, same tick). */
  private matched?:{weapon:string;tick:number};
  private decided=new Map<number,boolean>();

  /** The weapon's cooldown learned so far (ms), 0 before the room fired it twice. */
  cooldownOf(weapon:string){return this.cooldown.get(weapon)??0;}

  /**
   * The attack pressed now (ms) with `weapon` in the hand: true when the phone draws the shot at once (and its sound).
   * The swing also starts, unless one started less than SWING_GAP_MS ago.
   */
  press(now:number,weapon:string):boolean{
    this.expire(now);
    // A tick of margin: the gaps are read from the frames' ticks, one tick off at most.
    const cooldown=this.cooldownOf(weapon);
    if(cooldown>0&&now-(this.lastFireAt.get(weapon)??-Infinity)<cooldown+TICK_MS)return false;
    this.waitFire.push({at:now,weapon});this.lastFireAt.set(weapon,now);
    if(now-this.lastSwingAt>=SWING_GAP_MS){this.waitSwing.push(now);this.lastSwingAt=now;this.swings++;}
    return true;
  }

  /** Every frame, the room's attackTick for this hero: returns the swing count to draw (a predicted swing is not redrawn). */
  swingTick(attackTick:number,now:number):number{
    if(this.serverTick===undefined||attackTick<this.serverTick){this.serverTick=attackTick;this.waitSwing=[];return this.swings;}
    if(attackTick===this.serverTick)return this.swings;
    this.serverTick=attackTick;this.expire(now);
    if(this.waitSwing.length)this.waitSwing.shift();
    else{this.lastSwingAt=now;this.swings++;}
    return this.swings;
  }

  /**
   * One of the room's 'fire' events of this hero (`eventId`, the view's `tick`): whether to draw it and play its sound.
   * False when the phone already drew it on the press. The same eventId always gets the same answer.
   */
  fire(eventId:number,weapon:string,tick:number,now:number):boolean{
    const known=this.decided.get(eventId);
    if(known!==undefined)return known;
    const last=this.lastServerFire;
    if(last&&last.weapon===weapon&&tick>last.tick){
      const gap=(tick-last.tick)*TICK_MS,was=this.cooldown.get(weapon);
      if(was===undefined||gap<was)this.cooldown.set(weapon,gap);
    }
    if(!last||tick!==last.tick||weapon!==last.weapon)this.lastServerFire={weapon,tick};
    let show:boolean;
    if(this.matched&&this.matched.weapon===weapon&&this.matched.tick===tick)show=false;
    else{
      this.expire(now);
      const i=this.waitFire.findIndex(w=>w.weapon===weapon);
      if(i>=0){this.waitFire.splice(0,i+1);this.matched={weapon,tick};show=false;}
      else{show=true;this.lastFireAt.set(weapon,now);}
    }
    this.decided.set(eventId,show);
    if(this.decided.size>MEMO)this.decided.delete(this.decided.keys().next().value!);
    return show;
  }

  private expire(now:number){
    while(this.waitSwing.length&&now-this.waitSwing[0]>MATCH_MS)this.waitSwing.shift();
    while(this.waitFire.length&&now-this.waitFire[0].at>MATCH_MS)this.waitFire.shift();
  }
}
