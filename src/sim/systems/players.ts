/**
 * Player step of the horde run (VGM-042): movement and facing from the input queue, tap target, class skill and regen.
 * Weapons fire on their own (weapons system); damage, falls and revives go through core/revive.
 */
import {moveStep,slipping,type Point} from '../../maps/index.ts';
import type {TerrainField} from '../../maps/index.ts';
import {SIM_HZ,SYSTEM_ORDER} from '../../contract/index.ts';
import type {PlayerInput,SimPlayer} from '../../contract/index.ts';
import type {SimSystem} from '../context.ts';
import {castSkill} from '../skills.ts';

/** 'players' runs before the contract systems, so enemies react to this tick's positions. */
/**
 * Systems of a horde run: the players' moves first, then SYSTEM_ORDER with the zueira events (VGM-053B) right after
 * the director (the round it just moved) and before the pickups (the boletos and coxinhas it drops are live this tick).
 */
export const RUN_ORDER=['players',SYSTEM_ORDER[0],'zueira',...SYSTEM_ORDER.slice(1)] as const;

/** Protocol 3 input (src/contract/types.ts). */
export type {PlayerInput};
/** Protocol 3 wire fields kept on the server player. */
export type RunPlayer=SimPlayer&{ack:number;score:number;attackTick?:number;skillTick?:number;skillReadyTick?:number};

export const DEFAULT_FACING:Readonly<Point>=Object.freeze({x:0,y:1});
const STEP=1/SIM_HZ;

/**
 * Same movement as shared.simulate (client prediction), plus facing. `tick` (the step's server tick) applies the D-036
 * effects: slowed walking, or the slide while slipping (the stick and facing are ignored then); omitted, plain walking.
 * A slide needs a step, like walking: a player standing still (no step this tick) does not slide (D-036 decision: the
 * phone replays exactly the steps the room takes, and the stand-still balance of the rounds is unchanged).
 */
export function movePlayer(p:SimPlayer,input:PlayerInput,terrain:TerrainField,tick?:number){
  const effects=tick===undefined?undefined:p,slide=slipping(effects,tick??0);
  Object.assign(p,moveStep(p,{x:input.x,y:input.y},tick??0,effects,terrain));
  if(slide)return;
  const length=Math.hypot(input.x,input.y);
  if(Number.isFinite(length)&&length>=.01)p.facing={x:input.x/length,y:input.y/length};
}

/**
 * One input per player per tick, like the prototype, so client prediction and the server stay in step. `autopilot`:
 * an offline player the room plays meanwhile (3g-rede-sem-teleporte): it walks on the room's inputs, whose seq is not
 * the person's (their ack stays where their own inputs left it).
 */
export function playersSystem(takeInput:(playerId:string)=>PlayerInput|undefined,autopilot?:(playerId:string)=>boolean):SimSystem{
  return {id:'players',step(ctx){
    for(const player of ctx.players.values()){
      const p=player as RunPlayer;
      // D-036: an effect that is over goes away (views and the owner's confirmed check only see live ones).
      if(p.slowUntil!==undefined&&ctx.tick>=p.slowUntil)delete p.slowUntil;
      if(p.slipUntil!==undefined&&ctx.tick>=p.slipUntil){delete p.slipUntil;delete p.slip;}
      const auto=!p.online&&!!autopilot?.(p.id);
      if((!p.online&&!auto)||p.spectator)continue;
      const input=takeInput(p.id);
      if(input&&!auto)p.ack=input.seq;
      if(p.downed||p.eliminated||!(p.hp>0))continue;
      if(input){
        movePlayer(p,input,ctx.terrain,ctx.tick);
        if(input.target)p.target=input.target;else delete p.target;
      }
      if(!auto&&p.stats.regen>0&&p.hp<p.stats.maxHp)p.hp=Math.min(p.stats.maxHp,p.hp+p.stats.regen*STEP);
      if(input?.skill){
        const cast=castSkill(ctx,p);
        if(cast){
          p.skillTick=ctx.tick;p.skillReadyTick=cast.readyTick;
          // What the client needs besides the cooldown (E7-skill-hud-wiring): the line, the dice and where the caster landed.
          ctx.emit({type:'skill',player:p.id,skill:cast.classId,line:cast.line,...(cast.outcome?{outcome:cast.outcome}:{}),
            ...(cast.movedTo?{x:cast.movedTo.x,y:cast.movedTo.y}:{})});
        }
      }
    }
  }};
}
