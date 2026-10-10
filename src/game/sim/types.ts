/**
 * Shared simulation contract for the horde run (VGM-030+).
 * Systems are pure server-side steps over SimContext. Keep this file stable:
 * change it only through the integration card (VGM-030) or with orchestrator approval.
 * Erasable TypeScript only (no enum, namespace or parameter properties): tests run with --experimental-strip-types.
 */
import type {TerrainField} from '../terrain/field.ts';
import type {Point} from '../world.ts';
import type {Rng} from './rng.ts';

export const SIM_HZ=20;
export const ticks=(seconds:number)=>Math.round(seconds*SIM_HZ);

// ---------- Items and builds ----------
export type ItemKind='weapon'|'passive'|'evolution';
export interface ItemDef {
  id:string; kind:ItemKind; name:string; icon:string; maxLevel:number;
  /** Short pt-BR text for the offer card at the given next level. */
  describe(level:number):string;
}
export interface OwnedItem {id:string;level:number}
export interface PlayerBuild {weapons:OwnedItem[];passives:OwnedItem[]}
export const MAX_WEAPONS=6,MAX_PASSIVES=6;

/** Multipliers start at 1, flat values at 0. Computed from build + class kit, never sent by the client. */
export interface PlayerStats {
  maxHp:number; regen:number; armor:number; moveSpeed:number;
  might:number; area:number; cooldown:number; amount:number; duration:number;
  speed:number; magnet:number; luck:number; growth:number; revive:number;
}
export const BASE_STATS:Readonly<PlayerStats>=Object.freeze({
  maxHp:100,regen:0,armor:0,moveSpeed:1,might:1,area:1,cooldown:1,amount:0,duration:1,
  speed:1,magnet:1.2,luck:1,growth:1,revive:1,
});

// ---------- Entities (world units; island ~ 2..22, 20 Hz ticks) ----------
export interface SimPlayer extends Point {
  id:string; classId:string; hp:number; online:boolean; spectator:boolean;
  /** Unit vector of last non-zero movement; directional weapons use it. */
  facing:Point;
  /** Enemy id prioritized by tap, if still valid. */
  target?:string;
  build:PlayerBuild; stats:PlayerStats;
  downed?:{sinceTick:number;bleedOutTick:number;progress:number};
  eliminated?:boolean;
  /** Per-weapon next-fire tick, keyed by weapon id. */
  weaponReady:Record<string,number>;
  invulnerableUntil?:number;
  /** Class kit stat bonus (VGM-044A); pass to refreshStats whenever the build changes (D-005). */
  classBonus?:Partial<PlayerStats>;
}

export interface EnemyState extends Point {
  id:string; kind:string; hp:number; maxHp:number;
  speed:number; damage:number; radius:number; xp:number;
  elite?:boolean; boss?:boolean; spawnTick:number;
  readyTick:number; slowUntil?:number; frozenUntil?:number;
  knock?:Point; phase?:number;
  /** Small numeric scratch for behaviors; keep JSON-safe. */
  memory?:Record<string,number>;
}

export type PickupKind='xp'|'heal'|'magnet'|'chest'|'resource';
export interface PickupState extends Point {
  id:string; kind:PickupKind; value:number; resource?:string;
  spawnTick:number; expiresTick?:number;
  /** Set when a magnet pulls it toward a player. */
  homing?:string;
}

export interface ProjectileState extends Point {
  id:string; owner:string; source:string; vx:number; vy:number; radius:number;
  damage:number; pierce:number; untilTick:number; hostile:boolean;
  /** Enemy (or player) ids already hit, prevents double damage per pass. */
  hit:string[];
}

/** Telegraphed danger zone; damage applies at fireTick on the server. */
export interface Telegraph {
  id:string; shape:'circle'|'line'|'cone'; x:number; y:number; radius:number;
  dx?:number; dy?:number; width?:number; fireTick:number; damage:number; owner:string;
}

// ---------- Team progression ----------
export interface TeamProgress {xp:number;level:number;nextXp:number}
export interface OfferChoice {itemId:string;level:number}
export type OfferSource='level'|'round';
export interface LevelOffer {id:string;playerId:string;source:OfferSource;level:number;choices:OfferChoice[];deadlineTick:number;defaultIndex:number}
/** Round state machine owned by the director (VGM-033). */
export type RoundPhase='wave'|'prepare';
export interface RoundState {index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number}

// ---------- Events (server -> clients, for effects/HUD; never trusted back) ----------
export type SimEvent=
  | {type:'damage';target:string;amount:number;source?:string;weapon?:string;crit?:boolean}
  | {type:'kill';enemy:string;kind:string;by?:string;x:number;y:number}
  | {type:'spawn-warning';x:number;y:number;atTick:number;count:number}
  | {type:'fire';player:string;weapon:string;x:number;y:number;dx?:number;dy?:number}
  | {type:'pickup';player:string;pickup:string;kind:PickupKind;value:number}
  | {type:'levelup';level:number}
  | {type:'offer';player:string;offer:string}
  | {type:'upgrade';player:string;item:string;level:number}
  | {type:'evolve';player:string;from:string;to:string}
  /** downed.source: kind of the enemy (or boss) that dealt the last hit, for "what got you" (UX-voce-e-dano). */
  | {type:'downed';player:string;by?:string;source?:string}
  | {type:'revived'|'eliminated';player:string;by?:string}
  | {type:'telegraph';telegraph:string}
  | {type:'boss-phase';enemy:string;phase:number}
  | {type:'wave';index:number;label:string}
  | {type:'round';index:number;phase:RoundPhase|'end';name?:string;modifier?:string}
  | {type:'bark';enemy:string;line:string}
  | {type:'structure';id:string;hp:number;maxHp:number};

// ---------- Spatial query (VGM-032 implements a hash; tests may use naive) ----------
export interface SpatialIndex<T extends Point&{id:string}> {
  rebuild(items:Iterable<T>):void;
  /** Items whose center is within radius, any order. */
  query(x:number,y:number,radius:number,out?:T[]):T[];
  nearest(x:number,y:number,radius:number,filter?:(item:T)=>boolean):T|undefined;
}

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

export interface SimSystem {
  readonly id:string;
  step(ctx:SimContext):void;
}

/** Order systems run each tick. Integration (VGM-030) registers implementations against these ids. */
export const SYSTEM_ORDER=[
  'director','enemy-ai','boss','weapons','projectiles','telegraphs','pickups','progression','revive','structures',
] as const;
export type SystemId=typeof SYSTEM_ORDER[number];
