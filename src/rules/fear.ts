/**
 * Fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, user 24/10): a hero with nobody near is closed in by the dark
 * and, after FEAR_SECONDS alone, is consumed by it (the normal fall, downPlayer with source FEAR_SOURCE). It runs in
 * every phase (the user's choice (b): also in the Minerva minute and the explore interval). Shared by the fear
 * system (src/sim/fear.ts) and the client's vignette (fear 0..1 on the wire).
 * Card NEW-20261028-ORQ-escuridao-justa (the E2 audit, 28/10, items 1 and 9): the dark must not take a hero doing what
 * the objective says ("Junte caixas e volte ao Uno"): the Uno's company grew to the light seen around it (6 → 12 u, a
 * hero leaning on the car was 6.3 u from its centre and fell) and while exploring the dark grows at FEAR_EXPLORE_RATE.
 */
import {ticks} from '../contract/index.ts';

/** Seconds alone until the dark takes the hero. */
export const FEAR_SECONDS=60;
export const FEAR_TICKS=ticks(FEAR_SECONDS);
/** Company: another hero (or bot) on their feet within this many units. */
export const FEAR_ALLY_RADIUS=8;
/** The Uno (the chaveiro's car, else the base) is company too, within this many units (its light on screen). */
export const FEAR_BASE_RADIUS=12;
/**
 * Exploring (the minuto de Minerva, the time to explore after a wave, the rounds' intermission) the dark grows at this
 * share of a tick per tick: 2 minutes alone, the whole time the mission gives to fetch crates, before it takes the hero.
 */
export const FEAR_EXPLORE_RATE=.5;
/** With company the dark backs off this many times faster than it grows (60 s of fear gone in 2 s). */
export const FEAR_CALM_RATE=30;
/** The `downed` event's source for a fall to the dark (no enemy behind it). */
export const FEAR_SOURCE='escuridao';
/** The client's vignette starts after this many seconds alone (the server counts from the first tick). */
export const FEAR_SHOW_SECONDS=3;
/** The last stretch: the vignette leaves only a circle around the hero, with the heartbeat. */
export const FEAR_FINAL_SECONDS=10;
/** The HUD's countdown ("Escuro: N s") shows over the last this many seconds before the dark takes the hero. */
export const FEAR_COUNT_SECONDS=20;
