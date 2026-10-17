/**
 * Texture keys and display metrics shared by the procedural texture factory and the horde layers.
 * Pure module (no Phaser import) so node tests can read it.
 */
import type {PickupKind} from '../../contract/index.ts';
import {fallbackAccent,fallbackKind} from '../../rules/index.ts';

/**
 * Enemy cast of D-033 (design/arte-v2.md §4): procedural stand-ins until the prerendered art arrives (art/horde-art.ts
 * draws a kind from the imported sheets once the manifest has its piece). Elenco P1 (NEW-20261012-ORQ-elenco-p1): the
 * coach, the motoboy and the influencer, procedural for now like the rest.
 */
export const ENEMY_KINDS=['bebado','anao-molotov','pombos','tio-pave','agiota','chefe','coach','motoboy','influencer'] as const;
export type EnemyKind=typeof ENEMY_KINDS[number];
/** 'item' (D-051): an inventory item on the ground; its sticker when the arsenal art loaded (render/arsenal-fx.ts), else this. */
export const PICKUP_KINDS:readonly PickupKind[]=['xp','heal','magnet','chest','resource','item'];

export const isEnemyKind=(kind:string):kind is EnemyKind=>(ENEMY_KINDS as readonly string[]).includes(kind);
/**
 * The procedural kind drawn for any roster id (D-040): itself for the nine, else its role's base (rules/enemy-cast.ts
 * fallbackKind) until the entry has art; undefined for a string the roster does not know.
 */
export const drawnKind=(kind:string):EnemyKind|undefined=>fallbackKind(kind);
/** Unknown kinds fall back to the bêbado (the basic chaser) so a newer server never crashes an older client. */
export const enemyKind=(kind:string):EnemyKind=>fallbackKind(kind)??'bebado';
/**
 * Tint of a roster entry drawn with its role's fallback texture: its accent mixed halfway with white (a multiply tint, so
 * the stand-in keeps its shading and reads as a different critter). The nine and unknown kinds: undefined (no tint).
 */
export function fallbackTint(kind:string):number|undefined{
  const accent=fallbackAccent(kind);
  if(accent===undefined)return undefined;
  const mix=(shift:number)=>Math.round((((accent>>shift)&255)+255)/2)<<shift;
  return mix(16)|mix(8)|mix(0);
}
/**
 * Kinds with a second pose while they act (EnemyView.phase 1, render/phase-look.ts): the coach's raised whiteboard,
 * the motoboy's lit headlight and the influencer's flex. Their `:act` texture sits next to the idle one.
 */
export const ACTING_KINDS=['coach','motoboy','influencer'] as const satisfies readonly EnemyKind[];
export const hasActingPose=(kind:string)=>(ACTING_KINDS as readonly string[]).includes(kind);
/** Texture key of a kind: elite (never the boss) and, for ACTING_KINDS, the acting pose. */
export const enemyTexture=(kind:string,elite=false,acting=false)=>{
  const k=enemyKind(kind);
  return `horde:enemy:${k}${elite&&k!=='chefe'?':elite':''}${acting&&hasActingPose(k)?':act':''}`;
};
/**
 * enemyTexture per kind, [plain, elite, plain acting, elite acting], built once: the per-frame draw code reads it
 * without building strings. Kinds without an acting pose repeat their plain keys in the acting slots.
 */
export const ENEMY_TEXTURES:Readonly<Record<EnemyKind,readonly [string,string,string,string]>>=Object.freeze(
  Object.fromEntries(ENEMY_KINDS.map(k=>[k,[enemyTexture(k),enemyTexture(k,true),enemyTexture(k,false,true),enemyTexture(k,true,true)]])) as Record<EnemyKind,[string,string,string,string]>);
export const pickupTexture=(kind:string)=>`horde:pickup:${(PICKUP_KINDS as readonly string[]).includes(kind)?kind:'xp'}`;
/** Hostile projectile look by source: the agiota's boleto com juros is a slip; every other hostile shot is the star. */
export const projectileTexture=(hostile:boolean,source?:string)=>!hostile?FX.projFriendly:source==='boleto-juros'?FX.projBoleto:FX.projHostile;
/** What a pickup looks like: its kind's texture, or a boleto for the XP of the boleto rain (resource 'boleto', VGM-053B). */
export const pickupLook=(kind:string,resource?:string)=>kind==='xp'&&resource==='boleto'?FX.boleto:pickupTexture(kind);

export const FX={
  shadow:'horde:fx:shadow',
  puff:'horde:fx:puff',
  star:'horde:fx:star',
  projFriendly:'horde:proj:friendly',
  projHostile:'horde:proj:hostile',
  /** The agiota's boleto com juros (D-033): a paper slip, not the generic hostile star. */
  projBoleto:'horde:proj:boleto-juros',
  warning:'horde:fx:warning',
  bar:'horde:fx:bar',
  barElite:'horde:fx:bar-elite',
  barFill:'horde:fx:bar-fill',
  /** XP of the boleto rain (VGM-053B). */
  boleto:'horde:pickup:boleto',
} as const;

/**
 * Texture size in pixels (generated 1:1 with display size at camera zoom 1) and the feet origin.
 * `hover` lifts flying bodies above their shadow; `bar` is the health-bar offset above the feet.
 */
export interface EnemyArt {width:number;height:number;originY:number;hover:number;bar:number}
export const ENEMY_ART:Record<EnemyKind,EnemyArt>={
  bebado:{width:64,height:62,originY:.92,hover:0,bar:64},
  'anao-molotov':{width:76,height:78,originY:.94,hover:0,bar:80},
  pombos:{width:88,height:68,originY:.9,hover:26,bar:94},
  'tio-pave':{width:84,height:106,originY:.95,hover:0,bar:110},
  agiota:{width:62,height:86,originY:.95,hover:0,bar:90},
  chefe:{width:150,height:178,originY:.95,hover:0,bar:186},
  // Elenco P1: the coach is tall (the raised whiteboard fits above his head), the motoboy wide (the bike).
  coach:{width:84,height:112,originY:.95,hover:0,bar:116},
  motoboy:{width:100,height:88,originY:.93,hover:0,bar:92},
  influencer:{width:84,height:100,originY:.95,hover:0,bar:104},
};
/** Elite variants are the base art with crown and aura, drawn into a texture this much larger. */
export const ELITE_SCALE=1.35;
export const PICKUP_SIZE:Record<PickupKind,{width:number;height:number}>={
  xp:{width:22,height:28},heal:{width:34,height:30},magnet:{width:32,height:32},chest:{width:46,height:40},resource:{width:30,height:28},item:{width:34,height:34},
};
