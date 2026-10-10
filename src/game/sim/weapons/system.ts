/**
 * Auto-firing weapons (VGM-035), system id 'weapons'. Runs before 'projectiles' in SYSTEM_ORDER:
 * it only spawns projectiles (moved and collided by the projectile system) except the audio cone, which hits instantly.
 * Damage passed to ctx.damageEnemy is base weapon damage; the core applies might.
 */
import type {EnemyState,SimContext,SimPlayer,SimSystem} from '../types.ts';
import {SIM_HZ,ticks} from '../types.ts';
import {PIERCE_INFINITE,resolveWeapon,weaponCatalog} from './catalog.ts';
import type {ResolvedWeapon,WeaponDef} from './catalog.ts';
import {PROJECTILE_CAP,canAct,hitEnemy,isAlive,spawnProjectile} from '../projectiles.ts';

/** Speed and life of sandals flung by the evolved orbit. */
const FLING_SPEED=8,FLING_SECONDS=1,FLING_PIERCE=2;
/** Angle between projectiles of one straight volley. */
const FAN_STEP=.14;
/** Initial spread of a homing volley, before steering takes over. */
const HOMING_SPREAD=.35,HOMING_TURN=.25;

interface WeaponOptions {
  cap?:number;
  catalog?:{get(id:string):WeaponDef|undefined};
}

type Dir={x:number;y:number};

function facingOf(player:SimPlayer):Dir{
  const len=Math.hypot(player.facing.x,player.facing.y);
  return len>1e-9?{x:player.facing.x/len,y:player.facing.y/len}:{x:1,y:0};
}

const rotate=(d:Dir,a:number):Dir=>({x:d.x*Math.cos(a)-d.y*Math.sin(a),y:d.x*Math.sin(a)+d.y*Math.cos(a)});

export function createWeaponSystem(opts:WeaponOptions={}):SimSystem{
  const cap=opts.cap??PROJECTILE_CAP,catalog=opts.catalog??weaponCatalog;
  const scratch:EnemyState[]=[];

  /** Up to `count` live enemies within range: the player's tap target first (if valid), then nearest, ties by id. */
  function targets(ctx:SimContext,player:SimPlayer,range:number,count:number):EnemyState[]{
    const out:EnemyState[]=[];
    const inRange=(e:EnemyState)=>isAlive(ctx,e)&&Math.hypot(e.x-player.x,e.y-player.y)<=range;
    const preferred=player.target?ctx.enemies.get(player.target):undefined;
    if(preferred&&inRange(preferred))out.push(preferred);
    if(out.length>=count)return out;
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,range,scratch);
    const rest=scratch.filter(e=>e!==preferred&&inRange(e))
      .map(e=>({e,d:Math.hypot(e.x-player.x,e.y-player.y)}))
      .sort((a,b)=>a.d-b.d||(a.e.id<b.e.id?-1:a.e.id>b.e.id?1:0));
    for(const {e} of rest){if(out.length>=count)break;out.push(e);}
    return out;
  }

  const group=(player:SimPlayer,w:ResolvedWeapon)=>`${player.id}:${w.def.id}`;

  function fireOrbit(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const spin=w.speed/SIM_HZ,start=ctx.tick*spin,until=ctx.tick+w.durationTicks;
    const angles=Array.from({length:w.amount},(_,i)=>start+2*Math.PI*i/w.amount);
    let spawned=0;
    for(const angle of angles){
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'orbit',anchor:player.id,angle,orbitRadius:w.area,spin,
        x:player.x+Math.cos(angle)*w.area,y:player.y+Math.sin(angle)*w.area,vx:0,vy:0,
        radius:Math.max(.25,.22*w.area),damage:w.damage,pierce:PIERCE_INFINITE,untilTick:until,hostile:false,
        rehit:w.rehitTicks,group:group(player,w),knockback:w.knockback,
      },cap);
      if(p)spawned++;
    }
    // Havaianas do Caos: every cycle, one extra sandal per orbiter flies outward. Orbiters claim cap slots first.
    // They leave from the ring, not from the hero, so a hugging enemy is not hit point-blank by all of them at once.
    if(spawned&&w.def.evolved?.flingOnCycle){
      const speed=FLING_SPEED*player.stats.speed;
      for(const angle of angles){
        spawnProjectile(ctx,{
          owner:player.id,source:w.def.id,motion:'linear',x:player.x+Math.cos(angle)*w.area,y:player.y+Math.sin(angle)*w.area,
          vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:.3,damage:w.damage,pierce:FLING_PIERCE,
          untilTick:ctx.tick+Math.max(1,Math.round(ticks(FLING_SECONDS)*player.stats.duration)),hostile:false,knockback:w.knockback,
        },cap);
      }
    }
    if(spawned)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y});
    return spawned>0;
  }

  function firePierce(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const [target]=targets(ctx,player,w.range,1);
    let dir=facingOf(player);
    if(target){const len=Math.hypot(target.x-player.x,target.y-player.y);if(len>1e-9)dir={x:(target.x-player.x)/len,y:(target.y-player.y)/len};}
    const returns=!!w.def.evolved?.returns;
    let spawned=0;
    for(let i=0;i<w.amount;i++){
      const d=rotate(dir,(i-(w.amount-1)/2)*FAN_STEP);
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'linear',x:player.x,y:player.y,vx:d.x*w.speed,vy:d.y*w.speed,
        radius:w.area,damage:w.damage,pierce:returns?PIERCE_INFINITE:w.pierce,hostile:false,knockback:w.knockback,
        untilTick:ctx.tick+w.durationTicks*(returns?2:1),
        returnTick:returns?ctx.tick+w.durationTicks:undefined,
      },cap);
      if(p)spawned++;
    }
    if(spawned)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:dir.x,dy:dir.y});
    return spawned>0;
  }

  function fireZone(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const until=ctx.tick+w.durationTicks,slowTicks=w.def.evolved?.slowSeconds?ticks(w.def.evolved.slowSeconds):undefined;
    if(w.def.evolved?.followsOwner){
      // Cafeteira Industrial: the puddle walks with its owner and slows whatever it touches.
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'follow',anchor:player.id,x:player.x,y:player.y,vx:0,vy:0,
        radius:w.area,damage:w.damage,pierce:PIERCE_INFINITE,untilTick:until,hostile:false,
        rehit:w.rehitTicks,group:group(player,w),knockback:w.knockback,slowTicks,
      },cap);
      if(p)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y});
      return !!p;
    }
    const list=targets(ctx,player,w.range,w.amount);
    if(!list.length)return false;
    let spawned=0;
    for(const e of list){
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'linear',x:e.x,y:e.y,vx:0,vy:0,
        radius:w.area,damage:w.damage,pierce:PIERCE_INFINITE,untilTick:until,hostile:false,
        rehit:w.rehitTicks,group:group(player,w),knockback:w.knockback,slowTicks,
      },cap);
      if(p)spawned++;
    }
    if(spawned)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:list[0].x-player.x,dy:list[0].y-player.y});
    return spawned>0;
  }

  function fireShield(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const p=spawnProjectile(ctx,{
      owner:player.id,source:w.def.id,motion:'follow',anchor:player.id,x:player.x,y:player.y,vx:0,vy:0,
      radius:w.area,damage:w.damage,pierce:PIERCE_INFINITE,untilTick:ctx.tick+w.durationTicks,hostile:false,
      rehit:w.rehitTicks,group:group(player,w),knockback:w.knockback,blocksHostile:true,
    },cap);
    if(p)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y});
    return !!p;
  }

  function fireHoming(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const list=targets(ctx,player,w.range,w.amount);
    if(!list.length)return false;
    let spawned=0;
    for(let i=0;i<w.amount;i++){
      const target=list[i%list.length],len=Math.hypot(target.x-player.x,target.y-player.y);
      const aim=len>1e-9?{x:(target.x-player.x)/len,y:(target.y-player.y)/len}:facingOf(player);
      const d=rotate(aim,(i-(w.amount-1)/2)*HOMING_SPREAD);
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'homing',homing:target.id,seek:w.range,turn:HOMING_TURN,
        x:player.x,y:player.y,vx:d.x*w.speed,vy:d.y*w.speed,radius:w.area,damage:w.damage,pierce:w.pierce,
        untilTick:ctx.tick+w.durationTicks,hostile:false,knockback:w.knockback,
      },cap);
      if(p)spawned++;
    }
    if(spawned)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:list[0].x-player.x,dy:list[0].y-player.y});
    return spawned>0;
  }

  /** Instant wave: every live enemy inside any cone is hit once per volley. One fire event per direction. */
  function fireCone(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const half=w.def.coneHalfAngle??.6,face=facingOf(player);
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,w.area+1.5,scratch);
    const near=scratch.filter(e=>isAlive(ctx,e)&&Math.hypot(e.x-player.x,e.y-player.y)<=w.area+e.radius)
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if(!near.length)return false;
    let dirs=Array.from({length:w.amount},(_,i)=>rotate(face,2*Math.PI*i/w.amount));
    const inCone=(e:EnemyState)=>{
      const dx=e.x-player.x,dy=e.y-player.y,dist=Math.hypot(dx,dy);
      // Enemies overlapping the player are inside every cone.
      return dist<=Math.max(e.radius,1e-9)||dirs.some(d=>Math.acos(Math.max(-1,Math.min(1,(dx*d.x+dy*d.y)/dist)))<=half);
    };
    // A player standing still keeps an old facing, so a hug from behind was never answered: when the facing
    // cones would hit nobody, the wave turns to the tapped target if it is in reach (like targets()), otherwise
    // to the nearest enemy in reach (ties by id), instead of shouting at the air.
    if(!near.some(inCone)){
      const tapped=player.target?near.find(e=>e.id===player.target):undefined;
      const target=tapped??near.reduce((best,e)=>Math.hypot(e.x-player.x,e.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y)?e:best);
      const dx=target.x-player.x,dy=target.y-player.y,dist=Math.hypot(dx,dy)||1;
      dirs=Array.from({length:w.amount},(_,i)=>rotate({x:dx/dist,y:dy/dist},2*Math.PI*i/w.amount));
    }
    for(const e of near){
      if(!inCone(e)||!isAlive(ctx,e))continue;
      const dx=e.x-player.x,dy=e.y-player.y;
      hitEnemy(ctx,e,w.damage,player.id,w.def.id,{x:dx,y:dy,force:w.knockback});
    }
    for(const d of dirs)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:d.x,dy:d.y});
    return true;
  }

  function fire(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    switch(w.def.pattern){
      case 'orbit':return fireOrbit(ctx,player,w);
      case 'pierce':return firePierce(ctx,player,w);
      case 'zone':return fireZone(ctx,player,w);
      case 'shield':return fireShield(ctx,player,w);
      case 'homing':return fireHoming(ctx,player,w);
      case 'cone':return fireCone(ctx,player,w);
    }
  }

  return {
    id:'weapons',
    step(ctx){
      for(const player of ctx.players.values()){
        if(!canAct(player))continue;
        for(const owned of player.build.weapons){
          const def=catalog.get(owned.id);
          // A unified item catalog may also hold passives; only weapon defs carry a pattern.
          if(!def?.pattern)continue;
          // An evolution inherits the base weapon's timer instead of firing on the swap tick.
          const base=def.base;
          if(base&&player.weaponReady[def.id]===undefined&&player.weaponReady[base]!==undefined&&!player.build.weapons.some(o=>o.id===base)){
            player.weaponReady[def.id]=player.weaponReady[base];
            delete player.weaponReady[base];
          }
          if(ctx.tick<(player.weaponReady[def.id]??0))continue;
          const w=resolveWeapon(def,owned.level,player.stats);
          // Weapons with nothing to shoot at keep their cooldown and retry next tick.
          if(!fire(ctx,player,w))continue;
          const lingers=def.pattern==='orbit'||def.pattern==='shield'||def.pattern==='zone';
          player.weaponReady[def.id]=ctx.tick+(lingers?w.durationTicks:0)+w.cooldownTicks;
        }
      }
    },
  };
}
