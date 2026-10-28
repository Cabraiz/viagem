/**
 * The level-up burst and the hurt shake (card levelup-estouro-e-tremida; auditoria som-impacto 28/10, items 8 and 5),
 * as pure rules drawn by render/zueira-fx.ts:
 * - Burst: a ring of light grows around the local hero and a short confetti pops out of it for LEVELUP_BURST_MS, right
 *   before the level-up offer opens (hud.ts holds the pause's offer that long). With reduced motion: the ring alone,
 *   still, no confetti.
 * - Hurt shake: a hit on the local player above HURT_SHAKE_SHARE of its max hp shakes the camera HURT_SHAKE.shake px
 *   over HURT_SHAKE.shakeMs, with the towers' rule (tower-rules.ts shakeAt/shakeOffset); none with reduced motion.
 */
import type {RunView} from '../../contract/index.ts';

/** How long the burst lasts (ms); the level-up offer opens after it. */
export const LEVELUP_BURST_MS=400;
/** The camera shake of a hurting hit: the towers' calibre shape (tower-rules.ts CalibreLook shake/shakeMs). */
export const HURT_SHAKE={shake:2,shakeMs:120} as const;
/** A hit shakes only above this share of the local player's max hp (the small chip damage of a horde never does). */
export const HURT_SHAKE_SHARE=.1;
/** Depth of the burst: over the hero's own mark (you.ts SELF_DEPTH 96500), under its balloon (layers.ts 96550). */
export const LEVELUP_DEPTH=96520;

/** Ring radius (× the hero's height) at the start and the end of the burst, and the still ring's under reduced motion. */
export const RING_FROM=.35;
export const RING_TO=1.05;
export const RING_STILL=.7;
/** Confetti pieces popped per burst. */
export const CONFETTI_N=18;

/**
 * Hit points the local player lost in this view's new events (eventId above `seen`), and the last eventId read.
 * Only `damage` events on `localId` count (hits on others, heals and kills never shake this phone).
 */
export function hurtOn(view:Pick<RunView,'events'>,localId:string,seen:number){
  let amount=0,last=seen;
  for(const event of view.events){
    if(event.eventId<=seen)continue;
    last=Math.max(last,event.eventId);
    if(event.type==='damage'&&event.target===localId)amount+=event.amount;
  }
  return {amount,last};
}
/** Whether `amount` lost at once is worth a shake: above HURT_SHAKE_SHARE of `maxHp` (and never with reduced motion). */
export const hurtShakes=(amount:number,maxHp:number,reduced:boolean)=>!reduced&&maxHp>0&&amount>maxHp*HURT_SHAKE_SHARE;

export interface ConfettiPiece {x:number;y:number;rotation:number;color:number}
export interface BurstFrame {
  /** Ring radius and stroke width (× the hero's height) and its alpha; alpha 0: nothing to draw. */
  ring:{radius:number;width:number;alpha:number};
  /** Confetti offsets from the burst's centre (× the hero's height); empty with reduced motion. */
  confetti:ConfettiPiece[];
  confettiAlpha:number;
}

/** Fixed spread of the confetti (no random: the same burst on every phone and in every test). */
const hash=(i:number)=>{const s=Math.sin(i*12.9898+78.233)*43758.5453;return s-Math.floor(s);};

/**
 * The burst `ms` after it started, in units of the hero's height (the renderer scales it to the screen). The ring eases
 * out from RING_FROM to RING_TO and fades; the confetti flies out of the centre, mostly upward, and falls back under a
 * light gravity, fading in the last third. Reduced motion: the ring still at RING_STILL, full alpha, no confetti. After
 * LEVELUP_BURST_MS (or before 0): nothing.
 */
export function burstFrame(ms:number,reduced:boolean,colors:readonly number[]):BurstFrame{
  const none:BurstFrame={ring:{radius:0,width:0,alpha:0},confetti:[],confettiAlpha:0};
  if(!(ms>=0)||ms>=LEVELUP_BURST_MS)return none;
  if(reduced)return {ring:{radius:RING_STILL,width:.06,alpha:.9},confetti:[],confettiAlpha:0};
  const t=ms/LEVELUP_BURST_MS,ease=1-(1-t)*(1-t);
  const ring={radius:RING_FROM+(RING_TO-RING_FROM)*ease,width:.09*(1-.6*t),alpha:1-t*t};
  const confetti:ConfettiPiece[]=[];
  for(let i=0;i<CONFETTI_N;i++){
    // Fanned over the upper half-turn and a bit below, each with its own speed and spin.
    const angle=-Math.PI/2+(i/(CONFETTI_N-1)-.5)*Math.PI*1.5+(hash(i)-.5)*.3,speed=1+hash(i+50)*.9;
    const s=t*speed;
    confetti.push({x:Math.cos(angle)*s*1.1,y:Math.sin(angle)*s*1.1+1.6*t*t,rotation:(hash(i+100)-.5)*12*t,color:colors[i%colors.length]??0xffffff});
  }
  return {ring,confetti,confettiAlpha:t<2/3?1:3*(1-t)};
}
