/**
 * Fatia A2 of NEW-20261022-ORQ-arsenal-completo-no-bau (E7): how the bola-murcha, the panela-de-pressao and the
 * carro-de-som look on screen, merged by render/arsenal-rules.ts into the arsenal's tables. Empty until their sim lands.
 */
import type {FireLook} from './arsenal-rules.ts';

/** The items whose sticker the arsenal loads (render/arsenal-rules.ts ARSENAL_ITEMS). */
export const A2_ITEMS:readonly string[]=[];
/** The 'fire' event's look of each A2 weapon (render/arsenal-rules.ts FIRE_LOOK). */
export const A2_FIRE_LOOK:Readonly<Record<string,FireLook>>={};
/**
 * Projectile source → `ui` sticker it wears instead of a `projeteis` piece (render/arsenal-rules.ts projectileSticker:
 * the carro-de-som on the ground). The sticker must be one ARSENAL_ITEMS loads (an item's icon).
 */
export const A2_PROJECTILE_STICKER:Readonly<Record<string,string>>={};
/** Weapon id → `projeteis` piece its projectiles wear (art/horde-art.ts PROJECTILE_ALIAS), and those pieces to load. */
export const A2_PROJECTILE_ALIAS:readonly (readonly [string,string])[]=[];
