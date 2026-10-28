/**
 * Fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, user 24/10): a hero with nobody near is closed in by the dark,
 * at its darkest after FEAR_SECONDS alone. It never takes them (the user 28/10, card escuridao-justa: "a escuridão não
 * mata"); FEAR_SOURCE stays for the old falls' texts. It runs in
 * every phase (the user's choice (b): also in the Minerva minute and the explore interval). Shared by the fear
 * system (src/sim/fear.ts) and the client's vignette (fear 0..1 on the wire).
 */
import {ticks} from '../contract/index.ts';

/** Seconds alone until the dark is at its darkest (it stays there; nobody falls to it). */
export const FEAR_SECONDS=60;
export const FEAR_TICKS=ticks(FEAR_SECONDS);
/** Company: another hero (or bot) on their feet within this many units. */
export const FEAR_ALLY_RADIUS=8;
/** The Uno (the chaveiro's car, else the base) is company too, within this many units. */
export const FEAR_BASE_RADIUS=6;
/** With company the dark backs off this many times faster than it grows (60 s of fear gone in 2 s). */
export const FEAR_CALM_RATE=30;
/** The `downed` event's source the dark used for a fall (no enemy behind it); the sim no longer sends it. */
export const FEAR_SOURCE='escuridao';
/** The client's vignette starts after this many seconds alone (the server counts from the first tick). */
export const FEAR_SHOW_SECONDS=3;
/** The last stretch: the vignette leaves only a circle around the hero, with the heartbeat. */
export const FEAR_FINAL_SECONDS=10;
