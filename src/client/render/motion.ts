/**
 * Pure animation curves for the horde layers (no Phaser). Times in ms, offsets in screen px at zoom 1.
 * Every helper that returns an object accepts an optional `out` to stay allocation-free per frame.
 */
export interface Scale2 {sx:number;sy:number}
export interface PoofFrame {scale:number;alpha:number;done:boolean}
export interface TextFrame {y:number;scale:number;alpha:number;done:boolean}

const TAU=Math.PI*2;
const clamp01=(v:number)=>v<0?0:v>1?1:v;
const easeOut=(t:number)=>1-(1-t)*(1-t)*(1-t);

/** Deterministic 0..1 from an id (FNV-1a), used for animation phases and joke picks. */
export function hashPhase(id:string){
  let h=0x811c9dc5;
  for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return (h>>>0)/4294967296;
}

/** Idle breathing ±6%, moving hop/stretch ±14%. Volume is roughly preserved. */
export function squash(timeMs:number,phase:number,moving:boolean,reduced:boolean,out:Scale2={sx:1,sy:1}):Scale2{
  if(reduced){out.sx=1;out.sy=1;return out;}
  const s=moving?Math.sin(timeMs/1000*TAU*3.4+phase*TAU)*.14:Math.sin(timeMs/1000*TAU*.85+phase*TAU)*.06;
  out.sy=1+s;out.sx=1-s*.8;return out;
}

export const HIT_FLASH_MS=90;
export const hitFlash=(ageMs:number)=>ageMs>=0&&ageMs<HIT_FLASH_MS;
/**
 * Rest after a flash before a hit may flash the same critter again (BUG silhueta-branca). Under the horde's fire a
 * critter takes several hits per second (the boss over 12/s): restarting the flash on every hit kept big critters a
 * solid white silhouette for their whole fight. A flash now always runs its HIT_FLASH_MS and the next one starts at
 * least HIT_FLASH_MS+HIT_FLASH_REST_MS (340 ms) later: under 3 flashes per second (WCAG 2.3.1), mostly in colour.
 */
export const HIT_FLASH_REST_MS=250;
/** When the flash of a critter hit at `now` starts: now, or `flashAt` (the running flash) when it is still too recent. */
export const flashStartOnHit=(now:number,flashAt:number)=>now-flashAt>=HIT_FLASH_MS+HIT_FLASH_REST_MS?now:flashAt;

export const POOF_MS=520;
/** Cartoon poof: overshoots to ~1.8 quickly, settles, fades out by POOF_MS. */
export function poof(ageMs:number,out:PoofFrame={scale:0,alpha:0,done:false}):PoofFrame{
  const t=clamp01(ageMs/POOF_MS);
  out.scale=t<.28?.4+1.4*easeOut(t/.28):1.8-.3*(t-.28)/.72;
  out.alpha=t<.35?1:1-(t-.35)/.65;
  out.done=ageMs>=POOF_MS;return out;
}

export const POP_TEXT_MS=900;
/** Death pop text: springs in (1.3 → 1), rises ~46 px, fades the last 300 ms. */
export function popText(ageMs:number,reduced:boolean,out:TextFrame={y:0,scale:1,alpha:1,done:false}):TextFrame{
  const t=clamp01(ageMs/POP_TEXT_MS);
  out.y=-46*easeOut(t);
  if(reduced)out.scale=1;
  else if(ageMs<120)out.scale=.3+1*(ageMs/120);
  else if(ageMs<260)out.scale=1.3-.3*((ageMs-120)/140);
  else out.scale=1;
  out.alpha=ageMs<POP_TEXT_MS-300?1:clamp01((POP_TEXT_MS-ageMs)/300);
  out.done=ageMs>=POP_TEXT_MS;return out;
}

export const DAMAGE_MS=720;
/** Damage number: quick pop then float up ~38 px and fade. */
export function damageFloat(ageMs:number,out:TextFrame={y:0,scale:1,alpha:1,done:false}):TextFrame{
  const t=clamp01(ageMs/DAMAGE_MS);
  out.y=-38*easeOut(t);
  out.scale=ageMs<90?.7+.5*(ageMs/90):ageMs<200?1.2-.2*((ageMs-90)/110):1;
  out.alpha=t<.55?1:1-(t-.55)/.45;
  out.done=ageMs>=DAMAGE_MS;return out;
}

/** Ticks of warning used to normalize urgency when the telegraph start is unknown. */
export const TELEGRAPH_WINDOW=30;
/** 0..1 urgency, monotonic non-decreasing in nowTick, 1 at fireTick. */
export function telegraphPulse(nowTick:number,fireTick:number,reduced:boolean,startTick=fireTick-TELEGRAPH_WINDOW){
  const span=Math.max(1,fireTick-startTick);
  const t=clamp01(1-(fireTick-nowTick)/span);
  return reduced?t:t*t*(3-2*t);
}
/** Border blink 0..1 that speeds up with urgency (2 Hz → 9 Hz). Reduced motion keeps it steady. */
export function telegraphBlink(timeMs:number,urgency:number,reduced:boolean){
  if(reduced)return 1;
  const hz=2+7*urgency;
  return .5+.5*Math.cos(timeMs/1000*TAU*hz);
}

/** City telegraph dash drift (CSS px per second): slow, so the edge reads as alive, never as a spinner. */
export const TELEGRAPH_DASH_CSS_PER_S=6;
/**
 * Drift of the city telegraph's dashes in CSS px (≥ 0, unwrapped): it moves slowly along the edge; reduced motion keeps
 * it still at 0 (prefers-reduced-motion). It is NOT wrapped here: a huge zone stretches its dash pattern
 * (telegraph-shape.ts dashSegments, DASH_MAX), so only the painter knows the real period, and dashSegments wraps the
 * phase on it; wrapping on the unstretched 15 px would make those dashes jump back every 2.5 s.
 */
export function telegraphDashPhase(timeMs:number,reduced:boolean){
  if(reduced||!(timeMs>0))return 0;
  return timeMs/1000*TELEGRAPH_DASH_CSS_PER_S;
}

/** Frame-rate independent exponential smoothing; `rate` is 1/s. */
export const smoothToward=(current:number,target:number,deltaMs:number,rate:number)=>
  target+(current-target)*Math.exp(-rate*Math.max(0,deltaMs)/1000);

/**
 * Seconds a linearly moving shot is drawn ahead of its last snapshot (BUG-20261013-E5-projetil-desenhado-a-frente):
 * the time since the snapshot arrived, capped at two sim ticks so a late frame never throws it far ahead. Its vx/vy are
 * in units per SECOND (sim projectiles.ts, the wire's extrapolation), so the offset is v × these seconds — not × ticks.
 */
export const PROJECTILE_LEAD_TICKS=2;
export const projectileLeadSeconds=(nowMs:number,pushAtMs:number,tickMs:number)=>
  Math.min(PROJECTILE_LEAD_TICKS*tickMs,Math.max(0,nowMs-pushAtMs))/1000;
