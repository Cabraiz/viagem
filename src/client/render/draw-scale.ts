/**
 * Draw-only size factors of the figures (NEW-20261013-ORQ-heroi-menor-inimigos-maiores): the heroes (the local one and
 * the allies) draw 20% smaller and every enemy (elites and the boss too) 15% bigger. Only the drawing: the zoom keeps the
 * reference hero (HERO_WORLD_PX, D-046), the follow camera centres the drawn (smaller) body (camera-centro-heroi), and
 * hitboxes, speeds and ranges (sim, rules) do not change.
 * Pure module (no Phaser) so node tests can read it.
 */

/** Heroes' drawn size against the 96 world px reference figure (sprites/character-sprites.ts): ×0.8. */
export const HERO_DRAW_SCALE=.8;
/** Enemies' drawn size against today's (render/keys.ts ENEMY_ART, art/horde-art.ts ROLE_HEIGHT): ×1.15. */
export const ENEMY_DRAW_SCALE=1.15;

