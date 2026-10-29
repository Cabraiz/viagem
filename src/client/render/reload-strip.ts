/**
 * NEW-20261029-ORQ-animacoes-de-recarga: the reload of the six firearms is a strip of the held weapon itself (no body
 * animation, the same for every hero): 16 square frames of 128 px built from the weapon's own icon (frames 0 and 15 are
 * the icon; the shotgun breaks open, the revolver's cylinder swings out, the SMG's magazine drops, the rifle takes a
 * stripper clip, the blowtorch swaps its canister, the rocket stick takes a new rocket), stretched over the reload the
 * sim runs (card pente-e-recarga: PlayerRunView.reloadUntil / reloadTicks). The art and its builders live in
 * viagem-board/evidence/NEW-20261029-ORQ-animacoes-de-recarga/gerar/ (montar-<arma>.py). Already light: no lite copy.
 */
import {TICK_MS} from '../net/smoothing.ts';

/** Frames of each strip (square, the icon's side). */
export const RELOAD_FRAMES=16;
/** The weapons with a strip (their plain icon ids: WEAPON_HOLD). The dourada edition keeps its icon. */
export const RELOAD_WEAPONS=['pistola','escopeta','submetralhadora','rifle','macarico','rojao'] as const;
const HAS=new Set<string>(RELOAD_WEAPONS);

export const hasReloadStrip=(icon:string)=>HAS.has(icon);
export const reloadKey=(icon:string)=>`recarga:${icon}`;
export const reloadUrl=(icon:string)=>`/art/fx/recarga-${icon}.webp`;

/** A hero's reload as the last view told it: ends at tick `until`, lasts `ticks`; the view was at `tick` at time `at` (ms). */
export interface ReloadClock {until:number;ticks:number;tick:number;at:number}

/**
 * The strip frame for a reload at time `now` (ms), the view's tick carried forward between views (20 Hz) so the strip
 * runs at the frame rate; undefined once it is over (the icon again).
 */
export function reloadFrame(r:ReloadClock,now:number):number|undefined{
  if(!(r.ticks>0))return undefined;
  const left=r.until-r.tick-Math.max(0,now-r.at)/TICK_MS;
  if(left<=0)return undefined;
  const p=Math.min(1,Math.max(0,1-left/r.ticks));
  return Math.min(RELOAD_FRAMES-1,Math.floor(p*RELOAD_FRAMES));
}
