/**
 * Procedural sound contract (VGM-050). Recipes are plain data so they can be tested without WebAudio.
 * Erasable TypeScript only: tests run with --experimental-strip-types.
 */

/** The procedural sounds (recipes.ts): each also has a file (sfx.ts) and falls back to its recipe when the file fails. */
export const SOUND_IDS=[
  'golpe','gema','nivel','upgrade','queda','resgate','chefe','round-inicio','round-fim',
  'buzina','boing','risada','carimbo',
] as const;
/**
 * Sounds that exist only as files (NEW-20261022-ORQ-sons-ia-ace-step: made by TangoFlux, public/audio/sfx/): UI, the
 * hero, the arsenal (NEW_WEAPONS, the class weapons and Pack 12 by type), the towers by calibre, critters, chests and
 * pickups. No recipe: a file that fails is silence.
 */
export const FILE_SOUND_IDS=[
  'ui-botao','ui-abrir','ui-fechar','ui-carta','ui-erro',
  'passo-neve','empurrar','levantar','dano-heroi',
  'faca','pistola','escopeta','submetralhadora','rifle','macarico','rojao',
  'chinelo','boleto','cafe','guarda-chuva','pombo','audio',
  'p12-tiro','p12-leque','p12-orbita','p12-ricochete','p12-bumerangue','p12-teleguiado','p12-lancado','p12-mina','p12-torreta','p12-aura','p12-nuvem',
  'torre-construir','torre-pistola','torre-fuzil','torre-metralhadora','torre-rotativa','torre-sniper','torre-antimaterial','torre-rojao',
  'torre-morteiro','torre-foguete','torre-obus','torre-gustavao','torre-holofote','torre-arame','torre-antiaerea','torre-radar',
  'bicho-acerto','bicho-morte','chefe-acerto','chefe-morte','chefe-passo',
  'bau-comum','bau-raro','bau-epico','bau-lendario',
  'coxinha','ima',
] as const;
export type ProceduralId=typeof SOUND_IDS[number];
export type SoundId=ProceduralId|typeof FILE_SOUND_IDS[number];
/** Every sound, procedural first. */
export const ALL_SOUND_IDS:readonly SoundId[]=[...SOUND_IDS,...FILE_SOUND_IDS];

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
  id:ProceduralId;
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
