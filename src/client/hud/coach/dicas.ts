/**
 * First-time tips for the hidden gestures (NEW-20261029-ORQ-celular-dicas-primeira-vez; auditoria controles-celular
 * 29/10, item D): aiming by dragging Atacar, the two-finger zoom on the map and holding a backpack slot to drop it.
 * Nothing on screen says them, so the first round says them, one at a time, in the controls' etiqueta (the Papel label
 * by the joystick that the waiting room uses, controls-phase.ts).
 *
 * Rules:
 * - One tip at a time, after the joystick's "andar" light is gone (hud/coach.ts Coach.stick), START_MS later.
 * - A tip goes away when the player does the gesture (learned) or after TIP_MS on screen (learned by sight), then
 *   GAP_MS of quiet before the next.
 * - Never over a pause or a level-up: while blocked the tip hides and its clock stops.
 * - A tip shows only when it makes sense now (`can`): aiming only in the manual combat with Atacar live, dropping
 *   only with an item in the backpack. The desktop gets only the words that hold there (the PC zoom is fixed and the
 *   mouse does not aim the attack): holding the click on a slot drops it too.
 * - Only in the phone's first match: when a match that ran the coach reaches its result, every tip counts as seen.
 * - Storage may be off or throw (private tab): the tips are then remembered in memory for this page only.
 * Pure state (TipCoach); the DOM part is dicas-dom.ts.
 */
import type {InputKind} from '../../desktop-input.ts';

export type Tip='aim'|'zoom'|'drop';
/** The order the tips come in: the attack first (the thumb is already on it), then the camera, then the backpack. */
export const TIP_ORDER:readonly Tip[]=['aim','zoom','drop'];
/** House voice: short, informal imperative, sentence case. One row of the etiqueta at 390 px. */
export const TIPS:Readonly<Record<InputKind,Readonly<Partial<Record<Tip,string>>>>>={
  touch:{aim:'Arrasta o Atacar pra mirar',zoom:'Dois dedos no mapa: zoom',drop:'Segura o item pra largar'},
  mouse:{drop:'Segura o clique no item pra largar'},
};
/** Most time a tip stays on screen (ms, unblocked time only). */
export const TIP_MS=6000;
/** Quiet time between the walk light going and the first tip, and between two tips. */
export const START_MS=1500;
export const GAP_MS=1500;
export const DICAS_KEY='viagem:dicas-gestos';

type Store=Pick<Storage,'getItem'|'setItem'>;
const isTip=(id:unknown):id is Tip=>typeof id==='string'&&(TIP_ORDER as readonly string[]).includes(id);
const sessionLearned=new Set<Tip>();
const defaultStore=():Store|undefined=>{try{return globalThis.localStorage;}catch{return undefined;}};

/** Tips this phone already saw (stored, joined with this page's memory). Never throws. */
export function loadLearned(storage:Store|undefined=defaultStore()):Set<Tip>{
  const learned=new Set<Tip>(sessionLearned);
  try{const raw=storage?.getItem(DICAS_KEY),list=raw?JSON.parse(raw):[];if(Array.isArray(list))for(const id of list)if(isTip(id))learned.add(id);}
  catch{/* private tab or broken value: memory only */}
  return learned;
}
/** Stores the learned tips, joined with what another tab stored meanwhile. Never throws. */
export function saveLearned(learned:ReadonlySet<Tip>,storage:Store|undefined=defaultStore()){
  for(const tip of learned)sessionLearned.add(tip);
  const all=loadLearned(storage);
  for(const tip of learned)all.add(tip);
  try{storage?.setItem(DICAS_KEY,JSON.stringify(TIP_ORDER.filter(t=>all.has(t))));}catch{/* quota or private tab */}
}
/** Test hook: forgets this page's memory. */
export function resetTipMemory(){sessionLearned.clear();}

export interface TipInput {
  now:number;kind:InputKind;
  /** A pause, a level-up, the offer, the result or the boss scene is on screen: no tip, its clock stops. */
  blocked:boolean;
  /** The joystick's "andar" light is gone (the round's first lesson had its moment). */
  ready:boolean;
  /** The tips that make sense right now. */
  can:ReadonlySet<Tip>;
}

export class TipCoach {
  readonly learned:Set<Tip>;
  /** The coach ran in a round of this match (endRun only closes a match that had tips to give). */
  started=false;
  private current:{tip:Tip;shownMs:number;last?:number}|undefined;
  private quietUntil=Infinity;
  private readonly storage:Store|undefined;
  constructor(storage:Store|undefined=defaultStore()){this.storage=storage;this.learned=loadLearned(storage);}

  /** Nothing left to teach on this phone. */
  get over():boolean{return TIP_ORDER.every(t=>this.learned.has(t));}

  /** The player did the gesture: learned at once; if it was on screen it goes, and the quiet starts. */
  done(tip:Tip,now:number){
    if(this.current?.tip===tip){this.current=undefined;this.quietUntil=now+GAP_MS;}
    this.learn(tip);
  }

  /** The tip on screen now, or undefined. Call every view of the round. */
  step(input:TipInput):Tip|undefined{
    if(this.over)return undefined;
    this.started=true;
    const {now}=input;
    if(input.blocked||!input.ready){if(this.current)this.current.last=undefined;return undefined;}
    if(this.quietUntil===Infinity)this.quietUntil=now+START_MS;
    const cur=this.current;
    if(cur){
      if(!this.shows(cur.tip,input)){this.current=undefined;return undefined;}
      if(cur.last!==undefined)cur.shownMs+=Math.max(0,now-cur.last);
      cur.last=now;
      if(cur.shownMs<TIP_MS)return cur.tip;
      this.current=undefined;this.quietUntil=now+GAP_MS;this.learn(cur.tip);
      return undefined;
    }
    if(now<this.quietUntil)return undefined;
    const next=TIP_ORDER.find(t=>this.shows(t,input));
    if(!next)return undefined;
    this.current={tip:next,shownMs:0,last:now};
    return next;
  }

  /** The match reached its result: only the first match teaches, so every tip counts as seen. */
  endRun(){
    if(!this.started)return;
    this.started=false;this.current=undefined;this.quietUntil=Infinity;
    for(const tip of TIP_ORDER)this.learned.add(tip);
    saveLearned(this.learned,this.storage);
  }

  private shows(tip:Tip,input:TipInput):boolean{return !this.learned.has(tip)&&input.can.has(tip)&&!!TIPS[input.kind][tip];}
  private learn(tip:Tip){if(this.learned.has(tip))return;this.learned.add(tip);saveLearned(this.learned,this.storage);}
}
