/**
 * Client-side view model of a horde run. Protocol 4 (VGM-041) decodes into these shapes;
 * renderers (VGM-039) and HUD (VGM-040) consume them and must not import server-only modules.
 */
import type {PickupKind,SimEvent,OfferChoice,OfferSource,RoundState} from './types.ts';

export interface EnemyView {id:string;kind:string;x:number;y:number;hp:number;maxHp:number;elite?:boolean;boss?:boolean;phase?:number}
export interface PickupView {id:string;kind:PickupKind;x:number;y:number;value:number;resource?:string}
export interface ProjectileView {id:string;source:string;x:number;y:number;vx:number;vy:number;radius:number;hostile:boolean}
export interface TelegraphView {id:string;shape:'circle'|'line'|'cone';x:number;y:number;radius:number;dx?:number;dy?:number;width?:number;fireTick:number}
export interface StructureView {id:string;kind:string;x:number;y:number;hp:number;maxHp:number}
export interface PlayerRunView {
  id:string;name:string;classId:string;hp:number;maxHp:number;online:boolean;spectator:boolean;
  downed?:{progress:number;bleedOutTick:number};eliminated?:boolean;
  weapons:{id:string;level:number}[];passives:{id:string;level:number}[];
  /** Contribution counters for the result screen. */
  stats?:PlayerStatsView;
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
  players:PlayerRunView[];
  /** Pending offers for the local player only, oldest first. */
  offers:OfferView[];
  /** Events since the previous view, each with a monotonic id for de-duplication. */
  events:(SimEvent&{eventId:number})[];
}
