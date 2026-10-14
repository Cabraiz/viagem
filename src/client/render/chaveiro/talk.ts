/**
 * D-047, card NEW-20261013-ORQ-chaveiro-falas: when the chaveiro's cast speaks (lines.ts says what). Pure, so the
 * timing is tested; the scene feeds it every run view and asks each frame for the line to show (scene.ts).
 * Two sources, the events first:
 * - protocol 15's SimEvents (contract/types.ts on the objective's branch), read loosely by `type` until main has them:
 *   {type:'alarm'} → volta; {type:'part'} → part; {type:'moto';mode;alone?} → the moment (tranco + alone → tranco-sozinha);
 *   {type:'sale'} (Cida sold to a critter) → sale; {type:'buy'} → buy; and main's {type:'boss-phase'} of a new boss → chefe;
 * - the objective view's changes (view.ts), until the events arrive: the moto's mode (morta → anda = tranco), a part's
 *   bit, the end (victory: conector, or divida when the Grana did not cover the budget; defeat with the car at its limit:
 *   perda-total). Once a chaveiro event arrived in a run, the view stops speaking for those moments.
 * The end comes from the run's result too (ObjectiveResult: opened with debt 0 → conector, debt > 0 → divida, cause
 * 'car' → perda-total), whichever arrives first, once per run.
 * Spam: one line every LINE_GAP_MS; a moment that comes during the gap waits for its end (the most important waiting
 * one goes next, PENDING_MS at most); the same moment twice within DEDUPE_MS (the event and the view, the alarm and the 'volta'
 * mode) speaks once. The end always shows, right away.
 */
import {END_EVENTS,LINE_EVENTS,hash32,pickLine,type LineEvent,type PickedLine} from './lines.ts';
import type {ChaveiroView,MotoMode} from './view.ts';

/** At most one line of the cast every LINE_GAP_MS (the balloon lives 2.2 s: a silent beat between two). */
export const LINE_GAP_MS=4500;
/**
 * A moment heard during the gap can still be said at its end (the most important one waiting); one older than this
 * when the talk is next asked (the tab was hidden, the scene paused) is old news and dropped.
 */
export const PENDING_MS=LINE_GAP_MS;
/** The same moment again within this window is the same moment (two sources, or the alarm and its lap). */
export const DEDUPE_MS=3000;
/** Which waiting moment goes first when the gap ends (higher first; equal: the newest). */
const WEIGHT:Partial<Record<LineEvent,number>>={chefe:4,part:3,volta:2,tombo:2,morta:2,chegou:2};
/** The moto's modes that speak when the view enters them (anda never does; leaving morta for anda is the tranco). */
const MODE_LINES:Readonly<Partial<Record<MotoMode,LineEvent>>>={volta:'volta',morta:'morta',lombada:'lombada',entrega:'entrega',tombo:'tombo',abrindo:'abrindo'};
/** Moments the protocol-15 events tell: once one of them came, the view no longer speaks for these. */
const EVENT_TOLD:ReadonlySet<LineEvent>=new Set<LineEvent>(['volta','morta','tranco','tranco-sozinha','lombada','entrega','tombo','abrindo','chegou','part']);
const MOMENTS:ReadonlySet<string>=new Set(['morta','lombada','entrega','tombo','volta','abrindo','chegou']);

/** A run event as the talk reads it: by its `type` (protocol 15's are not in main's contract yet). */
export type LooseEvent={type:string;eventId?:number}&Record<string,unknown>;
export interface SaidLine extends PickedLine {
  /** An end line: it skips every balloon gap. */
  priority:boolean;
}

/** The moment of a run event, if it has one (boss-phase is handled with the boss's id, apart). */
export function eventMoment(event:LooseEvent):LineEvent|undefined{
  switch(event.type){
    case 'alarm':return 'volta';
    case 'part':return 'part';
    case 'sale':return 'sale';
    case 'buy':return 'buy';
    case 'moto':{
      const mode=event.mode;
      if(mode==='tranco')return event.alone?'tranco-sozinha':'tranco';
      return typeof mode==='string'&&MOMENTS.has(mode)?mode as LineEvent:undefined;
    }
  }
  return undefined;
}
/** The end line of a run result (contract ObjectiveResult, read loosely): undefined when the result says nothing. */
export function resultMoment(result:unknown):LineEvent|undefined{
  if(!result||typeof result!=='object')return undefined;
  const r=result as {cause?:unknown;debt?:unknown};
  if(r.cause==='car')return 'perda-total';
  if(r.cause==='opened')return typeof r.debt==='number'&&r.debt>0?'divida':'conector';
  return undefined;
}
/** The end line of an ended objective view: the Grana against the budget when the view carries them (ObjectiveView). */
export function viewEndMoment(view:ChaveiroView):LineEvent|undefined{
  if(view.ended==='victory'){
    const {grana,budget}=view as {grana?:unknown;budget?:unknown};
    return typeof grana==='number'&&typeof budget==='number'&&grana<budget?'divida':'conector';
  }
  if(view.ended==='defeat')return view.car.hits>=view.car.limit?'perda-total':undefined;
  return undefined;
}

export class ChaveiroTalk {
  private readonly seed:number;
  /** Per moment: how many times it spoke (the picker's counter) and the line it said last. */
  private count=new Map<LineEvent,number>();
  private last=new Map<LineEvent,number>();
  private heardAt=new Map<LineEvent,number>();
  private saidAt=-Infinity;
  private waiting?:{event:LineEvent;at:number};
  private end?:LineEvent;
  private endSaid=false;
  private mode?:MotoMode;
  private parts=0;
  private hadView=false;
  private eventsLive=false;
  private cursor=-1;
  private tick=-1;
  private bosses=new Set<string>();

  constructor(seed:number){this.seed=seed>>>0;}

  /** A run view's objective (undefined: none, or the run is gone) and its events, at server tick `tick`, seen at `now`. */
  push(view:ChaveiroView|undefined,events:readonly LooseEvent[],tick:number,now:number){
    if(tick<this.tick)this.newRun();
    this.tick=tick;
    if(!view){if(this.hadView)this.newRun();return;}
    for(const event of events){
      if(typeof event.eventId==='number'){if(event.eventId<=this.cursor)continue;this.cursor=event.eventId;}
      if(event.type==='boss-phase'){
        // The boss's spawn is its phase 1 (sim/boss.ts); a later phase of a boss never seen is not an arrival.
        const id=String(event.enemy??'');
        if(!this.bosses.has(id)){this.bosses.add(id);if((event.phase??1)===1)this.hear('chefe',now);}
        continue;
      }
      const moment=eventMoment(event);
      if(!moment)continue;
      this.eventsLive=true;
      this.hear(moment,now);
    }
    const viewTells=(e:LineEvent)=>!(this.eventsLive&&EVENT_TOLD.has(e));
    if(this.hadView){
      const mode=view.moto.mode;
      if(mode!==this.mode){
        const moment=this.mode==='morta'&&mode==='anda'?'tranco':MODE_LINES[mode];
        if(moment&&viewTells(moment))this.hear(moment,now);
      }
      if(view.car.parts&~this.parts&&viewTells('part'))this.hear('part',now);
    }
    if(view.ended){const end=viewEndMoment(view);if(end)this.hear(end,now);}
    this.mode=view.moto.mode;this.parts=view.car.parts;this.hadView=true;
  }
  /** The run's result (RunState.objective, protocol 15), read loosely: its end line, if none was said yet. */
  result(result:unknown,now:number){
    if(!this.hadView)return; // the objective is gone (or not yet here): its end was said, or is not ours
    const end=resultMoment(result);
    if(end)this.hear(end,now);
  }
  /** The line to show at `now`, if one is due; it counts as said. */
  take(now:number):SaidLine|undefined{
    if(this.end&&!this.endSaid){this.endSaid=true;return {...this.pick(this.end),priority:true};}
    if(this.end)return undefined; // after the end line, the run is over
    const w=this.waiting;
    if(!w)return undefined;
    if(now-w.at>PENDING_MS){this.waiting=undefined;return undefined;}
    if(now-this.saidAt<LINE_GAP_MS)return undefined;
    this.waiting=undefined;this.saidAt=now;
    return {...this.pick(w.event),priority:false};
  }
  /** Forget the run (a new one, or the objective is gone); the counters stay, so the next run goes on varying. */
  newRun(){
    this.heardAt.clear();this.waiting=this.end=undefined;this.endSaid=false;this.mode=undefined;this.parts=0;this.hadView=false;
    this.eventsLive=false;this.cursor=-1;this.tick=-1;this.bosses.clear();this.saidAt=-Infinity;
  }

  private hear(event:LineEvent,now:number){
    if(this.endSaid||this.end)return; // after the end, nothing else
    if(END_EVENTS.has(event)){this.end=event;this.waiting=undefined;return;}
    const at=this.heardAt.get(event);
    if(at!==undefined&&now-at<DEDUPE_MS)return;
    this.heardAt.set(event,now);
    const w=this.waiting;
    if(w&&now-w.at<=PENDING_MS&&(WEIGHT[w.event]??1)>(WEIGHT[event]??1))return;
    this.waiting={event,at:now};
  }
  private pick(event:LineEvent){
    const n=this.count.get(event)??0;
    const line=pickLine(event,hash32(this.seed,LINE_EVENTS.indexOf(event),n),this.last.get(event));
    this.count.set(event,n+1);this.last.set(event,line.index);
    return line;
  }
}
