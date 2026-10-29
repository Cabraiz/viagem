/**
 * Skill button of the run (NEW-20261006-E7-skill-hud-wiring): one tap casts the class skill once through the room's
 * tap message (`CoopClient.cast()` → {t:'cast',round,id}, answered by {t:'cast',seq,ok,readyTick}, input-10hz/VGM-047).
 * The button shows the sticker and the word "Habilidade", the cooldown from the frames (skillTick/skillReadyTick) or
 * from the tap's own answer, "ainda não" for a tap during the cooldown (nothing is sent) and "sem alvo" when the room
 * answered ok:false. Mobile only (D-009). SkillTaps and skillState are pure (tests); SkillButton paints #coop-attack.
 * D-051 manual combat (step 2): the same slot is the action button, the class skill or the attack after the room's
 * CombatMode (setCombat): in 'manual' it says "Atacar", has no cooldown ring (the weapon's own cooldown is the server's)
 * and shows `data-held` while pressed; hud/attack-button.ts handles its press, hold and drag. Same ids, same place.
 * construir-no-botao (the user, 23/10): with a kit de torre selected (hud/kit-place) the same button says "Construir"
 * with the kit's sticker (setBuild); `data-build=bloqueado` greys it while the ghost is red.
 */
import {SIM_HZ} from '../../contract/index.ts';
import {kitFor} from '../../rules/index.ts';
import type {BicoId,CombatMode,PlayerRunView} from '../../contract/index.ts';
import {icon} from '../ui/icon.ts';
import {getAudio} from '../audio/engine.ts';
import {sticker,stickerOrIcon,type StickerName} from '../ui/sticker.ts';
import {itemDisplay} from './items.ts';
import {WORKING_WORD,WORK_WORD,workLabel,workingLabel} from './bicos.ts';
import {dancePlan} from '../sprites/movement128.ts';

/** How long a note ("ainda não", "sem alvo") replaces the word on the button. */
export const NOTE_MS=1200;
/** A sent tap the room never answered (socket dropped on the way) is forgotten quietly after this long. */
export const ANSWER_MS=5000;

export interface CastAnswer {seq:number;ok:boolean;readyTick:number}
/** 'waiting': the last tap is still unanswered; nothing is sent again until the room answers (or ANSWER_MS passes). */
export type TapResult='sent'|'cooling'|'waiting'|'off';
/**
 * One tap = one {t:'cast'} with a growing id. A tap during the cooldown sends nothing (the room would only answer
 * ok:false): the button says "ainda não" at once. `send` is CoopClient.cast: it returns undefined when the tap cannot
 * go out (offline, out of combat, watching, socket closing), the same checks as client.input.
 */
export class SkillTaps {
  private waiting?:{id:number;at:number};
  tap(cooling:boolean,send:()=>number|undefined,now:number):TapResult{
    if(cooling)return 'cooling';
    if(this.waiting&&now-this.waiting.at<=ANSWER_MS)return 'waiting';
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
/** D-051 manual combat: the word and the accessible name of the attack button. */
export const ATTACK_WORD='Atacar',ATTACK_LABEL='Atacar: toque para um ataque, segure para atacar sem parar, arraste para mirar';
/** construir-no-botao: the word and the accessible name while a kit de torre is selected. */
export const BUILD_WORD='Construir';
/**
 * torre-limite-rebocar-sem-arma: at the Uno's rope end the action button tows ("Rebocar": {t:'puxar',on:true}); on the
 * rope it lets go ("Soltar"). The face comes from hud/fortify/model.ts towFace.
 */
/**
 * torre-limite-rebocar-sem-arma: empty hands (the heroes start with no weapon) show on the attack button with the crate
 * icon (the first crate gives a weapon). Card exploracao-espera-carregar-e-sem-arma (the user, 28/10): with empty hands
 * the button dances ("Dançar": a tap or Space dances at once, sprites/hero-dance.ts); the first time in a run it says
 * "Abra uma caixa" for UNARMED_HINT_MS.
 */
export const UNARMED_WORD='Dançar',UNARMED_LABEL='Dançar (sem arma: abra uma caixa para pegar uma)';
export const NOTE_OPEN_CRATE='Abra uma caixa para pegar uma arma',UNARMED_HINT_MS=4000;
/**
 * The Dançar icon: one pose of the hero's own in-game dance (sprites/movement128.ts dancePlan, the sheet the dance
 * plays from), the figure fitted in `size` px; '' when the class has no dance sheet (the crate icon stays).
 */
export function danceIcon(classId:string,size=40):string{
  const plan=dancePlan(classId);
  if(!plan)return '';
  const cell=96,f=plan.figure,k=size/Math.max(f.right-f.left,f.bottom-f.top);
  const frame=Math.floor(plan.frameCount/4),col=frame%plan.columns,row=Math.floor(frame/plan.columns);
  const x=size/2-(col*cell+(f.left+f.right)/2)*k,y=size-(row*cell+f.bottom)*k;
  const px=(n:number)=>`${Math.round(n*10)/10}px`;
  return `<span class="skillbtn-icon skillbtn-danca" style="width:${size}px;height:${size}px;background:url('${plan.url}') ${px(x)} ${px(y)}/${px(plan.columns*cell*k)} ${px(plan.rows*cell*k)} no-repeat"></span>`;
}
export const TOW_WORD='Rebocar',TOW_OFF_WORD='Soltar',TOW_LABEL='Rebocar o Uno: toque para pegar a corda',TOW_OFF_LABEL='Soltar a corda';
export const buildLabel=(kitId:string)=>`Construir ${itemDisplay(kitId).name} à sua frente`;
/** What the action button shows with a kit selected (or not): its word, its sticker ('' the attack's own) and its name. */
export function actionFace(combat:CombatMode,classId:string,handIcon:StickerName|'',kitId?:string):{word:string;icon:StickerName|'';label:string}{
  if(kitId)return {word:BUILD_WORD,icon:itemDisplay(kitId).icon,label:buildLabel(kitId)};
  if(combat==='manual')return {word:ATTACK_WORD,icon:handIcon,label:ATTACK_LABEL};
  return {word:SKILL_WORD,icon:'',label:skillLabel(classId)};
}

/** Ring circumference in the ring's own units (pathLength). */
const RING=100;
/** Paints #coop-attack: sticker + "Habilidade", cooldown ring and seconds, and the short notes. */
/**
 * The sticker of the weapon in the hand (atacar-arma-na-mao, the user, 23/10: "a arma selecionada deve ficar no atacar"):
 * the inventory's slot `hand` (hud/inventory.ts inventorySlots); undefined without a hand or with an empty one.
 */
export function attackIconOf(player:Pick<PlayerRunView,'weapons'|'hand'>|undefined){
  const item=player&&player.hand!==undefined?player.weapons?.[player.hand]:undefined;
  return item?itemDisplay(item.id).icon:undefined;
}

export class SkillButton {
  readonly taps=new SkillTaps();
  readonly el:HTMLButtonElement;
  private note='';private noteUntil=0;
  private tick=0;private player?:PlayerRunView;
  private answered?:{castTick:number;readyTick:number};
  private state:SkillState={mode:'ready',seconds:0,progress:1};
  private fill:SVGCircleElement;private time:HTMLElement;private word:HTMLElement;
  private combat:CombatMode='auto';
  /** The weapon sticker on the attack button right now ('' the generic attack sticker). */
  private handIcon:StickerName|''='';
  /** The selected kit de torre (construir-no-botao), undefined with a weapon. */
  private kit?:string;
  /** Manual combat with nothing in the hand (setUnarmed): "Dançar". */
  private unarmed=false;
  /** "Abra uma caixa" was already said in this run (once, the first time the hands are empty). */
  private hinted=false;
  /** The island is on screen (explore.ts hooks.ready): the note waits for it, not for the loading screen. */
  visible=false;
  /** The rope face (setTow): 'rebocar' or 'soltar', undefined for Atacar. */
  private tow?:'rebocar'|'soltar';
  /** Bicos: 'oferta|<bico>' or 'dentro|<bico>' while the slot is Trabalhar, undefined otherwise. */
  private work?:string;
  private readonly classId:string;
  constructor(el:HTMLButtonElement,classId:string){
    this.el=el;this.classId=classId;
    el.setAttribute('aria-label',skillLabel(classId));
    el.dataset.state='ready';
    // The weapon icon of each class comes with the item stickers (DSG-adesivos-itens); the bread bag is the generic one (§2.4).
    el.innerHTML=`<svg class="skillbtn-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="skillbtn-track" cx="50" cy="50" r="46"/><circle class="skillbtn-fill" cx="50" cy="50" r="46" pathLength="${RING}"/></svg>`
      +`<span class="skillbtn-face" aria-hidden="true">${icon('sacola',{size:40,className:'skillbtn-icon'})}<span class="skillbtn-time"></span></span><span class="skillbtn-word" aria-hidden="true">${SKILL_WORD}</span>`;
    this.fill=el.querySelector('.skillbtn-fill')!;this.time=el.querySelector('.skillbtn-time')!;this.word=el.querySelector('.skillbtn-word')!;
    this.paint();
  }
  /** The room's CombatMode (CoopClient.combat): 'manual' turns the slot into the attack button (no-op when unchanged). */
  setCombat(combat:CombatMode){
    if(combat===this.combat)return;
    this.combat=combat;this.kit=undefined;delete this.el.dataset.build;this.taps.clear();this.answered=undefined;this.note='';this.noteUntil=0;
    this.el.dataset.action=combat==='manual'?'attack':'skill';
    this.el.setAttribute('aria-label',combat==='manual'?ATTACK_LABEL:skillLabel(this.classId));
    // Manual: the attack sticker (ui/atacar; the chinelo without that art) until update() sees the weapon in the hand.
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(old)old.outerHTML=combat==='manual'?stickerOrIcon('atacar','chinelo',options):icon('sacola',options);
    this.handIcon='';
    this.state={mode:'ready',seconds:0,progress:1};this.el.dataset.note='';this.paint();
  }
  get attackMode(){return this.combat==='manual';}
  /** The kit de torre selected (Construir with its sticker) or undefined (back to Atacar); `blocked` greys it (red ghost). */
  setBuild(kitId:string|undefined,blocked=false){
    const look=kitId?(blocked?'bloqueado':'ok'):undefined;
    if(look!==this.el.dataset.build){if(look)this.el.dataset.build=look;else delete this.el.dataset.build;}
    if(kitId===this.kit)return;
    if(this.unarmed){this.unarmed=false;delete this.el.dataset.unarmed;}
    this.kit=kitId;
    const face=actionFace(this.combat,this.classId,'',kitId);
    this.el.setAttribute('aria-label',face.label);
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(old){
      // Back from Construir: the weapon in the hand (or the generic sticker) comes back on the next update().
      if(face.icon)old.outerHTML=sticker(face.icon,options);
      else old.outerHTML=this.combat==='manual'?stickerOrIcon('atacar','chinelo',options):icon('sacola',options);
    }
    this.handIcon='';
    if(!kitId&&this.combat==='manual')this.showHand(attackIconOf(this.player)??'');
    this.paint();
  }
  get building(){return this.kit!==undefined;}
  /**
   * Bicos (hud/bicos.ts): standing in an open shop's ring the slot says Trabalhar in the interaction colour
   * (`data-work=oferta`), inside the shift "No turno" (`data-work=dentro`); undefined goes back to Atacar or Construir.
   */
  setWork(work:{bico:BicoId;inside:boolean}|undefined){
    const look=work?(work.inside?'dentro':'oferta'):undefined,key=work?`${look}|${work.bico}`:undefined;
    if(key===this.work)return;
    if(this.unarmed){this.unarmed=false;delete this.el.dataset.unarmed;}
    const was=this.work;this.work=key;
    if(look)this.el.dataset.work=look;else delete this.el.dataset.work;
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(work){
      this.el.setAttribute('aria-label',work.inside?workingLabel(work.bico):workLabel(work.bico));
      if(old&&!was)old.outerHTML=icon('caixa-eletronico',options);
    }else{
      const face=actionFace(this.combat,this.classId,'',this.kit);
      this.el.setAttribute('aria-label',face.label);
      if(old)old.outerHTML=face.icon?sticker(face.icon,options):this.combat==='manual'?stickerOrIcon('atacar','chinelo',options):icon('sacola',options);
      this.handIcon='';
      if(!this.kit&&this.combat==='manual')this.showHand(attackIconOf(this.player)??'');
    }
    this.paint();
  }
  get working(){return this.work!==undefined;}
  /**
   * The Uno's rope (torre-limite-rebocar-sem-arma): 'rebocar' at its free end, 'soltar' on it (`data-tow`, the rope
   * sticker); undefined goes back to Atacar. Construir and Trabalhar win over it (the caller passes undefined then).
   */
  setTow(face:'rebocar'|'soltar'|undefined){
    if(face===this.tow)return;
    if(this.unarmed){this.unarmed=false;delete this.el.dataset.unarmed;}
    const was=this.tow;this.tow=face;
    if(face)this.el.dataset.tow=face;else delete this.el.dataset.tow;
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(face){
      this.el.setAttribute('aria-label',face==='soltar'?TOW_OFF_LABEL:TOW_LABEL);
      if(old&&!was)old.outerHTML=icon('corda',options);
    }else{
      const look=actionFace(this.combat,this.classId,'',this.kit);
      this.el.setAttribute('aria-label',look.label);
      if(old)old.outerHTML=look.icon?sticker(look.icon,options):this.combat==='manual'?stickerOrIcon('atacar','chinelo',options):icon('sacola',options);
      this.handIcon='';
      if(!this.kit&&this.combat==='manual')this.showHand(attackIconOf(this.player)??'');
    }
    this.paint();
  }
  get towing(){return this.tow;}
  /** Attack button pressed or let go (manual combat): `data-held` for the CSS. */
  setHeld(held:boolean){if(held)this.el.dataset.held='';else delete this.el.dataset.held;}
  /** A tap on the button: sends through `send` (CoopClient.cast) unless the skill is still cooling. */
  tap(send:()=>number|undefined,now:number):TapResult{
    if(this.attackMode)return 'off';
    const result=this.taps.tap(this.state.mode==='cooling',send,now);
    if(result==='cooling')this.flash(NOTE_COOLING,now);
    return result;
  }
  /** The room's answer to a tap (CoopClient.onCast). */
  answer(result:CastAnswer,now:number){
    const verdict=this.taps.answer(result,now);
    if(verdict==='cast'&&result.readyTick>0)this.answered={castTick:this.tick,readyTick:result.readyTick};
    // NEW-20261029-ORQ-som-golpe-e-resgate: "sem alvo" is heard too, a low "tsc".
    if(verdict==='none'){this.flash(NOTE_NO_TARGET,now);const audio=getAudio();if(audio.unlocked)audio.play('tsc');}
    else this.refresh(now);
  }
  /** Each authoritative view: the local player's cooldown. */
  update(player:PlayerRunView|undefined,tick:number,now:number){
    this.player=player;this.tick=tick;
    const free=this.combat==='manual'&&!this.kit&&!this.work&&!this.tow;
    this.setUnarmed(free&&!!player&&attackIconOf(player)===undefined);
    if(this.unarmed&&this.visible&&!this.hinted){this.hinted=true;this.flash(NOTE_OPEN_CRATE,now,UNARMED_HINT_MS);}
    if(free&&!this.unarmed)this.showHand(attackIconOf(player)??'');
    if(this.answered&&(player?.skillReadyTick??0)>=this.answered.readyTick)this.answered=undefined;
    this.refresh(now);
  }
  /** Manual combat: the button shows the weapon in the hand; with none, the generic attack sticker. */
  private setUnarmed(on:boolean){
    if(on===this.unarmed)return;
    this.unarmed=on;
    if(on)this.el.dataset.unarmed='';else delete this.el.dataset.unarmed;
    // Construir, Trabalhar and Rebocar keep their own face (they set it back through setBuild/setWork/setTow).
    if(this.kit||this.work||this.tow){this.paint();return;}
    this.el.setAttribute('aria-label',on?UNARMED_LABEL:actionFace(this.combat,this.classId,'',this.kit).label);
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(old)old.outerHTML=on?danceIcon(this.classId)||icon('bau',options):stickerOrIcon('atacar','chinelo',options);
    this.handIcon='';
    this.paint();
  }
  private showHand(name:StickerName|''){
    if(name===this.handIcon)return;
    const old=this.el.querySelector('.skillbtn-icon'),options={size:40,className:'skillbtn-icon'} as const;
    if(!old)return;
    this.handIcon=name;
    old.outerHTML=name?sticker(name,options):stickerOrIcon('atacar','chinelo',options);
  }
  /** Empty hands in the manual combat: the button dances (Dançar) instead of attacking. */
  get dancing(){return this.unarmed;}
  /** Run reset (rematch): ready, nothing pending. */
  reset(){this.hinted=false;this.taps.clear();this.answered=undefined;this.player=undefined;this.note='';this.noteUntil=0;this.state={mode:'ready',seconds:0,progress:1};this.setHeld(false);this.paint();}
  private flash(note:string,now:number,ms=NOTE_MS){this.note=note;this.noteUntil=now+ms;this.refresh(now,true);}
  /** The note on screen right now ('' none): CSS reads it to drop the green "ready" ring under "sem alvo". */
  get shownNote(){return this.el.dataset.note??'';}
  private refresh(now:number,force=false){
    // The attack has no cooldown of its own on the button: always ready.
    const next=this.attackMode?{mode:'ready' as const,seconds:0,progress:1}:skillState(this.player,this.tick,this.answered);
    const note=now<this.noteUntil?this.note:'';
    if(!force&&next.mode===this.state.mode&&next.seconds===this.state.seconds&&Math.abs(next.progress-this.state.progress)<.01&&note===(this.el.dataset.note??''))return;
    this.state=next;this.el.dataset.note=note;this.paint();
  }
  private paint(){
    const s=this.state,note=this.el.dataset.note??'';
    this.el.dataset.state=s.mode;
    this.el.dataset.noteKind=note===NOTE_NO_TARGET?'sem-alvo':note===NOTE_COOLING?'ainda-nao':note===NOTE_OPEN_CRATE?'caixa':'';
    this.fill.style.strokeDashoffset=String(RING*(1-s.progress));
    this.time.textContent=s.mode==='cooling'?String(s.seconds):'';
    this.word.textContent=note||(this.work?(this.work.startsWith('dentro')?WORKING_WORD:WORK_WORD):this.kit?BUILD_WORD:this.tow?(this.tow==='soltar'?TOW_OFF_WORD:TOW_WORD):this.unarmed?UNARMED_WORD:this.attackMode?ATTACK_WORD:SKILL_WORD);
  }
}
