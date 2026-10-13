/** Port of the simulation sector: the server's core and systems, as the rooms (multiplayer/) use them. */
export * from './assemble.ts';
export * from './bot-brain.ts';
export * from './context.ts';
export * from './core.ts';
export * from './director.ts';
export * from './enemies/catalog.ts';
export * from './player-effects.ts';
export * from './progression.ts';
export * from './revive.ts';
export * from './run.ts';
export * from './shame.ts';
export * from './skills.ts';
/** spatial.ts has its own NaiveIndex (the reference one for benches and tests); core.ts's is the default index. */
export {SpatialHash,DEFAULT_CELL_SIZE} from './spatial.ts';
export * from './stonewards/forge.ts';
export * from './stonewards/resources.ts';
// torres-fio: what the rooms put on the wire and validate (the defenses' ids, phases and results).
export {DEFENSES,DEFENSE_PHASES,RAIL,isDefenseId,phaseOf,type DefenseId,type DefensePhase,type Branch} from './towers/catalog.ts';
export type {DefenseState,TowerResult,TowerRefusal} from './towers/system.ts';
export * from './systems/players.ts';
export * from './telegraphs.ts';
export * from './zueira.ts';
