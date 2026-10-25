/**
 * Player step of the horde run (VGM-042): movement and facing from the input queue, tap target, class skill and regen.
 * Weapons fire on their own (weapons system); damage, falls and revives go through core/revive. D-051 manual combat
 * (ManualCombat): who holds the attack this tick is noted for the weapons system and the class skill is ignored.
 */
import {capStep,carBlock,floorOf,floorOn,isDown,moveStep,onFloor,setFloor,slipping,slowStep,walkable,type CarPlace,type Point} from '../../maps/index.ts';
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
  if(isDown(effects,tick??0))return;
  const q=moveStep(p,{x:input.x,y:input.y},tick??0,effects,terrain);
  p.x=q.x;p.y=q.y;setFloor(p,floorOf(q));
  if(slide)return;
  const length=Math.hypot(input.x,input.y);
  if(Number.isFinite(length)&&length>=.01)p.facing={x:input.x/length,y:input.y/length};
}

/**
 * D-051 manual combat: the players who hold the attack on this tick (PlayerInput.attack of the step taken), read by
 * the weapons system later in the same tick. Transient: rebuilt every tick from the inputs (which are in the replay
 * hash), never part of the state.
 */
export interface ManualCombat {attacking:Set<string>}

/**
 * One input per player per tick, like the prototype, so client prediction and the server stay in step. `autopilot`:
 * an offline player the room plays meanwhile (3g-rede-sem-teleporte): it walks on the room's inputs, whose seq is not
 * the person's (their ack stays where their own inputs left it). `stepCap` (D-052, the chaveiro's car): the most a player
 * may walk this tick (u), undefined for free; the step is cut along its own line (kept in place if that point is not walkable).
 * `car` (card uno-bloqueio-corpo): the chaveiro's car, whose body every standing hero stays out of (maps carBlock, as the
 * phone's replay), walking or not (the car rolled onto a hero standing still: out to its edge on this tick).
 * `stepSlow` (NEW-20261023-ORQ-barracas-no-caminho): the step's multiplier from where the hero stands (a barraca: ×0.5).
 */
export function playersSystem(takeInput:(playerId:string)=>PlayerInput|undefined,autopilot?:(playerId:string)=>boolean,manual?:ManualCombat,
  stepCap?:(playerId:string)=>number|undefined,car?:()=>CarPlace|undefined,stepSlow?:(at:Point)=>number):SimSystem{
  return {id:'players',step(ctx){
    manual?.attacking.clear();
    const body=car?.();
    for(const player of ctx.players.values()){
      const p=player as RunPlayer;
      // D-036: an effect that is over goes away (views and the owner's confirmed check only see live ones).
      if(p.slowUntil!==undefined&&ctx.tick>=p.slowUntil)delete p.slowUntil;
      if(p.slipUntil!==undefined&&ctx.tick>=p.slipUntil){delete p.slipUntil;delete p.slip;}
      // D-047 Dona Cida's sweets: an expired one goes away too.
      if(p.fastUntil!==undefined&&ctx.tick>=p.fastUntil)delete p.fastUntil;
      if(p.mightUntil!==undefined&&ctx.tick>=p.mightUntil)delete p.mightUntil;
      if(p.guardUntil!==undefined&&ctx.tick>=p.guardUntil)delete p.guardUntil;
      // boss-fim-onda-1, the Tank's punch: the throw carries the body (walls and water stop it), then the fall ends.
      if(p.knock&&ctx.tick<(p.knockUntil??-Infinity)&&!p.downed){
        const q={x:p.x+p.knock.x,y:p.y+p.knock.y};
        const floor=floorOf(p);
        if(walkable(q,onFloor(ctx.terrain,floor))){p.x=q.x;p.y=q.y;setFloor(p,floorOn(ctx.terrain,q.x,q.y,floor));}else{delete p.knock;delete p.knockUntil;}
      }else if(p.knock||p.knockUntil!==undefined){delete p.knock;delete p.knockUntil;}
      if(p.downUntil!==undefined&&ctx.tick>=p.downUntil)delete p.downUntil;
      const down=isDown(p,ctx.tick);
      const auto=!p.online&&!!autopilot?.(p.id);
      if((!p.online&&!auto)||p.spectator)continue;
      const input=takeInput(p.id);
      if(input&&!auto)p.ack=input.seq;
      if(p.downed||p.eliminated||!(p.hp>0))continue;
      if(input){
        const from={x:p.x,y:p.y,...(p.andar===1?{andar:1 as const}:{})};
        movePlayer(p,input,ctx.terrain,ctx.tick);
        // D-052: the same cut as the phone's replay (maps/prediction capStep).
        // NEW-20261023-ORQ-barracas-no-caminho: then the barraca's slow, from where the step started (maps slowStep).
        const capped=capStep(from,p,stepCap?.(p.id),ctx.terrain),slowed=slowStep(from,capped,stepSlow?.(from)??1,ctx.terrain);
        const q=carBlock(from,slowed,body,ctx.terrain);p.x=q.x;p.y=q.y;setFloor(p,floorOf(q));
        if(input.target)p.target=input.target;else delete p.target;
        // The mouse's aim while attacking (cone-ataque-melee): the melee swing goes there (weapons/system.ts fireCone).
        if(input.aim)p.aim=input.aim;else delete p.aim;
        // D-051: the attack held (or the press the input track kept) fires the equipped weapon this tick.
        if(manual&&input.attack&&!down)manual.attacking.add(p.id);
        // BUG-20261023-ORQ-tiro-na-direcao-mobile: attacking with an aim (the phone's aim stick, the mouse) turns the hero
        // to it, so a later tap without one fires where the body last looked.
        const al=input.aim?Math.hypot(input.aim.x,input.aim.y):0;
        if(manual&&input.attack&&input.aim&&al>1e-6)p.facing={x:input.aim.x/al,y:input.aim.y/al};
      }
      else if(body){const q=carBlock(p,p,body,ctx.terrain);p.x=q.x;p.y=q.y;}
      if(!auto&&p.stats.regen>0&&p.hp<p.stats.maxHp)p.hp=Math.min(p.stats.maxHp,p.hp+p.stats.regen*STEP);
      // D-051: no class skill in the manual combat (the classes stay as looks and stats).
      if(input?.skill&&!manual){
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
