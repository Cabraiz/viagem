/**
 * Card NEW-20261025-ORQ-heroi-empurra-inimigos, the room's side of maps/bodies.ts: heroes and awake enemies are solid.
 * - The players system (systems/players.ts) runs bodyBlock on every step a hero takes (the phone replays the same).
 * - heroBodiesPass, at the end of the boss's slot (after every enemy moved this tick: the enemy-ai's walk and crowd
 *   push, the boss, the chefão), puts back out of each standing hero the bodies that walked into one: the body takes
 *   it all, the boss too (the room never moves a hero outside its step: the phone predicted it, and one tick moves a
 *   hero at most one step, protocol/input-track.ts). A body a wall holds stays; the hero's next step backs out of it.
 * Not solid: the flying (pombos, voadores: a hero walks under them), the asleep (out of ctx.enemies), the dead; and
 * the downed, eliminated, spectating or offline heroes (enemies walk over a body on the ground).
 */
import {BODY_REACH,RADIUS as PLAYER_RADIUS,bodyBlock,enemyTerrain,floorOf,heroShare,onFloor,settleFloor,setFloor,type Body,type Shove} from '../maps/index.ts';
import type {TerrainField} from '../maps/index.ts';
import type {EnemyState,Point,PushMark,SimPlayer} from '../contract/index.ts';
import type {SimContext} from './context.ts';
import {shovedEnemy} from '../rules/index.ts';
import {isFlying} from './enemies/catalog.ts';
import {moveSafely} from './enemies/ai.ts';

/** A body a hero bumps into: awake, alive and on the ground or a deck (not flying). */
export const solidEnemy=(e:EnemyState)=>e.hp>0&&!isFlying(e);
/** EnemyView.radius, spread into the view: the body's radius when it is solid, else nothing (the phone walks through it). */
export const bodyRadius=(e:EnemyState):{radius?:number}=>solidEnemy(e)&&e.radius>0?{radius:e.radius}:{};

/**
 * The part of a hero's walk into an enemy the hero takes (bodyBlock's share): heroShare for the mendigo, all of it for
 * the saci, the sanfoneiro and the chefões (card colisao-entre-herois, rules shovedEnemy; the phone: Body.fixed).
 */
export const enemyHeroShare=(b:Body)=>{const e=b as EnemyState;return shovedEnemy(e.kind,e.boss)?heroShare(b):1;};

/** The room's shove: moveSafely on the enemies' view of the body's floor (walls and barricades stop it). */
export function enemyShove(terrain:TerrainField):Shove{
  const view=enemyTerrain(terrain);
  return (b,dx,dy)=>{
    const e=b as EnemyState;
    moveSafely(e,dx,dy,onFloor(view,e.andar),e.radius);
    settleFloor(terrain,e);
  };
}

/** The solid bodies near (x, y) this tick (reused array). The index holds this tick's start; BODY_REACH covers the moves since. */
export function bodiesNear(ctx:SimContext,x:number,y:number,out:EnemyState[]):EnemyState[]{
  ctx.enemyIndex.query(x,y,PLAYER_RADIUS+BODY_REACH,out);
  let n=0;
  for(const e of out)if(solidEnemy(e)&&ctx.enemies.get(e.id)===e)out[n++]=e;
  out.length=n;
  return out;
}

/** A hero bodies bump into: standing in the run (online or played by the room), alive, not down. */
export const standingHero=(p:SimPlayer,autopilot?:(id:string)=>boolean)=>
  (p.online||!!autopilot?.(p.id))&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

const enemyOnly=()=>0;

/**
 * Card colisao-entre-herois: how long (ticks) a push mark stays after the last tick that pushed (SimPlayer.pushing /
 * pushed, EnemyState.pushed): a push held along a wall or a crowd is one animation, not a flicker each tick it misses.
 */
export const PUSH_HOLD=4;
export function markPush(on:{pushing?:PushMark;pushed?:PushMark},key:'pushing'|'pushed',x:number,y:number,tick:number){
  const m=on[key];
  if(m){m.x=x;m.y=y;m.until=tick+PUSH_HOLD;}else on[key]={x,y,until:tick+PUSH_HOLD};
}
/** The live push marks as the views send them (absent past `until`). */
export function pushView(on:{pushing?:PushMark;pushed?:PushMark},tick:number):{pushing?:Point;pushed?:Point}{
  const out:{pushing?:Point;pushed?:Point}={};
  if(on.pushing&&tick<on.pushing.until)out.pushing={x:on.pushing.x,y:on.pushing.y};
  if(on.pushed&&tick<on.pushed.until)out.pushed={x:on.pushed.x,y:on.pushed.y};
  return out;
}

/** After the enemies moved: no body stands inside a standing hero (see the header). */
export function heroBodiesPass(ctx:SimContext,autopilot?:(id:string)=>boolean,scratch:EnemyState[]=[],moved?:(id:string)=>void){
  const shove=enemyShove(ctx.terrain);
  for(const p of ctx.players.values()){
    if(!standingHero(p,autopilot))continue;
    const near=bodiesNear(ctx,p.x,p.y,scratch);
    if(!near.length)continue;
    const q=bodyBlock(p,p,near,ctx.terrain,shove,enemyOnly);
    if(q.x!==p.x||q.y!==p.y){p.x=q.x;p.y=q.y;setFloor(p,floorOf(q));moved?.(p.id);}
  }
}
