/**
 * Player step of the horde run (VGM-042): movement and facing from the input queue, tap target, class skill and regen.
 * Weapons fire on their own (weapons system); damage, falls and revives go through core/revive.
 */
import {moveDirection,type Point} from '../../world.ts';
import type {TerrainField} from '../../terrain/field.ts';
import {SIM_HZ,SYSTEM_ORDER} from '../types.ts';
import type {SimPlayer,SimSystem} from '../types.ts';
import {castSkill} from '../skills.ts';

/** 'players' runs before the contract systems, so enemies react to this tick's positions. */
export const RUN_ORDER=['players',...SYSTEM_ORDER] as const;

/** Protocol 3 input. `attack` is accepted for compatibility but weapons fire automatically. */
export interface PlayerInput {seq:number;x:number;y:number;attack:boolean;target?:string;skill?:boolean}
/** Protocol 3 wire fields kept on the server player. */
export type RunPlayer=SimPlayer&{ack:number;score:number;attackTick?:number;skillTick?:number;skillReadyTick?:number};

export const DEFAULT_FACING:Readonly<Point>=Object.freeze({x:0,y:1});
const STEP=1/SIM_HZ;

/** Same movement as shared.simulate (client prediction), plus facing. */
export function movePlayer(p:SimPlayer,input:PlayerInput,terrain:TerrainField){
  Object.assign(p,moveDirection(p,{x:input.x,y:input.y},STEP,terrain));
  const length=Math.hypot(input.x,input.y);
  if(Number.isFinite(length)&&length>=.01)p.facing={x:input.x/length,y:input.y/length};
}

/** One input per player per tick, like the prototype, so client prediction and the server stay in step. */
export function playersSystem(takeInput:(playerId:string)=>PlayerInput|undefined):SimSystem{
  return {id:'players',step(ctx){
    for(const player of ctx.players.values()){
      const p=player as RunPlayer;
      if(!p.online||p.spectator)continue;
      const input=takeInput(p.id);
      if(input)p.ack=input.seq;
      if(p.downed||p.eliminated||!(p.hp>0))continue;
      if(input){
        movePlayer(p,input,ctx.terrain);
        if(input.target)p.target=input.target;else delete p.target;
      }
      if(p.stats.regen>0&&p.hp<p.stats.maxHp)p.hp=Math.min(p.stats.maxHp,p.hp+p.stats.regen*STEP);
      if(input?.skill){
        const cast=castSkill(ctx,p);
        if(cast){p.skillTick=ctx.tick;p.skillReadyTick=cast.readyTick;}
      }
    }
  }};
}
