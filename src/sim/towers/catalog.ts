/** The defense tree now lives in the rules port (src/rules/towers.ts, torres-hud) so the client can read it; re-exported here unchanged. */
export {
  DEFENSE_PHASES,TIER_COST,GUSTAVAO_COST,TIER_BUILD_SECONDS,RAIL,DEFENSE_LIMIT,GUSTAVAO_LIMIT,DAMAGED_AT,DEFENSES,DEFENSE_IDS,ROOT_DEFENSE,
  isDefenseId,childrenOf,pickChild,phaseOf,unitsOf,payUnits,
  type DefenseId,type Branch,type Hits,type TargetMode,type DefensePhase,type DefenseDef,type DefenseSize,
} from '../../rules/index.ts';
