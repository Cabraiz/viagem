/**
 * What an enemy's server state looks like (Elenco P1, NEW-20261012-ORQ-elenco-p1). Pure (no Phaser): layers.ts and the
 * tests read it. EnemyView.phase on a regular critter: 1 = acting (the coach lecturing, the motoboy aiming his charge,
 * the influencer posing), 2 = buffed by a coach's lecture. The chefe's phase is his boss phase (sim/boss.ts) and never
 * maps here; any other value (an older or newer server) shows nothing.
 * Every answer is one of a few frozen constants: no allocation per call, per enemy or per frame.
 */
import type {EnemyKind} from './keys.ts';
import {roleOf} from '../../rules/index.ts';

export const PHASE_ACTING=1,PHASE_BUFFED=2;

export interface PhaseLook {
  /** Swap to the kind's `:act` texture (keys.ts ACTING_KINDS). */
  readonly acting:boolean;
  /** The coach's lecture ring on the ground, PALESTRA_RADIUS world units. */
  readonly aura:boolean;
  /** Subtle golden "motivated" sparkle over the head (buffed by a coach). */
  readonly sparkle:boolean;
  /** The influencer's shiny reflect ring (his pose bounces straight shots back). */
  readonly reflect:boolean;
  /** The motoboy's headlight glow while he aims the charge. */
  readonly headlight:boolean;
}
const look=(l:PhaseLook)=>Object.freeze(l);
export const LOOK_NONE=look({acting:false,aura:false,sparkle:false,reflect:false,headlight:false});
export const LOOK_LECTURE=look({acting:true,aura:true,sparkle:false,reflect:false,headlight:false});
export const LOOK_CHARGE=look({acting:true,aura:false,sparkle:false,reflect:false,headlight:true});
export const LOOK_POSE=look({acting:true,aura:false,sparkle:false,reflect:true,headlight:false});
export const LOOK_BUFFED=look({acting:false,aura:false,sparkle:true,reflect:false,headlight:false});

export function phaseLook(kind:EnemyKind,phase:number|undefined):PhaseLook{
  if(kind==='chefe'||phase===undefined)return LOOK_NONE;
  if(phase===PHASE_ACTING)return kind==='coach'?LOOK_LECTURE:kind==='motoboy'?LOOK_CHARGE:kind==='influencer'?LOOK_POSE:LOOK_NONE;
  if(phase===PHASE_BUFFED)return LOOK_BUFFED;
  return LOOK_NONE;
}
/**
 * Look of an EnemyView's kind (any roster id, D-040) drawn as `kind` (keys.ts enemyKind): phaseLook, except that the
 * invocador only borrows the coach's texture: its phase 1 is calling minions (the spawn warning shows where), not a
 * lecture, so it gets no lecture ring and no raised whiteboard. Buffed (phase 2) reads as on anyone.
 */
export function viewPhaseLook(id:string,kind:EnemyKind,phase:number|undefined):PhaseLook{
  return phase===PHASE_ACTING&&roleOf(id)==='invocador'?LOOK_NONE:phaseLook(kind,phase);
}

/**
 * Radius (world units) of the coach's lecture: allies inside it are buffed. The client cannot import the sim, so it is
 * a copy of src/sim/enemies/catalog.ts PALESTRA.radius; tests/client/elenco-p1.test.ts pins the two equal.
 */
export const PALESTRA_RADIUS=3.5;
/**
 * Half axes (world px) of a ground circle of `radius` world units under the 2:1 projection (render/projector.ts:
 * x = (u−v)·42, y = (u+v)·21): the same in every camera view. Written into `out`.
 */
export function groundEllipse(radius:number,out:{rx:number;ry:number}){out.rx=radius*42*Math.SQRT2;out.ry=radius*21*Math.SQRT2;return out;}

/** Lecture ring pulse (scale, 1 with reduced motion): a slow breath, never a blink (it is not a danger zone). */
export const auraPulse=(now:number,reduced:boolean)=>reduced?1:1+.025*Math.sin(now*.004);
/**
 * One sparkle of the buffed glitter (i = 0..SPARKLES−1) at `now`: offset from the head (CSS-scaled units of k), size and
 * alpha, written into `out`. Reduced motion: still, fixed spots at full alpha.
 */
export const SPARKLES=3;
export interface SparkleFrame {dx:number;dy:number;r:number;alpha:number}
export function sparkleFrame(i:number,now:number,seed:number,reduced:boolean,out:SparkleFrame):SparkleFrame{
  const base=(i/SPARKLES+seed)*Math.PI*2;
  if(reduced){out.dx=Math.cos(base)*16;out.dy=Math.sin(base)*7-4;out.r=5;out.alpha=.9;return out;}
  const t=now*.0016+base,twinkle=.5+.5*Math.sin(now*.009+i*2.1+seed*7);
  out.dx=Math.cos(t)*17;out.dy=Math.sin(t)*7-4-3*twinkle;out.r=3.5+3*twinkle;out.alpha=.45+.5*twinkle;
  return out;
}
/** Shine of the reflect ring: angle (rad) of its glint, still with reduced motion. */
export const reflectGlint=(now:number,reduced:boolean)=>reduced?-Math.PI*.75:now*.006;
/** Headlight glow strength 0..1 (a fast flicker; steady with reduced motion). */
export const headlightGlow=(now:number,seed:number,reduced:boolean)=>reduced?1:.75+.25*Math.sin(now*.03+seed*9);
