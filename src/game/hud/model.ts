/**
 * Pure HUD model (VGM-040): derives display data from RunView without touching the DOM,
 * so it can be unit-tested under node. DOM parts in this folder consume these helpers.
 */
import {SIM_HZ} from '../sim/types.ts';
import type {OfferView,PlayerRunView,RunView} from '../sim/view.ts';

export const TOTAL_ROUNDS=10;

/** Shared context every HUD part receives on update. */
export interface HudContext {
  /** Local player id (the one choosing offers). */
  localId:string;
  /** Portrait URL for a class id. */
  portrait(classId:string,detailed?:boolean):string;
  /** Running tallies accumulated from view events. */
  tally:RunTally;
}

/** Common shape of every DOM part of the HUD. */
export interface HudPart {
  readonly el:HTMLElement;
  update(view:RunView,ctx:HudContext):void;
  destroy?():void;
}

export const clamp01=(value:number)=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
export const secondsLeft=(untilTick:number,tick:number)=>Math.max(0,Math.ceil((untilTick-tick)/SIM_HZ));

export function formatDuration(ticks:number){
  const total=Math.max(0,Math.floor(ticks/SIM_HZ));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}

export function xpFraction(view:RunView){
  return clamp01(view.team.nextXp>0?view.team.xp/view.team.nextXp:0);
}

export interface RoundInfo {index:number;total:number;label:string;phase:'wave'|'prepare';remaining:number;countdown?:number;detail:string}

/** "Round N/10" plus the right-hand detail: remaining critters during a wave, countdown in the interval. */
export function roundInfo(view:RunView):RoundInfo|undefined{
  const round=view.round;
  if(round){
    const total=round.total||TOTAL_ROUNDS;
    const label=`Round ${round.index}/${total}`;
    if(round.phase==='prepare'){
      const countdown=secondsLeft(round.phaseEndsTick,view.tick);
      return {index:round.index,total,label,phase:'prepare',remaining:0,countdown,detail:`Intervalo · ${countdown} s`};
    }
    const remaining=Math.max(0,round.remaining);
    return {index:round.index,total,label,phase:'wave',remaining,detail:remaining===1?'falta 1 bicho':`${remaining} bichos`};
  }
  if(view.wave){
    const phase=view.wave.phase??'wave';
    const remaining=view.enemies.length;
    return {index:view.wave.index,total:TOTAL_ROUNDS,label:`Round ${view.wave.index}/${TOTAL_ROUNDS}`,phase,remaining,detail:phase==='prepare'?'Intervalo':`${remaining} bichos`};
  }
  return undefined;
}

export interface BossInfo {id:string;name:string;fraction:number;phase:number;enraged:boolean}
export const BOSS_NAME='Síndico Supremo';

export function bossInfo(view:RunView):BossInfo|undefined{
  const boss=view.enemies.find(enemy=>enemy.boss&&enemy.hp>0);
  if(!boss)return undefined;
  const phase=boss.phase??1;
  return {id:boss.id,name:BOSS_NAME,fraction:clamp01(boss.maxHp>0?boss.hp/boss.maxHp:0),phase,enraged:phase>=2};
}

export const isActive=(player:PlayerRunView)=>!player.spectator&&!player.eliminated;
export const hpFraction=(player:PlayerRunView)=>clamp01(player.maxHp>0?player.hp/player.maxHp:0);

/** Team members in a stable order: local player first, then by id; spectators last. */
export function teamOrder(players:readonly PlayerRunView[],localId:string){
  return [...players].sort((a,b)=>Number(a.spectator)-Number(b.spectator)||Number(b.id===localId)-Number(a.id===localId)||(a.id<b.id?-1:a.id>b.id?1:0));
}

export interface ReviveAlert {kind:'self'|'ally';playerId:string;name:string;seconds:number;progress:number;text:string}

/** Alerts for downed players: the local one first (it changes what the player should do), then allies by urgency. */
export function reviveAlerts(view:RunView,localId:string):ReviveAlert[]{
  const alerts:ReviveAlert[]=[];
  for(const player of view.players){
    if(!player.downed||player.eliminated)continue;
    const seconds=secondsLeft(player.downed.bleedOutTick,view.tick);
    const progress=clamp01(player.downed.progress);
    if(player.id===localId)alerts.push({kind:'self',playerId:player.id,name:player.name,seconds,progress,text:progress>0?`Te salvando… ${Math.round(progress*100)}%`:`Você caiu! Grita por socorro · ${seconds} s`});
    else alerts.push({kind:'ally',playerId:player.id,name:player.name,seconds,progress,text:progress>0?`Salvando ${player.name}… ${Math.round(progress*100)}%`:`${player.name} caiu! Corre lá · ${seconds} s`});
  }
  return alerts.sort((a,b)=>Number(b.kind==='self')-Number(a.kind==='self')||a.seconds-b.seconds);
}

/** Offer header copy: end-of-round upgrades look and read differently from level-ups. */
export function offerTitle(offer:OfferView){
  return offer.source==='round'?{eyebrow:'FIM DE ROUND',title:'Upgrade do round'}:{eyebrow:`NÍVEL ${offer.level}`,title:'Subiu de nível!'};
}

/** Remaining fraction of an offer deadline, given the tick the client first saw it. */
export function offerDeadlineFraction(offer:OfferView,tick:number,firstSeenTick:number){
  const span=offer.deadlineTick-Math.min(firstSeenTick,tick);
  return span>0?clamp01((offer.deadlineTick-tick)/span):0;
}

/** End-of-run summary handed to the result screen (VGM-042/043 fill it from the server). */
export interface RunResult {
  victory:boolean;
  /** Ticks between combat start and the end. */
  durationTicks:number;
  /** Last round reached (1..total). */
  round:number;
  totalRounds:number;
  seed:string;
  players:PlayerRunView[];
}

/** Per-player counters accumulated from view events, de-duplicated by eventId. */
export interface PlayerTally {downs:number;revives:number;upgrades:number;evolves:number;heals:number;magnets:number;chests:number;pickups:number;kills:number}
export interface RunTally {players:Map<string,PlayerTally>;lastEventId:number;startTick?:number}

export const emptyTally=():RunTally=>({players:new Map(),lastEventId:-1});
const blank=():PlayerTally=>({downs:0,revives:0,upgrades:0,evolves:0,heals:0,magnets:0,chests:0,pickups:0,kills:0});

export function tallyOf(tally:RunTally,playerId:string){
  let entry=tally.players.get(playerId);
  if(!entry){entry=blank();tally.players.set(playerId,entry);}
  return entry;
}

/** Applies new events once; repeated or late eventIds are ignored. */
export function applyEvents(tally:RunTally,view:RunView){
  tally.startTick??=view.tick;
  for(const event of view.events){
    if(event.eventId<=tally.lastEventId)continue;
    tally.lastEventId=event.eventId;
    switch(event.type){
      case 'downed':tallyOf(tally,event.player).downs++;break;
      case 'revived':if(event.by)tallyOf(tally,event.by).revives++;break;
      case 'upgrade':tallyOf(tally,event.player).upgrades++;break;
      case 'evolve':tallyOf(tally,event.player).evolves++;break;
      case 'kill':if(event.by)tallyOf(tally,event.by).kills++;break;
      case 'pickup':{
        const entry=tallyOf(tally,event.player);entry.pickups++;
        if(event.kind==='heal')entry.heals++;else if(event.kind==='magnet')entry.magnets++;else if(event.kind==='chest')entry.chests++;
        break;
      }
    }
  }
  return tally;
}
