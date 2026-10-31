/**
 * NEW-20261031-ORQ-itens-so-de-monstro-ultra-raro (the user, 31/10: "nao deveria spawnar mais itens no jogo aleatorio,
 * se spawnar vai ser ultra raro e é quando matar o monstro"; the ORQ's option A, 05:42Z):
 *  - MAP_CRATES off: the map's own sources stay in crates.ts as legacy, switched off (placed, start, trail, floor,
 *    respawn). Only the near crate is left, one a hero at the first step (the heroes start empty-handed), and it always
 *    shows NEAR_WEAPON: a weapon, never a kit, the same for everyone, never redrawn (crates.ts stock/restock);
 *  - the kill drop (killDrop): a dead monster leaves a crate with KILL_CRATE_CHANCE, an elite with ELITE_CRATE_CHANCE
 *    (its old sure chest, progression dropLoot, is taken back first). The roll is on the enemy's own stream (seed,
 *    enemy id), so no other draw shifts it; the crate sits off the street mouths (none found: no crate) and crates.ts
 *    dropCrate keeps it ITEM_MIN_GAP from the other items. The boss's chest, the nests and the cédulas do not change.
 */
import type {EnemyState,PickupState,Point} from '../contract/index.ts';
import {Rng} from '../contract/index.ts';
import {CRATE_BODY_RADIUS} from '../rules/index.ts';
import {cityTerrainOf} from './city/grid.ts';
import type {SimContext} from './context.ts';
import {crateInMouth} from './crates-gap.ts';
import type {Rarity} from './weapons/arsenal.ts';

/** The map's own crate sources (see the header); false since itens-so-de-monstro. */
export const MAP_CRATES=false;
/** What every near crate gives (a verde one): the first weapon of each hero. */
export const NEAR_WEAPON='pistola';
/**
 * A common monster's crate (measured on scripts/diag-caixas-abate.ts, seeds 1-3: a solo bot kills ~14 monsters a
 * minute in its first 10 min, so this is about one crate every 5 min; the map's crates gave ~42 in those 10 min) and an
 * elite's, rarer than its old sure chest.
 */
export const KILL_CRATE_CHANCE=.015,ELITE_CRATE_CHANCE=.15;
/** A kill crate's colour: verde or azul for a common monster, azul or roxa for an elite. */
export const KILL_ODDS:readonly (readonly [Rarity,number])[]=[[1,.6],[2,.4]],ELITE_KILL_ODDS:readonly (readonly [Rarity,number])[]=[[2,.6],[3,.4]];
/** How far a kill crate looks for a spot off a street mouth: rings STEP u apart out to REACH u, ANGLES each. */
export const KILL_MOUTH_REACH=12,KILL_MOUTH_STEP=.5,KILL_MOUTH_ANGLES=24;

/** The crate a kill leaves (its colour), or none: the enemy's own stream (seed, enemy id). The boss never (its chest). */
export function killRoll(seed:number,enemy:Pick<EnemyState,'id'|'elite'|'boss'>):Rarity|undefined{
  if(enemy.boss)return undefined;
  const rng=new Rng(seed).fork(`abate:${enemy.id}`);
  if(rng.next()>=(enemy.elite?ELITE_CRATE_CHANCE:KILL_CRATE_CHANCE))return undefined;
  let u=rng.next();
  const odds=enemy.elite?ELITE_KILL_ODDS:KILL_ODDS;
  for(const [rarity,chance] of odds){if(u<chance)return rarity;u-=chance;}
  return odds[odds.length-1][0];
}

/** `at`, or the nearest spot off every street mouth with open ground for a crate's body; none: undefined. */
export function offMouth(ctx:SimContext,at:Point):Point|undefined{
  const city=cityTerrainOf(ctx.terrain);
  if(!city||!crateInMouth(city,at.x,at.y))return {x:at.x,y:at.y};
  for(let r=KILL_MOUTH_STEP;r<=KILL_MOUTH_REACH;r+=KILL_MOUTH_STEP)for(let k=0;k<KILL_MOUTH_ANGLES;k++){
    const a=k*2*Math.PI/KILL_MOUTH_ANGLES,x=Math.round((at.x+Math.cos(a)*r)*100)/100,y=Math.round((at.y+Math.sin(a)*r)*100)/100;
    if(!crateInMouth(city,x,y)&&city.clearDisc(x,y,CRATE_BODY_RADIUS))return {x,y};
  }
  return undefined;
}

/**
 * A kill (assemble's onKill, after progression dropLoot with its `drops`): with MAP_CRATES off, the elite's sure chest
 * goes, and the kill leaves a crate (`drop`: crates.ts dropCrate) when killRoll says so. No crates (`drop` absent: the
 * automatic combat, whose chests are the evolutions'): nothing changes. Returns the crate's spot, if any.
 */
export function killDrop(ctx:SimContext,seed:number,enemy:EnemyState,drops:readonly PickupState[],drop?:(ctx:SimContext,at:Point,rarity:Rarity)=>void):Point|undefined{
  if(MAP_CRATES||!drop)return undefined;
  for(const p of drops)if(p.kind==='chest')ctx.pickups.delete(p.id);
  const rarity=killRoll(seed,enemy),at=rarity&&offMouth(ctx,enemy);
  if(!rarity||!at)return undefined;
  drop(ctx,at,rarity);
  return at;
}
