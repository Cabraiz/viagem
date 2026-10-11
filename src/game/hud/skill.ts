/**
 * Skill button of the run (NEW-20261006-E7-skill-hud-wiring): one tap casts the class skill once through the room's
 * tap message (`CoopClient.cast()` → {t:'cast',round,id}, answered by {t:'cast',seq,ok,readyTick}, input-10hz/VGM-047).
 * The button shows the sticker and the word "Habilidade", the cooldown from the frames (skillTick/skillReadyTick) or
 * from the tap's own answer, "ainda não" for a tap during the cooldown (nothing is sent) and "sem alvo" when the room
 * answered ok:false. Mobile only (D-009). SkillTaps and skillState are pure (tests); SkillButton paints #coop-attack.
 */
import {SIM_HZ} from '../sim/types.ts';
import {kitFor} from '../sim/kits.ts';
import type {PlayerRunView} from '../sim/view.ts';
import {icon} from '../../ui/icon.ts';

/** How long a note ("ainda não", "sem alvo") replaces the word on the button. */
export const NOTE_MS=1200;
/** A sent tap the room never answered (socket dropped on the way) is forgotten quietly after this long. */
export const ANSWER_MS=5000;

export interface CastAnswer {seq:number;ok:boolean;readyTick:number}
export type TapResult='sent'|'cooling'|'off';
/**
 * One tap = one {t:'cast'} with a growing id. A tap during the cooldown sends nothing (the room would only answer
 * ok:false): the button says "ainda não" at once. `send` is CoopClient.cast: it returns undefined when the tap cannot
 * go out (offline, out of combat, watching, socket closing), the same checks as client.input.
 */
export class SkillTaps {
  private waiting?:{id:number;at:number};
  tap(cooling:boolean,send:()=>number|undefined,now:number):TapResult{
    if(cooling)return 'cooling';
    const id=send();
    if(id===undefined)return 'off';
    this.waiting={id,at:now};return 'sent';
  }
  /** The room's answer: 'cast' / 'none' (ok:false: no target, fallen…) for the tap we are waiting for; else undefined. */
  answer(result:CastAnswer,now:number):'cast'|'none'|undefined{
    const w=this.waiting;
    if(!w)return undefined;
    if(now-w.at>ANSWER_MS){this.waiting=undefined;return undefined;}
    if(result.seq!==w.id)return undefined;
    this.waiting=undefined;return result.ok?'cast':'none';
  }
  clear(){this.waiting=undefined;}
  get pending(){return this.waiting!==undefined;}
}

export interface SkillState {
  mode:'ready'|'cooling';
  /** Whole seconds left (cooling), rounded up: "3" until it is ready. */
  seconds:number;
  /** Share of the cooldown already paid, 0..1 (1 = ready). */
  progress:number;
}
/**
 * Cooldown of a player at a view tick, from the frame fields (0 or absent = never cast). `answered` is the readyTick
 * of the tap's own answer, so the ring starts before the next frame; the frame wins once it knows a later one.
 */
export function skillState(player:Pick<PlayerRunView,'skillTick'|'skillReadyTick'>|undefined,tick:number,answered?:{castTick:number;readyTick:number}):SkillState{
  let ready=player?.skillReadyTick??0,cast=player?.skillTick??0;
  if(answered&&answered.readyTick>ready){ready=answered.readyTick;cast=answered.castTick;}
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
/** The word under the sticker, and the two notes that briefly take its place. */
export const SKILL_WORD='Habilidade',NOTE_COOLING='ainda não',NOTE_NO_TARGET='sem alvo';

/** Ring circumference in the ring's own units (pathLength). */
const RING=100;
/** Paints #coop-attack: sticker + "Habilidade", cooldown ring and seconds, and the short notes. */
export class SkillButton {
  readonly taps=new SkillTaps();
  readonly el:HTMLButtonElement;
  private note='';private noteUntil=0;
  private tick=0;private player?:PlayerRunView;
  private answered?:{castTick:number;readyTick:number};
  private state:SkillState={mode:'ready',seconds:0,progress:1};
  private fill:SVGCircleElement;private time:HTMLElement;private word:HTMLElement;
  constructor(el:HTMLButtonElement,classId:string){
    this.el=el;
    el.setAttribute('aria-label',skillLabel(classId));
    el.dataset.state='ready';
    // The weapon icon of each class comes with the item stickers (DSG-adesivos-itens); the bread bag is the generic one (§2.4).
    el.innerHTML=`<svg class="skillbtn-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="skillbtn-track" cx="50" cy="50" r="46"/><circle class="skillbtn-fill" cx="50" cy="50" r="46" pathLength="${RING}"/></svg>`
      +`<span class="skillbtn-face" aria-hidden="true">${icon('sacola',{size:32,className:'skillbtn-icon'})}<span class="skillbtn-time"></span></span><span class="skillbtn-word" aria-hidden="true">${SKILL_WORD}</span>`;
    this.fill=el.querySelector('.skillbtn-fill')!;this.time=el.querySelector('.skillbtn-time')!;this.word=el.querySelector('.skillbtn-word')!;
    this.paint();
  }
  /** A tap on the button: sends through `send` (CoopClient.cast) unless the skill is still cooling. */
  tap(send:()=>number|undefined,now:number):TapResult{
    const result=this.taps.tap(this.state.mode==='cooling',send,now);
    if(result==='cooling')this.flash(NOTE_COOLING,now);
    return result;
  }
  /** The room's answer to a tap (CoopClient.onCast). */
  answer(result:CastAnswer,now:number){
    const verdict=this.taps.answer(result,now);
    if(verdict==='cast'&&result.readyTick>0)this.answered={castTick:this.tick,readyTick:result.readyTick};
    if(verdict==='none')this.flash(NOTE_NO_TARGET,now);
    else this.refresh(now);
  }
  /** Each authoritative view: the local player's cooldown. */
  update(player:PlayerRunView|undefined,tick:number,now:number){
    this.player=player;this.tick=tick;
    if(this.answered&&(player?.skillReadyTick??0)>=this.answered.readyTick)this.answered=undefined;
    this.refresh(now);
  }
  /** Run reset (rematch): ready, nothing pending. */
  reset(){this.taps.clear();this.answered=undefined;this.player=undefined;this.note='';this.noteUntil=0;this.state={mode:'ready',seconds:0,progress:1};this.paint();}
  private flash(note:string,now:number){this.note=note;this.noteUntil=now+NOTE_MS;this.refresh(now,true);}
  private refresh(now:number,force=false){
    const next=skillState(this.player,this.tick,this.answered);
    const note=now<this.noteUntil?this.note:'';
    if(!force&&next.mode===this.state.mode&&next.seconds===this.state.seconds&&Math.abs(next.progress-this.state.progress)<.01&&note===(this.el.dataset.note??''))return;
    this.state=next;this.el.dataset.note=note;this.paint();
  }
  private paint(){
    const s=this.state,note=this.el.dataset.note??'';
    this.el.dataset.state=s.mode;
    this.fill.style.strokeDashoffset=String(RING*(1-s.progress));
    this.time.textContent=s.mode==='cooling'?String(s.seconds):'';
    this.word.textContent=note||SKILL_WORD;
  }
}
