/**
 * The weight of a big death and the answer to a caught gem (card NEW-20261028-ORQ-som-alarme-gema-e-chefe, auditoria
 * som-impacto itens 6 e 7). Pure (no Phaser): tested in tests/client/impact-rules.test.ts; layers.ts draws them.
 * - an elite's death trembles the screen ELITE_SHAKE_PX, a boss's BOSS_SHAKE_PX, and the horde's drawing holds still
 *   for HIT_STOP_MS (the sim never stops: only the drawn clock pauses, HitStop); reduced motion: neither;
 * - a gem (the kill's cédula) caught by the local hero lights a short glow on him (gemGlow).
 */

/** Screen tremble (CSS px) at an elite's and at a boss's death, and how long it lasts (ms). */
export const ELITE_SHAKE_PX=3,BOSS_SHAKE_PX=6,DEATH_SHAKE_MS=180;
/** The drawing's pause at an elite's or a boss's death (ms). */
export const HIT_STOP_MS=60;

export interface DeathImpact {shakePx:number;shakeMs:number;stopMs:number}
/** What a death shakes and pauses: nothing for a plain critter, nothing at all with reduced motion. */
export function deathImpact(boss:boolean,elite:boolean,reduced:boolean):DeathImpact|undefined{
  if(reduced||(!boss&&!elite))return undefined;
  return {shakePx:boss?BOSS_SHAKE_PX:ELITE_SHAKE_PX,shakeMs:DEATH_SHAKE_MS,stopMs:HIT_STOP_MS};
}

/**
 * Phaser's camera shake intensity for `px` screen px of tremble: its offset is intensity × the camera's size × zoom,
 * and it is applied after the zoom (Camera.preRender), so on screen it is intensity × size × zoom².
 */
export function shakeIntensity(px:number,width:number,height:number,zoom:number):{x:number;y:number}{
  const z2=Math.max(.05,zoom)**2;
  return {x:px/(Math.max(1,width)*z2),y:px/(Math.max(1,height)*z2)};
}

/**
 * A hit-stop on the drawn clock: during a stop clock() stays where it was, then runs on with the paused time left out,
 * so every animation resumes where it stopped (no jump). A stop asked during another extends it, never stacks.
 */
export class HitStop {
  private from=0;
  private until=-Infinity;
  private lost=0;
  /** Stops the drawn clock for `ms` from real time `now`. */
  start(now:number,ms:number){
    if(!(ms>0))return;
    this.settle(now);
    if(now<this.until){this.until=Math.max(this.until,now+ms);return;}
    this.from=now;this.until=now+ms;
  }
  /** The drawn clock at real time `now`. */
  clock(now:number):number{
    this.settle(now);
    return now<this.until?this.from-this.lost:now-this.lost;
  }
  /** True while a stop holds the clock. */
  stopped(now:number){return now<this.until;}
  private settle(now:number){
    if(this.until===-Infinity||now<this.until)return;
    this.lost+=this.until-this.from;this.until=-Infinity;
  }
}

/** The caught gem's glow on the hero (ms). */
export const GEM_GLOW_MS=280;
/**
 * The glow `age` ms after the catch: its size (× the base ring, growing out) and alpha (fading), or undefined once over.
 * Reduced motion: it only fades, at its full size.
 */
export function gemGlow(age:number,reduced:boolean):{size:number;alpha:number}|undefined{
  if(!(age>=0)||age>=GEM_GLOW_MS)return undefined;
  const t=age/GEM_GLOW_MS;
  return {size:reduced?1:.55+.45*(1-(1-t)**2),alpha:.9*(1-t)};
}
