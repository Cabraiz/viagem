/**
 * Pack 12 fatia A2 (E7): the `turret` pattern (carro-de-som). Placed at the owner's feet (`mechanic:'turret'`, still,
 * never hits by contact), it stays until the next placement (`cooldown`: "1 viva por 10 s", a new one retires the old)
 * and every `hitInterval` shoots straight shots (`speed`, `area`, `pierce`, flying `duration`, like the pistol's, through
 * HERO_SHOT_SPEED_MULT) at the nearest enemy within `range` of it. The shots are the sound waves: source TURRET_SHOT.
 */
import type {EnemyState} from '../../contract/index.ts';
import {HERO_SHOT_SPEED_MULT} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import {canAct,isAlive,spawnProjectile,type WeaponProjectile} from '../projectiles.ts';
import {isReflecting} from '../enemies/catalog.ts';
import {PIERCE_INFINITE} from './catalog.ts';
import type {FireApi,FirePattern,PatternReach} from './fire-api.ts';

/** Source of the car's shots (render: the `projeteis` sound wave, render/arsenal-a2-look.ts); the car keeps the weapon id. */
export const TURRET_SHOT='carro-de-som-onda';
/** Size of the car on the ground (u): only drawn, it never touches anyone. */
export const TURRET_RADIUS=.6;
/** Angle between the waves of one volley when `amount` > 1 (rad). */
const FAN_STEP=.18;

/** Placed when an enemy is within the turret's range. */
export const turretReach:PatternReach=w=>({reach:w.range,pad:false});

/** The volley (system.ts fire, pattern 'turret'): place the car (it shoots from the next tick on). */
export const fireTurret:FirePattern=(ctx,player,w,api)=>{
  const aimed=api.targets(ctx,player,turretReach(w).reach,1);
  if(!aimed.length)return false;
  const car=spawnProjectile(ctx,{
    owner:player.id,source:w.def.id,motion:'linear',x:player.x,y:player.y,vx:0,vy:0,radius:TURRET_RADIUS,
    damage:w.damage,pierce:PIERCE_INFINITE,hostile:false,knockback:w.knockback,untilTick:ctx.tick+w.cooldownTicks,
    mechanic:'turret',data:{next:ctx.tick+1,every:w.rehitTicks,range:w.range,area:w.area,amount:w.amount,pierce:w.pierce,
      speed:w.speed*HERO_SHOT_SPEED_MULT,life:Math.max(1,Math.round(w.durationTicks/HERO_SHOT_SPEED_MULT))},
  },api.cap);
  if(!car)return false;
  for(const base of [...ctx.projectiles.values()]){
    const p=base as WeaponProjectile;
    if(p!==car&&p.mechanic==='turret'&&!p.hostile&&p.owner===player.id&&p.source===w.def.id)ctx.projectiles.delete(p.id);
  }
  return true;
};

/** Every tick, before the players fire (system.ts step): the placed turrets of acting owners shoot when due. */
export function tickTurrets(ctx:SimContext,api:FireApi):void{
  const cars:WeaponProjectile[]=[];
  for(const base of ctx.projectiles.values()){const p=base as WeaponProjectile;if(p.mechanic==='turret'&&!p.hostile&&p.data)cars.push(p);}
  for(const car of cars){
    const d=car.data!;
    if(ctx.tick<d.next||ctx.tick>=car.untilTick)continue;
    const owner=ctx.players.get(car.owner);
    if(!owner||!canAct(owner))continue;
    const target=nearest(ctx,car.x,car.y,d.range);
    if(!target)continue;
    d.next=ctx.tick+d.every;
    const base=Math.atan2(target.y-car.y,target.x-car.x);
    for(let i=0;i<d.amount;i++){
      const a=base+(i-(d.amount-1)/2)*FAN_STEP;
      spawnProjectile(ctx,{
        owner:car.owner,source:TURRET_SHOT,motion:'linear',x:car.x,y:car.y,vx:Math.cos(a)*d.speed,vy:Math.sin(a)*d.speed,
        radius:d.area,damage:car.damage,pierce:d.pierce,hostile:false,knockback:car.knockback,untilTick:ctx.tick+d.life,
      },api.cap);
    }
    ctx.emit({type:'fire',player:car.owner,weapon:car.source,x:car.x,y:car.y,dx:Math.cos(base),dy:Math.sin(base)});
  }
}

/** Nearest live enemy within `range` of the car, a posing influencer only when nobody else is there; ties by id. */
function nearest(ctx:SimContext,x:number,y:number,range:number):EnemyState|undefined{
  const out:EnemyState[]=[];
  ctx.enemyIndex.query(x,y,range,out);
  let best:EnemyState|undefined,bestD=Infinity,bestPosing=true;
  for(const e of out){
    if(!isAlive(ctx,e)||!ctx.enemies.has(e.id))continue;
    const dist=Math.hypot(e.x-x,e.y-y);
    if(dist>range)continue;
    const posing=isReflecting(e,ctx.tick);
    if(best&&(posing!==bestPosing?posing:dist>bestD||dist===bestD&&e.id>best.id))continue;
    best=e;bestD=dist;bestPosing=posing;
  }
  return best;
}
