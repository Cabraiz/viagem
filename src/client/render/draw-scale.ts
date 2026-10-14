/**
 * Draw-only size factors of the figures (NEW-20261013-ORQ-heroi-menor-inimigos-maiores): the heroes (the local one and
 * the allies) draw 20% smaller and every enemy (elites and the boss too) 15% bigger. Only the drawing: the camera keeps
 * framing the reference hero (framing.ts HERO_WORLD_PX, D-046), and hitboxes, speeds and ranges (sim, rules) do not change.
 * Pure module (no Phaser) so node tests can read it.
 */

/** Heroes' drawn size against the 96 world px reference figure (sprites/character-sprites.ts): ×0.8. */
export const HERO_DRAW_SCALE=.8;
/** Enemies' drawn size against today's (render/keys.ts ENEMY_ART, art/horde-art.ts ROLE_HEIGHT): ×1.15. */
export const ENEMY_DRAW_SCALE=1.15;

/**
 * The hero's box as the camera frames it: the drawn box over HERO_DRAW_SCALE, so the follow camera (framing.ts
 * anchorOf, lookLimit) puts the feet where it did before the hero shrank.
 */
export function framedHeroSize(drawn:{width:number;height:number}):{width:number;height:number}{
  return {width:drawn.width/HERO_DRAW_SCALE,height:drawn.height/HERO_DRAW_SCALE};
}
