/**
 * Shared simulation contract for the horde run (VGM-030+).
 * Systems are pure server-side steps over SimContext (src/sim/context.ts, the server's side). Keep this file stable:
 * change it only through the integration card (VGM-030) or with orchestrator approval.
 * Erasable TypeScript only (no enum, namespace or parameter properties): tests run with --experimental-strip-types.
 */
import type {Rng} from './rng.ts';
import type {CidaItemId,MotoMoment} from './objective.ts';
import type {VehicleKind} from './vehicles.ts';

/** A position or direction in world units (maps/world.ts re-exports it). */
export type Point = { x: number; y: number };
/** 'ilha': the ~24×24 island (default). 'infinito': endless chunked map (D-019), base at the origin. */
/** 'cidade' = Cidade Nevada, the imported city (D-026/D-034). */
export type WorldKind='ilha'|'infinito'|'cidade';
/**
 * Protocol 3 input. `attack`: the attack button is held this step (D-051, segment flag bit 1). It only matters with the
 * manual combat (CombatMode 'manual'): the equipped weapon fires while it is held. With the automatic weapons (the
 * default) it is ignored, like before. `skill`: the class skill (ignored in manual combat).
 */
export interface PlayerInput {seq:number;x:number;y:number;attack:boolean;target?:string;skill?:boolean;
  /** The mouse's aim while attacking on a PC (a unit vector, one of the input's 32 directions; cone-ataque-melee). */
  aim?:Point}
/**
 * D-051: how heroes fight. 'auto' (the default): every weapon of the build fires on its own and the skill casts.
 * 'manual' (Wild Rift): only the equipped weapon fires, while PlayerInput.attack is held, at the server's auto aim
 * (rules/attack-target.ts); no class skill. Off by default until the E6 weapons and the balance pass.
 */
export type CombatMode='auto'|'manual';

export const SIM_HZ=20;
export const ticks=(seconds:number)=>Math.round(seconds*SIM_HZ);

// ---------- Items and builds ----------
/** D-051: 'consumable' (coxinha, doces, kit de torre) only lives in the manual combat's inventory. */
export type ItemKind='weapon'|'passive'|'evolution'|'consumable';
export interface ItemDef {
  id:string; kind:ItemKind; name:string; icon:string; maxLevel:number;
  /** Short pt-BR text for the offer card at the given next level. */
  describe(level:number):string;
}
export interface OwnedItem {id:string;level:number}
/**
 * D-051 manual combat: `weapons` is the 6-slot inventory (weapons and consumables, slot order; a weapon's level is its
 * rarity, a consumable's its stack) and `hand` the slot in the hand. Absent `hand`: the automatic weapons (every
 * weapon fires, levels are levels).
 */
export interface PlayerBuild {weapons:OwnedItem[];passives:OwnedItem[];hand?:number}
export const MAX_WEAPONS=6,MAX_PASSIVES=6;

/** Multipliers start at 1, flat values at 0. Computed from build + class kit, never sent by the client. */
export interface PlayerStats {
  maxHp:number; regen:number; armor:number; moveSpeed:number;
  might:number; area:number; cooldown:number; amount:number; duration:number;
  speed:number; luck:number; growth:number; revive:number;
}
export const BASE_STATS:Readonly<PlayerStats>=Object.freeze({
  maxHp:100,regen:0,armor:0,moveSpeed:1,might:1,area:1,cooldown:1,amount:0,duration:1,
  speed:1,luck:1,growth:1,revive:1,
});

// ---------- Entities (world units; island ~ 2..22, 20 Hz ticks) ----------
export interface SimPlayer extends Point {
  id:string; classId:string; hp:number; online:boolean; spectator:boolean;
  /** Unit vector of last non-zero movement; directional weapons use it. */
  facing:Point;
  /** Enemy id prioritized by tap, if still valid. */
  target?:string;
  /** Manual combat: the mouse's aim of the last step that attacked with one (PlayerInput.aim); the melee swing goes there. */
  aim?:Point;
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
   * boss-fim-onda-1 (the user, 24/10: "a gente é empurrado igual ao gigante do L4D2"): a chefão's pancada throws the hero.
   * While tick < knockUntil the room moves them by `knock` (u per tick, server-only: the positions carry it); while
   * tick < downUntil they are down on the ground for a moment (no walk, no attack), sent to the phone for its prediction.
   */
  knock?:Point; knockUntil?:number; downUntil?:number;
  /**
   * D-047 Dona Cida's sweets (objective.ts CIDA_ITEMS), absolute ticks: walking × CIDA_FAST_MULT while tick < fastUntil
   * (shared with the client's prediction, like slowUntil), damage dealt × CIDA_MIGHT_MULT while tick < mightUntil,
   * damage taken × CIDA_GUARD_MULT while tick < guardUntil. Absent outside the chaveiro objective.
   */
  fastUntil?:number; mightUntil?:number; guardUntil?:number;
  /**
   * Veículos (contract vehicles.ts): the vehicle this player rides while tick < rideUntil (absolute tick; the
   * crossfiteiro's burpee included). Shared with the client's prediction, like fastUntil. Absent outside the city.
   */
  ride?:VehicleKind; rideUntil?:number;
  /** This player's wallet in R$ (contract wallet.ts; NEW-20261014-ORQ-carteira-e-pix). Absent = 0. */
  grana?:number;
  /**
   * Fear (rules/fear.ts, sim/fear.ts): ticks of dark built up alone, 0..FEAR_TICKS; at FEAR_TICKS the hero falls.
   * Absent = 0 (and in the runs without the fear system, so their digests stay).
   */
  fear?:number;
  /**
   * D-051, manual combat only (server-side, never on the wire): the enemy whose hit last landed on this player and the
   * tick (core damagePlayer), for the auto aim's "who is hitting me" rule. Absent with the automatic weapons, so no
   * digest of the default game moves.
   */
  lastHitBy?:{id:string;tick:number};
  /** D-051, manual combat only (server-side): the auto aim's current target, kept by its hysteresis (rules/attack-target.ts). */
  autoTarget?:string;
  /** The floor (maps city/viaduct.ts): 1 on a viaduct's deck, absent on the ground. Shared with the client's prediction. */
  andar?:1;
}
/** D-036 player effects, shared by the server movement and the client prediction. */
export const PLAYER_SLOW_MULT=.6,PLAYER_SLOW_SECONDS=1.5,PLAYER_SLIP_SPEED=4.2,PLAYER_SLIP_SECONDS=.5;
/** boss-fim-onda-1: a throw (Telegraph.push) flies over KNOCK_SECONDS, then the hero is down KNOCK_DOWN_SECONDS more. */
export const KNOCK_SECONDS=.35,KNOCK_DOWN_SECONDS=.45;
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
  /** The floor (maps city/viaduct.ts): 1 on a viaduct's deck, absent on the ground. */
  andar?:1;
}

/**
 * D-054: a kill's XP goes straight to the team, no gems; 'xp' was only the zueira's boleto rain (resource 'boleto'),
 * retired by NEW-20261024-ORQ-tirar-drops-cedula-girando: no 'xp' pickup is made any more (the kind stays on the wire).
 * D-051: 'item' is an inventory item on the ground (resource = item id, value = its level: rarity or stack); in the
 * manual combat a 'chest' is a crate whose value is its rarity (1 verde .. 5 lendária), opened by standing next to it.
 */
/** 'vehicle' (Veículos): a parked vehicle, its VehicleKind in `resource`; the vehicles system takes it, never the pickups one. */
/**
 * 'grana' (NEW-20261024-ORQ-tirar-drops-cedula-girando): a kill's Grana as a spinning cédula, value = R$; it appears
 * CEDULA_DELAY_SECONDS after the kill where the enemy fell, whoever walks by takes it into their wallet, and after
 * CEDULA_WAIT_SECONDS it flies to its `owner` (sim/progression.ts).
 */
export type PickupKind='xp'|'heal'|'chest'|'resource'|'item'|'vehicle'|'grana';
export interface PickupState extends Point {
  id:string; kind:PickupKind; value:number; resource?:string;
  spawnTick:number; expiresTick?:number;
  /** Set when it is pulled toward a player (progression.ts PULL_RADIUS). */
  homing?:string;
  /**
   * D-051 'item' only (server-side): who dropped it, until they first walk clear of it; meanwhile walking over it does
   * not pick it back up (take, the "Trocar" button, still does).
   */
  dropper?:string;
  /**
   * D-051 'chest' only (server-side, never on the wire): players who no longer see this crate (crates.ts HIDE_AFTER_TAKEN:
   * they took a weapon of its colour); the encoder leaves it out of their frames and their bots skip it.
   */
  hiddenFor?:string[];
  /** 'grana' only (server-side): who the kill paid (the killer, a tower's owner); the cédula flies to them when nobody took it. */
  owner?:string;
}

export interface ProjectileState extends Point {
  id:string; owner:string; source:string; vx:number; vy:number; radius:number;
  damage:number; pierce:number; untilTick:number; hostile:boolean;
  /** Enemy (or player) ids already hit, prevents double damage per pass. */
  hit:string[];
  /** The floor it flies on (its shooter's, maps city/viaduct.ts): it only hits bodies on the same floor. Absent: the ground. */
  andar?:1;
}

/** Telegraphed danger zone; damage applies at fireTick on the server. */
export interface Telegraph {
  id:string; shape:'circle'|'line'|'cone'; x:number; y:number; radius:number;
  dx?:number; dy?:number; width?:number; fireTick:number; damage:number; owner:string;
  /** D-036: hazard kind for the client's look (absent = generic). */
  kind?:TelegraphKind;
  /** boss-fim-onda-1: it throws whoever it hits this far (u), away from its centre (a line: along it). Absent: no throw. */
  push?:number;
  /** The floor it lands on (its owner's, maps city/viaduct.ts): it only hurts bodies on the same floor. Absent: the ground. */
  andar?:1;
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
  /** A PIX between players (contract wallet.ts): memo is an index into PIX_MEMOS (the toast's description). */
  | {type:'pix';from:string;to:string;amount:number;memo:number}
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
  | {type:'acordou';x:number;y:number;n:number}
  /**
   * Bancos (rules/bancos.ts): a withdrawal of `amount` R$ from bank `bank` (by: a hero holding it, or a critter robbing
   * it: `enemy`), and a critter that became a Cliente Prime there.
   */
  | {type:'bank-cash';bank:string;amount:number;by:'hero'|'enemy';enemy?:string}
  | {type:'bank-prime';bank:string;enemy:string}
  /** A bank ran dry ('SEM CÉDULAS' until its refill) and when it is back with cash. */
  | {type:'bank-empty';bank:string;until:number}
  | {type:'bank-refill';bank:string}
  /**
   * Veículos (rules/veiculos.ts): `player` took a parked vehicle (pickup id `pickup`), the ride ran out ('acabou': the
   * time, the scooter's battery, the burpee done) or it ended early ('largou': moving the car, a fall).
   */
  | {type:'vehicle';player:string;kind:VehicleKind;what:'pegou'|'acabou'|'largou';pickup?:string}
  /** boss-fim-onda-1: a chefão's pancada threw `player`, down until untilTick (the Tank's punch). */
  | {type:'knock';player:string;untilTick:number};
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
