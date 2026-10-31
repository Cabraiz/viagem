/**
 * Round director (VGM-033): wave -> round-end -> intermission ('prepare') -> next wave, for ROUND_COUNT rounds.
 * Owns ctx.round. Enemy creation, the boss and offers come from other cards through injected callbacks,
 * so this module only depends on the shared contract, terrain and collision helpers.
 *
 * Where enemies appear depends on the world (spawn-em-volta):
 * - island: on the coastal band (coastalSpawnPoints), unchanged since VGM-033; timed-out hordes walk into the sea.
 * - endless: VS-style, on a ring just off the screen of an active player (offscreen.ts), each group going to the
 *   player with the fewest enemies around, so spread players each get a horde. Enemies that end up farther than
 *   RECYCLE_DISTANCE from every player are moved back onto a ring (same id and hp: no kill, no xp). Siege groups
 *   come from off screen around the base, on their way to it. Timed-out hordes flee off screen.
 * - city (cidade-05, with options.avenues): at the avenue tips through the AvenuePlanner (city/avenues.ts). The round is
 *   planned once at its start for the warning ticks; each group is planned again just in time at its warning, at
 *   exact hidden points (no jitter), and arrives at the plaza on the plan's cadence (first ≈ 12 s; a part that cannot be
 *   released early enough runs in off the default-zoom screens, CITY_RUN_IN_SPEED). The round's timer
 *   covers the slowest member's walk (CITY_ARRIVAL_SLACK). With the team away from the base (options.cityChase,
 *   cidade-05c) the mouths and spots are aimed at the team instead of the plaza. The boss lands in the plaza itself (D-026). Timed-out
 *   hordes walk back up the avenues (exit flow field) and vanish out of everyone's sight, at the avenue end or far
 *   from the plaza. With options.cityTutorial (cidade-08, city/tutorial.ts) round 1 is the walk from the crashed
 *   helicopter to the plaza: a few slow bêbados behind the team and at the plaza, held until a hero reached it.
 */
export {type CreateEnemy,type SpawnBoss,type RoundSummary,type DirectorOptions,EXTRA_WAVE_COUNT,type DirectorState,type Director,RECYCLE_EVERY,SPAWN_CLEARANCE,MEMBER_CLEARANCE,SPAWN_MARGIN,FLEE_CAP_SECONDS,CATCH_UP_SPEED,LAST_CALL_SECONDS,lastCallBoost,CITY_EXIT_REACH,CITY_ARRIVAL_SLACK,CITY_RUN_IN_SPEED,activePlayers,coastalSpawnPoints,createDirector,RECYCLE_PER_STEP,LAST_CALL_NEAR,LAST_CALL_PACE,CITY_GONE_DISTANCE} from './director/index.ts';
