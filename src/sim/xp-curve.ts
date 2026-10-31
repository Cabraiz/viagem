/** The team's XP curve (progression.ts re-exports it; kept apart for the 400-line limit, tests/tools/limites-codigo). */
/**
 * XP needed to go from `level` to `level + 1`: 5, 13, 26, 46, then ×1.58 per level until 10 and ×1.05 after.
 * xp-exponencial-3x (31/10, "muito rápido subir de level, era para ser exponencial"): cheap start, dear end. Levels 1-4
 * cost ~1.3× the old linear curve (4, 10, 20, then 5+10×(level−1), +13, +16): at 1.5× the city room of three bots lost
 * its wall in round 3. From level 8 each costs ≥3× the old. Totals: 90 XP to level 5, 1199 to 10, 10199 to 20 (were 69,
 * 394, 1794).
 * The exponent stops at XP_CURVE_CAP so the cost stays a finite integer however far a run goes.
 */
const FIRST_LEVELS=[5,13,26,46];
export const XP_GROWTH=1.58,XP_GROWTH_LATE=1.05;
const XP_STEEP_UNTIL=10,XP_CURVE_CAP=200;
export function xpToNext(level:number){
  const l=Math.min(XP_CURVE_CAP,Math.max(1,Math.floor(level))),n=FIRST_LEVELS.length,base=FIRST_LEVELS[n-1]!;
  if(l<=n)return FIRST_LEVELS[l-1]!;
  if(l<=XP_STEEP_UNTIL)return Math.round(base*XP_GROWTH**(l-n));
  return Math.round(base*XP_GROWTH**(XP_STEEP_UNTIL-n)*XP_GROWTH_LATE**(l-XP_STEEP_UNTIL));
}
