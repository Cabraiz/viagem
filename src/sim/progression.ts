/**
 * XP, pickups, team levels and the upgrade offer queue (VGM-034).
 * D-054: no XP gems. A kill's XP goes straight into the team bar (killXp); no XP lies on the ground since the boleto
 * rain was retired (NEW-20261024-ORQ-tirar-drops-cedula-girando). No magnet either: heal is pulled from PULL_RADIUS.
 * Cédulas (same card): a kill's Grana falls as a 'grana' pickup a second after the kill (dropGrana, CEDULA_*).
 * Offers come from two sources: team level (`lvl-…`) and end of round (`rnd-…`, called by the director).
 * Only the oldest offer of each player can be chosen. Clocks never run while the player is offline.
 * Deadlines (D-021, replaces the 10 s head clock of VGM-034 when a round director runs):
 * - a level offer granted in combat is held (HELD_DEADLINE) and is due at the end of the next intermission, however
 *   short; one granted during an intermission is due at its end when ARM_SECONDS are left, else at the end of the next;
 * - a round offer is due at the end of its intermission (grantRoundOffers);
 * - in combat every pending offer is held, whatever its source (an offline freeze may carry armed ones into a wave);
 * - when the intermission ends, every due offer gets its visible default once, oldest first (stale cards re-rolled).
 * D-050 (replaced D-023's boss clock): in combat the room pauses the run for the picks (multiplayer/levelup-pause.ts)
 * and gives the defaults through settle(); the boss wave holds like any wave. Without a director (ctx.round.total 0)
 * there is no intermission at all: there the old rule applies, OFFER_SECONDS from the moment an offer becomes the head.
 */
import {Rng} from '../contract/index.ts';
import {SIM_HZ,ticks} from '../contract/index.ts';
import type {EnemyState,LevelOffer,OfferSource,PickupKind,PickupState,SimPlayer,TeamProgress} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import type {Point} from '../maps/index.ts';
import {isLand} from '../maps/index.ts';
import {HEAL_AMOUNT,HEAL_CHOICE,ARM_SECONDS,HELD_DEADLINE,OFFER_SECONDS,applyChoice,defaultIndexFor,isEligible,isHeldOffer,rollChoices} from '../rules/index.ts';
import type {ItemCatalog} from '../rules/index.ts';
import {openChest as openEvolutionChest} from './evolutions.ts';
import type {ChestOptions} from './evolutions.ts';
import {refreshStats} from '../rules/index.ts';
import {MAX_PICKUPS,hasRoom} from '../rules/index.ts';
import {addGrana} from './wallet.ts';
import type {ClassBonus} from '../rules/index.ts';

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
/**
 * D-051 mode 'ninhos' (ritmo-morto-e-viaduto): the first level costs FIRST_LEVEL_XP[heroes − 1] instead of xpToNext(1),
 * heroes = the match's heroes (people and bots, not spectators) at its first step, fixed for the run (a fall never
 * moves the bar). One bar for the whole team: 5 XP came in 12–27 s with 3 heroes and not before 2 min with 1, the
 * card wants it at 60–120 s for any team. Levels 2+ cost xpToNext as ever.
 */
export const FIRST_LEVEL_XP:number[]=[6,9,11,12,12,12];
export const firstLevelXp=(heroes:number)=>FIRST_LEVEL_XP[Math.min(FIRST_LEVEL_XP.length,Math.max(1,heroes))-1];
export const createTeamProgress=():TeamProgress=>({xp:0,level:1,nextXp:xpToNext(1)});

export const COLLECT_RADIUS=.6;
/** D-054: heal and boletos start homing to a hero this close (the old base magnet, without the ímã). */
export const PULL_RADIUS=1.2;
/** Units per second a pulled pickup travels toward its collector. */
export const HOMING_SPEED=12;
/**
 * D-054: the round-1 crumbs' XP (VGM-056: 6 drops of 1 a short walk away, one more than the first level) in the endless
 * world, where the bêbados need ~25 s to arrive: paid with the first kill of round 1, or when its wave ends without
 * one, so the first level (and its chip) still lands in round 1. Not at the wave start: there it would open the
 * level-up pause (D-050) before anyone moved.
 */
export const ROUND1_XP=6;
export const ROUND_OFFER_FALLBACK_SECONDS=20;
const DROP_LIFETIME_SECONDS=30,DROP_SPREAD=.3,MAX_LEVELS_PER_TICK=100;
const REROLL='~';
const ATTRACTED:ReadonlySet<PickupKind>=new Set(['xp','heal','grana']);
/**
 * NEW-20261024-ORQ-tirar-drops-cedula-girando (the user: "ao matar inimigo, 1 segundo depois dele morrer deve aparecer
 * flutuante [...] uma cédula de dinheiro rodando"): a kill's Grana (never the boss's: split at once) appears as a
 * cédula CEDULA_DELAY_SECONDS after the kill where the enemy fell. A hero within CEDULA_PULL_RADIUS pulls it (a short
 * magnet) and takes it into their own wallet; after CEDULA_WAIT_SECONDS on the ground it flies by itself to its owner
 * (the killer, a tower's owner; the nearest hero when nobody), so no Grana is ever lost (the bots' purse, the vaquinha).
 * A cédula appearing within CEDULA_MERGE_RADIUS of one on the ground joins it (the values add up); with CEDULA_CAP on the
 * ground it joins the nearest wherever it is (a big horde on a phone), and with the pickup budget full and none to join
 * it is paid at once (options.payGrana).
 */
export const CEDULA_DELAY_SECONDS=1,CEDULA_WAIT_SECONDS=10,CEDULA_PULL_RADIUS=1.6,CEDULA_MERGE_RADIUS=1.2,CEDULA_CAP=24;
/** A cédula still to appear (ProgressionState.cedulas): the tick it appears, where, its R$ and who the kill paid. */
export interface PendingCedula {tick:number;x:number;y:number;value:number;owner?:string}

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
  /**
   * D-051 manual combat: chests are crates opened by standing next to them (sim/crates.ts), never by walking over them.
   * ('item' pickups, the inventory's, are never collected here: sim/inventory.ts takes them.)
   */
  crates?:boolean;
  /** A cédula with no room on the ground (the pickup budget full, none to join): its Grana paid at once (default: dropped). */
  payGrana?(ctx:SimContext,amount:number,owner?:string):void;
  /** D-051 mode 'ninhos': the first level's cost follows the match's heroes (FIRST_LEVEL_XP). */
  firstLevelByHeroes?:boolean;
}
/** JSON-safe bookkeeping: offers are granted once per level and per round; rngState lets a room checkpoint resume the same rolls. */
export interface ProgressionState {lastLevelGranted:number;lastRoundGranted:number;rngState?:number;
  /** First tick this run's pickups ran; chest 2:00 gate fallback until ctx.runStartTick exists (never open early). */
  runStartTick?:number;
  /** D-021: level offers granted too late in the current intermission (base ids); they wait for the next one. */
  lateHeld?:string[];
  /** D-052: each player's [skips, rerolls] left this run (absent: the full OFFER_SKIPS / OFFER_REROLLS). */
  charges?:Record<string,[number,number]>;
  /** D-054: ROUND1_XP was paid this run. */
  round1Paid?:boolean;
  /** firstLevelByHeroes: the heroes counted at the run's first step (absent before it). */
  heroes?:number;
  /** Cédulas still to appear, in the order they appear (CEDULA_DELAY_SECONDS after their kill). */
  cedulas?:PendingCedula[]}
/** D-052: every player starts a run with this many "Pular" (close the offer, no prize) and "Rolar de novo" (new cards). */
export const OFFER_SKIPS=2,OFFER_REROLLS=2;
export type OfferActionFailure='no-player'|'no-offer'|'unknown-offer'|'not-oldest'|'no-charge';
export type OfferActionResult={ok:true;left:number}|{ok:false;reason:OfferActionFailure};
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
/**
 * OFFER_SECONDS head clock (VGM-034): only without a director. Under one, every wave holds its offers, the boss wave too
 * (D-050 replaced D-023's boss clock): the room pauses the run for the team to pick (multiplayer/levelup-pause.ts).
 */
const clocked=(ctx:SimContext)=>!directed(ctx);
const baseOf=(id:string)=>id.split('~')[0];
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
  function reset(){Object.assign(state,createProgressionState());delete state.rngState;delete state.runStartTick;delete state.lateHeld;delete state.charges;delete state.round1Paid;delete state.cedulas;delete state.heroes;rng=undefined;chestRng=undefined;}
  const reachable=options.reachable??((ctx:SimContext,p:Point)=>isLand(p,0,ctx.terrain));

  function addPickup(ctx:SimContext,kind:PickupKind,value:number,at:Point,collectors:readonly SimPlayer[],expires?:number){
    const pickup:PickupState={id:ctx.nextId(kind),kind,value,x:at.x,y:at.y,spawnTick:ctx.tick};
    if(expires!==undefined)pickup.expiresTick=expires;
    if(!reachable(ctx,at))pickup.homing=nearest(collectors,at,()=>Infinity)?.id??HOME_ANY;
    ctx.pickups.set(pickup.id,pickup);
    return pickup;
  }

  /**
   * D-054: the XP of a kill, straight into the team bar: the enemy's xp × the killer's growth (Cartão Fidelidade); a
   * kill with no hero behind it (a tower, an explosion) uses the highest growth of the standing heroes, like the gem
   * the best of them would have picked up.
   */
  function killXp(ctx:SimContext,enemy:EnemyState,by?:string){
    if(!(enemy.xp>0))return 0;
    const killer=by?ctx.players.get(by):undefined;
    let growth=killer&&!killer.spectator?killer.stats.growth:0;
    if(!growth)for(const p of ctx.players.values())if(canCollect(p))growth=Math.max(growth,p.stats.growth);
    const xp=(enemy.xp+(round1Due(ctx)&&ctx.round.index===1&&ctx.round.phase==='wave'?payRound1():0))*(growth||1);
    ctx.team.xp+=xp;
    return xp;
  }
  /** ROUND1_XP still owed: an endless world's directed run in round 1 (on the island the bichos come in a few seconds). */
  const round1Due=(ctx:SimContext)=>!state.round1Paid&&directed(ctx)&&!!ctx.terrain.chunks&&ctx.round.index<=2;
  function payRound1(){state.round1Paid=true;return ROUND1_XP;}

  /** A killed enemy: its XP to the team (killXp) and a chest for elites. No coxinha falls any more (NEW-20261025-ORQ-sem-coxinha-no-chao). */
  function dropLoot(ctx:SimContext,enemy:EnemyState,by?:string):PickupState[]{
    killXp(ctx,enemy,by);
    const r=rngOf(ctx),collectors=sortedCollectors(ctx);
    const near=()=>({x:enemy.x+r.range(-DROP_SPREAD,DROP_SPREAD),y:enemy.y+r.range(-DROP_SPREAD,DROP_SPREAD)});
    const out:PickupState[]=[];
    if(enemy.elite&&!enemy.boss)out.push(addPickup(ctx,'chest',1,near(),collectors));
    // The old coxinha and ímã rolls, drawn and dropped: the run's random stream stays as before (seeded runs and tests keep their story).
    r.next();r.next();
    saveRng();
    return out;
  }

  /** A kill's Grana (`amount` R$, paid to `owner` when nobody takes it): a cédula where the enemy fell, a second later. */
  function dropGrana(ctx:SimContext,at:Point,amount:number,owner?:string){
    if(!(amount>0))return;
    (state.cedulas??=[]).push({tick:ctx.tick+ticks(CEDULA_DELAY_SECONDS),x:at.x,y:at.y,value:amount,...(owner!==undefined?{owner}:{})});
  }
  /** The cédulas due this tick: each joins one on the ground nearby (or anywhere past CEDULA_CAP), else lies down. */
  function placeCedulas(ctx:SimContext){
    const due=state.cedulas;if(!due?.length)return;
    let n=0;while(n<due.length&&due[n].tick<=ctx.tick)n++;
    if(!n)return;
    const ready=due.splice(0,n);if(!due.length)delete state.cedulas;
    // Every cédula on screen counts for the cap (flying ones too); a nearby one only joins one lying still.
    const notes:PickupState[]=[];for(const p of ctx.pickups.values())if(p.kind==='grana')notes.push(p);
    let collectors:SimPlayer[]|undefined;
    for(const c of ready){
      const full=!hasRoom(ctx.pickups,MAX_PICKUPS),crowded=full||notes.length>=CEDULA_CAP;
      let join:PickupState|undefined,best=crowded?Infinity:CEDULA_MERGE_RADIUS**2;
      for(const p of notes)if(crowded||!p.homing){const d=dist2(p,c);if(d<=best){join=p;best=d;}}
      if(join){join.value+=c.value;continue;}
      if(full){options.payGrana?.(ctx,c.value,c.owner);continue;}
      const pickup=addPickup(ctx,'grana',c.value,c,collectors??=sortedCollectors(ctx),ctx.tick+ticks(CEDULA_WAIT_SECONDS));
      if(c.owner!==undefined)pickup.owner=c.owner;
      notes.push(pickup);
    }
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
    else if(pickup.kind==='grana')addGrana(player,pickup.value);
    ctx.emit({type:'pickup',player:player.id,pickup:pickup.id,kind:pickup.kind,value:pickup.value});
    return true;
  }

  const pickups:SimSystem={id:'pickups',step(ctx){
    state.runStartTick??=ctx.tick;
    placeCedulas(ctx);
    const collectors=sortedCollectors(ctx),byId=new Map(collectors.map(p=>[p.id,p]));
    const stepLength=HOMING_SPEED/SIM_HZ;
    for(const pickup of [...ctx.pickups.values()]){
      // Veículos: a parked vehicle is taken by the vehicles system (sim/veiculos), never walked over here.
      if(pickup.kind==='resource'||pickup.kind==='item'||pickup.kind==='vehicle'||pickup.kind==='chest'&&options.crates)continue;
      if(pickup.homing){
        let target=pickup.homing===HOME_ANY?undefined:byId.get(pickup.homing);
        if(!target){target=nearest(collectors,pickup,()=>Infinity);if(target)pickup.homing=target.id;}
        if(target){
          const d=Math.sqrt(dist2(pickup,target));
          if(d<=stepLength){pickup.x=target.x;pickup.y=target.y;}
          else{pickup.x+=(target.x-pickup.x)/d*stepLength;pickup.y+=(target.y-pickup.y)/d*stepLength;}
        }
      }else if(pickup.expiresTick!==undefined&&ctx.tick>=pickup.expiresTick){
        // Nobody took the cédula: it flies to its owner (next tick on), never lost.
        if(pickup.kind==='grana')pickup.homing=pickup.owner??HOME_ANY;
        else{ctx.pickups.delete(pickup.id);continue;}
      }
      const taker=nearest(collectors,pickup,()=>COLLECT_RADIUS);
      if(taker&&collect(ctx,pickup,taker))continue;
      if(!pickup.homing&&ATTRACTED.has(pickup.kind)){
        const puller=nearest(collectors,pickup,()=>pickup.kind==='grana'?CEDULA_PULL_RADIUS:PULL_RADIUS);
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
    if(last&&clocked(ctx)&&!isHeldOffer(last))deadlineTick=Math.max(deadlineTick,last.deadlineTick+ticks(OFFER_SECONDS));
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
    if(clocked(ctx))return grantAll(ctx,p=>pushOffer(ctx,p,'level',level,`lvl-${level}-${p.id}`,ctx.tick+ticks(OFFER_SECONDS)));
    const due=intermissionDeadline(ctx);
    const offers=grantAll(ctx,p=>pushOffer(ctx,p,'level',level,`lvl-${level}-${p.id}`,due??HELD_DEADLINE));
    // Too late in this intermission: they wait for the next one instead of being armed now.
    if(due===undefined&&ctx.round.phase==='prepare')(state.lateHeld??=[]).push(...offers.map(o=>o.id));
    return offers;
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
    else if(clocked(ctx))next.deadlineTick=isHeldOffer(next)?ctx.tick+ticks(OFFER_SECONDS):Math.max(next.deadlineTick,ctx.tick+ticks(OFFER_SECONDS));
    return choice;
  }

  /**
   * D-050: the pause's end (or a player it does not wait for: offline, a bot past its reaction): every offer of
   * `playerId` gets its default now, oldest first, each re-rolled if the previous pick made its cards stale (the same
   * as an intermission's end). Returns how many were settled.
   */
  function settle(ctx:SimContext,playerId:string){
    const player=ctx.players.get(playerId),queue=ctx.offers.get(playerId);
    if(!player||!queue)return 0;
    if(!receivesOffers(player)){ctx.offers.delete(playerId);return 0;}
    let n=0;
    while(queue[0]){reroll(ctx,player,queue[0]);resolve(ctx,player,queue,queue[0].defaultIndex);n++;}
    return n;
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
    // The next card is fresh at once (D-050: in a pause the sim does not step, and step() is where stale heads re-roll).
    if(queue[0])reroll(ctx,player,queue[0]);
    return {ok:true,itemId:choice.itemId,level:choice.level};
  }

  /** D-052: [skips, rerolls] `playerId` has left this run. */
  function charges(playerId:string):[number,number]{return state.charges?.[playerId]??[OFFER_SKIPS,OFFER_REROLLS];}
  /** The head offer `offerId` of `playerId`, or why a skip/reroll on it is refused (the same checks as choose). */
  function headFor(ctx:SimContext,playerId:string,offerId:string):{reason:OfferActionFailure}|{player:SimPlayer;queue:LevelOffer[];head:LevelOffer}{
    const player=ctx.players.get(playerId);
    if(!player||!receivesOffers(player))return {reason:'no-player'};
    const queue=ctx.offers.get(playerId),head=queue?.[0];
    if(!queue||!head)return {reason:'no-offer'};
    if(head.id!==offerId)return {reason:queue.some(offer=>offer.id===offerId)?'not-oldest':'unknown-offer'};
    return {player,queue,head};
  }
  function spend(playerId:string,slot:0|1){
    const left=charges(playerId).slice() as [number,number];left[slot]--;
    (state.charges??={})[playerId]=left;return left[slot];
  }
  /**
   * D-052 "Pular": closes the head offer with no prize, spending one skip. In a pause it counts as picked (the queue
   * shrinks like after a choice; the next card, if any, is fresh).
   */
  function skip(ctx:SimContext,playerId:string,offerId:string):OfferActionResult{
    const found=headFor(ctx,playerId,offerId);
    if(!('head' in found))return {ok:false,reason:found.reason};
    if(charges(playerId)[0]<=0)return {ok:false,reason:'no-charge'};
    const left=spend(playerId,0);
    resolve(ctx,found.player,found.queue,-1);
    if(found.queue[0])reroll(ctx,found.player,found.queue[0]);
    return {ok:true,left};
  }
  /**
   * D-052 "Rolar de novo": new cards for this player's head offer only, spending one reroll. The offer gets a new id
   * (a pick sent against the old cards is refused); the tick stands still in a pause, so the id counts the rerolls spent.
   */
  function rerollOffer(ctx:SimContext,playerId:string,offerId:string):OfferActionResult{
    const found=headFor(ctx,playerId,offerId);
    if(!('head' in found))return {ok:false,reason:found.reason};
    if(charges(playerId)[1]<=0)return {ok:false,reason:'no-charge'};
    const left=spend(playerId,1),player=found.player,head=found.head;
    head.id=head.id.split(REROLL)[0]+REROLL+(ctx.tick*1000+(OFFER_REROLLS-left));
    head.choices=rollChoices(catalog,player.build,player.stats.luck,rngOf(ctx));
    head.defaultIndex=defaultIndexFor(player.build,head.choices);
    saveRng();
    ctx.emit({type:'offer',player:player.id,offer:head.id});
    return {ok:true,left};
  }

  const progression:SimSystem={id:'progression',step(ctx){
    const team=ctx.team;
    if(options.firstLevelByHeroes&&state.heroes===undefined){
      const heroes=[...ctx.players.values()].filter(p=>!p.spectator).length;
      if(heroes>0){state.heroes=heroes;if(team.level===1)team.nextXp=firstLevelXp(heroes);}
    }
    // Round 1's wave ended with no kill: its XP comes with the intermission (no pause there, D-050).
    if(round1Due(ctx)&&ctx.round.index===2&&ctx.round.phase==='prepare')team.xp+=payRound1();
    for(let n=0;n<MAX_LEVELS_PER_TICK&&team.xp>=team.nextXp;n++){
      team.xp-=team.nextXp;
      team.level++;
      team.nextXp=xpToNext(team.level);
      ctx.emit({type:'levelup',level:team.level});
      grantLevelOffers(ctx,team.level);
    }
    const r=ctx.round;
    // Held offers are armed by any intermission (even one shorter than ARM_SECONDS), except the late ones of this one.
    const armAt=directed(ctx)&&r.phase==='prepare'&&r.phaseEndsTick>ctx.tick?r.phaseEndsTick:undefined;
    const late=new Set(state.lateHeld??[]);
    if(directed(ctx)&&r.phase==='wave'&&state.lateHeld)delete state.lateHeld;
    const holding=directed(ctx)&&r.phase==='wave';
    for(const [playerId,queue] of ctx.offers){
      const player=ctx.players.get(playerId);
      if(!player||!receivesOffers(player)||!queue[0]){ctx.offers.delete(playerId);continue;}
      reroll(ctx,player,queue[0]);
      if(armAt!==undefined)for(const offer of queue)if(isHeldOffer(offer)&&!late.has(baseOf(offer.id)))offer.deadlineTick=armAt;
      if(!player.online){for(const offer of queue)if(!isHeldOffer(offer))offer.deadlineTick++;continue;}
      // The intermission ends: every offer due now gets its default once, oldest first, each re-rolled if the
      // previous pick made its cards stale (two offers holding the same next level).
      while(queue[0]&&ctx.tick>=queue[0].deadlineTick){reroll(ctx,player,queue[0]);resolve(ctx,player,queue,queue[0].defaultIndex);}
      // In combat everything waits, whatever its source: an offline freeze may carry a level offer and the round offer
      // behind it into a wave, and a pick on the first must never let the second expire in the same tick.
      if(holding)for(const offer of queue)offer.deadlineTick=HELD_DEADLINE;
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

  return {state,reset,dropLoot,dropGrana,pickups,progression,grantLevelOffers,grantRoundOffers,choose,settle,skip,rerollOffer,charges};
}
export type Progression=ReturnType<typeof createProgression>;
