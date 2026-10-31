/**
 * Client-side view model of a horde run. Protocol 4 (VGM-041) decodes into these shapes;
 * renderers (VGM-039) and HUD (VGM-040) consume them and must not import server-only modules.
 */
import type {BankView,ObjectiveView} from './objective.ts';
import type {PickupKind,SimEvent,OfferChoice,OfferSource,RoundState,TelegraphKind} from './types.ts';
import type {VehicleKind} from './vehicles.ts';

export interface EnemyView {id:string;kind:string;x:number;y:number;hp:number;maxHp:number;elite?:boolean;boss?:boolean;phase?:number;
  /** D-047: Dona Cida sold it a sweet ("açucarado": more damage and speed) and it still lasts. */
  sugar?:true;
  /**
   * D-051: a body asleep on the map (sim/ninhos/sono.ts), sent near the players (the interest area, at most
   * ASLEEP_PER_VIEWER per client). It wakes with the same id (asleep leaves) or with the 'acordou' event.
   */
  asleep?:true;
  /** Bancos: it robbed an ATM and became a Cliente Prime (rules/bancos.ts BANCO.primeVida, the crown). */
  prime?:true;
  /** The viaduct (maps city/viaduct.ts): on a deck (floor 1); absent on the ground. The client lifts it by the deck's height. */
  andar?:1;
  /**
   * Card heroi-empurra-inimigos: the body's radius (u) when it is solid to the heroes (maps bodies.ts: the phone's
   * prediction pushes it like the room); absent for the flying and the asleep, which a hero walks through.
   */
  radius?:number;
  /**
   * Card colisao-entre-herois ("empurrado", the animation's: E1's anim-ser-empurrado): a hero's walk is pushing this
   * mendigo, along the unit (x, y); absent otherwise (sim/bodies.ts PUSH_HOLD keeps it a few ticks past the last push).
   */
  pushed?:{x:number;y:number}}
export interface PickupView {id:string;kind:PickupKind;x:number;y:number;value:number;resource?:string}
export interface ProjectileView {id:string;source:string;x:number;y:number;vx:number;vy:number;radius:number;hostile:boolean;
  /** The viaduct: flying on a deck (floor 1); absent on the ground. */
  andar?:1}
export interface TelegraphView {id:string;shape:'circle'|'line'|'cone';x:number;y:number;radius:number;dx?:number;dy?:number;width?:number;fireTick:number;kind?:TelegraphKind}
/**
 * The wall ('muralha') and the forge's towers ('torre-chinelo', with the tick they go away), the city barricades, and
 * the tower defenses (torres-fio: kind = the DefenseId, `tier` 1-6, `branch` A/B/C from tier 2, `phase` obra-1..3,
 * pronta, danificada, ruina, and `aim` where it last fired, in turns 0..1 of a circle from +x).
 */
export interface StructureView {id:string;kind:string;x:number;y:number;hp:number;maxHp:number;untilTick?:number;
  tier?:number;branch?:string;phase?:string;aim?:number;
  /** A defense's volleys, mod 256 (torre-contador-de-tiros): a change is a shot. */
  shots?:number;
  /** D-047, the car ('quadradao'): its fallen parts (bit i = CAR_PARTS[i]); hp = limit − hits, maxHp = limit. */
  parts?:number;
  /**
   * D-051, a nest (kind 'ninho', phase 'dormindo' | 'ativo' | 'destruido', a fallen one stays at hp 0): its size, and
   * `seen` once someone in the team came near it (the minimap's fog).
   */
  size?:'P'|'M'|'G';seen?:true;
  /**
   * D-052, free build: a built piece's top-left cell on the build grid (contract/build.ts) and its rot (absent = 0).
   * Every defense, the root included, and the kinds 'muro' and 'barricada'; x,y stay the footprint's centre.
   */
  c?:number;r?:number;rot?:number;
  /** torres-3-base-9-evolucoes: a bicho tower's força, absent at 1 (sim towers/forca.ts). */
  level?:number}
/**
 * A gather node near this client during the intermission (VGM-046B): coco or pedra, units of work left this round,
 * what one unit is worth (farther from the base, more) and the progress (0..1) of the unit being gathered now.
 */
export interface NodeView {id:string;kind:string;x:number;y:number;remaining:number;capacity:number;value:number;progress:number}
/** The team's Stonewards state (VGM-046B): balance, the return horn of this intermission, and the wall down (defeat). */
/**
 * `units`: the team's one pile of material (D-048); the fichas de torre and the ring come from it (rules tokensOf/tokenProgress).
 * `grana`: THIS viewer's wallet in R$ (contract wallet.ts; every world): what they pay evolutions, repairs, the forge and
 *   Dona Cida with. The room fills it per viewer from their SimPlayer.grana; a spectator without a seat sees 0.
 */
export interface CampView {units:number;grana:number;hornEndsTick?:number;wallDown?:boolean;
  /** Inflação: this run's purchases of the inflating recipes (rules forgePrice), absent when none. */
  forge?:Partial<Record<'gambiarra'|'torre-chinelo',number>>}
export interface PlayerRunView {
  id:string;name:string;classId:string;hp:number;maxHp:number;online:boolean;spectator:boolean;
  downed?:{progress:number;bleedOutTick:number};eliminated?:boolean;
  weapons:{id:string;level:number}[];passives:{id:string;level:number}[];
  /** D-051 manual combat: the inventory slot in the hand (`weapons` is the inventory); absent with the automatic weapons. */
  hand?:number;
  /**
   * Class skill (E7-skill-hud-wiring): tick of the last cast and tick it is ready again (0 or absent: ready).
   * The skill button shows the cooldown from these; refunds move skillReadyTick earlier.
   */
  skillTick?:number;skillReadyTick?:number;
  /** Contribution counters for the result screen. */
  stats?:PlayerStatsView;
  /** A room bot (D-025): the client sets it from the run state; the HUD shows the robot sticker, people-only prizes skip it. */
  bot?:boolean;
  /** D-036 movement effects (see SimPlayer): the client's prediction applies them so movement never snaps back. */
  slowUntil?:number;slipUntil?:number;slip?:{x:number;y:number};
  /** D-047 Dona Cida's sweets while they last (fastUntil also drives the prediction, maps/prediction.ts). */
  fastUntil?:number;mightUntil?:number;guardUntil?:number;
  /** Veículos: the vehicle ridden while tick < rideUntil (also drives the prediction, maps/prediction.ts). */
  ride?:VehicleKind;rideUntil?:number;
  /** The viaduct (maps city/viaduct.ts): on a deck (floor 1), absent on the ground; the phone's prediction starts from it. */
  andar?:1;
  /** stats.moveSpeed when it is not 1 (class, weapon, tênis, the offer): the phone's prediction walks with it. */
  moveSpeed?:number;
  /** Fear (rules/fear.ts): the dark around this hero, 0..1 (1 = consumed); absent = 0. The client's vignette draws it. */
  fear?:number;
  /**
   * Card colisao-entre-herois (the animation's state, E1's anim-ser-empurrado): "empurrando", this hero walks into a
   * hero or a mendigo and pushes them, and "empurrado", a hero's walk pushes this one; each along the unit (x, y) of
   * the push (from the pusher to the pushed), absent otherwise. Both at once in the middle of a line.
   */
  pushing?:{x:number;y:number};pushed?:{x:number;y:number};
}
/**
 * Run counters the server keeps per player (NEW-20261009-N2-award-stats-server): every client gets the same numbers,
 * whatever events it saw (reconnects, protocol 4 area of interest). `downs` present = server counters; the prizes
 * then use these instead of counting events. Damage is what the player dealt to enemies.
 */
export interface PlayerStatsView {
  damage:number;kills:number;revives:number;pickups:number;
  downs?:number;heals?:number;chests?:number;magnets?:number;evolves?:number;
}
export interface OfferView {id:string;source:OfferSource;level:number;choices:OfferChoice[];deadlineTick:number;defaultIndex:number}
export interface RunView {
  tick:number;
  team:{xp:number;level:number;nextXp:number};
  wave?:{index:number;label:string;phase?:'prepare'|'wave'};
  round?:RoundState;
  enemies:EnemyView[];pickups:PickupView[];projectiles:ProjectileView[];telegraphs:TelegraphView[];structures:StructureView[];
  /** Gather nodes around this client, only in the intermission (protocol 6). */
  nodes?:NodeView[];
  /** Stonewards balance, horn and wall state (protocol 6); absent before the run is wired. */
  camp?:CampView;
  players:PlayerRunView[];
  /** D-047: the chaveiro objective (moto, ETA, alarm, Grana, Dona Cida, the car); absent when the run has none. */
  objective?:ObjectiveView;
  /** The city's banks (BankView, card bancos-e-veiculos), in both city modes; absent elsewhere. */
  banks?:BankView[];
  /** Pending offers for the local player only, oldest first. */
  offers:OfferView[];
  /** Events since the previous view, each with a monotonic id for de-duplication. */
  events:(SimEvent&{eventId:number})[];
}
