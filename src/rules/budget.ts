/**
 * Entity budgets for the horde run (VGM-032).
 * Caps keep the server tick and the snapshot size bounded; systems ask for room before creating entities.
 * D-054: no XP gems (a kill's XP goes straight to the team), so nothing merges: a pickup without room is not created.
 */

/** Live enemies (VS uses ~300 for periodic spawns). The director may receive a lower cap. */
export const MAX_ENEMIES=300;
/** Player and hostile projectiles together. */
export const MAX_PROJECTILES=400;
/**
 * The user's slower shots (velocidade-heroi-e-projetil, D-0xx not yet): every TRAVELLING projectile (the heroes' pierce
 * and homing weapons, the orbit's flung sandals, the agiota's boleto) flies at this × its tuned speed and lives
 * 1 / this × its tuned time, so it reaches the same distance. Lasting ones (orbit, zone, shield) keep their time.
 * Longer lives mean more shots alive at once; MAX_PROJECTILES is unchanged.
 */
export const PROJECTILE_SPEED_MULT=.5;
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
