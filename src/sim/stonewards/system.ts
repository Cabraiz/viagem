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
import {heroSpeed} from '../../maps/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {ticks} from '../../contract/index.ts';
import {isStanding} from '../revive.ts';
import {buy as forgeBuy,clearTowers,draw,towerStep,type BuyResult} from './forge.ts';
import {gatherStep,refillNodes,WORK_PER_UNIT,type Gathered} from './resources.ts';
import {cityFarthestReturn,cityLoot,lootTripTicks,type CityLoot} from './loot.ts';
import {CIDADE_CRATE_LINES,CIDADE_HORN_LINES,CIDADE_LEFT_BEHIND_LINES,DEPLETED_LINES,HORN_LINES,RECIPES,returnTicks} from '../../rules/index.ts';
import type {StonewardsState} from './state.ts';
import {createWall,placeWall,siegeStep,WALL_MAX_HP} from './wall.ts';
import {cityCrateValue,type CityBalance} from '../city/balance.ts';

export {damageWall,isSiege,SIEGE_FLAG} from './wall.ts';
export {RECIPES,RECIPE_IDS,HORN_LINES} from '../../rules/index.ts';

/**
 * The horn sounds at least this long before an intermission ends (on its first tick if it is shorter).
 * Not in the opening countdown before round 1 (prepare with index 1): nobody is out gathering yet.
 */
export const HORN_LEAD=ticks(5);
/**
 * City (cidade-07): the horn sounds at least 10 s before the intermission ends (the island keeps HORN_LEAD), and the
 * "can the farthest hero get back" estimate is the real walk to the plaza (loot.ts cityFarthestReturn).
 */
export const HORN_LEAD_CITY=ticks(10);
/** `say` key of the left-behind line (a hero outside the base when the round starts, city only). */
export const LEFT_BEHIND_KEY='ficou-pra-tras';
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
  /**
   * City only (cidade-11, city/balance.ts): lootValue × the units each crate pays and intermissionExtraSeconds added
   * after the trip sizing. Read only where the crates are the nodes (cityLoot); absent or neutral: no change.
   */
  cityBalance?:Pick<CityBalance,'lootValue'|'intermissionExtraSeconds'>;
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
  for(const p of ctx.players.values())if(isStanding(p))lead=Math.max(lead,returnTicks(Math.hypot(p.x-state.wall.x,p.y-state.wall.y),heroSpeed(ctx.terrain)));
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
  const lootValue=options.cityBalance?.lootValue??1,extraTicks=ticks(Math.max(0,options.cityBalance?.intermissionExtraSeconds??0));
  /**
   * City loot knob: gatherStep already paid each crate its value; pay the difference to cityCrateValue (whole units per
   * crate) and scale this tick's credits in `gathered` by the same ratio (the per-gatherer split is gone by then).
   */
  function scaleLoot(got:readonly Gathered[],before:Readonly<Record<string,number>>){
    let raw=0,paid=0;
    for(const g of got){const v=cityCrateValue(g.node.value,lootValue);raw+=g.node.value;paid+=v;state.balance[g.node.kind]+=v-g.node.value;}
    if(!(raw>0)||paid===raw)return;
    for(const id of Object.keys(state.gathered)){
      const was=Object.hasOwn(before,id)?before[id]:0,now=state.gathered[id];
      if(now!==was)Object.defineProperty(state.gathered,id,{value:was+(now-was)*paid/raw,enumerable:true,writable:true,configurable:true});
    }
  }
  function horn(ctx:SimContext,loot:CityLoot|undefined){
    const round=ctx.round;
    if(round.index<=1||state.hornRound===round.index)return;
    const back=loot?cityFarthestReturn(ctx,loot,p=>returnTicks(Math.hypot(p.x-state.wall.x,p.y-state.wall.y))):farthestReturn(ctx,state);
    const lead=Math.max(loot?HORN_LEAD_CITY:HORN_LEAD,back),left=round.phaseEndsTick-ctx.tick;
    if(left>lead)return;
    state.hornRound=round.index;
    if(left<lead)stretch(ctx,ctx.tick+lead);
    const line=draw(ctx,state,loot?CIDADE_HORN_LINES:HORN_LINES); // one draw either way: island rng unchanged
    state.hornEndsTick=round.phaseEndsTick;
    ctx.emit({type:'horn',endsTick:round.phaseEndsTick,line});
    options.onHorn?.(ctx,line,round.phaseEndsTick);
  }
  /**
   * Moves the end of the intermission to `endsTick`, within MAX_PREPARE_TICKS; a horn stretch (`budgeted`) also within
   * the run's MAX_STRETCH_PER_RUN, and counts against it.
   */
  function stretch(ctx:SimContext,endsTick:number,budgeted=true){
    const round=ctx.round;
    if(!options.extendPrepare)return;
    const budget=budgeted?Math.max(0,MAX_STRETCH_PER_RUN-state.stretched):Infinity;
    const capped=Math.min(endsTick,state.prepareStart+MAX_PREPARE_TICKS,round.phaseEndsTick+budget);
    if(capped<=round.phaseEndsTick)return;
    const before=round.phaseEndsTick;
    options.extendPrepare(ctx,capped);
    if(budgeted)state.stretched+=Math.max(0,round.phaseEndsTick-before);
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
      // City (cidade-07): the crates are the nodes (loot.ts); `options.obstacles` (tests) keeps the island path.
      const loot=options.obstacles?undefined:cityLoot(ctx.terrain);
      if(!state.wallDown&&round.phase==='prepare'){
        if(state.refilledRound!==round.index){
          state.refilledRound=round.index;state.prepareStart=ctx.tick;state.hornEndsTick=-1;refillNodes(state);
          // City: an intermission (not the opening countdown) long enough for the farthest good crate and back, its
          // collect time and the horn's lead (loot.ts lootTripTicks), up to MAX_PREPARE_TICKS. It is the city's
          // intermission length, not a horn stretch: it does not spend MAX_STRETCH_PER_RUN (9 intermissions × ~9 s
          // would leave the horn almost nothing for a straggler, and nothing once the city hero walks at ~2 u/s).
          if(loot&&round.index>1){
            stretch(ctx,ctx.tick+lootTripTicks(loot,kind=>WORK_PER_UNIT[kind],HORN_LEAD_CITY),false);
            // City knob (cidade-11): extra seconds on top of the sized intermission, within MAX_PREPARE_TICKS.
            if(extraTicks>0)stretch(ctx,ctx.round.phaseEndsTick+extraTicks,false);
          }
        }
        const scale=loot&&lootValue!==1,before=scale?{...state.gathered}:undefined;
        const got=gatherStep(ctx,state,options.obstacles);
        if(before)scaleLoot(got,before);
        for(const g of got)if(g.emptied)say(ctx,state,g.player,`no-${g.node.kind}`,draw(ctx,state,loot?CIDADE_CRATE_LINES:DEPLETED_LINES[g.node.kind]));
        horn(ctx,loot);
      }else if(round.phase!=='prepare'){
        state.hornEndsTick=-1;
        // City: the round started; each standing hero outside the base gets the left-behind line, once per round.
        // Not in round 1: everyone starts at the crashed vehicle, outside the base, by design.
        if(loot&&round.index>1&&!state.wallDown&&state.refilledRound===round.index&&state.leftBehindRound!==round.index){
          state.leftBehindRound=round.index;
          const used=new Set<string>();
          for(const id of [...ctx.players.keys()].sort()){
            const p=ctx.players.get(id)!;
            if(!isStanding(p)||loot.insideBase(p))continue;
            // Straight to the event (not `say`): its SAY_GAP must not drop it after a crate's line a moment ago.
            Object.defineProperty(state.sayReady,id,{value:ctx.tick+SAY_GAP,enumerable:true,writable:true,configurable:true});
            // Different lines for heroes left behind in the same tick (a few extra draws at most, still deterministic).
            let line=draw(ctx,state,CIDADE_LEFT_BEHIND_LINES);
            for(let t=0;t<4&&used.has(line);t++)line=draw(ctx,state,CIDADE_LEFT_BEHIND_LINES);
            used.add(line);
            ctx.emit({type:'say',source:id,key:LEFT_BEHIND_KEY,line});
          }
        }
      }
      if(!state.wallDown){towerStep(ctx,state);if(contact)siegeStep(ctx,state);}
      // Also catches a wall brought down by damageWall from another system (the enemy-ai, the boss).
      if(state.wallDown){state.defeatReported=true;clearTowers(ctx,state);options.onWallDestroyed?.(ctx);}
    },
  };
}

