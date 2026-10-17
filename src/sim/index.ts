/** Port of the simulation sector: the server's core and systems, as the rooms (multiplayer/) use them. */
export * from './assemble.ts';
export * from './bot-brain.ts';
// D-047: the chaveiro objective (state, numbers, system) and its route.
export * from './chaveiro/system.ts';
export {buildRoute,pointAt,type Route} from './chaveiro/route.ts';
// Bancos (card bancos-e-veiculos): the city's ATMs (placement, state, system) and the Cliente Prime flag.
export * from './bancos/system.ts';
export {baitEnemy} from './enemies/ai.ts';
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
// torres-ajustes: the reach rule and the repair price (rooms and tools may read them).
export {BUILD_REACH,TOWER_REPAIR_COST} from './towers/system.ts';
// D-052 free build: the order the rooms parse and the wall pieces they put on the wire.
export {FREE_CELL,MURO_BLOCK_R,type FreeOrder,type PieceState} from './towers/free-build.ts';
export * from './systems/players.ts';
export * from './telegraphs.ts';
export * from './zueira.ts';
export * from './wallet.ts';
// E5-checkpoint-por-round: the item catalog, so a room validates a checkpoint's builds.
export {ITEMS} from './items.ts';
export type {InventoryResult,InventoryRefusal} from './inventory.ts';
export {cityRunStart,START_SLOT_SPREAD} from './city/tutorial.ts';
