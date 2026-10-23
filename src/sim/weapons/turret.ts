/**
 * Pack 12 fatia A2 (E7): the `turret` pattern (carro-de-som). Placed at the owner's feet (`mechanic:'turret'`, still,
 * never hits by contact), it lives `duration` and shoots its own straight shots at the nearest enemy within `range`
 * every `hitInterval`. Stub until the fatia A2.
 */
import type {SimContext} from '../context.ts';
import type {FireApi,FirePattern,PatternReach} from './fire-api.ts';

/** The volley (system.ts fire, pattern 'turret'): place the turret. */
export const fireTurret:FirePattern=()=>false;
/** Placed when an enemy is within the turret's range. */
export const turretReach:PatternReach=w=>({reach:w.range,pad:false});
/** Every tick, before the players fire (system.ts step): the placed turrets shoot. */
export function tickTurrets(_ctx:SimContext,_api:FireApi):void{}
