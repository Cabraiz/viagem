/**
 * When a bot is in peril (bot-brain's TURN_HOLD lets it turn back at once): a critter within PERIL_R, a shot heading in
 * or a telegraph over it. Apart from bot-brain.ts (the 400-line limit, card bot-nao-trava).
 */
import type {RunView} from '../contract/index.ts';
import type {Point} from '../maps/index.ts';
import {telegraphHits} from '../rules/index.ts';

/** A critter this close (u, its centre), a shot heading in or a telegraph lets the bot turn back at once. */
export const PERIL_R=1.4;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
/** A critter within PERIL_R of `at` (more for a boss or an elite); `ahead`: only one in front of that heading. */
export const perilAhead=(view:RunView,at:Point,ahead?:Point)=>view.enemies.some(e=>e.hp>0&&!e.asleep
  &&dist(e,at)<PERIL_R*(e.boss?1.8:e.elite?1.3:1)&&(!ahead||(e.x-at.x)*ahead.x+(e.y-at.y)*ahead.y>0));
export function peril(view:RunView,at:Point,ahead?:Point){
  if(perilAhead(view,at,ahead))return true;
  if(view.telegraphs.some(t=>telegraphHits(t,at,.4)))return true;
  return view.projectiles.some(s=>{
    if(!s.hostile)return false;
    const rx=at.x-s.x,ry=at.y-s.y,speed=Math.hypot(s.vx,s.vy);
    return Math.hypot(rx,ry)<4&&speed>1e-3&&rx*s.vx+ry*s.vy>0;
  });
}
