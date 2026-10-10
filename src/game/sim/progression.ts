/**
 * XP, pickups, team levels and the upgrade offer queue (VGM-034).
 * Offers come from two sources: team level (`lvl-…`) and end of round (`rnd-…`, called by the director).
 * Only the oldest offer of each player can be chosen. Clocks never run while the player is offline.
 * Deadlines (D-021, replaces the 10 s head clock of VGM-034 when a round director runs):
 * - a level offer granted in combat is held (HELD_DEADLINE) and is due at the end of the next intermission that still
 *   has ARM_SECONDS left; one granted during such an intermission is due at its end;
 * - a round offer is due at the end of its intermission (grantRoundOffers);
 * - when the intermission ends, every due offer gets its visible default once, oldest first (stale cards re-rolled).
 * Without a director (ctx.round.total 0) the old rule applies: OFFER_SECONDS from the moment an offer becomes the head.
 */
import {Rng} from './rng.ts';
import {SIM_HZ,ticks} from './types.ts';
import type {EnemyState,LevelOffer,OfferSource,PickupKind,PickupState,SimContext,SimPlayer,SimSystem,TeamProgress} from './types.ts';
import type {Point} from '../world.ts';
import {isLand} from '../world.ts';
import {HEAL_AMOUNT,HEAL_CHOICE,ARM_SECONDS,HELD_DEADLINE,OFFER_SECONDS,applyChoice,defaultIndexFor,isEligible,isHeldOffer,rollChoices} from './offers.ts';
import type {ItemCatalog} from './offers.ts';
import {openChest as openEvolutionChest} from './evolutions.ts';
import type {ChestOptions} from './evolutions.ts';
import {refreshStats} from './stats.ts';
import type {ClassBonus} from './stats.ts';

/** Contract additions approved in D-005 (SimPlayer.classBonus, SimContext.runStartTick), read defensively until VGM-030 lands them. */
const classBonusOf=(player:SimPlayer)=>(player as SimPlayer&{classBonus?:ClassBonus}).classBonus;
const ctxRunStartTick=(ctx:SimContext)=>(ctx as SimContext&{runStartTick?:number}).runStartTick;

/** XP needed to go from `level` to `level + 1`: 5, then +10 per level until 20, +13 until 40, +16 after. */
export function xpToNext(level:number){
  const l=Math.max(1,Math.floor(level));
  if(l<=20)return 5+10*(l-1);
  if(l<=40)return 195+13*(l-20);
  return 455+16*(l-40);
}
export const createTeamProgress=():TeamProgress=>({xp:0,level:1,nextXp:xpToNext(1)});

export const COLLECT_RADIUS=.6;
/** Units per second a magnetized pickup travels toward its collector. */
export const HOMING_SPEED=12;
export const HEAL_DROP_CHANCE=.02,MAGNET_DROP_CHANCE=.005;
export const ROUND_OFFER_FALLBACK_SECONDS=20;
const DROP_LIFETIME_SECONDS=30,DROP_SPREAD=.3,MAX_LEVELS_PER_TICK=100;
const REROLL='~';
const ATTRACTED:ReadonlySet<PickupKind>=new Set(['xp','heal','magnet']);

export interface ProgressionOptions {
  catalog:ItemCatalog;
  /** Seed of this module's own stream (recommended: room seed); without it, ctx.rng.fork('progression') on first use. */
  seed?:number;
  /** Chest opener (default: VGM-036 openChest). Must consume the chest from ctx.pickups; null means not opened (D-005/D-006). */
  openChest?(ctx:SimContext,player:SimPlayer,chestId:string,options:ChestOptions):unknown;
  /** Called after a choice changes the build (default: refreshStats with the player's class bonus). */
  onBuildChange?(ctx:SimContext,player:SimPlayer):void;
  /** Whether a player can walk to a drop; unreachable drops home to the nearest collector. */
  reachable?(ctx:SimContext,point:Point):boolean;
}
/** JSON-safe bookkeeping: offers are granted once per level and per round; rngState lets a room checkpoint resume the same rolls. */
export interface ProgressionState {lastLevelGranted:number;lastRoundGranted:number;rngState?:number;
  /** First tick this run's pickups ran; chest 2:00 gate fallback until ctx.runStartTick exists (never open early). */
  runStartTick?:number}
export const createProgressionState=():ProgressionState=>({lastLevelGranted:1,lastRoundGranted:0});
/** Pickup homing target meaning "nearest collector as soon as one exists" (drops that nobody can walk to). */
export const HOME_ANY='*';
export type ChooseFailure='no-player'|'no-offer'|'unknown-offer'|'not-oldest'|'bad-index'|'ineligible';
export type ChooseResult={ok:true;itemId:string;level:number}|{ok:false;reason:ChooseFailure};

const canCollect=(p:SimPlayer)=>p.online&&!p.spectator&&!p.eliminated&&!p.downed;
const receivesOffers=(p:SimPlayer)=>!p.spectator&&!p.eliminated;
const dist2=(a:Point,b:Point)=>(a.x-b.x)**2+(a.y-b.y)**2;
/** A round director owns ctx.round (VGM-033): offers follow the intermission clock (D-021). */
const directed=(ctx:SimContext)=>ctx.round.total>0;
/** End of the current intermission when it still leaves ARM_SECONDS to choose; undefined in combat or too late. */
function intermissionDeadline(ctx:SimContext){
  const r=ctx.round;
  return r.phase==='prepare'&&r.phaseEndsTick-ctx.tick>=ticks(ARM_SECONDS)?r.phaseEndsTick:undefined;
}

/** Nearest collector within `radius(player)` (ties: lowest id); collectors must be sorted by id. */
function nearest(collectors:readonly SimPlayer[],point:Point,radius:(p:SimPlayer)=>number){
  let best:SimPlayer|undefined,bestD=Infinity;
  for(const p of collectors){const d=dist2(p,point),r=radius(p);if(d<=r*r&&d<bestD){best=p;bestD=d;}}
  return best;
}
function sortedCollectors(ctx:SimContext){
  return [...ctx.players.values()].filter(canCollect).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

export function createProgression(options:ProgressionOptions,state:ProgressionState=createProgressionState()){
  const {catalog}=options;
  const openChest=options.openChest??openEvolutionChest;
  const runStartTickOf=(ctx:SimContext)=>ctxRunStartTick(ctx)??state.runStartTick??ctx.tick;
  const onBuildChange=options.onBuildChange??((_ctx:SimContext,player:SimPlayer)=>{refreshStats(player,classBonusOf(player));});
  let rng:Rng|undefined;
  const rngOf=(ctx:SimContext)=>rng??=state.rngState!==undefined?new Rng(state.rngState):options.seed!==undefined?new Rng(options.seed).fork('progression'):ctx.rng.fork('progression');
  const saveRng=()=>{if(rng)state.rngState=rng.state;};
  // Never drawn from: openChest forks `chest:<id>` from it, so chest rolls ignore every other draw in the tick.
  let chestRng:Rng|undefined;
  const chestRngOf=(ctx:SimContext)=>chestRng??=options.seed!==undefined?new Rng(options.seed).fork('chest'):ctx.rng.fork('chest');
  /** New run (rematch): forget granted levels/rounds and restart the stream from the seed. */
  function reset(){Object.assign(state,createProgressionState());delete state.rngState;delete state.runStartTick;rng=undefined;chestRng=undefined;}
  const reachable=options.reachable??((ctx:SimContext,p:Point)=>isLand(p,0,ctx.terrain));

  function addPickup(ctx:SimContext,kind:PickupKind,value:number,at:Point,collectors:readonly SimPlayer[],expires?:number){
    const pickup:PickupState={id:ctx.nextId(kind),kind,value,x:at.x,y:at.y,spawnTick:ctx.tick};
    if(expires!==undefined)pickup.expiresTick=expires;
    if(!reachable(ctx,at))pickup.homing=nearest(collectors,at,()=>Infinity)?.id??HOME_ANY;
    ctx.pickups.set(pickup.id,pickup);
    return pickup;
  }

  /** Drops for a killed enemy: XP gem, chest for elites, and a small luck-scaled chance of coxinha/ímã. */
  function dropLoot(ctx:SimContext,enemy:EnemyState,by?:string):PickupState[]{
    const r=rngOf(ctx),collectors=sortedCollectors(ctx);
    const luck=Math.max(0,(by?ctx.players.get(by)?.stats.luck:undefined)??1);
    const near=()=>({x:enemy.x+r.range(-DROP_SPREAD,DROP_SPREAD),y:enemy.y+r.range(-DROP_SPREAD,DROP_SPREAD)});
    const out:PickupState[]=[];
    if(enemy.xp>0)out.push(addPickup(ctx,'xp',enemy.xp,enemy,collectors));
    if(enemy.elite&&!enemy.boss)out.push(addPickup(ctx,'chest',1,near(),collectors));
    const heal=r.chance(HEAL_DROP_CHANCE*luck),magnet=r.chance(MAGNET_DROP_CHANCE*luck);
    const expires=ctx.tick+ticks(DROP_LIFETIME_SECONDS);
    if(heal)out.push(addPickup(ctx,'heal',HEAL_AMOUNT,near(),collectors,expires));
    if(magnet)out.push(addPickup(ctx,'magnet',0,near(),collectors,expires));
    saveRng();
    return out;
  }

  /** Returns false when the pickup stays on the ground (a chest the player cannot open). */
  function collect(ctx:SimContext,pickup:PickupState,player:SimPlayer){
    if(pickup.kind==='chest'){
      // The opener consumes the chest itself (single-application guarantee), so it must still be in ctx.pickups.
      if(openChest(ctx,player,pickup.id,{runStartTick:runStartTickOf(ctx),rng:chestRngOf(ctx)})===null)return false;
      ctx.pickups.delete(pickup.id);
      ctx.emit({type:'pickup',player:player.id,pickup:pickup.id,kind:pickup.kind,value:pickup.value});
      return true;
    }
    ctx.pickups.delete(pickup.id);
    if(pickup.kind==='xp')ctx.team.xp+=pickup.value*player.stats.growth;
    else if(pickup.kind==='heal')player.hp=Math.min(player.stats.maxHp,player.hp+pickup.value);
    else if(pickup.kind==='magnet'){for(const other of ctx.pickups.values())if(other.kind==='xp')other.homing=player.id;}
    ctx.emit({type:'pickup',player:player.id,pickup:pickup.id,kind:pickup.kind,value:pickup.value});
    return true;
  }

  const pickups:SimSystem={id:'pickups',step(ctx){
    state.runStartTick??=ctx.tick;
    const collectors=sortedCollectors(ctx),byId=new Map(collectors.map(p=>[p.id,p]));
    const stepLength=HOMING_SPEED/SIM_HZ;
    for(const pickup of [...ctx.pickups.values()]){
      if(pickup.kind==='resource')continue;
      if(pickup.homing){
        let target=pickup.homing===HOME_ANY?undefined:byId.get(pickup.homing);
        if(!target){target=nearest(collectors,pickup,()=>Infinity);if(target)pickup.homing=target.id;}
        if(target){
          const d=Math.sqrt(dist2(pickup,target));
          if(d<=stepLength){pickup.x=target.x;pickup.y=target.y;}
          else{pickup.x+=(target.x-pickup.x)/d*stepLength;pickup.y+=(target.y-pickup.y)/d*stepLength;}
        }
      }else if(pickup.expiresTick!==undefined&&ctx.tick>=pickup.expiresTick){ctx.pickups.delete(pickup.id);continue;}
      const taker=nearest(collectors,pickup,()=>COLLECT_RADIUS);
      if(taker&&collect(ctx,pickup,taker))continue;
      if(!pickup.homing&&ATTRACTED.has(pickup.kind)){
        const puller=nearest(collectors,pickup,p=>p.stats.magnet);
        if(puller)pickup.homing=puller.id;
      }
    }
  }};

  function pushOffer(ctx:SimContext,player:SimPlayer,source:OfferSource,level:number,id:string,deadlineTick:number){
    let queue=ctx.offers.get(player.id);
    if(!queue){queue=[];ctx.offers.set(player.id,queue);}
    if(queue.some(offer=>offer.id===id||offer.id.startsWith(id+REROLL)))return undefined;
    // Old head clock only: a queued offer never shows a deadline before the one ahead of it has run out.
    const last=queue[queue.length-1];
    if(last&&!directed(ctx))deadlineTick=Math.max(deadlineTick,last.deadlineTick+ticks(OFFER_SECONDS));
    const choices=rollChoices(catalog,player.build,player.stats.luck,rngOf(ctx));
    saveRng();
    const offer:LevelOffer={id,playerId:player.id,source,level,choices,deadlineTick,defaultIndex:defaultIndexFor(player.build,choices)};
    queue.push(offer);
    ctx.emit({type:'offer',player:player.id,offer:id});
    return offer;
  }
  function grantAll(ctx:SimContext,make:(player:SimPlayer)=>LevelOffer|undefined){
    const out:LevelOffer[]=[];
    for(const player of ctx.players.values())if(receivesOffers(player)){const offer=make(player);if(offer)out.push(offer);}
    return out;
  }

  /** One offer per active player for a new team level; repeated levels are ignored. Held in combat (D-021). */
  function grantLevelOffers(ctx:SimContext,level:number){
    if(!(level>state.lastLevelGranted))return [];
    state.lastLevelGranted=level;
    const deadline=directed(ctx)?intermissionDeadline(ctx)??HELD_DEADLINE:ctx.tick+ticks(OFFER_SECONDS);
    return grantAll(ctx,p=>pushOffer(ctx,p,'level',level,`lvl-${level}-${p.id}`,deadline));
  }

  /** End-of-round offer for every active player, due by the end of the intermission; once per round. */
  function grantRoundOffers(ctx:SimContext,round:number,deadlineTick?:number){
    const r=ctx.round;
    if(!(round>state.lastRoundGranted)||round>=r.total)return [];
    state.lastRoundGranted=round;
    const deadline=deadlineTick??(r.phase==='prepare'&&r.phaseEndsTick>ctx.tick?r.phaseEndsTick:ctx.tick+ticks(ROUND_OFFER_FALLBACK_SECONDS));
    return grantAll(ctx,p=>pushOffer(ctx,p,'round',round,`rnd-${round}-${p.id}`,deadline));
  }

  /** Applies choice `index` of the head offer; without a director the next one gets a fresh head clock. */
  function resolve(ctx:SimContext,player:SimPlayer,queue:LevelOffer[],index:number){
    const offer=queue.shift()!;
    const choice=offer.choices[index];
    if(choice&&applyChoice(catalog,player,choice)){
      if(choice.itemId===HEAL_CHOICE)ctx.emit({type:'pickup',player:player.id,pickup:offer.id,kind:'heal',value:HEAL_AMOUNT});
      else{
        ctx.emit({type:'upgrade',player:player.id,item:choice.itemId,level:choice.level});
        onBuildChange(ctx,player);
      }
    }
    const next=queue[0];
    if(!next)ctx.offers.delete(player.id);
    else if(!directed(ctx))next.deadlineTick=Math.max(next.deadlineTick,ctx.tick+ticks(OFFER_SECONDS));
    return choice;
  }

  /** Player command. Rejects forged, repeated, out-of-order and stale picks without side effects. */
  function choose(ctx:SimContext,playerId:string,offerId:string,index:number):ChooseResult{
    const player=ctx.players.get(playerId);
    if(!player||!receivesOffers(player))return {ok:false,reason:'no-player'};
    const queue=ctx.offers.get(playerId),head=queue?.[0];
    if(!queue||!head)return {ok:false,reason:'no-offer'};
    if(head.id!==offerId)return {ok:false,reason:queue.some(offer=>offer.id===offerId)?'not-oldest':'unknown-offer'};
    if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=head.choices.length)return {ok:false,reason:'bad-index'};
    const choice=head.choices[index];
    if(!isEligible(catalog,player.build,choice))return {ok:false,reason:'ineligible'};
    resolve(ctx,player,queue,index);
    return {ok:true,itemId:choice.itemId,level:choice.level};
  }

  const progression:SimSystem={id:'progression',step(ctx){
    const team=ctx.team;
    for(let n=0;n<MAX_LEVELS_PER_TICK&&team.xp>=team.nextXp;n++){
      team.xp-=team.nextXp;
      team.level++;
      team.nextXp=xpToNext(team.level);
      ctx.emit({type:'levelup',level:team.level});
      grantLevelOffers(ctx,team.level);
    }
    const armAt=directed(ctx)?intermissionDeadline(ctx):undefined;
    for(const [playerId,queue] of ctx.offers){
      const player=ctx.players.get(playerId);
      if(!player||!receivesOffers(player)||!queue[0]){ctx.offers.delete(playerId);continue;}
      reroll(ctx,player,queue[0]);
      if(armAt!==undefined)for(const offer of queue)if(isHeldOffer(offer))offer.deadlineTick=armAt;
      if(!player.online){for(const offer of queue)if(!isHeldOffer(offer))offer.deadlineTick++;continue;}
      // The intermission ends: every offer due now gets its default once, oldest first, each re-rolled if the
      // previous pick made its cards stale (two offers holding the same next level).
      while(queue[0]&&ctx.tick>=queue[0].deadlineTick){reroll(ctx,player,queue[0]);resolve(ctx,player,queue,queue[0].defaultIndex);}
      // A level offer carried into combat by the offline freeze waits for the next intermission like the rest.
      if(directed(ctx)&&ctx.round.phase==='wave')for(const offer of queue)if(offer.source==='level')offer.deadlineTick=HELD_DEADLINE;
    }
  }};

  /** Re-rolls a head whose cards went stale (build changed since the roll). */
  function reroll(ctx:SimContext,player:SimPlayer,head:LevelOffer){
    if(head.choices.every(choice=>isEligible(catalog,player.build,choice)))return;
    // New id so a pick sent against the old cards is refused instead of applying a different item.
    head.id=head.id.split(REROLL)[0]+REROLL+ctx.tick;
    head.choices=rollChoices(catalog,player.build,player.stats.luck,rngOf(ctx));
    head.defaultIndex=defaultIndexFor(player.build,head.choices);
    saveRng();
    ctx.emit({type:'offer',player:player.id,offer:head.id});
  }

  return {state,reset,dropLoot,pickups,progression,grantLevelOffers,grantRoundOffers,choose};
}
export type Progression=ReturnType<typeof createProgression>;
