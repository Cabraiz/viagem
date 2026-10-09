/**
 * Stonewards layer (VGM-046A): shared state for gathering, forge, wall and towers.
 * Server-only; everything here is JSON-safe so rooms can checkpoint it (VGM-047).
 */
import type {Point} from '../../world.ts';

export type ResourceKind='coco'|'pedra';
export const RESOURCE_KINDS:readonly ResourceKind[]=['coco','pedra'];
export type Balance=Record<ResourceKind,number>;

/** Finite gather node on a palm/tree (coco) or rock (pedra). Refills at each intermission. */
export interface ResourceNode extends Point {
  id:string; kind:ResourceKind; radius:number;
  /** Units left this round. */
  remaining:number; capacity:number;
  /** Shared work toward the next unit, in gatherer-ticks, and who put it in. */
  work:number; workBy:Record<string,number>;
}

export interface WallState extends Point {
  id:'muralha'; hp:number; maxHp:number; radius:number;
  /** Per-enemy next tick it may hit the wall again. */
  hitReady:Record<string,number>;
}

export interface TowerState extends Point {
  id:string; kind:'torre-chinelo'; owner:string;
  hp:number; maxHp:number; untilTick:number; readyTick:number;
}

export interface StonewardsState {
  balance:Balance;
  nodes:ResourceNode[];
  wall:WallState;
  towers:TowerState[];
  /** Units gathered per player (fractional: each unit is split by work done), for the result awards. */
  gathered:Record<string,number>;
  /** `playerId:requestId` of purchases already applied, so a resent command applies once. */
  handled:string[];
  /** Round index whose intermission already refilled nodes / sounded the horn. */
  refilledRound:number; hornRound:number;
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
