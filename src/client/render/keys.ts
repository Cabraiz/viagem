/**
 * Texture keys and display metrics shared by the procedural texture factory and the horde layers.
 * Pure module (no Phaser import) so node tests can read it.
 */
import type {PickupKind} from '../../contract/index.ts';

/** Enemy cast of D-033 (design/arte-v2.md §4): procedural stand-ins until the prerendered art arrives. */
export const ENEMY_KINDS=['bebado','anao-molotov','pombos','tio-pave','agiota','chefe'] as const;
export type EnemyKind=typeof ENEMY_KINDS[number];
export const PICKUP_KINDS:readonly PickupKind[]=['xp','heal','magnet','chest','resource'];

export const isEnemyKind=(kind:string):kind is EnemyKind=>(ENEMY_KINDS as readonly string[]).includes(kind);
/** Unknown kinds fall back to the bêbado (the basic chaser) so a newer server never crashes an older client. */
export const enemyKind=(kind:string):EnemyKind=>isEnemyKind(kind)?kind:'bebado';
export const enemyTexture=(kind:string,elite=false)=>`horde:enemy:${enemyKind(kind)}${elite&&kind!=='chefe'?':elite':''}`;
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
};
/** Elite variants are the base art with crown and aura, drawn into a texture this much larger. */
export const ELITE_SCALE=1.35;
export const PICKUP_SIZE:Record<PickupKind,{width:number;height:number}>={
  xp:{width:22,height:28},heal:{width:34,height:30},magnet:{width:32,height:32},chest:{width:46,height:40},resource:{width:30,height:28},
};
