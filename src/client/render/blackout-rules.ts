/**
 * Blackout of the zueira events (VGM-053B, "apagão"): pure rules, no Phaser, so the depth audit runs in node.
 * The dark is one rectangle over the world at BLACKOUT_DEPTH; what must never hide sits above it:
 * - telegraphs: outline, wash and hatch on the renderer's top layer (TELEGRAPH_TOP_DEPTH 99000);
 * - spawn warnings (the critters' arrival), hostile projectiles and the caídos' rescue ring and light column: lifted
 *   to LIFTED_DEPTH while it is dark;
 * - the local hero (SELF_DEPTH, or its see-through copy over a canopy), its ring, bar and "Você" arrow (MARK_DEPTH),
 *   the allies standing or down (ALLY_DEPTH) with their fichas (LABEL_DEPTH), hit numbers on a player (PLAYER_HIT_DEPTH);
 * - the critters as eyes in the dark (EYES_DEPTH): where they are stays readable, only the body goes dark.
 */
export const BLACKOUT_DEPTH=94000;
/** Eyes of the critters: over the dark, under every hero and marker. */
export const EYES_DEPTH=94500;
/** Spawn warnings, hostile projectiles and the caído rings/columns while dark: over the dark and the eyes. */
export const LIFTED_DEPTH=94700;
/** Darkness of the blackout (Breu): the scene still shows faintly under it. Reduced effects: lighter. */
export const BLACKOUT_ALPHA=.8,BLACKOUT_ALPHA_REDUCED=.6;
/** Fade in and out (ms). Reduced motion: a slower fade, never a cut (no flash). */
export const FADE_IN_MS=160,FADE_OUT_MS=320,FADE_REDUCED_MS=500;

/** How dark it is now (0..alpha), from the start and end of the blackout on this client's clock. */
export function blackoutAlpha(now:number,start:number,end:number,reduced:boolean){
  if(!(now>=start)||!(end>start))return 0;
  const max=reduced?BLACKOUT_ALPHA_REDUCED:BLACKOUT_ALPHA,fin=reduced?FADE_REDUCED_MS:FADE_IN_MS,fout=reduced?FADE_REDUCED_MS:FADE_OUT_MS;
  const up=Math.min(1,(now-start)/fin),down=Math.min(1,Math.max(0,(end-now)/fout));
  return max*Math.min(up,down);
}

/** Every critter blinks now and then (once each ~3 s, 120 ms), staggered by its phase; reduced motion: eyes never blink. */
export const BLINK_EVERY_MS=2900,BLINK_MS=120;
export const eyesOpen=(now:number,phase:number,reduced:boolean)=>reduced||((now+phase*BLINK_EVERY_MS)%BLINK_EVERY_MS)>=BLINK_MS;
/**
 * Frame of the imported eyes strip (`olhos-escuro`, art-d item 5) on the same clock as eyesOpen: frame 0 while open;
 * during a blink the other frames play once over BLINK_MS (1..frames-1). One frame or reduced motion: always 0.
 */
export function eyesFrame(now:number,phase:number,reduced:boolean,frames:number):number{
  if(reduced||frames<=1)return 0;
  const t=(now+phase*BLINK_EVERY_MS)%BLINK_EVERY_MS;
  return t>=BLINK_MS?0:1+Math.min(frames-2,Math.floor(Math.max(0,t)/BLINK_MS*(frames-1)));
}

/** One drawn layer for the audit: what it is and its depth (and whether it is shown). */
export interface LayerDepth {name:string;depth:number;visible?:boolean}
/** Layers that must stay above the dark: any below it (or hidden) is a failure. Returns the failures. */
export function auditBlackout(layers:readonly LayerDepth[],dark=BLACKOUT_DEPTH){
  return layers.filter(l=>l.visible!==false&&!(l.depth>dark)).map(l=>`${l.name} (${l.depth}) under the blackout (${dark})`);
}
