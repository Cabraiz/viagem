/**
 * What the weapon system hands a weapon pattern that lives in its own file (Pack 12 fatia A2: ricochet.ts, mine.ts,
 * turret.ts), so those files never edit system.ts: the system's own target order and its projectile cap.
 */
import type {EnemyState,SimPlayer} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import type {ResolvedWeapon} from './catalog.ts';

export interface FireApi {
  /** Projectile ceiling to pass to spawnProjectile. */
  cap:number;
  /**
   * Up to `count` live enemies within `range` of the player (plus their radius with `pad`), in the system's order (the
   * manual combat: rules/attack-target.ts; the automatic game: the tap, the coaches, the nearest).
   */
  targets(ctx:SimContext,player:SimPlayer,range:number,count:number,pad?:boolean):EnemyState[];
  /** Area-hit group of a player's weapon (takeAreaHit): `${player}:${weapon}`. */
  group(player:SimPlayer,w:ResolvedWeapon):string;
}
/** A pattern's volley: true when it fired (the cooldown starts), false to keep the cooldown and retry next tick. */
export type FirePattern=(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon,api:FireApi)=>boolean;
/** How far the manual combat looks for a target with the weapon, and whether the enemy's radius is added. */
export type PatternReach=(w:ResolvedWeapon)=>{reach:number;pad:boolean};
