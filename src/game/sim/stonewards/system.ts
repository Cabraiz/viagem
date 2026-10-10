/**
 * Stonewards 'structures' system: refills nodes and gathers during the intermission, sounds the
 * return horn, runs towers and wall siege, and reports the wall falling exactly once.
 */
import {resourceObstacles,type Obstacle} from '../../world.ts';
import type {SimContext,SimSystem} from '../types.ts';
import {ticks} from '../types.ts';
import {buy as forgeBuy,clearTowers,draw,towerStep,type BuyResult} from './forge.ts';
import {createNodes,gatherStep,refillNodes} from './resources.ts';
import type {StonewardsState} from './state.ts';
import {createWall,placeWall,siegeStep,WALL_MAX_HP} from './wall.ts';

export {damageWall,isSiege,SIEGE_FLAG} from './wall.ts';
export {RECIPES,RECIPE_IDS} from './forge.ts';

/**
 * The horn sounds this long before an intermission ends (on its first tick if it is shorter).
 * Not in the opening countdown before round 1 (prepare with index 1): nobody is out gathering yet.
 */
export const HORN_LEAD=ticks(5);
export const HORN_LINES=[
  'Corneta tocou! Larga o coco e volta pra muralha!',
  'Fim do recreio! Os bichos tão chegando!',
  'Tá ouvindo? É a corneta, não é o caminhão do gás!',
] as const;

export interface StonewardsOptions {
  /** The room's terrain; the wall is placed on it. */
  terrain:SimContext['terrain'];
  obstacles?:readonly Obstacle[];
  wallMaxHp?:number;
  /** Called once when the wall falls: common defeat. */
  onWallDestroyed?(ctx:SimContext):void;
  /** Called once per intermission, HORN_LEAD before it ends, with a pt-BR line. */
  onHorn?(ctx:SimContext,line:string):void;
}

export interface StonewardsSystem extends SimSystem {
  readonly id:'structures';
  readonly state:StonewardsState;
  buy(ctx:SimContext,playerId:string,recipeId:string,requestId?:string):BuyResult;
  /** Fresh layer for a rematch: balance, nodes, wall, towers, ids and stream all start over. */
  reset():void;
}

export function createStonewardsState(options:Omit<StonewardsOptions,'onWallDestroyed'|'onHorn'>):StonewardsState{
  const source=options.obstacles??resourceObstacles(options.terrain);
  return {
    balance:{coco:0,pedra:0},
    nodes:createNodes(source),
    wall:createWall(placeWall(options.terrain,options.obstacles),options.wallMaxHp??WALL_MAX_HP),
    towers:[],gathered:{},handled:[],
    refilledRound:-1,hornRound:-1,wallDown:false,defeatReported:false,rng:null,
  };
}

export function createStonewardsSystem(options:StonewardsOptions,state=createStonewardsState(options)):StonewardsSystem{
  return {
    id:'structures',
    state,
    buy:(ctx,playerId,recipeId,requestId)=>forgeBuy(ctx,state,playerId,recipeId,requestId),
    reset(){
      const fresh=createStonewardsState(options) as unknown as Record<string,unknown>,target=state as unknown as Record<string,unknown>;
      for(const key of Object.keys(target))delete target[key];
      Object.assign(target,fresh);
    },
    step(ctx){
      if(state.defeatReported)return;
      const round=ctx.round;
      if(!state.wallDown&&round.phase==='prepare'){
        if(state.refilledRound!==round.index){state.refilledRound=round.index;refillNodes(state);}
        gatherStep(ctx,state);
        if(round.index>1&&state.hornRound!==round.index&&round.phaseEndsTick-ctx.tick<=HORN_LEAD){
          state.hornRound=round.index;
          options.onHorn?.(ctx,draw(ctx,state,HORN_LINES));
        }
      }
      if(!state.wallDown){towerStep(ctx,state);siegeStep(ctx,state);}
      // Also catches a wall brought down by damageWall from another system (e.g. the boss).
      if(state.wallDown){state.defeatReported=true;clearTowers(ctx,state);options.onWallDestroyed?.(ctx);}
    },
  };
}
