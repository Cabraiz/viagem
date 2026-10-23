/**
 * Pack 12 fatia A2 (E7): the `mine` pattern (panela-de-pressao). Dropped at the owner's feet (`mechanic:'mine'`, still),
 * it lives `duration` and bursts in `area` for `damage` when an enemy comes within `range`. Stub until the fatia A2.
 */
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import type {WeaponProjectile} from '../projectiles.ts';
import type {FirePattern,PatternReach} from './fire-api.ts';

/** The volley (system.ts fire, pattern 'mine'). */
export const fireMine:FirePattern=()=>false;
/** A mine is dropped when an enemy is within its trigger reach plus the burst. */
export const mineReach:PatternReach=w=>({reach:w.range+w.area,pad:true});
/**
 * Called by the projectile system when a live enemy touches a `mechanic:'mine'` projectile, instead of the contact hit
 * (projectiles.ts collideFriendly). True keeps the mine; false removes it (it went off).
 */
export function mineTouched(_ctx:SimContext,_p:WeaponProjectile,_enemy:EnemyState):boolean{return true;}
