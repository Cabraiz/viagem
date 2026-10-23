/**
 * Card 3g-rede-sem-teleporte: what the screen draws on a bad 3G link (800 ms, jitter, losses, drops), pure and tested.
 *
 * - SelfCorrection: the local hero. The prediction (client.ts) steps at once from the thumb; when a frame arrives the
 *   prediction is reconciled with the room (maps/prediction.ts reconcile) and may move. The drawing does not follow
 *   that move: the offset takes it and fades, a small error gone in ~150-300 ms and never more than
 *   CORRECTION_MAX_PX per frame on screen. An error over CORRECTION_HIDE_UNITS (a long drop) is not glided: the scene
 *   snaps behind a puff.
 * - ArrivalJitter: how late frames come (mean gap and its deviation), so the remote buffer (players) and the enemies'
 *   glide are as long as the link needs (INTERP_MIN_MS..INTERP_MAX_MS), not a fixed 100-120 ms that freezes and jumps.
 * - extrapolation: a late frame does not freeze the others; they go on along their last motion for at most
 *   EXTRAPOLATE_MAX_MS (dead reckoning with a ceiling).
 */
import {HERO_SPEED_MULT,type Point} from '../../maps/index.ts';

/** Time constant of the hero's correction fade (ms): ~95% of a small error is gone in 3τ ≈ 270 ms. */
export const CORRECTION_TAU_MS=90;
/** The visible correction never moves the hero more than this per frame (CSS px on screen). */
export const CORRECTION_MAX_PX=4;
/**
 * An error larger than this (world units ≈ cells) is not glided: hidden behind a puff (a long drop, a respawn). 3 u at
 * the base walk, × HERO_SPEED_MULT (velocidade-heroi-e-projetil): the same walking time of error.
 */
export const CORRECTION_HIDE_UNITS=3*HERO_SPEED_MULT;
/**
 * BUG heroi-vai-e-volta: while the hero walks, the fade may slow the drawing down but never turn it back: it keeps at
 * least this share of the frame's own motion along it (a correction behind the hero is walked into, not snapped back to).
 */
export const CORRECTION_MIN_FORWARD=.3;
/** Below this the offset is gone (units). */
const CORRECTION_EPS=1e-3;

export type Absorbed='none'|'smooth'|'hide';
/** The local hero's display error (world units): drawn = prediction + offset; the offset fades every frame. */
export class SelfCorrection {
  x=0;y=0;
  /** Largest per-frame move of the last step (px), for the lab's numbers. */
  lastPx=0;
  get size(){return Math.hypot(this.x,this.y);}
  /**
   * The prediction jumped from `from` to `to` outside a step (reconcile): the drawing stays where it was and the offset
   * takes the jump. 'hide' when the error is too big to glide (the offset is dropped: the scene snaps behind a puff).
   */
  absorb(from:Point,to:Point):Absorbed{
    const dx=from.x-to.x,dy=from.y-to.y;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||(dx===0&&dy===0))return 'none';
    this.x+=dx;this.y+=dy;
    if(Math.hypot(this.x,this.y)>CORRECTION_HIDE_UNITS){this.clear();return 'hide';}
    return 'smooth';
  }
  clear(){this.x=0;this.y=0;}
  /**
   * One frame of `dtMs`: the offset fades by the time constant, at most CORRECTION_MAX_PX on screen. `unitPx`: screen
   * px of one world unit (the largest over directions), so the cap holds at any zoom. `motion`: how far the prediction
   * itself drew the hero this frame (units); against it the fade goes no faster than CORRECTION_MIN_FORWARD allows.
   * Returns the px moved.
   */
  step(dtMs:number,unitPx:number,motion?:Point):number{
    const size=Math.hypot(this.x,this.y);
    if(size<CORRECTION_EPS){this.clear();return this.lastPx=0;}
    const fade=size*(1-Math.exp(-Math.max(0,dtMs)/CORRECTION_TAU_MS));
    const cap=unitPx>0?CORRECTION_MAX_PX/unitPx:fade;
    let move=Math.min(fade,cap);
    const walked=motion?Math.hypot(motion.x,motion.y):0;
    if(walked>1e-6&&Number.isFinite(walked)){
      // The fade moves the drawing by -offset/size × move; its part along the motion may not undo more than allowed.
      const back=-(this.x*motion!.x+this.y*motion!.y)/(size*walked),limit=(1-CORRECTION_MIN_FORWARD)*walked;
      if(back<0&&-back*move>limit)move=limit/-back;
    }
    const k=size-move<CORRECTION_EPS?0:(size-move)/size;
    this.x*=k;this.y*=k;
    return this.lastPx=(k===0?size:move)*Math.max(0,unitPx);
  }
}

/** Shortest and longest render delay for the others (ms): the room sends every 100 ms; 3G jitter needs more. */
export const INTERP_MIN_MS=100,INTERP_MAX_MS=250;
/** A late frame: the others go on along their last motion for at most this long, then wait (ms). */
export const EXTRAPOLATE_MAX_MS=150;
/**
 * ...and never more than this far past the newest sample (units): a dash between two frames is not a speed. 0.6 u at
 * the base walk (150 ms × 3.1 u/s = 0.47), × HERO_SPEED_MULT for the 2× walk (0.93 u in 150 ms).
 */
export const EXTRAPOLATE_MAX_UNITS=.6*HERO_SPEED_MULT;
/**
 * Frame arrival jitter: smoothed gap between frames and its mean deviation (RFC 6298 style), turned into the render
 * delay the others need: the usual gap plus two deviations, within INTERP_MIN_MS..INTERP_MAX_MS.
 */
export class ArrivalJitter {
  gap:number;dev=0;
  private last?:number;
  constructor(nominalMs=INTERP_MIN_MS){this.gap=nominalMs;}
  /** A frame arrived at `at` (ms). Gaps over 2 s (a drop, the app hidden) are not jitter: ignored. */
  push(at:number){
    const last=this.last;this.last=at;
    if(last===undefined)return;
    const gap=at-last;
    if(!(gap>=0)||gap>2000)return;
    this.dev+=(Math.abs(gap-this.gap)-this.dev)/4;
    this.gap+=(gap-this.gap)/8;
  }
  reset(){this.last=undefined;}
  /** Render delay for the others (ms). */
  delay(){return Math.max(INTERP_MIN_MS,Math.min(INTERP_MAX_MS,this.gap+2*this.dev));}
}

/**
 * Where a remote entity is drawn at `target` (ms) from timed samples `a` (at ≤ target, or the oldest) and `b` (the
 * next, or the newest): interpolated between them, or past the newest along its last motion for at most
 * EXTRAPOLATE_MAX_MS (`prev` is the sample before the newest). Returns the blend factor (may be > 1).
 */
export function blendFactor(aAt:number,bAt:number,target:number,prevAt?:number):number{
  if(bAt>aAt)return Math.max(0,Math.min(1,(target-aAt)/(bAt-aAt)));
  // a === b: the newest sample; extrapolate along prev→newest when the target is past it.
  if(prevAt===undefined||!(aAt>=prevAt)||target<=aAt)return 1;
  // Arrival times, not server ticks: frames held by a lossy link land in a burst (a gap under 1 ms). The motion between
  // two frames took at least the room's send period, so the gap counts as at least INTERP_MIN_MS.
  return 1+Math.min(target-aAt,EXTRAPOLATE_MAX_MS)/Math.max(aAt-prevAt,INTERP_MIN_MS);
}
/** a + (b - a)·t for any t; past b (t > 1) at most EXTRAPOLATE_MAX_UNITS beyond it. */
export function along(a:Point,b:Point,t:number):Point{
  if(t<=1)return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  let ex=(b.x-a.x)*(t-1),ey=(b.y-a.y)*(t-1);const d=Math.hypot(ex,ey);
  if(d>EXTRAPOLATE_MAX_UNITS){ex*=EXTRAPOLATE_MAX_UNITS/d;ey*=EXTRAPOLATE_MAX_UNITS/d;}
  return {x:b.x+ex,y:b.y+ey};
}
/** Largest extrapolation of an enemy glide, as a share of the glide (and never past EXTRAPOLATE_MAX_MS). */
export function glideCeiling(glideMs:number){return 1+Math.min(.5,EXTRAPOLATE_MAX_MS/Math.max(1,glideMs));}
