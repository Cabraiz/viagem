/** Downed and revive tuning (VGM-037), shared by the revive system (src/sim/revive.ts) and the HUD's rescue ring. */
import {ticks} from '../contract/index.ts';

export const BLEED_OUT_TICKS=ticks(30);
export const REVIVE_RADIUS=1.2;
export const REVIVE_TICKS=ticks(3);
export const REVIVE_HP_FRACTION=.4;
/**
 * comeca-armado-e-levanta-seguro (auditoria-jogabilidade-28-10 item 3): 2 s ran out with the bêbado and the pombos still
 * on top, and the hero fell again in ~3 s, three times in a row. Getting up now shoves every critter within
 * REVIVE_PUSH_RADIUS away (REVIVE_PUSH_KNOCK per tick, decaying: ~2 u in all, bosses stand) and protects 3.5 s.
 */
export const REVIVE_INVULNERABLE_TICKS=ticks(3.5);
export const REVIVE_PUSH_RADIUS=2,REVIVE_PUSH_KNOCK=.8;
/**
 * Item 4: alone in the run (no ally, no bot), the first fall of the match is not the defeat: the hero gets up by himself
 * after SOLO_SELF_REVIVE_TICKS (the rescue ring fills meanwhile). SOLO_SECOND_CHANCES per match; the next fall ends it.
 */
export const SOLO_SECOND_CHANCES=1,SOLO_SELF_REVIVE_TICKS=ticks(5);
/** Item 2: seconds a hero is untouchable at the start unless he opens a crate first (src/sim/crates.ts; the client blinks him). */
export const START_GRACE_S=20;
/** Without a rescuer in range, progress falls back at the base revive speed. */
export const REVIVE_DECAY_PER_TICK=1/REVIVE_TICKS;
/**
 * A player who dropped while on their feet may be back soon (VGM-047). While one of them is
 * missing and nobody else stands, the defeat waits this long instead of latching on a 1-tick lag.
 */
export const RECONNECT_GRACE_TICKS=ticks(5);
/** Weight of each rescuer after the strongest one: more allies speed it up, with diminishing returns. */
export const EXTRA_RESCUER_WEIGHT=.5;
