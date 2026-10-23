/**
 * Fatia A2 of NEW-20261022-ORQ-arsenal-completo-no-bau (E7): how the bola-murcha, the panela-de-pressao and the
 * carro-de-som look on screen, merged by render/arsenal-rules.ts into the arsenal's tables.
 */
import type {FireLook} from './arsenal-rules.ts';

/** The items whose sticker the arsenal loads (render/arsenal-rules.ts ARSENAL_ITEMS). */
export const A2_ITEMS:readonly string[]=['bola-murcha','panela-de-pressao','carro-de-som'];
/**
 * The 'fire' event's look of each A2 weapon (render/arsenal-rules.ts FIRE_LOOK). The pot's 'fire' is its burst
 * (sim/weapons/mine.ts: at the pot, dx = dy = 0), so a blast the size of its 2.2 u area; the ball and the car's waves
 * are their own projectiles, no flash.
 */
export const A2_FIRE_LOOK:Readonly<Record<string,FireLook>>={
  'panela-de-pressao':{art:'explosao-m',kind:'blast',size:190,ms:620},
};
/**
 * Projectile source → `ui` sticker it wears instead of a `projeteis` piece (render/arsenal-rules.ts projectileSticker:
 * the carro-de-som on the ground). The sticker must be one ARSENAL_ITEMS loads (an item's icon).
 */
export const A2_PROJECTILE_STICKER:Readonly<Record<string,string>>={'carro-de-som':'carro-de-som'};
/**
 * Weapon id → `projeteis` piece its projectiles wear (art/horde-art.ts PROJECTILE_ALIAS), and those pieces to load.
 * The car on the ground keeps the weapon id; its shots (sim/weapons/turret.ts TURRET_SHOT) are the sound wave.
 */
export const A2_PROJECTILE_ALIAS:readonly (readonly [string,string])[]=[
  ['bola-murcha','bola-murcha'],['panela-de-pressao','panela-de-pressao'],['carro-de-som','carro-de-som'],
  ['carro-de-som-onda','carro-de-som'],
];
