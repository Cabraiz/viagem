/**
 * D-051 mode 'ninhos' without rounds (card NEW-20261014-ORQ-ninhos-rounds-fora): the sim's side of rules/calma.ts.
 * ctx.enemies holds only the critters awake (the sleepers live in sono.ts), so calm reads them through the index.
 */
import {CALMA} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';

/**
 * Whether `playerId` may use what waited for an intermission (the forge, the towers' orders) now: in the rounds
 * mode the gate is absent (phase 'prepare' decides); in mode 'ninhos' assemble.ts hands calmGate().
 */
export type CalmGate=(ctx:SimContext,playerId:string)=>boolean;
/** No critter alive (awake) within `r` of (x, y). */
export function calmAt(ctx:SimContext,x:number,y:number,r:number):boolean{
  return !ctx.enemyIndex.nearest(x,y,r,e=>e.hp>0&&ctx.enemies.has(e.id));
}
/** The gate of mode 'ninhos': the player is in the run and has no critter awake within CALMA.forgeR. */
export const calmGate=(r=CALMA.forgeR):CalmGate=>(ctx,playerId)=>{
  const p=ctx.players.get(playerId);
  return !!p&&calmAt(ctx,p.x,p.y,r);
};
