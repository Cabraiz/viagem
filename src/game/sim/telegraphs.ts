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
 */
import {RADIUS} from '../world.ts';
import type {Point} from '../world.ts';
import {ticks} from './types.ts';
import type {SimContext,SimPlayer,SimSystem,Telegraph} from './types.ts';

/** Minimum warning before any telegraph deals damage: 0.8 s. */
export const MIN_TELEGRAPH_TICKS=ticks(.8);
export const DEFAULT_LINE_WIDTH=1;
export const DEFAULT_CONE_ANGLE=Math.PI/3;
export type TelegraphSpec=Omit<Telegraph,'id'|'fireTick'>;
export type TelegraphShapeData=Pick<Telegraph,'shape'|'x'|'y'|'radius'|'dx'|'dy'|'width'>;

const TAU=Math.PI*2;
const finite=(...n:number[])=>n.every(Number.isFinite);

/** Pure geometry. padding = target body radius (players use world RADIUS). */
export function telegraphHits(t:TelegraphShapeData,p:Point,padding=0):boolean{
  const {x,y,radius}=t;
  if(!finite(x,y,radius,p.x,p.y,padding)||radius<0||padding<0)return false;
  const vx=p.x-x,vy=p.y-y,dist=Math.hypot(vx,vy);
  if(t.shape==='circle')return dist<=radius+padding;
  const dx=t.dx??NaN,dy=t.dy??NaN;
  if(!finite(dx,dy))return false;
  const len=Math.hypot(dx,dy);
  if(!(len>0))return false;
  const ux=dx/len,uy=dy/len;
  if(t.shape==='line'){
    const width=t.width??DEFAULT_LINE_WIDTH;
    if(!Number.isFinite(width)||width<0)return false;
    const along=vx*ux+vy*uy,across=Math.abs(vx*uy-vy*ux);
    return along>=-padding&&along<=radius+padding&&across<=width/2+padding;
  }
  if(t.shape==='cone'){
    const aperture=Math.min(TAU,t.width??DEFAULT_CONE_ANGLE);
    if(!(aperture>0))return false;
    if(dist>radius+padding)return false;
    if(dist<=padding)return true;
    const angle=Math.atan2(Math.abs(vx*uy-vy*ux),vx*ux+vy*uy);
    return angle<=aperture/2+Math.asin(Math.min(1,padding/dist));
  }
  return false;
}

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
      for(const p of hit)ctx.damagePlayer(p.id,t.damage,t.owner);
    }
  }};
}
export const telegraphSystem:SimSystem=createTelegraphSystem();
