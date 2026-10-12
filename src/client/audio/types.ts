/**
 * Procedural sound contract (VGM-050). Recipes are plain data so they can be tested without WebAudio.
 * Erasable TypeScript only: tests run with --experimental-strip-types.
 */

export const SOUND_IDS=[
  'golpe','gema','nivel','upgrade','queda','resgate','chefe','round-inicio','round-fim',
  'buzina','boing','risada','carimbo',
] as const;
export type SoundId=typeof SOUND_IDS[number];

export type Wave='sine'|'square'|'sawtooth'|'triangle'|'noise';

/** One oscillator (or noise burst) inside a sound. Times in seconds from the sound start. */
export interface Tone {
  wave:Wave;
  /** Start and end frequency in Hz (exponential glide). For noise, the band-pass center. */
  from:number; to:number;
  at:number; dur:number;
  /** Peak gain 0..1 before the master volume. */
  gain:number;
  /** Attack time in seconds (default 0.005); the rest of `dur` decays to silence. */
  attack?:number;
  /** Pitch wobble: rate in Hz, depth in Hz. */
  vibrato?:{rate:number;depth:number};
  filter?:{type:'lowpass'|'highpass'|'bandpass';freq:number;q?:number};
}

export interface SoundRecipe {
  id:SoundId;
  /** pt-BR button label for the sandbox and settings preview. */
  label:string;
  tones:readonly Tone[];
  /** Minimum milliseconds between two plays of this sound (hit spam with 300 enemies). */
  throttleMs:number;
  /** Higher survives voice stealing. 0 = cosmetic spam, 3 = must be heard (boss, downed). */
  priority:number;
  /** Optional navigator.vibrate pattern in ms, only when vibration is enabled. */
  vibrate?:readonly number[];
}

/** Total length of a recipe in seconds. */
export function recipeLength(recipe:SoundRecipe){
  return recipe.tones.reduce((end,t)=>Math.max(end,t.at+t.dur),0);
}
