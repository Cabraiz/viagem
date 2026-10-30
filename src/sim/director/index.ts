/** The round director (src/sim/director.ts has its module doc): createDirector and what other modules use. */
export {type CreateEnemy,type SpawnBoss,type RoundSummary,type DirectorOptions,type DirectorState,type Director} from './types.ts';
export {EXTRA_WAVE_COUNT,RECYCLE_EVERY,SPAWN_CLEARANCE,MEMBER_CLEARANCE,SPAWN_MARGIN,FLEE_CAP_SECONDS,CATCH_UP_SPEED,LAST_CALL_SECONDS,lastCallBoost,CITY_EXIT_REACH,CITY_ARRIVAL_SLACK,CITY_RUN_IN_SPEED,RECYCLE_PER_STEP,LAST_CALL_NEAR,LAST_CALL_PACE,CITY_GONE_DISTANCE} from './tuning.ts';
export {activePlayers,coastalSpawnPoints} from './spawn-points.ts';
export {createDirector} from './create.ts';
