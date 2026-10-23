/**
 * Pack 12 fatia A2 (E7): the `ricochet` pattern (bola-murcha). A straight shot that, on a hit, turns toward the nearest
 * enemy it has not hit yet within a radius, `pierce` times. Stub until the fatia A2: nothing fires.
 */
import type {EnemyState} from '../../contract/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import type {WeaponProjectile} from '../projectiles.ts';
import type {FirePattern,PatternReach} from './fire-api.ts';

/** The volley (system.ts fire, pattern 'ricochet'): spawn the shot with `mechanic:'ricochet'`. */
export const fireRicochet:FirePattern=()=>false;
/** Flight distance plus the shot's radius, capped by the range (like a straight shot). */
export const ricochetReach:PatternReach=w=>({reach:Math.min(w.range,w.speed*w.durationTicks/SIM_HZ+w.area),pad:false});
/**
 * Called by the projectile system right after a `mechanic:'ricochet'` shot damaged `enemy` (projectiles.ts
 * collideFriendly). True: the shot bounced (it lives on and stops hitting this tick); false: the usual pierce rule.
 */
export function bounceAfterHit(_ctx:SimContext,_p:WeaponProjectile,_enemy:EnemyState):boolean{return false;}
