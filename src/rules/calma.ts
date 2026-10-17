/**
 * D-051 mode 'ninhos' without rounds (card NEW-20261014-ORQ-ninhos-rounds-fora; claims/NEW-20261014-ORQ-mapa-vivo-
 * ninhos/proposta.md §6): the living map has no intermission, so what waited for one waits for calm instead. Calm is
 * per hero: no critter awake within a radius (the sleepers do not count; the boss does). Pure, shared by the sim (the
 * forge, the towers' orders, the bots, the room's checkpoint) and the client (the HUD unlocks the same things).
 * - forgeR: the forge and the towers' orders (build, upgrade, repair) open for a hero with no critter awake this close;
 * - botR: a bot is "calmo" (its old intermission: gather, forge, towers) with none this close;
 * - checkpointR, checkpointEveryS: the room checkpoints every checkpointEveryS while no standing hero has a critter
 *   awake this close and there is no boss, and right after a nest falls;
 * - refillS: the gather nodes refill on this clock (no intermission to refill them);
 * - zueira: the first event never before zueiraFirstS, then one every zueiraEveryS (drawn), at most zueiraMax, never
 *   with the boss;
 * - bossEnrageS: the boss enrages this long after it arrives (round 10's clock of the rounds mode).
 */
export const CALMA=Object.freeze({
  forgeR:12,botR:15,checkpointR:20,checkpointEveryS:90,
  refillS:60,
  zueiraFirstS:60,zueiraEveryS:Object.freeze([100,140] as const),zueiraMax:4,
  bossEnrageS:90,
});

/** A critter as the rule reads it (sim EnemyState: never asleep there; client EnemyView: `asleep` on a sleeper). */
export interface CalmEnemy {x:number;y:number;hp:number;asleep?:boolean}
/** No critter alive and awake within `r` of `at` (r inclusive). */
export function calmAround(enemies:Iterable<CalmEnemy>,at:{x:number;y:number},r:number):boolean{
  const r2=r*r;
  for(const e of enemies)if(e.hp>0&&!e.asleep&&(e.x-at.x)**2+(e.y-at.y)**2<=r2)return false;
  return true;
}
