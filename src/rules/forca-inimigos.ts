/**
 * NEW-20261031-ORQ-inimigos-3x-fortes-metade-da-horda (the user, 31/10: "pode deixar cada inimigo 3x mais forte, mas
 * reduzir o tanto de inimigo que vem atacar (não reduzir os que estão pelo mapa) mas os que vem em orda redução de 2"):
 *  - ENEMY_HP: × every enemy's max hp at birth (enemies/catalog.ts createEnemy): every kind, the map's sleepers, the
 *    elites and the bosses, on top of every other scale (round, room size, nest crowd);
 *  - ENEMY_DAMAGE: × every hit a hero takes (core.ts damagePlayer: contact, hostile projectiles, telegraphs, D-001),
 *    before armor, and every hit on a structure (ORQ 31/10): the Uno's hit units (chaveiro hitCar, the boss's siege
 *    too), the wall's siege (stonewards/wall.ts) and the enemy-ai's hitStructure (stonewards hit: wall, barricades,
 *    pieces, towers);
 *  - the boss (boss.ts, born outside createEnemy) gets ENEMY_HP over its bossMaxHp too;
 *  - halfHorde: the bodies a horde brings (rules/waves.ts planRound: the round's regular count, its groups and swarms;
 *    ninhos.ts sendWave: the map's recruits, the nest-born and the outside group) × HORDE_SHARE, rounded up, at least 1
 *    when there was any. The map's sleepers (the plan's bodies) do not change in number.
 *  XP and grana a body pays do not change.
 * The power climbs over the first rounds so a novice still reaches the plaza (ORQ 31/10, 07:42Z): hp ×1 in round 1 (and
 * before it), ×2 in round 2, ×ENEMY_POWER from round 3 on; damage ×1.5 in round 1, ×2 in round 2, ×ENEMY_POWER from
 * round 3 on. Why hp ×1 in round 1: the tutorial's critters (TUTORIAL_PLAN.hpScale) fall to one shot of the starting
 * weapon, and any hp over ×1 (×1.2 measured) makes it two, so they stay on the novice: 3 → 17-19 hits, 4 of 5 novices
 * fell (city-tutorial ACCEPTANCE). Why damage ×1.5: ×2 kept the lone novices (5 of 5) but felled one of the three of
 * seed 11 (city-tutorial ACCEPTANCE); ×1.5 keeps all (lowest hp 25). Hp takes the round the body is born in; a hit, the
 * round it lands in. The horde's half holds from round 1.
 */
export const ENEMY_POWER=3;
/** Hp at birth and damage per hit by round: RAMP[round-1], the last entry from then on. */
export const ENEMY_HP_RAMP=[1,2,ENEMY_POWER] as const,ENEMY_DAMAGE_RAMP=[1.5,2,ENEMY_POWER] as const;
const onRamp=(ramp:readonly number[])=>(round:number)=>ramp[Math.min(ramp.length,Math.max(1,Math.floor(round)||1))-1];
export const ENEMY_HP=onRamp(ENEMY_HP_RAMP),ENEMY_DAMAGE=onRamp(ENEMY_DAMAGE_RAMP);
export const HORDE_SHARE=.5;
/** A horde's count after the cut: ceil(n × HORDE_SHARE), at least 1 when n ≥ 1; none stays none. */
export const halfHorde=(n:number)=>n>0?Math.max(1,Math.ceil(n*HORDE_SHARE)):0;
