/**
 * Texture keys and display metrics shared by the procedural texture factory and the horde layers.
 * Pure module (no Phaser import) so node tests can read it.
 */
import type {PickupKind} from '../sim/types.ts';

export const ENEMY_KINDS=['gosma','pernilongo','tio-pave','fiscal','chefe'] as const;
export type EnemyKind=typeof ENEMY_KINDS[number];
export const PICKUP_KINDS:readonly PickupKind[]=['xp','heal','magnet','chest','resource'];

export const isEnemyKind=(kind:string):kind is EnemyKind=>(ENEMY_KINDS as readonly string[]).includes(kind);
/** Unknown kinds fall back to gosma so a newer server never crashes an older client. */
export const enemyKind=(kind:string):EnemyKind=>isEnemyKind(kind)?kind:'gosma';
export const enemyTexture=(kind:string,elite=false)=>`horde:enemy:${enemyKind(kind)}${elite&&kind!=='chefe'?':elite':''}`;
export const pickupTexture=(kind:string)=>`horde:pickup:${(PICKUP_KINDS as readonly string[]).includes(kind)?kind:'xp'}`;

export const FX={
  shadow:'horde:fx:shadow',
  puff:'horde:fx:puff',
  star:'horde:fx:star',
  projFriendly:'horde:proj:friendly',
  projHostile:'horde:proj:hostile',
  warning:'horde:fx:warning',
  bar:'horde:fx:bar',
  barElite:'horde:fx:bar-elite',
  barFill:'horde:fx:bar-fill',
} as const;

/**
 * Texture size in pixels (generated 1:1 with display size at camera zoom 1) and the feet origin.
 * `hover` lifts flying bodies above their shadow; `bar` is the health-bar offset above the feet.
 */
export interface EnemyArt {width:number;height:number;originY:number;hover:number;bar:number}
export const ENEMY_ART:Record<EnemyKind,EnemyArt>={
  gosma:{width:64,height:56,originY:.92,hover:0,bar:58},
  pernilongo:{width:64,height:52,originY:.9,hover:26,bar:84},
  'tio-pave':{width:72,height:92,originY:.95,hover:0,bar:96},
  fiscal:{width:62,height:86,originY:.95,hover:0,bar:90},
  chefe:{width:150,height:178,originY:.95,hover:0,bar:186},
};
/** Elite variants are the base art with crown and aura, drawn into a texture this much larger. */
export const ELITE_SCALE=1.35;
export const PICKUP_SIZE:Record<PickupKind,{width:number;height:number}>={
  xp:{width:22,height:28},heal:{width:34,height:30},magnet:{width:32,height:32},chest:{width:46,height:40},resource:{width:30,height:28},
};
