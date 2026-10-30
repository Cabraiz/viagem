/** The defenses renderer's numbers (moved from towers.ts, corte C2): pools, effect looks and sizes, baked frame names. */
import {MATERIALS} from '../city/palette.ts';

export const SHOT_POOL=192,FLASH_POOL=48,BLAST_POOL=64,CRATER_POOL=40;
/** The muzzle smoke of the heavy calibres: its radius and life against the flash's, its grey. */
export const SMOKE_R=1.1,SMOKE_MS=6,SMOKE_TINT=0x9aa0a6;
/** The radar's pulse ring (the wire's spark ring, tinted). */
export const PULSE_TINT=0x6ec6ff;
/**
 * The painted effects (NEW-20261029-ORQ-fx-torres-arte, scripts/import-torres-fx.mjs: ChatGPT art, one frame per effect
 * cell of the atlas, same name and size): loaded once, painted over the procedural bake, which stays only while it loads.
 */
export const FX_ART_KEY='torres:fx-arte',FX_ART_URL='/art/fx/torres-fx';
export interface FxArtFrames {frames:Record<string,{x:number;y:number;w:number;h:number}>}
/**
 * Explosions by calibre (torres-polimento): from BIG_BLAST u (the obus, the Gustavão) the fireball wears a smoke cap and
 * a shock ring runs over the snow (SHOCK_R × its radius in SHOCK_MS × its life); from SMOKY_BLAST u the smoke rises
 * after it for BLAST_SMOKE × its life (× 1.5 the big ones).
 */
export const BIG_BLAST=2.4,SMOKY_BLAST=1.2,SHOCK_R=1.5,SHOCK_MS=.55,BLAST_SMOKE=2;
/** Shots per volley drawn at most (a 6-shot volley reads as a burst, not 6 parallel lines). */
export const BURST_MAX=4,BURST_GAP_MS=45;
export const RECOIL_MS=90;
/** Two or three volleys of one snapshot (the room's counter jumped) are drawn this far apart, not at once. */
export const VOLLEY_STAGGER_MS=70;
/** Crater decals: a small frame, and a large one for the big shells and the Gustavão (no blur when scaled up). */
export const CRATER_FRAME='cratera',CRATER_TEX=128,CRATER_BIG='cratera-g',CRATER_BIG_TEX=512,CRATER_BIG_FROM=1;
/** Effects sort just above the actors standing at their point (a pickup is +1, a projectile +2 in layers.ts). */
export const FX_DEPTH={shot:2,blast:3,flash:.002,beam:.0015} as const;
/** A weapon with a target re-scans the horde for a nearer one this often (ms); it re-scans at once when it loses it. */
export const RESCAN_MS=250;
/** Baked effect textures: drawn once (bakeEffects), then placed, scaled, turned and faded per frame. */
export const FX={flash:'fx:flash',flashLong:'fx:clarao-longo',blast:'fx:blast',blastBig:'fx:explosao-g',spark:'fx:faisca',ring:'fx:anel',
  tracer:'fx:tracante',tracerBranco:'fx:tracante-branco',tracerVermelho:'fx:tracante-vermelho',smoke:'fx:fumaca',
  headPapel:'fx:ponta-papel',headShell:'fx:ponta-granada',headRocket:'fx:ponta-foguete',puff:'fx:baforada',
  cone:'fx:cone',spot:'fx:foco'} as const;
export const FLASH_TEX=64,FLASH_LONG_W=96,FLASH_LONG_H=40,SPARK_TEX=32,BLAST_R=48,BLAST_W=104,BLAST_H=60,BLAST_GROUND=44,BLAST_BIG_H=80,BLAST_BIG_GROUND=64,RING_W=256,RING_H=132,STREAK_W=64,STREAK_H=12,STREAK_LINE=8,HEAD_TEX=32,CONE_W=128,CONE_H=64,SPOT_W=64,SPOT_H=32;
/** The weapon's pivot stands this high over the roof (CSS px × actor scale), on a drum. */
export const POST_PX=10;

export const pool=<T>(n:number,make:()=>T):T[]=>Array.from({length:n},make);
export const BRANCH_MATERIAL={T:MATERIALS.pedra,A:MATERIALS.pedra,B:MATERIALS['metal-ferrugem'],C:MATERIALS['metal-pintado']} as const;
