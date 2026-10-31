/**
 * NEW-20261031-ORQ-inimigos-3x-fortes-metade-da-horda (the user, 31/10: "pode deixar cada inimigo 3x mais forte, mas
 * reduzir o tanto de inimigo que vem atacar (não reduzir os que estão pelo mapa) mas os que vem em orda redução de 2"):
 *  - ENEMY_HP: × every enemy's max hp at birth (enemies/catalog.ts createEnemy): every kind, the map's sleepers, the
 *    elites and the bosses, on top of every other scale (round, room size, nest crowd);
 *  - ENEMY_DAMAGE: × every hit a hero takes (core.ts damagePlayer: contact, hostile projectiles, telegraphs, D-001),
 *    before armor. The Uno, the walls and the towers take the old damage;
 *  - halfHorde: the bodies a horde brings (rules/waves.ts planRound: the round's regular count, its groups and swarms;
 *    ninhos.ts sendWave: the map's recruits, the nest-born and the outside group) × HORDE_SHARE, rounded up, at least 1
 *    when there was any. The map's sleepers (the plan's bodies) do not change in number.
 *  XP and grana a body pays do not change.
 */
export const ENEMY_POWER=3;
export const ENEMY_HP=ENEMY_POWER,ENEMY_DAMAGE=ENEMY_POWER;
export const HORDE_SHARE=.5;
/** A horde's count after the cut: ceil(n × HORDE_SHARE), at least 1 when n ≥ 1; none stays none. */
export const halfHorde=(n:number)=>n>0?Math.max(1,Math.ceil(n*HORDE_SHARE)):0;
