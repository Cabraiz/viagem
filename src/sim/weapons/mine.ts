/**
 * Pack 12 fatia A2 (E7): the `mine` pattern (panela-de-pressao). Dropped at the owner's feet (`mechanic:'mine'`, still,
 * its radius the trigger `range`), it lives `duration` and bursts in `area` for `damage` when an enemy touches it. At
 * most MAX_MINES per owner: a new one retires the oldest. The drop is quiet; the burst is the 'fire' event (noise, blast).
 */
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {MAX_ENEMY_RADIUS,hitEnemy,isAlive,queryHittable,spawnProjectile,type WeaponProjectile} from '../projectiles.ts';
import {PIERCE_INFINITE} from './catalog.ts';
import type {FirePattern,PatternReach} from './fire-api.ts';

/** Live pots per owner (the proposal's "até 3 vivas"). */
export const MAX_MINES=3;

/** A mine is dropped when an enemy is within its trigger reach plus the burst. */
export const mineReach:PatternReach=w=>({reach:w.range+w.area,pad:true});

/** The volley (system.ts fire, pattern 'mine'): a pot at the feet, once something is near enough to come to it. */
export const fireMine:FirePattern=(ctx,player,w,api)=>{
  const {reach,pad}=mineReach(w);
  if(!api.targets(ctx,player,reach,1,pad).length)return false;
  const mine=spawnProjectile(ctx,{
    owner:player.id,source:w.def.id,motion:'linear',x:player.x,y:player.y,vx:0,vy:0,radius:w.range,damage:w.damage,
    pierce:PIERCE_INFINITE,hostile:false,knockback:w.knockback,untilTick:ctx.tick+w.durationTicks,
    mechanic:'mine',data:{area:w.area},
  },api.cap);
  if(!mine)return false;
  const live=minesOf(ctx,player.id,w.def.id);
  for(let i=0;i<live.length-MAX_MINES;i++)ctx.projectiles.delete(live[i].id);
  return true;
};

/** The owner's live pots of `source`, oldest first (the map keeps insertion order). */
export function minesOf(ctx:SimContext,owner:string,source:string):WeaponProjectile[]{
  const out:WeaponProjectile[]=[];
  for(const base of ctx.projectiles.values()){
    const p=base as WeaponProjectile;
    if(p.mechanic==='mine'&&!p.hostile&&p.owner===owner&&p.source===source)out.push(p);
  }
  return out;
}

const scratch:EnemyState[]=[];
/**
 * Called by the projectile system when a live enemy touches a `mechanic:'mine'` projectile, instead of the contact hit
 * (projectiles.ts collideFriendly). The pot bursts: `damage` to every enemy within `area` (+ its radius), pushed away
 * from the pot, in id order. False: the mine is gone.
 */
export function mineTouched(ctx:SimContext,p:WeaponProjectile,_enemy:EnemyState):boolean{
  const area=p.data?.area??p.radius;
  queryHittable(ctx,p.x,p.y,area+MAX_ENEMY_RADIUS,scratch);
  const hit=scratch.filter(e=>isAlive(ctx,e)&&Math.hypot(e.x-p.x,e.y-p.y)<=area+e.radius).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  for(const e of hit)hitEnemy(ctx,e,p.damage,p.owner,p.source,{x:e.x-p.x,y:e.y-p.y,force:p.knockback??0});
  ctx.emit({type:'fire',player:p.owner,weapon:p.source,x:p.x,y:p.y,dx:0,dy:0});
  return false;
}
