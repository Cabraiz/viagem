/**
 * Telegraphed danger zones (VGM-038). Server-authoritative: damage applies only at fireTick.
 *
 * Shape conventions (world units; the renderer, VGM-039, draws exactly these areas):
 * - circle: center (x,y), radius = radius. Hit if distance <= radius+padding.
 * - line: starts at (x,y), unit direction (dx,dy), length = radius, full thickness = width ?? DEFAULT_LINE_WIDTH.
 *   Padded rectangle: hit if the projection on the axis is within [-padding, length+padding]
 *   and the perpendicular distance <= width/2+padding.
 * - cone: apex (x,y), unit direction (dx,dy), range = radius, FULL APERTURE ANGLE IN RADIANS = width ?? DEFAULT_CONE_ANGLE
 *   (an angle, not a chord length: the renderer must draw the arc from direction-width/2 to direction+width/2)
 *   (clamped to (0,2π]). Hit if distance <= range+padding and (distance <= padding or the angle between
 *   (p-apex) and the direction <= aperture/2 + asin(min(1,padding/distance))).
 * padding is the target body radius (players use world RADIUS). Non-finite input or a zero direction never hits.
 *
 * Owner rule: owner is an enemy id, a player id, or `env:<name>` for world hazards. When a telegraph fires,
 * a non-`env:` owner that is in neither ctx.players nor ctx.enemies, or is an enemy with hp<=0, is gone and the
 * telegraph resolves without damage (a boss killed earlier in the tick does not hit posthumously).
 *
 * D-036: `kind` names the hazard for the client's look, and two kinds also move the player they hit
 * (player-effects.ts): 'arroto' slows, 'coco' makes them slide. The effect lands before the damage (so a hit that
 * downs the player leaves nothing behind: the fall clears it) and lands even when armor takes the damage to 0.
 */
import {RADIUS} from '../maps/index.ts';
import type {Point} from '../maps/index.ts';
import {ticks} from '../contract/index.ts';
import {DEFAULT_CONE_ANGLE,DEFAULT_LINE_WIDTH,telegraphHits,type TelegraphShapeData} from '../rules/index.ts';
export {DEFAULT_CONE_ANGLE,DEFAULT_LINE_WIDTH,telegraphHits,type TelegraphShapeData};
import type {SimPlayer,Telegraph} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {applyTelegraphEffect,applyTelegraphPush} from './player-effects.ts';

/** Minimum warning before any telegraph deals damage: 0.8 s. */
export const MIN_TELEGRAPH_TICKS=ticks(.8);
export type TelegraphSpec=Omit<Telegraph,'id'|'fireTick'>;

/** Adds telegraph with fireTick=ctx.tick+max(delay,MIN_TELEGRAPH_TICKS) (delay in ticks, non-finite -> MIN), id ctx.nextId('tg'), stores in ctx.telegraphs, emits {type:'telegraph',telegraph:id}. Normalizes dx/dy to a unit vector for line/cone (zero/non-finite direction -> throw Error). Returns the stored Telegraph. */
export function addTelegraph(ctx:SimContext,spec:TelegraphSpec,delay:number):Telegraph{
  const wait=Number.isFinite(delay)?Math.max(Math.ceil(delay),MIN_TELEGRAPH_TICKS):MIN_TELEGRAPH_TICKS;
  let {dx,dy}=spec;
  if(spec.shape!=='circle'){
    const len=Math.hypot(dx??NaN,dy??NaN);
    if(!(len>0)||!Number.isFinite(len))throw new Error(`telegraph ${spec.shape} needs a non-zero direction`);
    dx=dx!/len;dy=dy!/len;
  }
  const telegraph:Telegraph={...spec,dx,dy,id:ctx.nextId('tg'),fireTick:ctx.tick+wait};
  if(telegraph.dx===undefined)delete telegraph.dx;
  if(telegraph.dy===undefined)delete telegraph.dy;
  ctx.telegraphs.set(telegraph.id,telegraph);
  ctx.emit({type:'telegraph',telegraph:telegraph.id});
  return telegraph;
}

/** Removes pending telegraphs of an owner without damage. Returns count removed. */
export function cancelTelegraphs(ctx:SimContext,owner:string):number{
  const ids=[...ctx.telegraphs.values()].filter(t=>t.owner===owner).map(t=>t.id);
  for(const id of ids)ctx.telegraphs.delete(id);
  return ids.length;
}

/**
 * True when a telegraph can hurt the player: not spectator, downed, eliminated or at hp 0.
 * Offline players are still hit, like ctx.damagePlayer does (D-011), so disconnecting never dodges a telegraph.
 */
export function canBeHit(p:SimPlayer):boolean{
  return !p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
}
/** True when attackers should aim at the player: hittable and online (no chasing idle bodies). */
export function canBeTargeted(p:SimPlayer):boolean{
  return p.online&&canBeHit(p);
}

function ownerGone(ctx:SimContext,owner:string){
  if(owner.startsWith('env:'))return false;
  const enemy=ctx.enemies.get(owner);
  if(enemy)return !(enemy.hp>0);
  return !ctx.players.has(owner);
}

export function createTelegraphSystem():SimSystem{
  return {id:'telegraphs',step(ctx){
    const due:Telegraph[]=[];
    for(const t of ctx.telegraphs.values())if(t.fireTick<=ctx.tick)due.push(t);
    for(const t of due){
      ctx.telegraphs.delete(t.id);
      if(ownerGone(ctx,t.owner))continue;
      const hit=[...ctx.players.values()].filter(p=>canBeHit(p)&&telegraphHits(t,p,RADIUS));
      for(const p of hit){
        applyTelegraphEffect(p,t,ctx.tick);
        // boss-fim-onda-1: the Tank's punch; the phones hear it (the shake, and no predicted steps while down).
        if(applyTelegraphPush(p,t,ctx.tick))ctx.emit({type:'knock',player:p.id,untilTick:p.downUntil!});
        ctx.damagePlayer(p.id,t.damage,t.owner);
      }
    }
  }};
}
export const telegraphSystem:SimSystem=createTelegraphSystem();
