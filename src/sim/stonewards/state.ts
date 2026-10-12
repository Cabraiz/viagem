/**
 * Stonewards layer (VGM-046A, wired into the run by VGM-046B): shared state for gathering, forge, wall and towers.
 * Server-only; everything here is JSON-safe so rooms can checkpoint it (VGM-047).
 */
import type {Point} from '../../maps/world.ts';
import type {Balance,ResourceKind} from '../../rules/stonewards.ts';

export type {Balance,ResourceKind} from '../../rules/stonewards.ts';
export {RESOURCE_KINDS} from '../../rules/stonewards.ts';

/**
 * A gather node somebody worked this round (base-stonewards-mapa). Nodes are the map's obstacles (coco on palms and
 * trees, pedra on rocks), so the list is sparse: an untouched node is full and costs nothing. Cleared each intermission.
 */
export interface ResourceNode extends Point {
  id:string; kind:ResourceKind; radius:number;
  /** Units of work left this round. */
  remaining:number; capacity:number;
  /** What one unit is worth (rules.ts nodeValue: farther from the base, more). */
  value:number;
  /** Shared work toward the next unit, in gatherer-ticks, and who put it in. */
  work:number; workBy:Record<string,number>;
}

export interface WallState extends Point {
  id:'muralha'; hp:number; maxHp:number; radius:number;
  /** Per-enemy next tick it may hit the wall again (only the 046A siegeStep path, off in the run, D-017). */
  hitReady:Record<string,number>;
}

export interface TowerState extends Point {
  id:string; kind:'torre-chinelo'; owner:string;
  hp:number; maxHp:number; untilTick:number; readyTick:number;
}

export interface StonewardsState {
  balance:Balance;
  /** Nodes touched this round, in the order they were first worked. */
  nodes:ResourceNode[];
  wall:WallState;
  towers:TowerState[];
  /** Resources gathered per player (fractional: each unit is split by work done), for the result awards. */
  gathered:Record<string,number>;
  /** `playerId:requestId` of purchases already applied, so a resent command applies once. */
  handled:string[];
  /** Round index whose intermission already refilled nodes / sounded the horn. */
  refilledRound:number; hornRound:number;
  /** Tick the current intermission started (caps how far the horn may stretch it). */
  prepareStart:number;
  /** Ticks the horn already stretched intermissions this run (capped by MAX_STRETCH_PER_RUN). */
  stretched:number;
  /** End of the intermission the horn announced (the HUD's "back to base" countdown); -1 when none. */
  hornEndsTick:number;
  /** D-013 limiter: per source, first tick another `say` may go out. */
  sayReady:Record<string,number>;
  wallDown:boolean;
  /** Defeat already reported; lives in the state so a checkpoint restore does not report it again. */
  defeatReported:boolean;
  /** Own Rng state (D-011), seeded from ctx.rng.fork('structures') on first use; null until then. */
  rng:number|null;
}

/** Adds to a counter keyed by an arbitrary id, safe for ids like '__proto__' or 'constructor'. */
export function bump(record:Record<string,number>,key:string,amount:number){
  const prev=Object.hasOwn(record,key)?record[key]:0;
  Object.defineProperty(record,key,{value:prev+amount,enumerable:true,writable:true,configurable:true});
}
