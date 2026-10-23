/**
 * Pack 12 fatia A2 (E7): the `ricochet` pattern (bola-murcha). A straight shot that, on a hit, turns toward the nearest
 * enemy it has not hit yet within BOUNCE_RADIUS, `pierce` times (the bounces); with nobody there, or no bounce left, it
 * is spent like a shot with pierce 0.
 */
import type {EnemyState} from '../../contract/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {isAlive,spawnProjectile,type WeaponProjectile} from '../projectiles.ts';
import {isReflecting} from '../enemies/catalog.ts';
import type {FirePattern,PatternReach} from './fire-api.ts';

/** How far a bounce looks for the next head (u): the proposal's "raio 4". */
export const BOUNCE_RADIUS=4;
/** Ticks of flight a bounce adds beyond the time to reach its next head, so it lands even when the old life is spent. */
const BOUNCE_SLACK=3;

/** Flight distance plus the shot's radius, capped by the range (like a straight shot). */
export const ricochetReach:PatternReach=w=>({reach:Math.min(w.range,w.speed*w.durationTicks/SIM_HZ+w.area),pad:false});

/** The volley (system.ts fire, pattern 'ricochet'): one ball per `amount`, each at the next enemy in reach. */
export const fireRicochet:FirePattern=(ctx,player,w,api)=>{
  const aimed=api.targets(ctx,player,ricochetReach(w).reach,w.amount);
  if(!aimed.length)return false;
  let spawned=0,first:{x:number;y:number}|undefined;
  for(let i=0;i<w.amount;i++){
    const t=aimed[i%aimed.length],dx=t.x-player.x,dy=t.y-player.y,len=Math.hypot(dx,dy);
    const d=len>1e-9?{x:dx/len,y:dy/len}:player.facing;
    const p=spawnProjectile(ctx,{
      owner:player.id,source:w.def.id,motion:'linear',x:player.x,y:player.y,vx:d.x*w.speed,vy:d.y*w.speed,
      radius:w.area,damage:w.damage,pierce:0,hostile:false,knockback:w.knockback,untilTick:ctx.tick+w.durationTicks,
      mechanic:'ricochet',data:{bounces:w.pierce},
    },api.cap);
    if(p){spawned++;first??=d;}
  }
  if(first)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:first.x,dy:first.y});
  return spawned>0;
};

/**
 * Called by the projectile system right after a `mechanic:'ricochet'` shot damaged `enemy` (projectiles.ts
 * collideFriendly). True: the shot bounced (it lives on and stops hitting this tick); false: the usual pierce rule.
 * The next head is the nearest live one not hit yet (a posing influencer only if nobody else is there); ties by id.
 */
export function bounceAfterHit(ctx:SimContext,p:WeaponProjectile,enemy:EnemyState):boolean{
  const left=p.data?.bounces??0;
  if(left<=0)return false;
  const out:EnemyState[]=[];
  ctx.enemyIndex.query(enemy.x,enemy.y,BOUNCE_RADIUS,out);
  let best:EnemyState|undefined,bestD=Infinity,bestPosing=true;
  for(const e of out){
    if(e===enemy||!isAlive(ctx,e)||p.hit.includes(e.id))continue;
    const d=Math.hypot(e.x-p.x,e.y-p.y);
    if(d>BOUNCE_RADIUS)continue;
    const posing=isReflecting(e,ctx.tick);
    if(best&&(posing!==bestPosing?posing:d>bestD||d===bestD&&e.id>best.id))continue;
    best=e;bestD=d;bestPosing=posing;
  }
  if(!best)return false;
  const speed=Math.hypot(p.vx,p.vy);
  if(bestD>1e-9){p.vx=(best.x-p.x)/bestD*speed;p.vy=(best.y-p.y)/bestD*speed;}
  p.data={...p.data,bounces:left-1};
  if(speed>1e-9)p.untilTick=Math.max(p.untilTick,ctx.tick+Math.ceil(bestD/speed*SIM_HZ)+BOUNCE_SLACK);
  return true;
}
