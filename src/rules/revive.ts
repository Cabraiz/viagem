/** Downed and revive tuning (VGM-037), shared by the revive system (src/sim/revive.ts) and the HUD's rescue ring. */
import {ticks} from '../contract/index.ts';

export const BLEED_OUT_TICKS=ticks(30);
export const REVIVE_RADIUS=1.2;
export const REVIVE_TICKS=ticks(3);
export const REVIVE_HP_FRACTION=.4;
export const REVIVE_INVULNERABLE_TICKS=ticks(2);
/** Without a rescuer in range, progress falls back at the base revive speed. */
export const REVIVE_DECAY_PER_TICK=1/REVIVE_TICKS;
/**
 * A player who dropped while on their feet may be back soon (VGM-047). While one of them is
 * missing and nobody else stands, the defeat waits this long instead of latching on a 1-tick lag.
 */
export const RECONNECT_GRACE_TICKS=ticks(5);
/** Weight of each rescuer after the strongest one: more allies speed it up, with diminishing returns. */
export const EXTRA_RESCUER_WEIGHT=.5;
