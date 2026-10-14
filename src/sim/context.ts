/**
 * The server's view of a run tick (VGM-030): what every system steps over. It holds the live terrain, so it lives in
 * the simulation sector, not in the contract (src/contract/types.ts has the state it carries).
 * Change it only through the integration card (VGM-030) or with orchestrator approval.
 */
import type {TerrainField} from '../maps/index.ts';
import type {EnemyState,LevelOffer,PickupState,ProjectileState,RoundState,SimEvent,SimPlayer,SpatialIndex,TeamProgress,Telegraph} from '../contract/index.ts';
import type {Rng} from '../contract/index.ts';

// ---------- Context and systems ----------
export interface SimContext {
  readonly tick:number;
  /** Tick when the current combat started (D-005: chests before 2:00 do not evolve). */
  readonly runStartTick:number;
  readonly terrain:TerrainField;
  /**
   * Re-derived every tick from the run seed and tick. Fork inside step (ctx.rng.fork('<id>')) for per-system streams;
   * do not keep a forked stream across ticks, because private state is outside the replay hash and survives rematches.
   */
  readonly rng:Rng;
  /** Includes offline/spectators; systems must skip them as appropriate. */
  readonly players:ReadonlyMap<string,SimPlayer>;
  readonly enemies:Map<string,EnemyState>;
  readonly pickups:Map<string,PickupState>;
  readonly projectiles:Map<string,ProjectileState>;
  readonly telegraphs:Map<string,Telegraph>;
  readonly team:TeamProgress;
  readonly offers:Map<string,LevelOffer[]>;
  readonly round:RoundState;
  readonly enemyIndex:SpatialIndex<EnemyState>;
  /**
   * D-051 (ninhos/sono.ts): the bodies asleep on the map, out of ctx.enemies and the enemyIndex. Absent outside the
   * ninhos mode. Hits look here too (sim/spatial.ts queryHittable, projectiles isAlive): damageEnemy wakes the body
   * and its band first. Auto-aim and the AI never look here.
   */
  readonly sleepers?:Sleepers;
  /** Deterministic, monotonic ids: prefix + counter. */
  nextId(prefix:string):string;
  emit(event:SimEvent):void;
  /**
   * Only path to hurt enemies: multiplies by the source player's stats.might (D-001), emits damage/kill and removes the
   * enemy once; drops (XP, chest) run in the integration's onKill hook, exactly once. Returns true if it killed.
   */
  damageEnemy(enemyId:string,amount:number,sourcePlayer?:string,weapon?:string):boolean;
  /** Only path to hurt players: armor, invulnerability; at 0 hp the integration's onPlayerZero hook downs the player (VGM-037). */
  damagePlayer(playerId:string,amount:number,source?:string):void;
}

/**
 * The sleepers' index (D-051, ninhos/sono.ts): only bodies still asleep, by id or by place. wake() moves the body and
 * its band into ctx.enemies (same ids and objects) and returns the body; undefined if it was not asleep.
 */
export interface Sleepers extends SpatialIndex<EnemyState> {
  readonly size:number;
  has(id:string):boolean;
  get(id:string):EnemyState|undefined;
  wake(ctx:SimContext,id:string,cause:'dano'):EnemyState|undefined;
  /** A hit target (E1's nests, ninhos/sono.ts HitTarget), not a body: damageEnemy calls strike() instead of wake(). */
  isTarget(id:string):boolean;
  /** Lands `amount` (the might already applied) on target `id`; true when it fell. */
  strike(ctx:SimContext,id:string,amount:number,source?:string,weapon?:string):boolean;
}

export interface SimSystem {
  readonly id:string;
  step(ctx:SimContext):void;
}
