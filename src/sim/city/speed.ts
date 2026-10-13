/**
 * City speeds (cidade-05c): the catalog and the boss are authored for the endless map ('infinito', hero 3.1 u/s); the
 * city ('cidade-nevada', hero ≈1.99 u/s) needs them converted, generically by profile (the cast keeps changing, so
 * no per-kind table).
 *
 * Why not rules/scale `convertSpeed`: it keeps each speed's fraction of the hero, so the common enemy stays at
 * 1.4/3.1 ≈ 0.45 × the hero (≈0.90 u/s in the city), the opposite of D-026, where the city's common zombie walks at
 * 0.9 × the hero (≈1.79 u/s). The endless map is a kiting game (enemies far slower than the hero), the city a
 * survival one (enemies almost as fast). So `citySpeed` maps the hero fraction r = speed / from.hero.speed with a
 * monotone piecewise-linear map that sends the common enemy's fraction of `from` to the common enemy's fraction of
 * `to` and keeps the hero itself fixed:
 *  - r ≤ rc_from → r · rc_to / rc_from (slow kinds keep their ratio to the common enemy: tio-pavê 0.95 → ≈1.21);
 *  - rc_from < r ≤ 1 → rc_to + (r − rc_from) · (1 − rc_to) / (1 − rc_from) (fast kinds squeeze between the common
 *    enemy and the hero: pombos 2.7 → ≈1.95, boss 1.6 → ≈1.81);
 *  - r > 1 → r (faster than the hero stays that much faster);
 * with rc = profile.enemySpeedRatio; the city speed is map(r) · to.hero.speed. bêbado (the common enemy) 1.4 → ≈1.79.
 */
import {SCALE_PROFILES,type ScaleProfile} from '../../rules/index.ts';

/** Speed (u/s) authored for `from` (default the endless map) as the city (default 'cidade-nevada') should run it. */
export function citySpeed(speed:number,from:Readonly<ScaleProfile>=SCALE_PROFILES.infinito,to:Readonly<ScaleProfile>=SCALE_PROFILES['cidade-nevada']):number{
  if(!Number.isFinite(speed)||speed<=0)return speed;
  const r=speed/from.hero.speed, a=from.enemySpeedRatio, b=to.enemySpeedRatio;
  const mapped=r<=a?r*b/a:r<=1?b+(r-a)*(1-b)/(1-a):r;
  return mapped*to.hero.speed;
}
