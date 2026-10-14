/**
 * Shared simulation contract for the horde run (VGM-030+).
 * Systems are pure server-side steps over SimContext (src/sim/context.ts, the server's side). Keep this file stable:
 * change it only through the integration card (VGM-030) or with orchestrator approval.
 * Erasable TypeScript only (no enum, namespace or parameter properties): tests run with --experimental-strip-types.
 */
import type {Rng} from './rng.ts';
import type {CidaItemId,MotoMoment} from './objective.ts';

/** A position or direction in world units (maps/world.ts re-exports it). */
export type Point = { x: number; y: number };
/** 'ilha': the ~24×24 island (default). 'infinito': endless chunked map (D-019), base at the origin. */
/** 'cidade' = Cidade Nevada, the imported city (D-026/D-034). */
export type WorldKind='ilha'|'infinito'|'cidade';
/** Protocol 3 input. `attack` is accepted for compatibility but weapons fire automatically. */
export interface PlayerInput {seq:number;x:number;y:number;attack:boolean;target?:string;skill?:boolean}

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
  /** D-036: walking speed × PLAYER_SLOW_MULT while tick < slowUntil (the bêbado's burp). Server-set, sent to the client for prediction. */
  slowUntil?:number;
  /**
   * D-036: while tick < slipUntil the player slides along `slip` (unit vector) at PLAYER_SLIP_SPEED and input is
   * ignored (pigeon poop). Deterministic from (slipUntil, slip), so the client predicts it exactly.
   */
  slipUntil?:number; slip?:Point;
  /**
   * D-047 Dona Cida's sweets (objective.ts CIDA_ITEMS), absolute ticks: walking × CIDA_FAST_MULT while tick < fastUntil
   * (shared with the client's prediction, like slowUntil), damage dealt × CIDA_MIGHT_MULT while tick < mightUntil,
   * damage taken × CIDA_GUARD_MULT while tick < guardUntil. Absent outside the chaveiro objective.
   */
  fastUntil?:number; mightUntil?:number; guardUntil?:number;
}
/** D-036 player effects, shared by the server movement and the client prediction. */
export const PLAYER_SLOW_MULT=.6,PLAYER_SLOW_SECONDS=1.5,PLAYER_SLIP_SPEED=4.2,PLAYER_SLIP_SECONDS=.5;
/** D-036: what a telegraph is, so the client draws each hazard its own way. Absent = generic. */
export type TelegraphKind='arroto'|'molotov'|'fogo'|'coco'|'explosao'|'pancada'|'investida'|'varredura'|'carimbo';
export const TELEGRAPH_KINDS:readonly TelegraphKind[]=['arroto','molotov','fogo','coco','explosao','pancada','investida','varredura','carimbo'];

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
  /** D-036: hazard kind for the client's look (absent = generic). */
  kind?:TelegraphKind;
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
  /**
   * Class skill cast (NEW-20261006-E7-skill-hud-wiring): the line for the caster's speech balloon, the dice result
   * (Odd Impossível) and, when the skill moved the caster (Motogirl, Cidadão Comum…), where they landed (x, y).
   * One event per cast, next to the `fire` with weapon `skill:<classId>` that the sprites already use.
   */
  | {type:'skill';player:string;skill:string;line:string;outcome?:'flop'|'hit'|'miracle';x?:number;y?:number}
  | {type:'structure';id:string;hp:number;maxHp:number}
  /**
   * D-013 (VGM-046B): the return horn of the intermission. endsTick is when the next round starts (the horn may have
   * stretched the intermission so the farthest hero gets back, base-stonewards-mapa); line is its pt-BR joke.
   */
  | {type:'horn';endsTick:number;line?:string}
  /** D-013: a line from something that is not an enemy (forge recipes, a node running dry), at most one per ~2 s per source. */
  | {type:'say';source:string;key:string;line:string}
  /**
   * VGM-053B: a zueira event in the middle of a round (sim/zueira.ts), decided by the server from the run seed:
   * boleto rain (XP), flash sale (coxinhas) or a blackout. endsTick: when it stops (the client's banner and the dark).
   */
  | {type:'happening';kind:HappeningKind;endsTick:number}
  /** VGM-053B: the last critter of a round fell (kill-cam): kind, where, who closed the bill and which round. */
  | {type:'last-bicho';kind:string;x:number;y:number;round:number;by?:string}
  /**
   * D-047 (chaveiro objective, src/sim/chaveiro/): the car alarm started (until untilTick), a car part fell (name: a
   * CarPart), a moto moment (alone: the moto started again by itself, no push), Dona Cida sold a sweet to an enemy
   * (it is "açucarado") and a player bought one for the team. Hooks for lines and HUD; not on the wire yet.
   */
  | {type:'alarm';untilTick:number}
  | {type:'part';name:string}
  | {type:'moto';mode:MotoMoment;alone?:true}
  | {type:'sale';enemy:string}
  | {type:'buy';player:string;item:CidaItemId}
  /** D-051 (sim/ninhos/sono.ts): `n` sleepers woke around (x, y) (the client's "hã?" balloon); never the noise itself. */
  | {type:'acordou';x:number;y:number;n:number};
export type HappeningKind='boletos'|'promo'|'apagao';
/** An event with the run-wide id the room's broadcast cursor follows (core.ts stamps it). */
export type StampedEvent=SimEvent&{eventId:number};

// ---------- Spatial query (VGM-032 implements a hash; tests may use naive) ----------
export interface SpatialIndex<T extends Point&{id:string}> {
  rebuild(items:Iterable<T>):void;
  /** Items whose center is within radius, any order. */
  query(x:number,y:number,radius:number,out?:T[]):T[];
  nearest(x:number,y:number,radius:number,filter?:(item:T)=>boolean):T|undefined;
}

/** Order systems run each tick. Integration (VGM-030) registers implementations against these ids. */
export const SYSTEM_ORDER=[
  'director','enemy-ai','boss','weapons','projectiles','telegraphs','pickups','progression','revive','structures',
] as const;
export type SystemId=typeof SYSTEM_ORDER[number];
