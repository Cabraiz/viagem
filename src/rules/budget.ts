/**
 * Entity budgets for the horde run (VGM-032).
 * Caps keep the server tick and the snapshot size bounded; systems ask for room before creating entities.
 * D-054: no XP gems (a kill's XP goes straight to the team), so nothing merges: a pickup without room is not created.
 */

/** Live enemies (VS uses ~300 for periodic spawns). The director may receive a lower cap. */
export const MAX_ENEMIES=300;
/**
 * Mode 'ninhos' (card ninhos-perto-ataca-20x): the sleepers that may be awake at once on the map. The noise and a hero
 * walking up stop waking there (a hit never does). Measured 18/10 (scripts/bench-ninhos-20x.ts, 6 bots, 5950 bodies,
 * i5-12400F): ~730 awake p95 4.9 ms a tick, ~1600 11.9 ms, ~3100 23 ms, ~5400 34 ms; 1500 keeps ~2× room for the
 * Worker's slower CPU under the 50 ms of a 20 Hz tick. Each client gets the nearest AWAKE_PER_VIEWER of them.
 */
export const MAX_AWAKE=1500;
/** Player and hostile projectiles together. */
export const MAX_PROJECTILES=400;
/**
 * The user's slower shots (velocidade-heroi-e-projetil, D-0xx not yet): every TRAVELLING projectile (the heroes' pierce
 * and homing weapons, the orbit's flung sandals, the agiota's boleto) flies at this × its tuned speed and lives
 * 1 / this × its tuned time, so it reaches the same distance. Lasting ones (orbit, zone, shield) keep their time.
 * Longer lives mean more shots alive at once; MAX_PROJECTILES is unchanged.
 */
export const PROJECTILE_SPEED_MULT=.5;
/**
 * Card upgrades-megabonk (usuário 22/10: "nossos projéteis 5x mais lentos, ou 4"; after the GIFs of 4× and 5× he chose
 * 3×, via the Orquestrador at 04:25Z): the HEROES' travelling shots (pierce
 * and homing weapons, the flung sandals) fly HERO_SHOT_SLOWDOWN × slower than PROJECTILE_SPEED_MULT made them and live
 * HERO_SHOT_SLOWDOWN × longer, so they still reach as far; the "velocidade do projétil" upgrade buys the speed back. The
 * enemies' shots (the agiota's boleto, a reflected shot) keep PROJECTILE_SPEED_MULT.
 * Card projetil-mais-rapido (usuário 25/10: "50% mais rápido no início"): 3 → 2, so a fresh hero's shots fly 1.5 × as
 * fast (and live 2/3 as long: the same reach); the Estilingue still multiplies on top.
 */
export const HERO_SHOT_SLOWDOWN=2;
/** The heroes' travelling shots: PROJECTILE_SPEED_MULT / HERO_SHOT_SLOWDOWN × the tuned speed, for the inverse × the time. */
export const HERO_SHOT_SPEED_MULT=PROJECTILE_SPEED_MULT/HERO_SHOT_SLOWDOWN;
/** All pickups (heal, chests, resources, items, the zueira's boletos). */
export const MAX_PICKUPS=250;
export const MAX_TELEGRAPHS=24;

export const BUDGET=Object.freeze({
  enemies:MAX_ENEMIES,projectiles:MAX_PROJECTILES,pickups:MAX_PICKUPS,telegraphs:MAX_TELEGRAPHS,
});

/** Caps are whole, non-negative counts; NaN or negative caps mean no room. */
const limit=(cap:number)=>cap>=0?Math.floor(cap):0;

/** How many more entities fit under the cap (never negative). */
export function room(size:number,cap:number){return Math.max(0,limit(cap)-size);}
export function hasRoom(collection:{readonly size:number},cap:number,count=1){return room(collection.size,cap)>=count;}
