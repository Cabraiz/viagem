/**
 * Pure HUD model (VGM-040): derives display data from RunView without touching the DOM,
 * so it can be unit-tested under node. DOM parts in this folder consume these helpers.
 */
import type {EmoteId} from '../fun/emotes.ts';
import type {ShameMoment} from '../../contract/index.ts';
import {SIM_HZ} from '../../contract/index.ts';
import type {OfferView,PlayerRunView,RunPause,RunView} from '../../contract/index.ts';
import {railName} from '../render/map-label-rules.ts';
import {isAsleep} from '../render/wake-rules.ts';
import {causeCopy,emptyCauses,recordFall,rememberEnemies,rememberKill,resetCauses,resolveCause,type CauseLog} from './cause.ts';
import {chaveiroClock,liveObjective,type ChaveiroClock} from './chaveiro.ts';
import type {ObjectiveResult} from '../../contract/index.ts';

export const TOTAL_ROUNDS=10;

/** Shared context every HUD part receives on update. */
export interface HudContext {
  /** Local player id (the one choosing offers). */
  localId:string;
  /** Portrait URL for a class id. */
  portrait(classId:string,detailed?:boolean):string;
  /** Running tallies accumulated from view events. */
  tally:RunTally;
  /** Connection banner text while the socket is down (VGM-043); undefined when connected. */
  network?:string;
  /** Out or watching: the teammate the camera follows ("Assistindo: Tia"), set 3 s after the out notice (camera-segue). */
  watching?:string;
  /**
   * The real game draws falls and rescues in the world and on the edge arrows (UX-resgate-e-ping): the fall/rescue
   * banners leave the top band; connection, out and watching notices stay. The sandbox keeps the banners.
   */
  worldRescue?:boolean;
  /** Sticker of a critter kind (data URL of the horde atlas texture), for "what got you"; undefined = text only. */
  critterIcon?(kind:string):string|undefined;
  /** The emote a player is showing now (rostos-kkkk: KKKK puts the `rindo` face on the team strip); undefined = none. */
  mood?(playerId:string):EmoteId|undefined;
  /**
   * D-050: the team's level-up pause (RunState.pause from the room's {t:'run'}), set by Hud.setPause; undefined when
   * the run is not paused. The offer opens by itself in it; the pause's own HUD (clock, who is picking) reads it too.
   */
  pause?:RunPause;
}

/** Common shape of every DOM part of the HUD. */
export interface HudPart {
  readonly el:HTMLElement;
  update(view:RunView,ctx:HudContext):void;
  destroy?():void;
}

export const clamp01=(value:number)=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
export const secondsLeft=(untilTick:number,tick:number)=>Math.max(0,Math.ceil((untilTick-tick)/SIM_HZ));
/** One clock format for a caído everywhere (team strip, edge arrow, map ficha): "27 s" (design onda 6 M2, UX aresta 1). */
export const secondsText=(seconds:number)=>`${seconds} s`;
/**
 * With a window open (offer, forge), its header names the most urgent caído (not you) with the live clock: the window
 * never hides that someone is bleeding out, and the player knows they can walk with it open (UX review janela-caido).
 */
export function fallLine(view:Pick<RunView,'players'|'tick'>,localId:string){
  let best:{name:string;seconds:number}|undefined;
  for(const p of view.players){
    if(p.id===localId||!p.downed||p.eliminated||p.spectator)continue;
    const seconds=secondsLeft(p.downed.bleedOutTick,view.tick);
    if(!best||seconds<best.seconds)best={name:p.name,seconds};
  }
  return best?`${railName(best.name)} caiu, ${secondsText(best.seconds)}. Dá pra andar.`:'';
}

export function formatDuration(ticks:number){
  const total=Math.max(0,Math.floor(ticks/SIM_HZ));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}

export function xpFraction(view:RunView){
  return clamp01(view.team.nextXp>0?view.team.xp/view.team.nextXp:0);
}

export interface RoundInfo {index:number;total:number;label:string;phase:'wave'|'prepare';remaining:number;countdown?:number;detail:string;
  /** D-047, the chaveiro objective running: the label is "Onda N" and the chip adds his clock (hud/chaveiro.ts). */
  chaveiro?:ChaveiroClock;
  /** D-051, a run in mode 'ninhos' (nestsMode): no waves, so the chip shows only the chaveiro's clock and no round marquee. */
  nests?:true}

/**
 * D-051: the run is in mode 'ninhos'. The room sends its nests as structures (kind 'ninho'; a fallen one stays), and
 * only that mode has them, so the HUD follows the room's mode without a field of its own.
 */
export const nestsMode=(view:Pick<RunView,'structures'>)=>view.structures.some(s=>s.kind==='ninho');
/** D-051: the nests of a run in mode 'ninhos', how many fell and how many there were; undefined in any other mode. */
/**
 * D-051 (ninhos-rounds-fora): the chip's nest count, the nests still standing over all of them ("6/8") and the same in
 * words for the screen reader; undefined outside the nests mode.
 */
export function nestCount(view:Pick<RunView,'structures'>|undefined):{alive:number;total:number;text:string;aria:string}|undefined{
  const t=nestTally(view);if(!t)return undefined;
  const alive=t.total-t.down;
  return {alive,total:t.total,text:`${alive}/${t.total}`,aria:`${alive} de ${t.total} ${t.total===1?'ninho':'ninhos'} de pé`};
}
export function nestTally(view:Pick<RunView,'structures'>|undefined):{down:number;total:number}|undefined{
  const nests=view?.structures.filter(s=>s.kind==='ninho')??[];
  return nests.length?{down:nests.filter(s=>s.hp<=0||s.phase==='destruido').length,total:nests.length}:undefined;
}

/**
 * "Round N/10" plus the right-hand detail: remaining critters during a wave, countdown in the interval. With the chaveiro
 * objective running (D-047) the rounds have no end ("Onda N": waves go on past 10) and the chip carries his clock.
 */
export function roundInfo(view:RunView):RoundInfo|undefined{
  const round=view.round,objective=liveObjective(view),chaveiro={...(objective?{chaveiro:chaveiroClock(objective)}:{}),...(nestsMode(view)?{nests:true as const}:{})};
  if(round){
    const total=round.total||TOTAL_ROUNDS;
    const label=objective?`Onda ${round.index}`:`Round ${round.index}/${total}`;
    if(round.phase==='prepare'){
      const countdown=secondsLeft(round.phaseEndsTick,view.tick);
      return {index:round.index,total,label,phase:'prepare',remaining:0,countdown,detail:`Intervalo ${countdown} s`,...chaveiro};
    }
    const remaining=Math.max(0,round.remaining);
    return {index:round.index,total,label,phase:'wave',remaining,detail:remaining===1?'falta 1 bicho':`${remaining} bichos`,...chaveiro};
  }
  if(view.wave){
    const phase=view.wave.phase??'wave';
    const remaining=awakeCount(view.enemies);
    return {index:view.wave.index,total:TOTAL_ROUNDS,label:`Round ${view.wave.index}/${TOTAL_ROUNDS}`,phase,remaining,detail:phase==='prepare'?'Intervalo':`${remaining} bichos`};
  }
  return undefined;
}

/** Enemies the round still has to beat: a nest's sleepers (D-051, asleep) are not in the count until they wake. */
export function awakeCount(enemies:readonly object[]){let n=0;for(const e of enemies)if(!isAsleep(e))n++;return n;}

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
    if(player.id===localId)alerts.push({kind:'self',playerId:player.id,name:player.name,seconds,progress,text:progress>0?`Te salvando… ${Math.round(progress*100)}%`:`Você caiu! Grita por socorro: ${seconds} s`});
    else alerts.push({kind:'ally',playerId:player.id,name:player.name,seconds,progress,text:progress>0?`Salvando ${player.name}… ${Math.round(progress*100)}%`:`${player.name} caiu! Corre lá · ${seconds} s`});
  }
  return alerts.sort((a,b)=>Number(b.kind==='self')-Number(a.kind==='self')||a.seconds-b.seconds);
}

/** The one banner of the center stack (VGM-043): one line, never a pile of them on top of the field. */
export interface ReviveBanner {kind:'self'|'ally';key:string;text:string;seconds:number;progress:number;urgent:boolean;
  /** Own fall: what got you (critter kind, its name and the joke line), shown as the banner's optional second line. */
  cause?:{kind:string;name:string;line:string}}

export const OUT_TEXT='Você tá fora. Volta na revanche.';
export const WATCH_TEXT='Você assiste daqui. Entra na revanche.';

/**
 * Priority: connection lost > own fall > own elimination / watching > allies down. Allies down at the same time are
 * grouped ("Zé e Bia caíram!", "3 da turma caíram!"); a rescue in progress names who is being saved, plus the rest.
 */
/** Out or watching, once the camera follows a teammate (2 words, camera-segue / UX onda 4). */
export const watchingText=(name:string)=>`Assistindo: ${name.trim().split(/\s+/)[0]?.slice(0,9)??''}`;

export function reviveBanner(view:RunView,localId:string,network?:string,causes?:Pick<CauseLog,'last'>,watching?:string,worldRescue=false):ReviveBanner|undefined{
  if(network)return {kind:'ally',key:'net',text:network,seconds:Infinity,progress:0,urgent:false};
  if(worldRescue){
    // Falls and rescues live in the world now (ring, column, "Você, 18 s" ficha, Me salva button, edge arrows).
    const self=view.players.find(p=>p.id===localId);
    if(self?.downed&&!self.eliminated)return undefined;
    if((self?.eliminated||self?.spectator)&&watching)return {kind:'ally',key:`watching:${watching}`,text:watchingText(watching),seconds:Infinity,progress:0,urgent:false};
    if(self?.eliminated)return {kind:'self',key:'out',text:OUT_TEXT,seconds:Infinity,progress:0,urgent:false};
    if(self?.spectator)return {kind:'ally',key:'watch',text:WATCH_TEXT,seconds:Infinity,progress:0,urgent:false};
    return undefined;
  }
  const alerts=reviveAlerts(view,localId),self=view.players.find(p=>p.id===localId);
  const own=alerts.find(a=>a.kind==='self');
  if(own){
    const kind=causes?.last.get(own.playerId),copy=kind?causeCopy(kind):undefined;
    return {kind:'self',key:`self:${own.playerId}`,text:own.text,seconds:own.seconds,progress:own.progress,urgent:own.seconds<=5,
      ...(copy&&kind?{cause:{kind,name:copy.name,line:copy.line}}:{})};
  }
  if((self?.eliminated||self?.spectator)&&watching)return {kind:'ally',key:`watching:${watching}`,text:watchingText(watching),seconds:Infinity,progress:0,urgent:false};
  if(self?.eliminated)return {kind:'self',key:'out',text:OUT_TEXT,seconds:Infinity,progress:0,urgent:false};
  if(self?.spectator)return {kind:'ally',key:'watch',text:WATCH_TEXT,seconds:Infinity,progress:0,urgent:false};
  if(!alerts.length)return undefined;
  const seconds=Math.min(...alerts.map(a=>a.seconds));
  if(alerts.length===1){const a=alerts[0];return {kind:'ally',key:`ally:${a.playerId}`,text:a.text,seconds,progress:a.progress,urgent:seconds<=5};}
  const saving=alerts.find(a=>a.progress>0),rest=alerts.length-1;
  const who=alerts.length===2?`${alerts[0].name} e ${alerts[1].name}`:`${alerts.length} da turma`;
  const text=saving?`Salvando ${saving.name}… ${Math.round(saving.progress*100)}% · +${rest} ${rest===1?'caído':'caídos'}`:`${who} caíram! Corre lá · ${seconds} s`;
  return {kind:'ally',key:'group',text,seconds,progress:saving?.progress??0,urgent:seconds<=5};
}

/** Offer header copy (DSG-voz): one title, no eyebrow chip. */
export function offerTitle(offer:OfferView){
  return {title:offer.source==='round'?'Oferta do round':`Nível ${offer.level}!`};
}

/**
 * D-021: during a wave the offer waits behind a chip ("combat", opened by a tap); in the intermission (or with no
 * round info) it opens by itself ("intermission").
 */
export type OfferMode='combat'|'intermission';
export function offerMode(view:RunView):OfferMode{
  return (view.round?.phase??view.wave?.phase)==='wave'?'combat':'intermission';
}

/** Remaining fraction of an offer deadline, given the tick it became the shown (head) offer. */
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
  /** The defeat came from the wall falling (VGM-046B), not from the whole team down. */
  wall?:boolean;
  /** The run's most embarrassing moment, from the server (VGM-053B, RunState.shame). */
  shame?:ShameMoment;
  /** D-047: the chaveiro's bill (RunState.objective): why it ended, the budget, the Grana, the debt. */
  objective?:ObjectiveResult;
}

/** Per-player counters accumulated from view events, de-duplicated by eventId. */
export interface PlayerTally {downs:number;revives:number;upgrades:number;evolves:number;heals:number;magnets:number;chests:number;pickups:number;kills:number}
export interface RunTally {players:Map<string,PlayerTally>;lastEventId:number;startTick?:number;
  /** What downed each player (UX-voce-e-dano f). */
  causes:CauseLog}

export const emptyTally=():RunTally=>({players:new Map(),lastEventId:-1,causes:emptyCauses()});

/**
 * Starts a new run's tally in place (rematch). Counters and start tick clear, but lastEventId is kept:
 * eventIds are monotonic across runs (D-011), so late events of the old run still dedupe instead of
 * leaking into the new one.
 */
export function resetTally(tally:RunTally){
  tally.players.clear();
  tally.startTick=undefined;
  resetCauses(tally.causes);
  return tally;
}
const blank=():PlayerTally=>({downs:0,revives:0,upgrades:0,evolves:0,heals:0,magnets:0,chests:0,pickups:0,kills:0});

export function tallyOf(tally:RunTally,playerId:string){
  let entry=tally.players.get(playerId);
  if(!entry){entry=blank();tally.players.set(playerId,entry);}
  return entry;
}

/** Applies new events once; repeated or late eventIds are ignored. */
export function applyEvents(tally:RunTally,view:RunView){
  tally.startTick??=view.tick;
  rememberEnemies(tally.causes,view.enemies);
  // Kills are remembered before the falls are named: the hitter may die on the tick it downed someone.
  const falls:{player:string;by?:string;source?:string}[]=[];
  for(const event of view.events){
    if(event.eventId<=tally.lastEventId)continue;
    tally.lastEventId=event.eventId;
    switch(event.type){
      case 'downed':tallyOf(tally,event.player).downs++;falls.push(event);break;
      case 'revived':if(event.by)tallyOf(tally,event.by).revives++;break;
      case 'upgrade':tallyOf(tally,event.player).upgrades++;break;
      case 'evolve':tallyOf(tally,event.player).evolves++;break;
      case 'kill':rememberKill(tally.causes,event.enemy,event.kind);if(event.by)tallyOf(tally,event.by).kills++;break;
      case 'pickup':{
        const entry=tallyOf(tally,event.player);entry.pickups++;
        if(event.kind==='heal')entry.heals++;else if(event.kind==='magnet')entry.magnets++;else if(event.kind==='chest')entry.chests++;
        break;
      }
    }
  }
  for(const fall of falls)recordFall(tally.causes,fall.player,resolveCause(fall,view,tally.causes));
  return tally;
}
