/**
 * First-run coach (VGM-056): the one place for "first time" hints, so they never stack. It teaches the first round in
 * about 20 s without long text: walk (the weapons fire by themselves), pick up XP, the "+N" chip (D-021) and rescue a
 * caído; later, in the first intermission, gathering (VGM-046B). It replaces the chip's balloon and the gathering tip.
 *
 * Rules:
 * - One hint at a time, as one row of the announcement slot in the top band (UX-zonas-tela): never over the hero or
 *   the thumbs, and any notice, alert or round banner outranks it (danger over the lesson); it waits for the slot.
 * - A hint goes away when the player does the action (a check sticker for DONE_MS, then gone), or when its time in
 *   this run runs out (walk and rescue have none: they stay while they make sense).
 * - Once per phone: a lesson done is stored at once; when a run reaches its result, every lesson shown in it is stored
 *   too ("só na primeira run do aparelho"). Lessons whose moment never came (rescue in a solo run) wait for a later run.
 * - Purely local: nothing goes to the room, nothing pauses anyone; in a group each phone shows its own.
 * - Storage may be off or throw (private tab): the coach then remembers in memory for this page only, never throws.
 * Pure state (Coach) plus a small DOM part (createCoach); the state is unit-tested under node.
 */
import type {RunView} from '../sim/view.ts';
import {icon,type IconName} from '../../ui/icon.ts';

export type Lesson='walk'|'xp'|'chip'|'rescue'|'gather';
/** Priority when two lessons could show: a caído first, then walking, the chip, XP, gathering. */
export const LESSON_ORDER:readonly Lesson[]=['rescue','walk','chip','xp','gather'];

export interface LessonCopy {text:string;sub?:string;icon:IconName|'chip';
  /** Most time this hint may stay on screen in one run (ms); undefined: while it makes sense. */
  maxMs?:number;
  /** Takes the slot from the street banner (round name, "Intervalo!") in round 1 only: the first thing a novice needs.
   * From round 2 on the banner may be a zueira event or the boss, and those keep their turn. */
  overBanner?:boolean}
/** House voice (revisao-visual §2.6): short, informal imperative, sentence case; the instruction is dry. */
export const LESSONS:Readonly<Record<Lesson,LessonCopy>>={
  walk:{text:'Arrasta o dedão pra andar',sub:'A arma atira sozinha',icon:'dedao',overBanner:true},
  xp:{text:'Passa nas gotinhas de XP',sub:'Elas sobem o seu nível',icon:'gota',maxMs:9000},
  chip:{text:'Toca pra escolher melhoria',icon:'chip',maxMs:9000},
  // Two short lines: one line plus "Leva 3 s" wrapped to three rows in portrait at 125%.
  rescue:{text:'Encosta no caído',sub:'Fica 3 s pra resgatar',icon:'boia'},
  gather:{text:'Encosta num coqueiro ou numa pedra pra catar',icon:'coco',maxMs:10000},
};
/** The check after the action, then the row goes. */
export const DONE_MS=900;
/** Quiet time between two hints, so a new one reads as new. */
export const GAP_MS=700;
/** The hero counts as walking once it got this far (world units) from where the walk hint first showed. */
export const WALK_DISTANCE=1.2;
/** A gather node near the hero (world units) with work in progress means the hero is gathering. */
export const GATHER_NEAR=2.5;
/** XP drops farther than this from the hero (world units, about half a portrait screen) do not call the XP hint. */
export const XP_NEAR=8;
/** The hero jumping this far between two views is a snap (spawn, reconnection), not a step: the walk is measured anew. */
export const SNAP_DISTANCE=2.5;

export const COACH_KEY='viagem:dicas';
/** Hints of earlier cards: a phone that saw them does not see them again. */
export const LEGACY_KEYS:Readonly<Partial<Record<Lesson,string>>>={chip:'viagem:hint:offer-chip',gather:'viagem:dica-coleta'};

type Store=Pick<Storage,'getItem'|'setItem'>;
const isLesson=(id:unknown):id is Lesson=>typeof id==='string'&&(LESSON_ORDER as readonly string[]).includes(id);
/** This page's memory, for phones whose storage is off. */
const sessionDone=new Set<Lesson>();
const defaultStore=():Store|undefined=>{try{return globalThis.localStorage;}catch{return undefined;}};

/** Lessons this phone already learned (stored, legacy keys and this page's memory). Never throws. */
export function loadDone(storage:Store|undefined=defaultStore()):Set<Lesson>{
  const done=new Set<Lesson>(sessionDone);
  try{
    const raw=storage?.getItem(COACH_KEY);
    const list=raw?JSON.parse(raw):[];
    if(Array.isArray(list))for(const id of list)if(isLesson(id))done.add(id);
  }catch{/* private tab or broken value: memory only */}
  for(const [lesson,key] of Object.entries(LEGACY_KEYS) as [Lesson,string][]){
    try{const v=storage?.getItem(key);if(v==='1')done.add(lesson);}catch{/* same */}
  }
  return done;
}
/** Stores the learned lessons; a storage that throws only leaves them in this page's memory. */
export function saveDone(done:ReadonlySet<Lesson>,storage:Store|undefined=defaultStore()){
  for(const lesson of done)sessionDone.add(lesson);
  try{storage?.setItem(COACH_KEY,JSON.stringify(LESSON_ORDER.filter(l=>done.has(l))));}catch{/* quota or private tab */}
}
/** Test hook: forgets this page's memory. */
export function resetSessionMemory(){sessionDone.clear();}

export interface CoachInput {
  view:RunView;localId:string;
  /** The hero's predicted spot (explore.ts via RunHud.setHero); undefined in the sandbox without a hero. */
  hero?:{x:number;y:number};
  /** The "+N" chip is on screen in combat. */
  chip:boolean;
  /** Another row holds the announcement slot (notice, alert, kill-cam) or a window is open: the hint waits. */
  blocked:boolean;
  /** The street banner (round name, "Intervalo!", zueira event) is up: only an overBanner hint takes the slot from it. */
  banner?:boolean;
}
export interface CoachShow {lesson:Lesson;done:boolean}

/** Whether a lesson's moment is now (pure). */
export function wants(lesson:Lesson,input:CoachInput,walked:boolean):boolean{
  const {view,localId}=input,round=view.round;
  const me=view.players.find(p=>p.id===localId);
  const standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0;
  if(!standing||!round)return false;
  const wave=round.phase==='wave';
  const near=(p:{x:number;y:number})=>!input.hero||Math.hypot(p.x-input.hero.x,p.y-input.hero.y)<=XP_NEAR;
  switch(lesson){
    // From the first second of the run (round 1's short prepare included): the 1st step should come in ≤ 3 s (UX-1).
    case 'walk':return wave||round.phase==='prepare';
    case 'xp':return wave&&walked&&view.pickups.some(p=>p.kind==='xp'&&near(p));
    case 'chip':return wave&&input.chip;
    case 'rescue':return view.players.some(p=>p.id!==localId&&!!p.downed&&!p.eliminated&&p.online);
    case 'gather':return round.phase==='prepare'&&round.index>=2&&!!view.camp&&view.camp.hornEndsTick===undefined&&!view.camp.wallDown;
  }
}

/** Whether the view shows the player doing the lesson's action (pure). The chip comes from the tap (Coach.did). */
export function didAction(lesson:Lesson,input:CoachInput,origin:{x:number;y:number}|undefined):boolean{
  const {view,localId,hero}=input;
  switch(lesson){
    case 'walk':return !!hero&&!!origin&&Math.hypot(hero.x-origin.x,hero.y-origin.y)>=WALK_DISTANCE;
    case 'xp':return view.events.some(e=>e.type==='pickup'&&e.kind==='xp'&&e.player===localId);
    case 'rescue':return view.events.some(e=>e.type==='revived'&&e.by===localId);
    case 'gather':return !!hero&&(view.nodes??[]).some(n=>n.progress>0&&Math.hypot(n.x-hero.x,n.y-hero.y)<=GATHER_NEAR);
    case 'chip':return false;
  }
}

/**
 * The coach's state for one HUD (one page). `step` is called on every view; it returns the hint to show, if any.
 * Time comes in (`now`, ms) so tests drive it without clocks.
 */
export class Coach {
  readonly done:Set<Lesson>;
  /** ms each lesson has been on screen in this run. */
  private shownMs=new Map<Lesson,number>();
  private current?:{lesson:Lesson;since:number;doneAt?:number};
  private lastStep?:number;
  private quietUntil=0;
  /** Where the hero stood when the walk hint first showed (the distance is measured from here). */
  private walkOrigin?:{x:number;y:number};
  private pendingDid=new Set<Lesson>();
  private lastHero?:{x:number;y:number};
  private readonly storage:Store|undefined;
  constructor(storage:Store|undefined=defaultStore()){this.storage=storage;this.done=loadDone(storage);}

  /** Every lesson learned: the coach has nothing left to say. */
  get finished(){return LESSON_ORDER.every(l=>this.done.has(l));}

  /** The player did it (a tap the HUD saw, like the chip). */
  did(lesson:Lesson){if(!this.done.has(lesson))this.pendingDid.add(lesson);}

  private learn(lesson:Lesson,now:number){
    if(this.done.has(lesson))return;
    this.done.add(lesson);saveDone(this.done,this.storage);
    if(this.current?.lesson===lesson&&this.current.doneAt===undefined)this.current.doneAt=now;
  }

  step(input:CoachInput,now:number):CoachShow|undefined{
    const dt=this.lastStep===undefined?0:Math.max(0,Math.min(500,now-this.lastStep));this.lastStep=now;
    // Actions first: a tap or an event while its hint shows turns into the check; any other time it is just learned.
    for(const lesson of this.pendingDid)this.learn(lesson,now);
    this.pendingDid.clear();
    // The walk origin is taken the first time the walk hint could show, so a novice standing 15 s still counts from there;
    // a snap of the predicted hero (spawn, reconnection) is not a step, so it re-anchors the origin.
    const hero=input.hero,last=this.lastHero;this.lastHero=hero&&{...hero};
    if(!this.done.has('walk')&&hero){
      if(this.walkOrigin&&last&&Math.hypot(hero.x-last.x,hero.y-last.y)>=SNAP_DISTANCE)this.walkOrigin={...hero};
      if(!this.walkOrigin&&wants('walk',input,false))this.walkOrigin={...hero};
    }
    const overBanner=(lesson:Lesson)=>!!LESSONS[lesson].overBanner&&input.view.round?.index===1;
    const held=(lesson:Lesson)=>input.blocked||(!!input.banner&&!overBanner(lesson));
    for(const lesson of LESSON_ORDER)if(!this.done.has(lesson)&&didAction(lesson,input,this.walkOrigin))this.learn(lesson,now);
    const cur=this.current;
    if(cur){
      if(cur.doneAt!==undefined){
        // The check keeps its clock but gives the slot away at once to any other row (one row at a time).
        if(now-cur.doneAt<DONE_MS)return held(cur.lesson)?undefined:{lesson:cur.lesson,done:true};
        // The gap runs from the end of the check, however seldom the views come.
        this.current=undefined;this.quietUntil=cur.doneAt+DONE_MS+GAP_MS;
      }else{
        const copy=LESSONS[cur.lesson];
        const still=wants(cur.lesson,input,this.done.has('walk'))&&!held(cur.lesson);
        if(still){
          const total=(this.shownMs.get(cur.lesson)??0)+dt;this.shownMs.set(cur.lesson,total);
          if(copy.maxMs===undefined||total<copy.maxMs)return {lesson:cur.lesson,done:false};
        }
        this.current=undefined;this.quietUntil=now+GAP_MS;
      }
    }
    if(input.blocked||now<this.quietUntil)return undefined;
    for(const lesson of LESSON_ORDER){
      if(this.done.has(lesson)||held(lesson))continue;
      const max=LESSONS[lesson].maxMs;
      if(max!==undefined&&(this.shownMs.get(lesson)??0)>=max)continue;
      if(!wants(lesson,input,this.done.has('walk')))continue;
      this.current={lesson,since:now};
      if(!this.shownMs.has(lesson))this.shownMs.set(lesson,0);
      return {lesson,done:false};
    }
    return undefined;
  }

  /**
   * The run reached its result: what was shown in it counts as learned (first run of the phone only), and the next run
   * starts with fresh per-run timers. Lessons that never showed (rescue in a solo run) stay for later.
   */
  endRun(){
    let changed=false;
    for(const [lesson,ms] of this.shownMs)if(ms>0&&!this.done.has(lesson)){this.done.add(lesson);changed=true;}
    if(changed)saveDone(this.done,this.storage);
    this.shownMs.clear();this.current=undefined;this.walkOrigin=undefined;this.lastHero=undefined;this.lastStep=undefined;this.quietUntil=0;
  }
}

// ---------- DOM ----------
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

export interface CoachPart {
  readonly el:HTMLElement;
  /** Draws the hint `show` (undefined hides it); `pending` is the chip's count for its replica. */
  render(show:CoachShow|undefined,pending:number):void;
}

/** The row of the announcement slot: a sticker (or the chip's replica), the line and an optional second line. */
export function createCoachRow():CoachPart{
  const row=el('div','rh-coach');row.hidden=true;row.setAttribute('role','status');row.setAttribute('aria-live','polite');row.lang='pt-BR';
  const mark=el('span','rh-coach-mark',row);
  const body=el('span','rh-coach-body',row);
  const text=el('span','rh-coach-text',body),sub=el('span','rh-coach-sub',body);
  let key='';
  return {el:row,render(show,pending){
    const next=show?`${show.lesson}:${show.done}:${show.lesson==='chip'?pending:''}`:'';
    if(next===key)return;key=next;
    if(!show){row.hidden=true;delete row.dataset.lesson;return;}
    const copy=LESSONS[show.lesson];
    row.hidden=false;row.dataset.lesson=show.lesson;row.classList.toggle('rh-coach-done',show.done);
    // The chip's own look ("+N" on Amarelo), so the line points at it without an arrow over the field.
    mark.innerHTML=show.done?icon('pronto',{size:32}):copy.icon==='chip'?`<span class="rh-coach-chip" aria-hidden="true">+${Math.max(1,pending)}</span>`:icon(copy.icon,{size:32});
    text.textContent=copy.text;
    sub.textContent=show.done?'':copy.sub??'';
  }};
}
