/** The director's constants (director.ts), moved out as is (corte C1). */
import {RING_SLACK,ticks} from '../../contract/index.ts';
import {SPEED} from '../../maps/index.ts';
import {CITY_DISTANCE_SCALE} from '../../rules/index.ts';

/** D-047: count multiplier per wave after the last round (compounded: wave 11 × 1.1, wave 12 × 1.21, …). */
export const EXTRA_WAVE_COUNT=1.1;

export const BAND_MAX=2.2;
/** Enemy memory key of the city run-in budget, in u (CITY_RUN_IN_SPEED). JSON-safe number. */
export const RUN_IN='runIn';
/** Salt of the rotation's stream (DirectorState.rotation), apart from every other stream of the director. */
export const ROTATION_SALT=0x0d040a11;
export const LINE_GAP=ticks(.3);
export const SURROUND_SIDES=4;
/** Endless world: tries per ring pick (each one a bit farther out), recycling cadence and cap. */
export const RING_TRIES=24,RING_STEP=RING_SLACK/RING_TRIES;
export const RECYCLE_EVERY=ticks(.5),RECYCLE_PER_STEP=20;
/** Free disc a spawn needs in the endless world: the boss radius, so no body starts inside a tree or rock. */
export const SPAWN_CLEARANCE=.9;
/** Free disc around the other members of a group (the biggest regular enemy, tio-pavê .48, rounded up). */
export const MEMBER_CLEARANCE=.5;
/** Endless: every body is born at least this far past the edge of every legal screen (offscreenDistance + margin). */
export const SPAWN_MARGIN=.5;
/** Endless: a fleeing enemy still on someone's screen keeps fleeing; past this it is removed anyway (liveness). */
export const FLEE_CAP_SECONDS=60;
/**
 * Endless world: an enemy no one can see walks this much faster towards the nearest player, so a horde born on the
 * off-screen ring (29.9-48.7 u away, offscreen.ts) reaches the edge of the screen in a few seconds, as in VS,
 * instead of the ~21 s a bêbado needs at 1.4 u/s. On screen it is back to its own pace. Never siege enemies; the boss
 * only while walking.
 * "No one can see" is judged at the players' DEFAULT zoom (contract HERO_DEFAULT_SCREEN_PX, D-046,
 * NEW-20261013-ORQ-camera-zoom-out-e-roda): the ring is out of the WIDEST legal camera (hero 44 px), so with the old
 * test the run-in stopped at that wider edge and the horde walked the 44..47 px band at its own pace, later than with the
 * 56 px framing. Now it runs in up to the default screen's edge; only a player zoomed out past the default (the thin
 * 44..47 px band) may see it walk fast.
 */
export const CATCH_UP_SPEED=2.5;
/**
 * Endless world, last call (NEW-ORQ-fim-de-round-no-infinito). A round ends when its whole horde is down (the HUD counts
 * the bichos left; the last kill gets the kill-cam), and only a timeout makes the rest flee. In the endless world the
 * last groups are born 25-41 u away on the off-screen ring at 65% of the round, a bêbado walks 1.4 u/s, and bodies stuck
 * behind a tree never arrive: with the team waiting by the base every round of the sim timed out with a third to half
 * of the horde fleeing (53-69 s). So once every group of the plan is out:
 *  - the round gets at least LAST_CALL_SECONDS more before its timeout (the HUD shows no wave clock, only bichos);
 *  - each enemy still farther than LAST_CALL_NEAR from the team (siege ones: from the wall they besiege) hurries in,
 *    sidestepping trees and rocks; inside LAST_CALL_NEAR it is back to its own pace, so nobody standing still is hit by
 *    a body that arrived faster than it could be seen. Off every screen (at the default zoom, see CATCH_UP_SPEED) it closes in at CATCH_UP_SPEED on top of its
 *    pace (as before the last call); where someone may see it, never faster than LAST_CALL_PACE × the hero's speed in
 *    all, so a team that runs away is never caught by the hurry (code review: 3.9 u/s outran the hero's 3.1).
 */
export const LAST_CALL_SECONDS=25,LAST_CALL_NEAR=7,LAST_CALL_PACE=.9;
/** The extra speed of a called enemy (u/s): full catch-up off screen, capped so its pace plus it stays ≤ 0.9 × SPEED (the BASE hero walk: enemies do not speed up with the 2× hero) on one. */
export const lastCallBoost=(pace:number,hidden:boolean)=>hidden?CATCH_UP_SPEED:Math.max(0,Math.min(CATCH_UP_SPEED,LAST_CALL_PACE*SPEED-pace));
/**
 * A called enemy that tried every sidestep and still could not move waits this many ticks (plus 0-7 by its id) before it
 * tries again: up to 7 moveSafely calls per blocked body per tick were ~5 ms per tick with 300 of them (code review).
 */
export const BLOCKED_WAIT=6;
/** Sidesteps a called enemy tries when the straight step is blocked, in radians (its own side first, by memory.seed). */
export const DETOUR_TURNS=[Math.PI/3,Math.PI/2,2*Math.PI/3];
/**
 * A called enemy that gained less than STUCK_UNITS in a second (a pocket of trees or rocks: the AI pulls it straight
 * back in) squeezes through trees and rocks, never water, for the next STUCK_SECONDS. Most of it happens off screen;
 * on screen it reads as a bicho pushing through the bushes, and it is still LAST_CALL_NEAR away from anyone.
 */
export const STUCK_UNITS=.5,STUCK_SECONDS=2;
/** Endless retreat: fleeing is faster and may take longer than walking into the island's sea. */
export const FLEE_SPEED=4.5,FLEE_TIME_FACTOR=3;
/**
 * City retreat (cidade-05): a body walking back up its avenue is gone within CITY_EXIT_REACH of the avenue end or
 * CITY_GONE_DISTANCE from the plaza, once hidden from everyone (v2); FLEE_CAP_SECONDS is the liveness cap.
 * CITY_EXIT_REACH is a map length: 2 u on the .w3x-sized city, × CITY_DISTANCE_SCALE (CITY_MAP_SCALE ÷ CITY_COMPACT, mapa-175-com-viaduto) (NEW-20261013-ORQ-cidade-escala-1-7).
 * CITY_GONE_DISTANCE is not (NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro, part A): it only has to put the body out of the
 * plaza block (its mouths are 18.7–21.5 u from the plaza point on the 1.7× city) and off the screens, which the hidden
 * check already asks (the widest camera reaches 16.7 u along an avenue from a hero at the wall, which did not grow).
 * × 1.7 (42.5 u) made every timed-out round's retreat walk ~17 u more off screen, ~19 s instead of ~11 s at the retreat
 * pace (≥ 2.25 u/s), and the next intermission waited for it; 25 u again.
 */
export const CITY_EXIT_REACH=2*CITY_DISTANCE_SCALE,CITY_GONE_DISTANCE=25;
/**
 * City round timer (v2): a wave that times out lasts at least until the slowest member of the last group could reach
 * the plaza (or the team, where it stood when the wave started, if that is farther), plus this many seconds to fight
 * it, so no group retreats before it arrived (planCity; it never shortens the plan's time; not the boss round).
 */
export const CITY_ARRIVAL_SLACK=10;
/**
 * City run-in (NEW-20261013-ORQ-camera-zoom-out-e-roda, Orquestrador's option A of D-046). The planner places every group
 * off the WIDEST legal camera (hero 44 px), farther out than with the 56 px framing, and a group cannot be released
 * before the round starts (plus the warning), so a group whose route is long (the team on the praça point, on mouth line
 * S) reached the plaza ~1.4 s later than its cadence slot. Such a late part (PendingSpawn.late) runs in at its own pace
 * plus CITY_RUN_IN_SPEED (u/s) while it is off every viewer's screen at the DEFAULT zoom (planner.hiddenAtDefault,
 * contract HERO_DEFAULT_SCREEN_PX), along the planner's flow, until it has made up the distance it is late by
 * (late × its own speed: never ahead of its slot) or it comes on a default screen (from there on its own pace).
 * Only with the whole live team in the base (the plaza flow is then the way the steer takes); never the tutorial, the
 * boss, a retreating or frozen body. Groups on time are untouched. 2 u/s (the endless CATCH_UP_SPEED is 2.5): with
 * the wide bodies squeezing by the hero rule (BUG-20261013-E8-tio-preso-cidade) the city room bots' runs are chaotic
 * around it — 1.5 left the B line short of B3 in towers-bots, 2.5–3 left a bot idle 5.2–5.4 s near the plaza in
 * city-room-bots ACCEPTANCE (c), 2 passes both and keeps the plaza pace (city-director first arrival/first wave).
 */
export const CITY_RUN_IN_SPEED=2;
export const retreatDir={x:0,y:0};
