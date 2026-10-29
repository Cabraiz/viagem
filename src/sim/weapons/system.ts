/**
 * Auto-firing weapons (VGM-035), system id 'weapons'. Runs before 'projectiles' in SYSTEM_ORDER:
 * it only spawns projectiles (moved and collided by the projectile system) except the audio cone, which hits instantly.
 * Damage passed to ctx.damageEnemy is base weapon damage; the core applies might.
 *
 * D-051 manual combat (WeaponOptions.manual, RunSystemsOptions.combat 'manual'): only the EQUIPPED weapon fires
 * (equippedWeapon: the inventory's hand slot, sim/inventory.ts; without one, the build's first weapon), and only on a tick its owner holds the attack (or the press the input track kept); every other weapon of
 * the build stays idle, its timer untouched. Targets come from rules/attack-target.ts (chosen -> who hit me in the last
 * 2 s -> nearest with the boss 30 % closer -> posing last, with hysteresis), and nothing fires without a live enemy in
 * the weapon's reach (manualReach): the weapon keeps its cooldown. The candidates are gathered here (enemyIndex plus
 * the optional ctx.sleepers of the D-051 nests) and handed to the pure picker, which never queries. Per pattern:
 *  - pierce, homing, zone (thrown puddles): shot at the aimed targets in range, as before but in the new order;
 *  - cone: the wave turns to the aimed target instead of the facing;
 *  - orbit, shield, zone that follows its owner (Cafeteira): no longer passive; a hold with an enemy within their
 *    ring/radius starts one cycle (the effect of the equipped weapon), then the usual duration + cooldown.
 * The hero never walks to a target (the stick moves him).
 *
 * BUG-20261023-ORQ-tiro-na-direcao-mobile: a person's attack (WeaponOptions.manual.free) always goes off, toward the aim
 * (PlayerInput.aim: the mouse, or the phone's aim stick) or else the facing, even with nobody in reach (the cooldown
 * runs). A light aim assist bends it onto the live enemy in reach nearest the middle of a ±ASSIST_ANGLE cone around that
 * direction; outside the cone it flies straight (never behind nor to the side). The bots and the autopiloted keep the
 * rule above (no attack at the air).
 */
import type {EnemyState,PlayerBuild,SimPlayer} from '../../contract/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {SIM_HZ,ticks} from '../../contract/index.ts';
import {floorOf} from '../../maps/index.ts';
import {AURA,HERO_SHOT_SPEED_MULT,THROW_TICKS,attackTargets} from '../../rules/index.ts';
import {PIERCE_INFINITE,resolveWeapon,weaponCatalog} from './catalog.ts';
import type {ResolvedWeapon,WeaponDef} from './catalog.ts';
import {PROJECTILE_CAP,canAct,hitEnemy,isAlive,queryHittable,spawnProjectile} from '../projectiles.ts';
import {isPriorityTarget,isReflecting} from '../enemies/catalog.ts';
import type {FireApi} from './fire-api.ts';
import {fireRicochet,ricochetReach} from './ricochet.ts';
import {fireMine,mineReach} from './mine.ts';
import {fireTurret,tickTurrets,turretReach} from './turret.ts';

/** Speed and life of sandals flung by the evolved orbit: tuned 8 u/s for 1 s, flown through HERO_SHOT_SPEED_MULT (same reach). */
const FLING_SPEED=8*HERO_SHOT_SPEED_MULT,FLING_SECONDS=1/HERO_SHOT_SPEED_MULT,FLING_PIERCE=2;
/** Angle between projectiles of one straight volley. */
const FAN_STEP=.14;
/**
 * Initial spread of a homing volley, before steering takes over; HOMING_TURN is the most it turns per tick (rad): the
 * tuned .25 × HERO_SHOT_SPEED_MULT, so the slower pigeon flies the same curves (same turn per unit flown).
 */
const HOMING_SPREAD=.35,HOMING_TURN=.25*HERO_SHOT_SPEED_MULT;

interface WeaponOptions {
  cap?:number;
  catalog?:{get(id:string):WeaponDef|undefined};
  /** D-051 manual combat: whether the player holds the attack on this tick (players system ManualCombat). Absent: automatic weapons. */
  manual?:{attacking(playerId:string):boolean;
    /** A person (not a bot nor the autopilot): the attack goes off toward the aim or facing, even into the air. Absent: nobody. */
    free?(playerId:string):boolean};
  /** D-052: hands busy (moving the chaveiro's car): the player does not fire this tick. */
  busy?(playerId:string):boolean;
}

type Dir={x:number;y:number};
/** Half-angle (rad) of the aim assist's cone of a person's attack: ±20°. */
export const ASSIST_ANGLE=20*Math.PI/180;

/** How far a straight shot gets before it expires, plus its own radius: an enemy farther than this cannot be hit. */
export const pierceReach=(w:{speed:number;durationTicks:number;area:number})=>w.speed*w.durationTicks/SIM_HZ+w.area;
/** Unit vector from the player to `to`, or the facing when they overlap. */
function towardOr(player:SimPlayer,to:{x:number;y:number}):Dir{
  const dx=to.x-player.x,dy=to.y-player.y,len=Math.hypot(dx,dy);
  return len>1e-9?{x:dx/len,y:dy/len}:facingOf(player);
}
function facingOf(player:SimPlayer):Dir{
  const len=Math.hypot(player.facing.x,player.facing.y);
  return len>1e-9?{x:player.facing.x/len,y:player.facing.y/len}:{x:1,y:0};
}

const rotate=(d:Dir,a:number):Dir=>({x:d.x*Math.cos(a)-d.y*Math.sin(a),y:d.x*Math.sin(a)+d.y*Math.cos(a)});
/** Radius of one orbiter (fireOrbit). */
const orbiterRadius=(w:{area:number})=>Math.max(.25,.22*w.area);

/**
 * D-051: the equipped weapon of the manual combat: the weapon in the inventory's hand slot (build.hand, sim/inventory.ts);
 * a build without a hand (no inventory) fires its first weapon. Undefined: nothing to fire.
 */
export function equippedWeapon(build:PlayerBuild,catalog:{get(id:string):WeaponDef|undefined}=weaponCatalog){
  // D-051 inventory (sim/inventory.ts): the weapon in the hand's slot; a consumable there fires nothing.
  if(build.hand!==undefined){const held=build.weapons[build.hand];return held&&catalog.get(held.id)?.pattern?held:undefined;}
  return build.weapons.find(o=>!!catalog.get(o.id)?.pattern);
}
/**
 * D-051: how far (u, from the hero's centre) the manual combat looks for a target with this weapon, and whether the
 * enemy's own radius is added (`pad`: patterns that touch, not aim). The bots hold the attack within it.
 */
export function manualReach(w:ResolvedWeapon):{reach:number;pad:boolean}{
  switch(w.def.pattern){
    case 'pierce':return {reach:Math.min(w.range,pierceReach(w)),pad:false};
    case 'homing':return {reach:w.range,pad:false};
    case 'zone':return w.def.evolved?.followsOwner?{reach:w.area,pad:true}:{reach:w.range,pad:false};
    case 'orbit':return {reach:w.area+orbiterRadius(w),pad:true};
    case 'shield':case 'cone':return {reach:w.area,pad:true};
    // Pack 12 fatia A2: each pattern's own file says how far it looks.
    case 'ricochet':return ricochetReach(w);
    case 'mine':return mineReach(w);
    case 'turret':return turretReach(w);
  }
}
/** Slack of the spatial query for padded reaches (enemy radius); the exact test follows. */
const PAD_QUERY=2;
/** Weapon id of the Defumador's hits (the 'damage' events, the kill feed). */
export const AURA_SOURCE='defumador';
/** The Defumador's level in a build (0: none). */
export const auraLevel=(build:PlayerBuild)=>build.passives.find(p=>p.id===AURA_SOURCE)?.level??0;
/** Radius of a player's aura (u): AURA.radius × the area stat; 0 without the Defumador. */
export function auraRadius(player:{build:PlayerBuild;stats:{area:number}}){
  const level=auraLevel(player.build);
  return level>0?AURA.radius(level)*player.stats.area:0;
}

export function createWeaponSystem(opts:WeaponOptions={}):SimSystem{
  const cap=opts.cap??PROJECTILE_CAP,catalog=opts.catalog??weaponCatalog;
  const scratch:EnemyState[]=[];

  /**
   * Up to `count` live enemies within range: the player's tap target first (if valid), then the live coaches in range
   * (priority target, enemies/catalog.ts isPriorityTarget; nearest first), then nearest, ties by id; influencers posing
   * right now (isReflecting: the shot would come back) only after every other candidate. A tapped one still comes first:
   * the player asked for it.
   */
  function targets(ctx:SimContext,player:SimPlayer,range:number,count:number):EnemyState[]{
    if(opts.manual)return manualTargets(ctx,player,range,count);
    const out:EnemyState[]=[];
    // The viaduct (maps city/viaduct.ts): only bodies on the hero's own floor.
    const inRange=(e:EnemyState)=>isAlive(ctx,e)&&floorOf(e)===floorOf(player)&&Math.hypot(e.x-player.x,e.y-player.y)<=range;
    // D-051: a tap may pick a sleeper or a nest (ctx.sleepers): the player opens that fight; nothing else aims there.
    const preferred=player.target?ctx.enemies.get(player.target)??ctx.sleepers?.get(player.target):undefined;
    if(preferred&&inRange(preferred))out.push(preferred);
    if(out.length>=count)return out;
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,range,scratch);
    const rest=scratch.filter(e=>e!==preferred&&inRange(e))
      .map(e=>({e,d:Math.hypot(e.x-player.x,e.y-player.y),first:isReflecting(e,ctx.tick)?2:isPriorityTarget(e)?0:1}))
      .sort((a,b)=>a.first-b.first||a.d-b.d||(a.e.id<b.e.id?-1:a.e.id>b.e.id?1:0));
    for(const {e} of rest){if(out.length>=count)break;out.push(e);}
    return out;
  }

  /**
   * D-051 manual combat: up to `count` live enemies within `range` (plus their radius with `pad`), in the order of
   * rules/attack-target.ts; remembers the auto pick on the player (SimPlayer.autoTarget, the hysteresis' memory).
   */
  function manualTargets(ctx:SimContext,player:SimPlayer,range:number,count:number,pad=false):EnemyState[]{
    const inRange=(e:EnemyState)=>isAlive(ctx,e)&&floorOf(e)===floorOf(player)&&Math.hypot(e.x-player.x,e.y-player.y)<=range+(pad?e.radius:0);

    const seen=new Set<EnemyState>(),candidates:{id:string;x:number;y:number;boss:boolean;reflecting:boolean;e:EnemyState}[]=[];
    const add=(e:EnemyState|undefined)=>{
      if(!e||seen.has(e)||!inRange(e))return;
      seen.add(e);candidates.push({id:e.id,x:e.x,y:e.y,boss:!!e.boss,reflecting:isReflecting(e,ctx.tick),e});
    };
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,range+(pad?PAD_QUERY:0),scratch);
    for(const e of scratch)add(e);
    // D-051 nests: the sleepers (out of enemyIndex) are targets too, ranked like anyone else (attacking one starts the fight).
    if(ctx.sleepers){scratch.length=0;ctx.sleepers.query(player.x,player.y,range+(pad?PAD_QUERY:0),scratch);for(const e of scratch)add(e);}
    // The chosen one and who hit me may lie past the query's slack (a big boss): looked up by id.
    for(const id of [player.target,player.lastHitBy?.id])if(id!==undefined)add(ctx.enemies.get(id));
    const {order,auto}=attackTargets(player,candidates,{tick:ctx.tick,chosen:player.target,lastHit:player.lastHitBy,current:player.autoTarget});
    if(auto!==undefined)player.autoTarget=auto;else delete player.autoTarget;
    return order.slice(0,count).map(c=>c.e);
  }

  /**
   * A person's attack (BUG-20261023-ORQ-tiro-na-direcao-mobile): the direction (the aim, or else the facing) and up to
   * `count` live enemies (awake or asleep) within `range` (plus their radius with `pad`) inside the ±ASSIST_ANGLE cone
   * around it, nearest the cone's middle first (then nearer, then by id). `dir` turns to the first one.
   */
  function freeAim(ctx:SimContext,player:SimPlayer,range:number,count:number,pad=false):{dir:Dir;aimed:EnemyState[]}{
    const a=player.aim,alen=a?Math.hypot(a.x,a.y):0;
    const base=a&&alen>1e-9?{x:a.x/alen,y:a.y/alen}:facingOf(player);
    const found:EnemyState[]=[];
    queryHittable(ctx,player.x,player.y,range+(pad?PAD_QUERY:0),found);
    const ranked=found.flatMap(e=>{
      const dx=e.x-player.x,dy=e.y-player.y,d=Math.hypot(dx,dy);
      if(!isAlive(ctx,e)||d>range+(pad?e.radius:0))return [];
      const angle=d>1e-9?Math.acos(Math.max(-1,Math.min(1,(dx*base.x+dy*base.y)/d))):0;
      return angle<=ASSIST_ANGLE?[{e,angle,d}]:[];
    }).sort((p,q)=>p.angle-q.angle||p.d-q.d||(p.e.id<q.e.id?-1:p.e.id>q.e.id?1:0));
    const aimed=ranked.slice(0,count).map(r=>r.e);
    return {dir:aimed[0]?towardOr(player,aimed[0]):base,aimed};
  }
  const isFree=(player:SimPlayer)=>!!opts.manual?.free?.(player.id);

  const group=(player:SimPlayer,w:ResolvedWeapon)=>`${player.id}:${w.def.id}`;
  /** What the patterns in their own files (fire-api.ts) get: this system's target order and cap. */
  const api:FireApi={cap,group,targets:(ctx,player,range,count,pad=false)=>opts.manual?manualTargets(ctx,player,range,count,pad):targets(ctx,player,range,count)};

  function fireOrbit(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    const spin=w.speed/SIM_HZ,start=ctx.tick*spin,until=ctx.tick+w.durationTicks;
    const angles=Array.from({length:w.amount},(_,i)=>start+2*Math.PI*i/w.amount);
    let spawned=0;
    for(const angle of angles){
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'orbit',anchor:player.id,angle,orbitRadius:w.area,spin,
        x:player.x+Math.cos(angle)*w.area,y:player.y+Math.sin(angle)*w.area,vx:0,vy:0,
        radius:orbiterRadius(w),damage:w.damage,pierce:PIERCE_INFINITE,untilTick:until,hostile:false,
        rehit:w.rehitTicks,group:group(player,w),knockback:w.knockback,blocksHostile:w.def.effect?.blocksHostile||undefined,
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
    // Only at a live enemy the shot can really reach (BUG-20261013-ORQ-ataque-fora-do-alcance): no shot into the air and
    // no shot at one beyond the flight distance; with none, the weapon keeps its cooldown and fires at the first in reach.
    // Card upgrades-megabonk (manual combat): each extra projectile (the Bombinha's +1 projétil) goes to the next enemy in
    // reach, like Megabonk's extra shots; only with fewer enemies than shots do the rest fan around the first.
    // A person's shot always leaves, toward the aim or facing (freeAim), bent onto an enemy in the assist's cone.
    // With nobody in the cone it aims at a point straight ahead (the volley below is the same).
    const reach=Math.min(w.range,pierceReach(w)),free=isFree(player)?freeAim(ctx,player,reach,w.amount):undefined;
    const aimed:{x:number;y:number}[]=free?(free.aimed.length?free.aimed:[{x:player.x+free.dir.x,y:player.y+free.dir.y}]):targets(ctx,player,reach,opts.manual?w.amount:1),target=aimed[0];
    if(!target)return false;
    let dir=facingOf(player);
    const len=Math.hypot(target.x-player.x,target.y-player.y);if(len>1e-9)dir={x:(target.x-player.x)/len,y:(target.y-player.y)/len};
    const returns=!!w.def.evolved?.returns,fanStep=w.def.effect?.fanStep;
    const slowTicks=w.def.effect?.slowSeconds?ticks(w.def.effect.slowSeconds):undefined;
    const fan=w.amount-aimed.length+1;
    let spawned=0;
    for(let i=0;i<w.amount;i++){
      // Pack 12 tarô (effect.fanStep): the whole volley fans around the first target, wider than FAN_STEP.
      const own=!fanStep&&i>0&&i<aimed.length?towardOr(player,aimed[i]):undefined,f=i-(aimed.length-1);
      const d=fanStep?rotate(dir,(i-(w.amount-1)/2)*fanStep):own??rotate(dir,(i===0?-(fan-1)/2:f-(fan-1)/2)*FAN_STEP);
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'linear',x:player.x,y:player.y,vx:d.x*w.speed,vy:d.y*w.speed,slowTicks,
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
    const scatter=w.def.effect?.scatter;
    const free=isFree(player)?freeAim(ctx,player,w.range,scatter?1:w.amount):undefined;
    // A person throws even with nobody in the cone: the puddle lands at the weapon's range, straight ahead.
    const list:{x:number;y:number}[]=free?(free.aimed.length?free.aimed:[{x:player.x+free.dir.x*w.range,y:player.y+free.dir.y*w.range}]):targets(ctx,player,w.range,scatter?1:w.amount);
    if(!list.length)return false;
    // Pack 12 traque (effect.scatter): the volley's bursts ring the first target, the ring turning with the tick.
    const spots=scatter?Array.from({length:w.amount},(_,i)=>{const a=ctx.tick*.7+2*Math.PI*i/w.amount;return {x:list[0].x+Math.cos(a)*scatter,y:list[0].y+Math.sin(a)*scatter};}):list;
    // Thrown (rules/thrown.ts): leaves the hero, flies THROW_TICKS hitting nothing, then bursts there for its duration.
    const land=w.def.effect?.thrown?ctx.tick+THROW_TICKS:undefined;
    let spawned=0;
    for(const e of spots){
      const fly=land!==undefined?{x:player.x,y:player.y,vx:(e.x-player.x)*SIM_HZ/THROW_TICKS,vy:(e.y-player.y)*SIM_HZ/THROW_TICKS,landTick:land,landX:e.x,landY:e.y}:{x:e.x,y:e.y,vx:0,vy:0};
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'linear',...fly,
        radius:w.area,damage:w.damage,pierce:PIERCE_INFINITE,untilTick:land!==undefined?land+w.durationTicks:until,hostile:false,
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
    const free=isFree(player)?freeAim(ctx,player,w.range,w.amount):undefined;
    const list=free?free.aimed:targets(ctx,player,w.range,w.amount);
    if(!list.length&&!free)return false;
    let spawned=0;
    for(let i=0;i<w.amount;i++){
      // A person's volley with nobody in the cone leaves straight ahead and seeks whoever comes within reach.
      const target=list.length?list[i%list.length]:undefined,len=target?Math.hypot(target.x-player.x,target.y-player.y):0;
      const aim=target&&len>1e-9?{x:(target.x-player.x)/len,y:(target.y-player.y)/len}:free?free.dir:facingOf(player);
      const d=rotate(aim,(i-(w.amount-1)/2)*HOMING_SPREAD);
      const p=spawnProjectile(ctx,{
        owner:player.id,source:w.def.id,motion:'homing',...(target?{homing:target.id}:{}),seek:w.range,turn:HOMING_TURN,
        x:player.x,y:player.y,vx:d.x*w.speed,vy:d.y*w.speed,radius:w.area,damage:w.damage,pierce:w.pierce,
        untilTick:ctx.tick+w.durationTicks,hostile:false,knockback:w.knockback,
      },cap);
      if(p)spawned++;
    }
    const at=list[0]?{x:list[0].x-player.x,y:list[0].y-player.y}:free!.dir;
    if(spawned)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:at.x,dy:at.y});
    return spawned>0;
  }

  /**
   * Instant wave: every live enemy inside any cone is hit once per volley. One fire event per direction.
   * Manual combat with the mouse's aim (cone-ataque-melee, PlayerInput.aim): the wave goes where the mouse points and
   * strikes only who is inside that cone; with nobody there it is a swing at the air (the cone shows, the cooldown runs),
   * like LoL. Without an aim (a phone, a bot): the auto aim below.
   */
  function fireCone(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    // A person's swing always goes off, toward the aim or facing, bent onto an enemy in the assist's cone (freeAim).
    const free=isFree(player)?freeAim(ctx,player,w.area,1,true):undefined;
    const aim=free?free.dir:opts.manual?player.aim:undefined;
    // D-051 manual combat: the wave goes where the aim points (nobody in reach: no wave).
    const aimed=opts.manual&&!aim?manualTargets(ctx,player,w.area,1,true)[0]:undefined;
    if(opts.manual&&!aim&&!aimed)return false;
    const half=w.def.coneHalfAngle??.6,face=aim??(aimed?towardOr(player,aimed):facingOf(player));
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,w.area+1.5,scratch);
    const near=scratch.filter(e=>isAlive(ctx,e)&&Math.hypot(e.x-player.x,e.y-player.y)<=w.area+e.radius)
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if(!near.length&&!aim)return false;
    let dirs=Array.from({length:w.amount},(_,i)=>rotate(face,2*Math.PI*i/w.amount));
    const inCone=(e:EnemyState)=>{
      const dx=e.x-player.x,dy=e.y-player.y,dist=Math.hypot(dx,dy);
      // Enemies overlapping the player are inside every cone.
      return dist<=Math.max(e.radius,1e-9)||dirs.some(d=>Math.acos(Math.max(-1,Math.min(1,(dx*d.x+dy*d.y)/dist)))<=half);
    };
    // A player standing still keeps an old facing, so a hug from behind was never answered: when the facing
    // cones would hit nobody, the wave turns to the tapped target if it is in reach (like targets()), otherwise
    // to the nearest enemy in reach (ties by id), instead of shouting at the air.
    if(!aim&&!near.some(inCone)){
      const tapped=player.target?near.find(e=>e.id===player.target):undefined;
      const target=tapped??near.reduce((best,e)=>Math.hypot(e.x-player.x,e.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y)?e:best);
      const dx=target.x-player.x,dy=target.y-player.y,dist=Math.hypot(dx,dy)||1;
      dirs=Array.from({length:w.amount},(_,i)=>rotate({x:dx/dist,y:dy/dist},2*Math.PI*i/w.amount));
    }
    // The wave fires at the awake (near), and also lands on the sleepers in its cones (D-051: they wake).
    const reach=(e:EnemyState)=>isAlive(ctx,e)&&Math.hypot(e.x-player.x,e.y-player.y)<=w.area+e.radius;
    const struck=ctx.sleepers?.size?queryHittable(ctx,player.x,player.y,w.area+1.5,[]).filter(reach).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0):near;
    for(const e of struck){
      if(!inCone(e)||!isAlive(ctx,e))continue;
      const dx=e.x-player.x,dy=e.y-player.y;
      hitEnemy(ctx,e,w.damage,player.id,w.def.id,{x:dx,y:dy,force:w.knockback});
    }
    for(const d of dirs)ctx.emit({type:'fire',player:player.id,weapon:w.def.id,x:player.x,y:player.y,dx:d.x,dy:d.y});
    return true;
  }

  function fire(ctx:SimContext,player:SimPlayer,w:ResolvedWeapon):boolean{
    // D-051 manual combat: the ring, the umbrella and the walking puddle are no longer passive: a hold starts a cycle
    // only with an enemy they can touch (no swing at the air; the cooldown waits).
    // A person's hold starts them even with nobody near (BUG-20261023-ORQ-tiro-na-direcao-mobile).
    if(opts.manual&&!isFree(player)&&(w.def.pattern==='orbit'||w.def.pattern==='shield'||w.def.pattern==='zone'&&w.def.evolved?.followsOwner)){
      const {reach,pad}=manualReach(w);
      if(!manualTargets(ctx,player,reach,1,pad).length)return false;
    }
    switch(w.def.pattern){
      case 'orbit':return fireOrbit(ctx,player,w);
      case 'pierce':return firePierce(ctx,player,w);
      case 'zone':return fireZone(ctx,player,w);
      case 'shield':return fireShield(ctx,player,w);
      case 'homing':return fireHoming(ctx,player,w);
      case 'cone':return fireCone(ctx,player,w);
      case 'ricochet':return fireRicochet(ctx,player,w,api);
      case 'mine':return fireMine(ctx,player,w,api);
      case 'turret':return fireTurret(ctx,player,w,api);
    }
  }

  /**
   * Card upgrades-megabonk, the Defumador (Megabonk's aura, no equipping, no attack held): every AURA.every s, each
   * AWAKE enemy within auraRadius takes AURA.damage (× might in the core). Its clock is the player's weaponReady
   * entry of AURA_SOURCE, like a weapon's; the sleepers are never touched (a nest is not woken by walking past it).
   */
  function aura(ctx:SimContext,player:SimPlayer){
    const level=auraLevel(player.build);
    if(!level||ctx.tick<(player.weaponReady[AURA_SOURCE]??0))return;
    const radius=auraRadius(player);
    scratch.length=0;
    ctx.enemyIndex.query(player.x,player.y,radius+PAD_QUERY,scratch);
    const struck=scratch.filter(e=>isAlive(ctx,e)&&ctx.enemies.has(e.id)&&Math.hypot(e.x-player.x,e.y-player.y)<=radius+e.radius)
      .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if(!struck.length)return;
    for(const e of struck)if(isAlive(ctx,e))hitEnemy(ctx,e,AURA.damage(level),player.id,AURA_SOURCE,{x:e.x-player.x,y:e.y-player.y,force:0});
    player.weaponReady[AURA_SOURCE]=ctx.tick+ticks(AURA.every);
  }

  return {
    id:'weapons',
    step(ctx){
      const manual=opts.manual;
      // Pack 12 fatia A2: the placed turrets shoot on their own, held attack or not.
      tickTurrets(ctx,api);
      for(const player of ctx.players.values()){
        if(!canAct(player))continue;
        aura(ctx,player);
        // D-051 manual combat: only the equipped weapon, only while the attack is held.
        if(manual&&!manual.attacking(player.id))continue;
        if(opts.busy?.(player.id))continue;
        const equipped=manual?equippedWeapon(player.build,catalog):undefined;
        for(const owned of player.build.weapons){
          if(manual&&owned!==equipped)continue;
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
