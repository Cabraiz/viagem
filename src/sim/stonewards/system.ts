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
 *
 * Tower defense (torres-sim, D-041): on the terrain's build sites (towers/sites.ts) the team builds and evolves the
 * defenses of towers/catalog.ts in the intermission (`build`, `upgrade`, `repair`; within BUILD_REACH); they fire in combat (towers/system.ts
 * defensesStep) and are hit through the same `hit` (D-017). The forge's 'torre-chinelo' recipe is unchanged.
 *
 * City (cidade-06): the base is the fountain plaza; the wall stands at points.praca (the fountain, so the forge's camp
 * is there too) and a barricade closes each mouth (barricades.ts). The enemy-ai hits both through `hit` (D-017); only
 * the wall falling is the defeat.
 */
import type {CellRect,Obstacle} from '../../maps/index.ts';
import {heroSpeed} from '../../maps/index.ts';
import type {SimContext,SimSystem} from '../context.ts';
import {ticks,type SimPlayer} from '../../contract/index.ts';
import {isStanding} from '../revive.ts';
import {buy as forgeBuy,clearTowers,draw,towerStep,type BuyResult} from './forge.ts';
import type {CalmGate} from '../ninhos/calma.ts';
import {gatherStep,refillNodes,WORK_PER_UNIT,type Gathered} from './resources.ts';
import {cityFarthestReturn,cityLoot,lootTripTicks,type CityLoot} from './loot.ts';
import {ENEMY_DAMAGE,CIDADE_CRATE_LINES,CIDADE_HORN_LINES,CIDADE_LEFT_BEHIND_LINES,DEPLETED_LINES,HORN_LINES,RECIPES,returnTicks} from '../../rules/index.ts';
import type {StonewardsState} from './state.ts';
import {createWall,damageWall,placeWall,siegeStep,WALL_MAX_HP} from './wall.ts';
import {blockingCity,createBarricades,damageBarricade,findBarricade,raiseDue,syncBarricades} from './barricades.ts';
import {cityCrateValue,hasTeamLoot,teamLootValue,type CityBalance} from '../city/balance.ts';
import {build as buildDefense,buildFree,damageDefense,defenseTargets,defensesStep,repair as repairDefense,upgrade as upgradeDefense,type FreeBuildContext,type TowerResult} from '../towers/system.ts';
import {coletaStep,coletar as coletarTralha,destruir as destruirTralha,placeTralha,type ColetaOutcome} from '../towers/tralha.ts';
import {placeFeirinhas} from '../towers/barracas.ts';
import {clearPieces,damagePiece,isPiece,pieceTargets,syncPieces,unoAlertStep,type FreeBuildHooks,type FreeOrder} from '../towers/free-build.ts';
import {buildPlanFor,type BuildPlan} from '../towers/sites.ts';

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
/*
 * City idle heroes (BUG-20261013-E4-corneta-jogador-longe): a hero who has neither walked (a non-zero stick,
 * StonewardsOptions.steered) nor worked a crate since the intermission started does not hold the horn
 * (StonewardsState.cityHornIdle): idle at the helicopter, ~42 s of walk from the plaza (about the whole intermission),
 * they used to sound it on the first tick and call everyone home. Displacement alone (a shove) does not count. If one of
 * them wakes after the horn and can no longer make it back, the horn is re-sized to their walk once per intermission,
 * a stretch within MAX_STRETCH_PER_RUN like any other.
 */
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
  /** City only: raise the four plaza barricades (default true). Travel/reach measurements (cidade-05c tests) turn them off. */
  barricades?:boolean;
  /** City tutorial (cidade-08): the barricades start down and go up at the first intermission. */
  barricadesLater?:boolean;
  /** Replaces the island's obstacles as nodes (tests). */
  obstacles?:readonly Obstacle[];
  /** Bancos (city): the crate ids this run does not have (a bank stands on their loot point); read on every gather step. */
  hiddenNodes?:()=>ReadonlySet<string>|undefined;
  wallMaxHp?:number;
  /** The 046A contact siege (siegeStep). The run turns it off: the enemy-ai is the only path that hurts the wall (D-017). */
  siegeContact?:boolean;
  /** Called once when the wall falls: common defeat. */
  onWallDestroyed?(ctx:SimContext):void;
  /** Called once per intermission when the horn sounds, with its pt-BR line and the tick the next round starts. */
  onHorn?(ctx:SimContext,line:string,endsTick:number):void;
  /**
   * City horn (idle heroes, BUG-20261013-E4): whether this player walked on this tick's players step (a non-zero stick).
   * Without it only working a crate wakes an idle hero.
   */
  steered?(playerId:string):boolean;
  /** Moves the end of the current intermission (the director owns ctx.round). Without it the horn never stretches it. */
  extendPrepare?(ctx:SimContext,endsTick:number):void;
  /**
   * City only (cidade-11, city/balance.ts): lootValue × the units each crate pays (× players[n].lootValue, n the heroes
   * standing on the intermission's first tick, StonewardsState.cityLootTeam) and intermissionExtraSeconds added after
   * the trip sizing. Read only where the crates are the nodes (cityLoot); absent or neutral: no change.
   */
  cityBalance?:Pick<CityBalance,'lootValue'|'intermissionExtraSeconds'|'players'>;
  /**
   * City: a barricade fell or was rebuilt (or a rematch reset moved them), changing the terrain's walkability in these
   * flow-grid cells (asset.unitsPerCell, inclusive). The run refreshes the grid and invalidates the planner there.
   * Not called when the system is created: the blockers are raised before the run builds its grid.
   */
  onTerrainChanged?(rect:CellRect):void;
  /**
   * D-052 free build: on (the city's runs, assemble.ts) with the car, the moto and the nests the build rules keep clear
   * (towers/free-build.ts; each hook optional). Absent: the build sites as before (tests, tools, the endless map).
   */
  freeBuild?:FreeBuildHooks;
  /**
   * barricada-construir part 2 (towers/tralha.ts): with the free build and a car, the map's barricadas are laid on the
   * first step; `give` hands a collected square to the hero (a kit:barricada; false: no room), `carrying` counts the
   * kits a hero has (CARREGA_MAX). Absent: no tralha (tests, the wall mode).
   */
  tralha?:{give(p:SimPlayer):boolean;carrying(p:SimPlayer):number};
  /**
   * D-051 mode 'ninhos' (assemble.ts; card ninhos-rounds-fora): no intermission. The forge and the towers' orders open
   * through `gate` (ninhos/calma.ts: no critter awake near the player), the crates are gathered at any time and the
   * nodes refill every `refillTicks` (rules/calma.ts CALMA.refillS). Absent: the rounds mode as before.
   */
  calm?:{gate:CalmGate;refillTicks:number};
}

export interface StonewardsSystem extends SimSystem {
  readonly id:'structures';
  readonly state:StonewardsState;
  /** `targetId`: what 'reparo' repairs (forge.ts buy): the wall by default, or a city barricade id. */
  buy(ctx:SimContext,playerId:string,recipeId:string,requestId?:string,targetId?:string):BuyResult;
  /** The one damage path of structures (D-017): the enemy-ai's hitStructure, routed by id to the wall, a barricade or a defense. */
  hit(ctx:SimContext,structureId:string,amount:number):void;
  /**
   * The terrain's build sites and rail (towers/sites.ts; empty on the island). D-052 free build: the sites are hints and
   * the rail is gone (null), so the bots' brain never saves for nor lays it.
   */
  readonly plan:BuildPlan;
  /**
   * Tower defense (torres-sim): the root on a free site, or the Gustavão's rail on the plan's rail id (torres-fio: the
   * rooms' {t:'build'}). D-052, the city: a FreeOrder (a piece on a grid cell, towers/system.ts buildFree); a site id
   * there is the root on the site's cell.
   */
  build(ctx:SimContext,playerId:string,order:string|FreeOrder,requestId?:string):TowerResult;
  /** Kits de torre (torre-pela-caixa): a kit's piece on a grid cell, for free (buildFree with `kit`); 'fora' off the city. */
  buildKit(ctx:SimContext,playerId:string,order:FreeOrder,requestId?:string):TowerResult;
  /** barricada-construir part 2: DESTRUIR a barricada square (at once, R$ to the hero) or COLETAR it (towers/tralha.ts). */
  destruir(ctx:SimContext,playerId:string,id:string):ReturnType<typeof destruirTralha>;
  coletar(ctx:SimContext,playerId:string,id:string,req?:number):ReturnType<typeof coletarTralha>;
  /** The coletas that ended on the last step (drained: the room answers the collectors). */
  drainColetas():ColetaOutcome[];
  /** Tower defense: evolves a ready defense (`branch`: 'A'|'B'|'C' at the root, a child id or label like 'A4b' at a fork). */
  upgrade(ctx:SimContext,playerId:string,defenseId:string,branch?:string,requestId?:string):TowerResult;
  /** Tower defense (torres-ajustes): repairs a standing defense below its maxHp, like the forge's barricade repair. */
  repair(ctx:SimContext,playerId:string,defenseId:string,requestId?:string):TowerResult;
  /** Fresh layer for a rematch: balance, nodes, wall, towers, ids and stream all start over. */
  reset():void;
}

export function createStonewardsState(options:Omit<StonewardsOptions,'onWallDestroyed'|'onHorn'|'extendPrepare'|'siegeContact'|'onTerrainChanged'>):StonewardsState{
  // City only: the island and the endless world keep exactly their old state (and state hashes).
  const city=options.barricades===false?undefined:createBarricades(options.terrain,undefined,options.barricadesLater===true);
  return {
    balance:{units:0},splitCursor:0,
    nodes:[],
    wall:createWall(placeWall(options.terrain,options.obstacles),options.wallMaxHp??WALL_MAX_HP),
    towers:[],
    ...(city?{barricades:city.barricades}:{}),...(city?.unsealed.length?{unsealed:city.unsealed}:{}),
    ...(city&&options.barricadesLater===true?{raiseBarricades:true}:{}),
    gathered:{},handled:[],
    refilledRound:-1,hornRound:-1,prepareStart:0,hornEndsTick:-1,stretched:0,sayReady:{},wallDown:false,defeatReported:false,rng:null,
  };
}

/**
 * What the enemy-ai may hit (EnemyAiOptions.structures): the wall while it stands, then the standing city barricades,
 * flagged `blocking` (any body pressed against one bashes it, siege or not). Off the city: exactly the wall, as before.
 */
export function structureTargets(state:StonewardsState,wall=true):{id:string;x:number;y:number;radius:number;blocking?:true}[]{
  // `wall` false (D-047, the chaveiro objective): the car stands where the wall was and is the target instead.
  const out:{id:string;x:number;y:number;radius:number;blocking?:true}[]=state.wallDown||!wall?[]:[{id:state.wall.id,x:state.wall.x,y:state.wall.y,radius:state.wall.radius}];
  for(const b of state.barricades??[])if(!b.down)out.push({id:b.id,x:b.x,y:b.y,radius:b.r,blocking:true});
  // Tower defenses (torres-sim): non-blocking siege targets, like the wall; none until the first build.
  if(state.defenses)out.push(...defenseTargets(state),...pieceTargets(state));
  return out;
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

const railless=new WeakMap<BuildPlan,BuildPlan>();
/** D-052: the plan with its sites as hints and no rail (the Gustavão is out of the free build). */
function withoutRail(plan:BuildPlan):BuildPlan{
  let out=railless.get(plan);
  if(!out){out=Object.freeze({...plan,rail:null});railless.set(plan,out);}
  return out;
}

/** A given `state` (a checkpoint) rebuilds the terrain's barricade blockers from it. */
export function createStonewardsSystem(options:StonewardsOptions,state=createStonewardsState(options)):StonewardsSystem{
  const contact=options.siegeContact??true;
  const extraTicks=ticks(Math.max(0,options.cityBalance?.intermissionExtraSeconds??0));
  const balance=options.cityBalance,teamLoot=!!balance&&hasTeamLoot(balance);
  /** This intermission's crate multiplier: the global lootValue × the standing team's (cidade-11 players knob). */
  const lootValueNow=()=>balance?teamLootValue(balance,teamLoot?state.cityLootTeam:undefined):1;
  /**
   * City loot knob: gatherStep already paid each crate its value; pay the difference to cityCrateValue (whole units per
   * crate) and scale this tick's credits in `gathered` by the same ratio (the per-gatherer split is gone by then).
   */
  function scaleLoot(got:readonly Gathered[],before:Readonly<Record<string,number>>,lootValue:number){
    let raw=0,paid=0;
    for(const g of got){const v=cityCrateValue(g.node.value,lootValue);raw+=g.node.value;paid+=v;state.balance.units+=v-g.node.value;}
    if(!(raw>0)||paid===raw)return;
    for(const id of Object.keys(state.gathered)){
      const was=Object.hasOwn(before,id)?before[id]:0,now=state.gathered[id];
      if(now!==was)Object.defineProperty(state.gathered,id,{value:was+(now-was)*paid/raw,enumerable:true,writable:true,configurable:true});
    }
  }
  syncBarricades(options.terrain,state);
  syncPieces(options.terrain,state);
  let coletaOutcomes:ColetaOutcome[]=[];
  const free:FreeBuildContext|undefined=options.freeBuild&&{...options.freeBuild,...(options.onTerrainChanged?{onTerrainChanged:options.onTerrainChanged}:{})};
  /** City: drops from cityHornIdle who walked or worked (`worked`) this tick; true when someone woke. */
  function wake(worked:ReadonlySet<string>){
    const idle=state.cityHornIdle;
    if(!idle?.length)return false;
    const still=idle.filter(id=>!worked.has(id)&&!options.steered?.(id));
    if(still.length===idle.length)return false;
    state.cityHornIdle=still;
    return true;
  }
  /** `woke`: a city hero left cityHornIdle this tick (after the horn: one re-size). */
  function horn(ctx:SimContext,loot:CityLoot|undefined,woke=false){
    const round=ctx.round;
    if(round.index<=1)return;
    const idle=loot?state.cityHornIdle:undefined;
    const back=()=>loot?cityFarthestReturn(ctx,loot,p=>returnTicks(Math.hypot(p.x-state.wall.x,p.y-state.wall.y),heroSpeed(ctx.terrain)),idle?.length?id=>idle.includes(id):undefined):farthestReturn(ctx,state);
    if(state.hornRound===round.index){
      // City: a hero idle when it sounded started walking or working and cannot make it back any more: once.
      if(!loot||!woke||state.cityHornResized)return;
      const need=back();
      if(round.phaseEndsTick-ctx.tick>=need)return;
      state.cityHornResized=true;
      stretch(ctx,ctx.tick+need);
      state.hornEndsTick=round.phaseEndsTick;
      return;
    }
    const lead=Math.max(loot?HORN_LEAD_CITY:HORN_LEAD,back()),left=round.phaseEndsTick-ctx.tick;
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
    get plan(){const plan=buildPlanFor(options.terrain);return free&&plan.rail?withoutRail(plan):plan;},
    build(ctx,playerId,order,requestId){
      const plan=buildPlanFor(ctx.terrain);
      if(typeof order==='string')return buildDefense(ctx,state,plan,playerId,order,requestId,free,options.calm?.gate);
      return free?buildFree(ctx,state,plan,playerId,order,requestId,free):{ok:false,reason:'fora'};
    },
    buildKit(ctx,playerId,order,requestId){
      return free?buildFree(ctx,state,buildPlanFor(ctx.terrain),playerId,order,requestId,free,'',true):{ok:false,reason:'fora'};
    },
    destruir(ctx,playerId,id){return destruirTralha(ctx,ctx.terrain,state,playerId,id,free?.onTerrainChanged);},
    coletar(ctx,playerId,id,req){
      const p=ctx.players.get(playerId);
      return options.tralha&&p?coletarTralha(ctx,state,playerId,id,options.tralha.carrying(p),req):{ok:false,reason:'player'};
    },
    drainColetas(){const out=coletaOutcomes;coletaOutcomes=[];return out;},
    upgrade(ctx,playerId,defenseId,branch,requestId){return upgradeDefense(ctx,state,buildPlanFor(ctx.terrain),playerId,defenseId,branch,requestId,options.calm?.gate);},
    repair(ctx,playerId,defenseId,requestId){return repairDefense(ctx,state,buildPlanFor(ctx.terrain),playerId,defenseId,requestId,options.calm?.gate);},
    buy(ctx,playerId,recipeId,requestId,targetId){
      const result=forgeBuy(ctx,state,playerId,recipeId,requestId,targetId,options.onTerrainChanged,options.calm?.gate);
      if(result.ok)say(ctx,state,playerId,result.recipe,result.line);
      return result;
    },
    reset(){
      for(const rect of clearPieces(options.terrain,state))options.onTerrainChanged?.(rect);
      const fresh=createStonewardsState(options) as unknown as Record<string,unknown>,target=state as unknown as Record<string,unknown>;
      for(const key of Object.keys(target))delete target[key];
      Object.assign(target,fresh);
      for(const rect of syncBarricades(options.terrain,state))options.onTerrainChanged?.(rect);
    },
    hit(ctx,structureId,amount){amount*=ENEMY_DAMAGE;// inimigos-3x-fortes (rules/forca-inimigos.ts): every structure hit is an enemy's
      if(structureId===state.wall.id)damageWall(ctx,state,amount);
      else if(state.defenses&&isPiece(state,structureId))damagePiece(ctx.terrain,state,structureId,amount,options.onTerrainChanged);
      else if(state.defenses&&!findBarricade(state,structureId))damageDefense(state,structureId,amount);
      else damageBarricade(ctx,state,structureId,amount,options.onTerrainChanged);
    },
    step(ctx){
      if(state.defeatReported)return;
      const round=ctx.round;
      // City tutorial: the team raises the barricades at the first intermission, the prepare phase of round 2 (round 1's
      // prepare is the tutorial's opening, the director's startPrepare(index)); raiseDue retries while a body is on one.
      if(state.raiseBarricades&&round.phase==='prepare'&&round.index>=2&&raiseDue(ctx,state,options.onTerrainChanged))delete state.raiseBarricades;
      // City (cidade-07): the crates are the nodes (loot.ts); `options.obstacles` (tests) keeps the island path.
      const loot=options.obstacles?undefined:cityLoot(ctx.terrain);
      if(options.calm){
        // D-051 mode 'ninhos': the crates are gathered at any time, and the nodes refill on the clock.
        if(!state.wallDown){
          if(state.refilledTick===undefined||ctx.tick-state.refilledTick>=options.calm.refillTicks){state.refilledTick=ctx.tick;refillNodes(state);}
          const lootValue=loot?lootValueNow():1,before=lootValue!==1?{...state.gathered}:undefined;
          const got=gatherStep(ctx,state,options.obstacles,undefined,options.hiddenNodes?.());
          if(before)scaleLoot(got,before,lootValue);
          for(const g of got)if(g.emptied)say(ctx,state,g.player,`no-${g.node.kind}`,draw(ctx,state,loot?CIDADE_CRATE_LINES:DEPLETED_LINES[g.node.kind]));
        }
      }else if(!state.wallDown&&round.phase==='prepare'){
        if(state.refilledRound!==round.index){
          state.refilledRound=round.index;state.prepareStart=ctx.tick;state.hornEndsTick=-1;refillNodes(state);
          // City team-size loot knob (cidade-11): the heroes standing as the intermission starts, kept for all of it.
          if(loot&&teamLoot){
            let n=0;for(const p of ctx.players.values())if(isStanding(p))n++;
            state.cityLootTeam=Math.max(1,Math.min(6,n));
          }
          // City: an intermission (not the opening countdown) long enough for the farthest good crate and back, its
          // collect time and the horn's lead (loot.ts lootTripTicks), up to MAX_PREPARE_TICKS. It is the city's
          // intermission length, not a horn stretch: it does not spend MAX_STRETCH_PER_RUN (9 intermissions × ~9 s
          // would leave the horn almost nothing for a straggler, and nothing once the city hero walks at ~2 u/s).
          if(loot&&round.index>1){
            // The horn's idle heroes: everyone, until they walk or work (cityHornIdle).
            state.cityHornIdle=[...ctx.players.keys()].sort();delete state.cityHornResized;
            stretch(ctx,ctx.tick+lootTripTicks(loot,kind=>WORK_PER_UNIT[kind],HORN_LEAD_CITY),false);
            // City knob (cidade-11): extra seconds on top of the sized intermission, within MAX_PREPARE_TICKS.
            if(extraTicks>0)stretch(ctx,ctx.round.phaseEndsTick+extraTicks,false);
          }
        }
        const lootValue=loot?lootValueNow():1,before=lootValue!==1?{...state.gathered}:undefined;
        const worked=new Set<string>();
        const got=gatherStep(ctx,state,options.obstacles,state.cityHornIdle?.length?id=>worked.add(id):undefined,options.hiddenNodes?.());
        if(before)scaleLoot(got,before,lootValue);
        for(const g of got)if(g.emptied)say(ctx,state,g.player,`no-${g.node.kind}`,draw(ctx,state,loot?CIDADE_CRATE_LINES:DEPLETED_LINES[g.node.kind]));
        horn(ctx,loot,loot?wake(worked):false);
      }else if(round.phase!=='prepare'){
        state.hornEndsTick=-1;
        if(state.cityHornIdle)delete state.cityHornIdle;
        if(state.cityHornResized)delete state.cityHornResized;
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
      if(!state.wallDown){towerStep(ctx,state);defensesStep(ctx,state);if(contact)siegeStep(ctx,state);}
      // NEW-20261021-ORQ-barricada-construir: the car near a barricada sounds its alert; 6 s later, still near, it falls.
      if(!state.wallDown&&free?.car)unoAlertStep(ctx,options.terrain,state,free.car(ctx.tick),free.onTerrainChanged);
      // barricada-construir part 2: the map's barricadas (once), then the coletas.
      if(options.tralha&&free?.car){
        const city=blockingCity(options.terrain),car=free.car(ctx.tick);
        if(city&&car&&!state.defenses?.tralha?.placed)placeTralha(ctx,state,{city,car,moto:free.moto?.(ctx.tick),nests:free.nests?.(ctx.tick),onTerrainChanged:free.onTerrainChanged});
        const give=options.tralha.give;
        coletaOutcomes.push(...coletaStep(ctx,options.terrain,state,give,free.onTerrainChanged));
      }
      // barracas-no-caminho: the map's feirinhas (once, after the tralha so it lays as before).
      if(free?.car&&!state.defenses?.feirinhas){
        const city=blockingCity(options.terrain),car=free.car(ctx.tick);
        if(city&&car)placeFeirinhas(ctx,state,{city,car,moto:free.moto?.(ctx.tick),nests:free.nests?.(ctx.tick),banks:free.banks?.(ctx.tick),onTerrainChanged:free.onTerrainChanged});
      }
      // Also catches a wall brought down by damageWall from another system (the enemy-ai, the boss).
      if(state.wallDown){state.defeatReported=true;clearTowers(ctx,state);options.onWallDestroyed?.(ctx);}
    },
  };
}

