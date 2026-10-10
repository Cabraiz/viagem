/**
 * Projectile motion and collision (VGM-035), system id 'projectiles'.
 * Friendly projectiles hurt enemies only through ctx.damageEnemy; hostile ones hurt players only through ctx.damagePlayer.
 * Extra fields below ride on ProjectileState (JSON-safe), so types.ts stays untouched and the view keeps reading the base fields.
 */
import type {EnemyState,ProjectileState,SimContext,SimPlayer,SimSystem} from './types.ts';
import {SIM_HZ} from './types.ts';
import {RADIUS as PLAYER_RADIUS} from '../world.ts';
import {getWeapon} from './weapons/catalog.ts';

/** Local projectile ceiling until the shared budget (VGM-032) is wired in by integration. */
export const PROJECTILE_CAP=400;
/** Largest enemy radius a collision query must reach (boss). */
export const MAX_ENEMY_RADIUS=1.5;
/** Extra query reach because the spatial index may lag enemy movement within the tick. */
const INDEX_SLACK=.5;
const DT=1/SIM_HZ;

export type ProjectileMotion='linear'|'orbit'|'follow'|'homing';
export interface WeaponProjectile extends ProjectileState {
  /** Defaults to 'linear' (vx/vy in units per second). */
  motion?:ProjectileMotion;
  /** Player the projectile is attached to (orbit/follow). */
  anchor?:string;
  angle?:number; orbitRadius?:number;
  /** Orbit angular speed in radians per tick. */
  spin?:number;
  /** Enemy id a homing projectile steers toward; reacquired within `seek` when it dies. */
  homing?:string; seek?:number;
  /** Max steering per tick in radians. */
  turn?:number;
  /** Area mode: hits each enemy at most once every `rehit` ticks per `group`, never consumes pierce. */
  rehit?:number; group?:string;
  knockback?:number; slowTicks?:number;
  /** Destroys hostile projectiles that touch it (guarda-chuva). */
  blocksHostile?:boolean;
  /** Boomerang: at this tick velocity reverses and `hit` resets once for the return pass. */
  returnTick?:number;
}
export type ProjectileInit=Omit<WeaponProjectile,'id'|'hit'>&{hit?:string[]};

/**
 * Area hit cooldowns live on the enemy (JSON-safe, D-002): group -> tick when that group may hit it again.
 * They die with the enemy, survive snapshots and cannot leak into a rematch that reuses enemy ids.
 */
export interface WeaponHitMemory {weaponHits?:Record<string,number>}

/** True (and the cooldown is armed) if `group` may hit `enemy` this tick. */
export function takeAreaHit(enemy:EnemyState,group:string,tick:number,rehit:number):boolean{
  const e=enemy as EnemyState&WeaponHitMemory,hits=e.weaponHits??(e.weaponHits={});
  if((hits[group]??-1)>tick)return false;
  for(const key of Object.keys(hits))if(hits[key]<=tick)delete hits[key];
  hits[group]=tick+Math.max(1,rehit);
  return true;
}

/** Player can act (fire weapons, take hostile projectile hits). */
export function canAct(player:SimPlayer){
  return player.online&&!player.spectator&&!player.downed&&!player.eliminated&&player.hp>0;
}

/**
 * Owner evolved the weapon that fired `source` (its evolution is now in the build).
 * Only evolution retires live projectiles; skills or towers with non-weapon sources are never touched.
 */
export function superseded(player:SimPlayer,source:string){
  return player.build.weapons.some(w=>getWeapon(w.id)?.base===source);
}

export function isAlive(ctx:SimContext,enemy:EnemyState){
  return ctx.enemies.get(enemy.id)===enemy&&enemy.hp>0;
}

/** Adds a projectile unless the map already holds `cap` of them. */
export function spawnProjectile(ctx:SimContext,init:ProjectileInit,cap=PROJECTILE_CAP):WeaponProjectile|undefined{
  if(ctx.projectiles.size>=cap)return undefined;
  const p:WeaponProjectile={...init,id:ctx.nextId('p'),hit:init.hit?[...init.hit]:[]};
  ctx.projectiles.set(p.id,p);
  return p;
}

/**
 * Damage plus on-hit effects. Knockback/slow only touch survivors; bosses ignore knockback.
 * Returns true when the hit killed the enemy.
 */
export function hitEnemy(ctx:SimContext,enemy:EnemyState,damage:number,owner:string,source:string,
  push?:{x:number;y:number;force:number},slowTicks?:number):boolean{
  const killed=ctx.damageEnemy(enemy.id,damage,owner,source);
  if(killed||!isAlive(ctx,enemy))return true;
  if(push&&push.force>0&&!enemy.boss){
    const len=Math.hypot(push.x,push.y);
    if(len>1e-9)enemy.knock={x:push.x/len*push.force,y:push.y/len*push.force};
  }
  if(slowTicks&&slowTicks>0)enemy.slowUntil=Math.max(enemy.slowUntil??0,ctx.tick+slowTicks);
  return false;
}

/** Squared distance from point to segment, plus the segment parameter of the closest point. */
function segmentDistance(ax:number,ay:number,bx:number,by:number,px:number,py:number){
  const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
  const t=len2>0?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2)):0;
  const cx=ax+dx*t-px,cy=ay+dy*t-py;
  return {d2:cx*cx+cy*cy,t};
}

const wrapAngle=(a:number)=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};

export function createProjectileSystem(opts:{cap?:number}={}):SimSystem{
  const cap=opts.cap??PROJECTILE_CAP;
  const prev=new Map<string,{x:number;y:number}>();
  const candidates:EnemyState[]=[];
  const shields:WeaponProjectile[]=[];

  /** Moves the projectile; returns false when it must be removed. */
  function move(ctx:SimContext,p:WeaponProjectile):boolean{
    const motion=p.motion??'linear';
    if(p.rehit!==undefined&&motion==='linear'){
      // Ground zones also retire when their weapon evolves, so base and evolved areas never stack.
      const owner=ctx.players.get(p.owner);
      if(owner&&superseded(owner,p.source))return false;
    }
    if(motion==='orbit'||motion==='follow'){
      const owner=p.anchor?ctx.players.get(p.anchor):undefined;
      if(!owner||!canAct(owner))return false;
      // Evolving the weapon retires its anchored projectiles, so base and evolution never overlap.
      if(superseded(owner,p.source))return false;
      if(motion==='follow'){p.x=owner.x;p.y=owner.y;p.vx=0;p.vy=0;return true;}
      const r=p.orbitRadius??1,spin=p.spin??0;
      p.angle=(p.angle??0)+spin;
      p.x=owner.x+Math.cos(p.angle)*r;p.y=owner.y+Math.sin(p.angle)*r;
      // Tangential velocity lets clients extrapolate between frames.
      p.vx=-Math.sin(p.angle)*r*spin*SIM_HZ;p.vy=Math.cos(p.angle)*r*spin*SIM_HZ;
      return true;
    }
    if(motion==='homing')steer(ctx,p);
    if(p.returnTick!==undefined&&ctx.tick>=p.returnTick){
      // Return pass may hit everyone again, except enemies still touching it at the turn (no 2-tick double hit).
      p.vx=-p.vx;p.vy=-p.vy;p.returnTick=undefined;
      p.hit=p.hit.filter(id=>{const e=ctx.enemies.get(id);return !!e&&Math.hypot(e.x-p.x,e.y-p.y)<=p.radius+e.radius;});
    }
    p.x+=p.vx*DT;p.y+=p.vy*DT;
    return true;
  }

  function steer(ctx:SimContext,p:WeaponProjectile){
    let target=p.homing?ctx.enemies.get(p.homing):undefined;
    // Retarget when the current target died or was already hit (piercing pigeons move on).
    if(!target||target.hp<=0||p.hit.includes(target.id)){
      target=ctx.enemyIndex.nearest(p.x,p.y,p.seek??6,e=>isAlive(ctx,e)&&!p.hit.includes(e.id));
      p.homing=target?.id;
    }
    if(!target)return;
    const speed=Math.hypot(p.vx,p.vy);
    if(speed<=1e-9)return;
    const current=Math.atan2(p.vy,p.vx),wanted=Math.atan2(target.y-p.y,target.x-p.x);
    const turn=p.turn??.2,delta=Math.max(-turn,Math.min(turn,wrapAngle(wanted-current)));
    const a=current+delta;
    p.vx=Math.cos(a)*speed;p.vy=Math.sin(a)*speed;
  }

  function collideFriendly(ctx:SimContext,p:WeaponProjectile,from:{x:number;y:number}):boolean{
    const half=Math.hypot(p.x-from.x,p.y-from.y)/2;
    const mx=(p.x+from.x)/2,my=(p.y+from.y)/2;
    candidates.length=0;
    ctx.enemyIndex.query(mx,my,half+p.radius+MAX_ENEMY_RADIUS+INDEX_SLACK,candidates);
    const hits:{e:EnemyState;t:number}[]=[];
    for(const e of candidates){
      if(!isAlive(ctx,e))continue;
      const {d2,t}=segmentDistance(from.x,from.y,p.x,p.y,e.x,e.y),reach=p.radius+e.radius;
      if(d2<=reach*reach)hits.push({e,t});
    }
    // Orbiters also sweep the spoke from the owner to the ring: an enemy hugging the owner sits inside the ring
    // (contact ~0.6 vs ring inner edge ~0.9 for the chinelo) and would otherwise never be hit while standing still.
    const owner=p.motion==='orbit'&&p.anchor?ctx.players.get(p.anchor):undefined;
    if(owner){
      candidates.length=0;
      ctx.enemyIndex.query(owner.x,owner.y,(p.orbitRadius??1)+p.radius+MAX_ENEMY_RADIUS+INDEX_SLACK,candidates);
      for(const e of candidates){
        if(!isAlive(ctx,e)||hits.some(h=>h.e===e))continue;
        const {d2}=segmentDistance(owner.x,owner.y,p.x,p.y,e.x,e.y),reach=p.radius+e.radius;
        if(d2<=reach*reach)hits.push({e,t:0});
      }
    }
    // Deterministic order: along the path, then id.
    hits.sort((a,b)=>a.t-b.t||(a.e.id<b.e.id?-1:a.e.id>b.e.id?1:0));
    const area=p.rehit!==undefined;
    for(const {e} of hits){
      if(!isAlive(ctx,e))continue;
      if(area){
        if(!takeAreaHit(e,p.group??p.id,ctx.tick,p.rehit??1))continue;
      }else{
        if(p.hit.includes(e.id))continue;
        p.hit.push(e.id);
      }
      const moving=Math.hypot(p.vx,p.vy)>1e-6&&p.motion!=='orbit';
      const push={x:moving?p.vx:e.x-p.x,y:moving?p.vy:e.y-p.y,force:p.knockback??0};
      hitEnemy(ctx,e,p.damage,p.owner,p.source,push,p.slowTicks);
      if(!area){
        if(p.pierce<=0)return false;
        p.pierce--;
      }
    }
    return true;
  }

  /** Resolves along the path: an umbrella blocks the shot only from where the shot meets it. */
  function collideHostile(ctx:SimContext,p:WeaponProjectile,from:{x:number;y:number}):boolean{
    let block=Infinity;
    for(const s of shields){
      const reach=s.radius+p.radius,{d2,t}=segmentDistance(from.x,from.y,p.x,p.y,s.x,s.y);
      if(d2<=reach*reach)block=Math.min(block,t);
    }
    const victims:{player:SimPlayer;t:number}[]=[];
    for(const player of ctx.players.values()){
      if(!canAct(player)||p.hit.includes(player.id))continue;
      const reach=p.radius+PLAYER_RADIUS,{d2,t}=segmentDistance(from.x,from.y,p.x,p.y,player.x,player.y);
      if(d2<=reach*reach&&t<block)victims.push({player,t});
    }
    victims.sort((a,b)=>a.t-b.t||(a.player.id<b.player.id?-1:a.player.id>b.player.id?1:0));
    for(const {player} of victims){
      p.hit.push(player.id);
      ctx.damagePlayer(player.id,p.damage,p.owner);
      if(p.pierce<=0)return false;
      p.pierce--;
    }
    return block===Infinity;
  }

  return {
    id:'projectiles',
    step(ctx){
      const tick=ctx.tick;
      // Enforce the ceiling even if another system inserted directly: drop oldest friendly first.
      if(ctx.projectiles.size>cap){
        for(const [id,p] of ctx.projectiles){
          if(ctx.projectiles.size<=cap)break;
          if(!p.hostile)ctx.projectiles.delete(id);
        }
      }
      prev.clear();shields.length=0;
      // Pass 1: expire and move everything, so collisions see this tick's positions.
      for(const [id,base] of ctx.projectiles){
        const p=base as WeaponProjectile;
        if(tick>=p.untilTick){ctx.projectiles.delete(id);continue;}
        const from={x:p.x,y:p.y};
        if(!move(ctx,p)){ctx.projectiles.delete(id);continue;}
        // Anchored projectiles jump with their owner; sweep only their own motion, not the owner's walk.
        if(p.motion==='follow')prev.set(id,{x:p.x,y:p.y});
        else if(p.motion==='orbit'){
          // Chord of this tick's arc, relative to the owner's current position, so fast spins cannot skip enemies.
          const r=p.orbitRadius??1,a=p.angle??0,back=a-(p.spin??0);
          prev.set(id,{x:p.x-Math.cos(a)*r+Math.cos(back)*r,y:p.y-Math.sin(a)*r+Math.sin(back)*r});
        }else prev.set(id,from);
        if(!p.hostile&&p.blocksHostile)shields.push(p);
      }
      // Pass 2: collisions.
      for(const [id,base] of ctx.projectiles){
        const p=base as WeaponProjectile,from=prev.get(id)??p;
        const keep=p.hostile?collideHostile(ctx,p,from):collideFriendly(ctx,p,from);
        if(!keep)ctx.projectiles.delete(id);
      }
    },
  };
}
