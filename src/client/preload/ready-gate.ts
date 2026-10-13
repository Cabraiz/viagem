/**
 * The waiting room's side of the pre-download (NEW-20261013-ORQ-3g-precarga-partida), pure: the ready button stays
 * blocked until this phone has its P0 (own hero and the map's ground) or PRELOAD_CAP_MS passed since it entered the
 * room; the rest keeps downloading behind. The room starts only when everyone is ready, so a match starts when every
 * phone has its P0 or its cap passed, with no protocol change. Each phone sees only its own progress (the others' is
 * not sent over the room).
 */
import type {PreloadProgress} from './preloader.ts';

export const PRELOAD_CAP_MS=25_000;
/** 0..1 of this phone's P0; 1 with nothing to download (no list yet counts as nothing). */
export const p0Fraction=(p:PreloadProgress|undefined)=>p?Math.max(0,Math.min(1,p.P0.fraction)):1;
/** "Baixando: 40%" (floored: never 100% while a byte is missing). */
export const preloadText=(fraction:number)=>`Baixando: ${Math.min(99,Math.floor(fraction*100))}%`;
/** Why the ready button is blocked by the pre-download, or undefined (done, or the cap passed). */
export function preloadBlock(p:PreloadProgress|undefined,elapsedMs:number):string|undefined{
  const f=p0Fraction(p);
  return f>=1||!(elapsedMs<PRELOAD_CAP_MS)?undefined:preloadText(f);
}
/** The ring around this player's face: how full, and whether it is gone (P0 complete). */
export function preloadRing(p:PreloadProgress|undefined):{fraction:number;done:boolean}{
  const fraction=p0Fraction(p);
  return {fraction,done:fraction>=1};
}
