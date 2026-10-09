/**
 * Protocol 3 prototype combat (basic attack, skill and the three gosmas) as SimSystems.
 * Behavior is unchanged from the pre-VGM-030 Simulation; VGM-042 replaces it with the real systems.
 * All damage goes through ctx.damageEnemy/ctx.damagePlayer.
 */
import {moveDirection,clearSegment,SPAWN,SPEED,type Point} from '../../world.ts';
import type {TerrainField} from '../../terrain/field.ts';
import type {SimWorld} from '../core.ts';
import {SIM_HZ,SYSTEM_ORDER} from '../types.ts';
import {computeStats} from '../stats.ts';
import type {EnemyState,PlayerBuild,PlayerStats,SimContext,SimPlayer,SimSystem} from '../types.ts';

export const ATTACK_RANGE=1.8;
export const BASIC_COOLDOWN_TICKS=12;
export const SKILL_RANGE=2.8;
export const SKILL_COOLDOWN_TICKS=160;
export const BASIC_DAMAGE=20,SKILL_DAMAGE=35,KILL_SCORE=10,RESPAWN_TICKS=160;
export const GOSMA_DAMAGE=8,GOSMA_HIT_COOLDOWN_TICKS=20,GOSMA_SPEED=.35,GOSMA_AGGRO=6,GOSMA_STOP=.85,GOSMA_REACH=1;
/** Weapon ids reported in damage/fire events and used as weaponReady keys. */
export const BASIC_WEAPON='basico',SKILL_WEAPON='habilidade';
const LEGACY_STEP=1/SIM_HZ;

/** The prototype runs before the contract systems; none of those are registered while it is installed. */
export const LEGACY_ORDER=['legacy-players','legacy-gosmas',...SYSTEM_ORDER] as const;

export interface LegacyInput {seq:number;x:number;y:number;attack:boolean;target?:string;skill?:boolean}
export type LegacyPlayer=SimPlayer&{ack:number;score:number;attackTick?:number;skillTick?:number;skillReadyTick?:number;respawnTick?:number};

export const DEFAULT_FACING:Readonly<Point>=Object.freeze({x:0,y:1});
/** Fresh per-run combat fields for a player; stats come from computeStats (VGM-036) with the class bonus. */
export function freshCombat(classBonus?:Partial<PlayerStats>):{facing:Point;build:PlayerBuild;stats:PlayerStats;weaponReady:Record<string,number>}{
  const build:PlayerBuild={weapons:[],passives:[]};
  return {facing:{...DEFAULT_FACING},build,stats:computeStats(build,classBonus),weaponReady:{}};
}

/** Completes a bare {id,x,y,hp} into a gosma EnemyState, in place, keeping the caller's reference live. */
export function toLegacyEnemy(enemy:Point&{id:string;hp:number}&Partial<EnemyState>,tick=0):EnemyState{
  return Object.assign(enemy,{
    kind:enemy.kind??'gosma',maxHp:enemy.maxHp??enemy.hp,speed:enemy.speed??SPEED*GOSMA_SPEED,damage:enemy.damage??GOSMA_DAMAGE,
    radius:enemy.radius??.4,xp:enemy.xp??1,spawnTick:enemy.spawnTick??tick,readyTick:enemy.readyTick??0,
  });
}
export const legacyGosmas=(tick=0)=>[
  {id:'gosma-1',x:10,y:16,hp:60},{id:'gosma-2',x:14,y:16,hp:60},{id:'gosma-3',x:12,y:13,hp:80},
].map(e=>toLegacyEnemy(e,tick));

/** Same movement as shared.simulate, plus facing. */
export function movePlayer(p:SimPlayer,input:LegacyInput,terrain:TerrainField){
  Object.assign(p,moveDirection(p,{x:input.x,y:input.y},LEGACY_STEP,terrain));
  const length=Math.hypot(input.x,input.y);
  if(Number.isFinite(length)&&length>=.01)p.facing={x:input.x/length,y:input.y/length};
}

function inRange(ctx:SimContext,p:Point,range:number){
  return [...ctx.enemies.values()].filter(e=>e.hp>0&&Math.hypot(e.x-p.x,e.y-p.y)<=range&&clearSegment(p,e,ctx.terrain))
    .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)||a.id.localeCompare(b.id));
}

export function legacyPlayersSystem(takeInput:(playerId:string)=>LegacyInput|undefined):SimSystem{
  return {id:'legacy-players',step(ctx){
    for(const player of ctx.players.values()){
      const p=player as LegacyPlayer;
      if(!p.online||p.spectator)continue;
      const input=takeInput(p.id);
      if(p.hp===0){
        if(ctx.tick>=(p.respawnTick??Infinity)){p.hp=p.stats.maxHp;Object.assign(p,SPAWN);delete p.respawnTick;}
        if(input)p.ack=input.seq;
        continue;
      }
      if(input){
        movePlayer(p,input,ctx.terrain);p.ack=input.seq;
        if(input.target)p.target=input.target;else delete p.target;
      }
      if(ctx.tick>=(p.weaponReady[BASIC_WEAPON]??0)){
        const candidates=inRange(ctx,p,ATTACK_RANGE);
        const enemy=candidates.find(e=>e.id===p.target)??candidates[0];
        if(enemy){
          p.attackTick=ctx.tick;p.weaponReady[BASIC_WEAPON]=ctx.tick+BASIC_COOLDOWN_TICKS;
          ctx.emit({type:'fire',player:p.id,weapon:BASIC_WEAPON,x:p.x,y:p.y,dx:enemy.x-p.x,dy:enemy.y-p.y});
          ctx.damageEnemy(enemy.id,BASIC_DAMAGE,p.id,BASIC_WEAPON);
        }
      }
      if(input?.skill&&ctx.tick>=(p.skillReadyTick??0)){
        p.skillTick=ctx.tick;p.skillReadyTick=ctx.tick+SKILL_COOLDOWN_TICKS;
        ctx.emit({type:'fire',player:p.id,weapon:SKILL_WEAPON,x:p.x,y:p.y});
        for(const enemy of inRange(ctx,p,SKILL_RANGE))ctx.damageEnemy(enemy.id,SKILL_DAMAGE,p.id,SKILL_WEAPON);
      }
    }
  }};
}

export const legacyGosmaSystem:SimSystem={id:'legacy-gosmas',step(ctx){
  for(const enemy of ctx.enemies.values()){
    if(!(enemy.hp>0))continue;
    const target=[...ctx.players.values()].filter(p=>p.online&&!p.spectator&&p.hp>0)
      .sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y))[0];
    if(!target)continue;
    const distance=Math.hypot(target.x-enemy.x,target.y-enemy.y);
    if(distance<GOSMA_AGGRO&&distance>GOSMA_STOP)Object.assign(enemy,moveDirection(enemy,{x:target.x-enemy.x,y:target.y-enemy.y},LEGACY_STEP*GOSMA_SPEED,ctx.terrain));
    if(distance<=GOSMA_REACH&&clearSegment(enemy,target,ctx.terrain)&&ctx.tick>=enemy.readyTick){
      enemy.readyTick=ctx.tick+GOSMA_HIT_COOLDOWN_TICKS;
      ctx.damagePlayer(target.id,GOSMA_DAMAGE,enemy.id);
    }
  }
}};

/** Registers the prototype systems and hooks: shared kill score and respawn after a fall. */
export function installLegacy(world:SimWorld,takeInput:(playerId:string)=>LegacyInput|undefined){
  world.register(legacyPlayersSystem(takeInput)).register(legacyGosmaSystem);
  world.onKill((_enemy,_by,ctx)=>{for(const ally of ctx.players.values())if(!ally.spectator)(ally as LegacyPlayer).score+=KILL_SCORE;});
  world.onPlayerZero((player,_source,ctx)=>{(player as LegacyPlayer).respawnTick=ctx.tick+RESPAWN_TICKS;});
}
