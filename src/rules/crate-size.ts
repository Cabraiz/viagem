/**
 * NEW-20261022-ORQ-coleta-3x (user, 22/10: "a caixa de pegar itens tem que ser 3x maior ... o size dele ser 3x maior
 * mesmo"): the D-051 crate (sim/crates.ts, art `caixa-saque`) is CRATE_SCALE times its old size, one value for all of
 * it: the sheet, its rarity ring and shadow (render/arsenal-fx.ts, render/layers.ts), its body on the ground (no tower
 * on it, sim/towers/system.ts) and the reach to open it, which follows the new edge (touch the crate and it opens).
 * The city's gather crates (sim/stonewards/loot.ts CRATE_RADIUS) are another thing and keep their size.
 */
export const CRATE_SCALE=3;
/** The crate's disc on the ground (world units): its rarity ring (58 px wide at body 1, was .5 u). */
export const CRATE_BODY_RADIUS=.5*CRATE_SCALE;
/** A standing hero this far past the crate's edge opens it (the old reach 1 u = .5 body + .5). */
export const CRATE_OPEN_MARGIN=.5;
export const CRATE_OPEN_RADIUS=CRATE_BODY_RADIUS+CRATE_OPEN_MARGIN;
