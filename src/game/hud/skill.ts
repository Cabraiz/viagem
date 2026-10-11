/**
 * Skill button of the run (NEW-20261006-E7-skill-hud-wiring): one tap casts the class skill once, the button shows
 * the cooldown from the server's skillTick/skillReadyTick, and a tap that cast nothing says so. Mobile only (D-009).
 * The press logic and the state are pure (tests); SkillButton only paints the existing #coop-attack.
 */
import {SIM_HZ} from '../sim/types.ts';
import {kitFor} from '../sim/kits.ts';
import type {PlayerRunView} from '../sim/view.ts';
import {icon} from '../../ui/icon.ts';

/** A tap not yet sent is dropped after this long (a reconnect, a long pause): it never fires a cast much later. */
export const PRESS_TTL_MS=1000;
/** A sent tap with no cast within this long had nothing to act on ("sem alvo"); covers ~300 ms of lag both ways. */
export const NO_CAST_MS=900;
/** How long the "sem alvo" note stays on the button. */
export const NOTE_MS=1200;

/**
 * One tap = one input with `skill: true` (the old button sent it while held, so a held thumb kept recasting).
 * `take` is asked once per input step and says yes once per tap, only when the input can actually go out.
 */
export class SkillPress {
  private queuedAt?:number;
  private sentAt?:number;
  press(now:number){this.queuedAt=now;}
  /** The input step: true once per tap when `canSend` (connected, in combat); stale taps expire. */
  take(now:number,canSend:boolean):boolean{
    if(this.queuedAt===undefined)return false;
    if(now-this.queuedAt>PRESS_TTL_MS){this.queuedAt=undefined;return false;}
    if(!canSend)return false;
    this.queuedAt=undefined;this.sentAt=now;return true;
  }
  /** A cast arrived (skillTick moved): the last tap was answered. */
  answered(){this.sentAt=undefined;}
  /** True once when a sent tap got no cast within NO_CAST_MS. */
  unanswered(now:number):boolean{
    if(this.sentAt===undefined||now-this.sentAt<NO_CAST_MS)return false;
    this.sentAt=undefined;return true;
  }
  clear(){this.queuedAt=this.sentAt=undefined;}
  get pending(){return this.queuedAt!==undefined;}
}

export interface SkillState {
  mode:'ready'|'cooling';
  /** Whole seconds left (cooling), rounded up: "3" until it is ready. */
  seconds:number;
  /** Share of the cooldown already paid, 0..1 (1 = ready). */
  progress:number;
}
/** Cooldown of a player at a view tick, from the frame fields (0 or absent = never cast). */
export function skillState(player:Pick<PlayerRunView,'skillTick'|'skillReadyTick'>|undefined,tick:number):SkillState{
  const ready=player?.skillReadyTick??0,cast=player?.skillTick??0;
  if(!ready||tick>=ready)return {mode:'ready',seconds:0,progress:1};
  const total=Math.max(1,ready-Math.min(cast||ready,ready));
  const left=ready-tick;
  return {mode:'cooling',seconds:Math.ceil(left/SIM_HZ),progress:Math.max(0,Math.min(1,1-left/total))};
}
/** The button's accessible name: what the skill is called for this class. */
export function skillLabel(classId:string){
  const name=kitFor(classId)?.skill.name;
  return name?`Habilidade: ${name}`:'Habilidade da classe';
}

/** Ring circumference in the ring's own units (pathLength). */
const RING=100;
/** Paints #coop-attack: sticker icon, cooldown ring and seconds, "sem alvo" note. */
export class SkillButton {
  readonly press=new SkillPress();
  private lastCast=0;
  private noteUntil=0;
  private state:SkillState={mode:'ready',seconds:0,progress:1};
  private fill:SVGCircleElement;private time:HTMLElement;
  readonly el:HTMLButtonElement;
  constructor(el:HTMLButtonElement,classId:string){
    this.el=el;
    el.setAttribute('aria-label',skillLabel(classId));
    el.dataset.state='ready';
    // The weapon icon of each class comes with the item stickers (DSG-adesivos-itens); the bread bag is the generic one (§2.4).
    el.innerHTML=`<svg class="skillbtn-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="skillbtn-track" cx="50" cy="50" r="46"/><circle class="skillbtn-fill" cx="50" cy="50" r="46" pathLength="${RING}"/></svg>${icon('sacola',{size:40,className:'skillbtn-icon'})}<span class="skillbtn-time" aria-hidden="true"></span>`;
    this.fill=el.querySelector('.skillbtn-fill')!;this.time=el.querySelector('.skillbtn-time')!;
    this.paint();
  }
  /** Each authoritative view: the local player's cooldown and whether the last tap was answered. */
  update(player:PlayerRunView|undefined,tick:number,now:number){
    const cast=player?.skillTick??0;
    if(cast&&cast!==this.lastCast){this.press.answered();this.lastCast=cast;}
    if(this.press.unanswered(now))this.noteUntil=now+NOTE_MS;
    const next=skillState(player,tick);
    const note=now<this.noteUntil;
    if(next.mode===this.state.mode&&next.seconds===this.state.seconds&&Math.abs(next.progress-this.state.progress)<.01&&note===(this.el.dataset.note==='true'))return;
    this.state=next;this.el.dataset.note=String(note);this.paint();
  }
  /** Run reset (rematch): ready, nothing pending. */
  reset(){this.lastCast=0;this.noteUntil=0;this.press.clear();this.state={mode:'ready',seconds:0,progress:1};this.el.dataset.note='false';this.paint();}
  private paint(){
    const s=this.state;
    this.el.dataset.state=s.mode;
    this.fill.style.strokeDashoffset=String(RING*(1-s.progress));
    this.time.textContent=this.el.dataset.note==='true'?'sem alvo':s.mode==='cooling'?String(s.seconds):'';
  }
}
