/**
 * Stonewards 'structures' system: refills nodes and gathers during the intermission, sounds the return horn, runs
 * towers, and reports the wall falling exactly once.
 *
 * The horn (base-stonewards-mapa): it sounds when the time left in the intermission reaches the time the farthest
 * standing hero needs to walk back to the camp (rules.ts returnTicks), never later than HORN_LEAD before the end. If
 * nobody could make it back any more (a hero 150 units out when the wave ends), it sounds at once and stretches the
 * intermission to that walk, up to MAX_PREPARE_TICKS from the intermission's start, so who leaves on the horn is
 * home before the round.
 *
 * The wall (D-017): in the run only the enemy-ai hits it (hitStructure -> damageWall); `siegeContact:false` turns
 * the 046A contact siege off. Standalone (tests, tools) the contact siege still works.
 */
import type {Obstacle} from '../../maps/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {ticks} from '../../contract/index.ts';
import {isStanding} from '../revive.ts';
import {buy as forgeBuy,clearTowers,draw,towerStep,type BuyResult} from './forge.ts';
import {gatherStep,refillNodes} from './resources.ts';
import {DEPLETED_LINES,HORN_LINES,RECIPES,returnTicks} from '../../rules/index.ts';
import type {StonewardsState} from './state.ts';
import {createWall,placeWall,siegeStep,WALL_MAX_HP} from './wall.ts';

export {damageWall,isSiege,SIEGE_FLAG} from './wall.ts';
export {RECIPES,RECIPE_IDS,HORN_LINES} from '../../rules/index.ts';

/**
 * The horn sounds at least this long before an intermission ends (on its first tick if it is shorter).
 * Not in the opening countdown before round 1 (prepare with index 1): nobody is out gathering yet.
 */
export const HORN_LEAD=ticks(5);
/** Longest an intermission may get when the horn stretches it (150 units out needs ~55 s, rules.ts returnTicks). */
export const MAX_PREPARE_TICKS=ticks(75);
/**
 * Total stretch a whole run may take (review onda 6): two full stretches would already push a worst-case run past the
 * room's window. Past it the horn still sounds at once, but the round starts on time; who is that far fights there.
 */
export const MAX_STRETCH_PER_RUN=ticks(90);
/** D-013: one `say` per source every this many ticks; a purchase still applies, only its line is skipped. */
export const SAY_GAP=ticks(2);

export interface StonewardsOptions {
  /** The room's terrain; the wall is placed on it and the nodes are its obstacles. */
  terrain:SimContext['terrain'];
  /** Replaces the island's obstacles as nodes (tests). */
  obstacles?:readonly Obstacle[];
  wallMaxHp?:number;
  /** The 046A contact siege (siegeStep). The run turns it off: the enemy-ai is the only path that hurts the wall (D-017). */
  siegeContact?:boolean;
  /** Called once when the wall falls: common defeat. */
  onWallDestroyed?(ctx:SimContext):void;
  /** Called once per intermission when the horn sounds, with its pt-BR line and the tick the next round starts. */
  onHorn?(ctx:SimContext,line:string,endsTick:number):void;
  /** Moves the end of the current intermission (the director owns ctx.round). Without it the horn never stretches it. */
  extendPrepare?(ctx:SimContext,endsTick:number):void;
}

export interface StonewardsSystem extends SimSystem {
  readonly id:'structures';
  readonly state:StonewardsState;
  buy(ctx:SimContext,playerId:string,recipeId:string,requestId?:string):BuyResult;
  /** Fresh layer for a rematch: balance, nodes, wall, towers, ids and stream all start over. */
  reset():void;
}

export function createStonewardsState(options:Omit<StonewardsOptions,'onWallDestroyed'|'onHorn'|'extendPrepare'|'siegeContact'>):StonewardsState{
  return {
    balance:{coco:0,pedra:0},
    nodes:[],
    wall:createWall(placeWall(options.terrain,options.obstacles),options.wallMaxHp??WALL_MAX_HP),
    towers:[],gathered:{},handled:[],
    refilledRound:-1,hornRound:-1,prepareStart:0,hornEndsTick:-1,stretched:0,sayReady:{},wallDown:false,defeatReported:false,rng:null,
  };
}

/** Ticks the farthest standing hero needs to be back in the camp (0 when everyone is home). */
export function farthestReturn(ctx:SimContext,state:StonewardsState){
  let lead=0;
  for(const p of ctx.players.values())if(isStanding(p))lead=Math.max(lead,returnTicks(Math.hypot(p.x-state.wall.x,p.y-state.wall.y)));
  return lead;
}

/** Emits a D-013 `say` unless this source spoke less than SAY_GAP ago. */
export function say(ctx:SimContext,state:StonewardsState,source:string,key:string,line:string){
  const ready=Object.hasOwn(state.sayReady,source)?state.sayReady[source]:-Infinity;
  if(ctx.tick<ready)return false;
  Object.defineProperty(state.sayReady,source,{value:ctx.tick+SAY_GAP,enumerable:true,writable:true,configurable:true});
  ctx.emit({type:'say',source,key,line});
  return true;
}

export function createStonewardsSystem(options:StonewardsOptions,state=createStonewardsState(options)):StonewardsSystem{
  const contact=options.siegeContact??true;
  function horn(ctx:SimContext){
    const round=ctx.round;
    if(round.index<=1||state.hornRound===round.index)return;
    const lead=Math.max(HORN_LEAD,farthestReturn(ctx,state)),left=round.phaseEndsTick-ctx.tick;
    if(left>lead)return;
    state.hornRound=round.index;
    if(left<lead&&options.extendPrepare){
      const budget=Math.max(0,MAX_STRETCH_PER_RUN-state.stretched);
      const endsTick=Math.min(ctx.tick+lead,state.prepareStart+MAX_PREPARE_TICKS,round.phaseEndsTick+budget);
      if(endsTick>round.phaseEndsTick){
        const before=round.phaseEndsTick;
        options.extendPrepare(ctx,endsTick);
        state.stretched+=Math.max(0,round.phaseEndsTick-before);
      }
    }
    const line=draw(ctx,state,HORN_LINES);
    state.hornEndsTick=round.phaseEndsTick;
    ctx.emit({type:'horn',endsTick:round.phaseEndsTick,line});
    options.onHorn?.(ctx,line,round.phaseEndsTick);
  }
  return {
    id:'structures',
    state,
    buy(ctx,playerId,recipeId,requestId){
      const result=forgeBuy(ctx,state,playerId,recipeId,requestId);
      if(result.ok)say(ctx,state,playerId,result.recipe,result.line);
      return result;
    },
    reset(){
      const fresh=createStonewardsState(options) as unknown as Record<string,unknown>,target=state as unknown as Record<string,unknown>;
      for(const key of Object.keys(target))delete target[key];
      Object.assign(target,fresh);
    },
    step(ctx){
      if(state.defeatReported)return;
      const round=ctx.round;
      if(!state.wallDown&&round.phase==='prepare'){
        if(state.refilledRound!==round.index){state.refilledRound=round.index;state.prepareStart=ctx.tick;state.hornEndsTick=-1;refillNodes(state);}
        for(const g of gatherStep(ctx,state,options.obstacles))if(g.emptied)say(ctx,state,g.player,`no-${g.node.kind}`,draw(ctx,state,DEPLETED_LINES[g.node.kind]));
        horn(ctx);
      }else if(round.phase!=='prepare')state.hornEndsTick=-1;
      if(!state.wallDown){towerStep(ctx,state);if(contact)siegeStep(ctx,state);}
      // Also catches a wall brought down by damageWall from another system (the enemy-ai, the boss).
      if(state.wallDown){state.defeatReported=true;clearTowers(ctx,state);options.onWallDestroyed?.(ctx);}
    },
  };
}

