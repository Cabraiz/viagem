/**
 * Per-class funny lines (VGM-053A): lookup, deterministic pick and the mapping from simulation events to balloons.
 * Content lives in lines.data.ts; visible text is pt-BR.
 */
import type {SimEvent} from '../sim/types.ts';
import {CLASS_LINES,type Situation} from './lines.data.ts';

export type {Situation};
export const SITUATIONS:readonly Situation[]=['levelUp','down','revive','upgrade','win','lose'];
export const SITUATION_LABELS:Readonly<Record<Situation,string>>={levelUp:'Subiu de nível',down:'Caiu',revive:'Resgatou',upgrade:'Escolheu upgrade',win:'Vitória',lose:'Derrota'};
/** Longest line that still fits a phone balloon. */
export const LINE_MAX=34;
/** Used for a class id that has no lines (new class, bad data): still funny, never empty. */
export const FALLBACK_LINES:Readonly<Record<Situation,readonly string[]>>={
  levelUp:['Subi! Nem sei como.','Nível novo, mesma cara.'],
  down:['Alguém me levanta aí!','Deitei só um pouquinho...'],
  revive:['De pé, guerreiro!','Levanta que o round não acabou!'],
  upgrade:['Esse aqui parece bom.','Escolhi pela cor.'],
  win:['Ganhamos?! Ganhamos!','Síndico derrotado, festa!'],
  lose:['Foi o lag, certeza.','Revanche? Revanche.'],
};

export const linesFor=(classId:string,situation:Situation):readonly string[]=>{
  const lines=CLASS_LINES[classId]?.[situation];
  return lines&&lines.length?lines:FALLBACK_LINES[situation];
};

function hashUnit(value:string){let h=0x811c9dc5;for(const c of value)h=Math.imul(h^c.charCodeAt(0),0x01000193);h^=h>>>13;h=Math.imul(h,0x5bd1e995);return ((h^h>>>15)>>>0)/4294967296;}
/** Deterministic pick: every client shows the same line for the same seed (e.g. event tick + player id). */
export function pickLine(classId:string,situation:Situation,seed:string|number){
  const lines=linesFor(classId,situation);
  return lines[Math.floor(hashUnit(`${classId}|${situation}|${seed}`)*lines.length)];
}

/** Players that can talk: pass the same active list (online, not spectating, not eliminated) on every client. */
export interface Speaker {id:string;classId:string}
export interface SpokenLine {speaker:string;situation:Situation;text:string}
/**
 * Balloon for a simulation event, or undefined when the event has no line.
 * A team level-up makes a single player talk (chosen by the seed) so six balloons never pop at once.
 */
export function lineForEvent(event:SimEvent,players:readonly Speaker[],seed:string|number):SpokenLine|undefined{
  const say=(player:Speaker|undefined,situation:Situation)=>player?{speaker:player.id,situation,text:pickLine(player.classId,situation,seed)}:undefined;
  const byId=(id:string|undefined)=>id===undefined?undefined:players.find(p=>p.id===id);
  switch(event.type){
    case 'downed':return say(byId(event.player),'down');
    case 'revived':return say(byId(event.by),'revive');
    // 'upgrade' also comes from chests, the forge and default picks: only about a third of them talk.
    case 'upgrade':return hashUnit(`upgrade|${event.player}|${event.item}|${event.level}|${seed}`)<UPGRADE_TALK_CHANCE?say(byId(event.player),'upgrade'):undefined;
    case 'evolve':return say(byId(event.player),'upgrade');
    case 'levelup':{
      if(!players.length)return undefined;
      const sorted=[...players].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
      return say(sorted[Math.floor(hashUnit(`levelup|${event.level}|${seed}`)*sorted.length)],'levelUp');
    }
    default:return undefined;
  }
}
export const UPGRADE_TALK_CHANCE=.35;
/** Falls and rescues always deserve a balloon; the rest wait for a quiet moment. */
const PRIORITY:ReadonlySet<Situation>=new Set(['down','revive']);
/**
 * Keeps class lines rare: one per speaker every `perSpeakerMs` and, except for falls and rescues,
 * one on screen every `globalMs`. Emotes are not throttled here (EmoteGate handles them).
 */
export class LineThrottle {
  private readonly last=new Map<string,number>();
  private lastAny=-Infinity;
  readonly perSpeakerMs:number;readonly globalMs:number;
  constructor(perSpeakerMs=6000,globalMs=1500){this.perSpeakerMs=perSpeakerMs;this.globalMs=globalMs;}
  allow(line:SpokenLine,now:number){
    if(!Number.isFinite(now))return false;
    const at=this.last.get(line.speaker)??-Infinity;
    if(!PRIORITY.has(line.situation)&&(now-at<this.perSpeakerMs&&now>=at||now-this.lastAny<this.globalMs&&now>=this.lastAny))return false;
    this.last.set(line.speaker,now);this.lastAny=now;return true;
  }
}
/** Result screen line for one player. */
export const resultLine=(player:Speaker,victory:boolean,seed:string|number)=>pickLine(player.classId,victory?'win':'lose',seed);
