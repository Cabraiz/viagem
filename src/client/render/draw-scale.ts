/**
 * Draw-only size factors of the figures. Only the drawing: the zoom keeps the reference hero (HERO_WORLD_PX, D-046), the
 * follow camera centres the drawn body (camera-centro-heroi), and hitboxes, speeds and ranges (sim, rules) do not change.
 * - NEW-20261013-ORQ-heroi-menor-inimigos-maiores: heroes ×0.8, enemies ×1.15.
 * - NEW-20261028-ORQ-escala-heroi-uno-inimigo (auditoria-arte-mundo items 1 and 2): one ruler. The hero stood ~0.47 of
 *   the Uno's roof (~0.7 m beside a 1.45 m car); now ≈ 0.9 of it. The enemies' heights (art/horde-art.ts ROLE_HEIGHT,
 *   DEFAULT_HEIGHT) are in heroes, so they share the hero's factor: a common human 0.9 hero, an elite 0.9 × ELITE_SCALE
 *   ≈ 1.2, the chefão kept at his approved size (WAVE_BOSS_KEEP).
 * Pure module (no Phaser) so node tests can read it.
 */

/** Heroes' drawn size against the 96 world px reference figure (sprites/character-sprites.ts): ×1.5. */
export const HERO_DRAW_SCALE=1.5;
/** Enemies' drawn size against the reference figure's ruler (render/keys.ts ENEMY_ART, art/horde-art.ts ROLE_HEIGHT): the hero's. */
export const ENEMY_DRAW_SCALE=HERO_DRAW_SCALE;
/**
 * The chefão (rules WAVE_BOSS) keeps the size the user approved on 24/10 ("Ponha 3x pelo meme", drawn at the old
 * ENEMY_DRAW_SCALE 1.15): his scale × this, so the bigger ruler does not grow him too.
 */
export const WAVE_BOSS_KEEP=1.15/ENEMY_DRAW_SCALE;
