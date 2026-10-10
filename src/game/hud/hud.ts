/**
 * Run HUD (VGM-040): DOM overlay over the game canvas, driven only by RunView.
 * The root ignores pointer events; only interactive panels opt back in and stop propagation,
 * so tapping the HUD never moves the character or reaches the joystick/canvas.
 */
import './hud.css';
import './you.css';
import type {RunView} from '../sim/view.ts';
import {applyEvents,emptyTally,resetTally,type HudContext,type HudPart,type RunResult,type RunTally} from './model.ts';
import {createTopBar,createAnnouncer} from './topbar.ts';
import {createOfferPanel} from './offer.ts';
import {createTeamStrip,createReviveAlerts} from './team.ts';
import {createResultScreen} from './result.ts';
import {getAudio} from '../audio/engine.ts';
import {createHurtFrame} from './hurt.ts';
import {chooseSlot,measureZones,veiled,type Rect,type ScreenZones} from './zones.ts';
import './zones.css';

export interface RunHudOptions {
  localId:string;
  onChoose(offerId:string,index:number):void;
  onRematch?():void;
  onExit?():void;
  /** Defaults to the approved portraits under /art/portraits. */
  portrait?(classId:string,detailed?:boolean):string;
  /** Critter sticker for "what got you" (the scene hands the horde atlas texture as a data URL). */
  critterIcon?(kind:string):string|undefined;
  /** Stamp feedback when an offer is picked; defaults to the "carimbo" sound (with its 15 ms buzz). */
  onStamp?():void;
}

/** Runs inside the pick's tap, so it may unlock the audio engine (iOS needs a gesture) before the "tum". */
export function playStamp(){
  const audio=getAudio();
  if(!audio.unlocked)audio.unlock();
  audio.play('carimbo');
}

/** Clearance kept between the hero's sprite and the center banner, in CSS px. */
export const HERO_MARGIN_PX=40;

export const defaultPortrait=(classId:string,detailed=false)=>`/art/portraits/${classId}${detailed?'':'-thumb'}.webp`;

export class RunHud {
  readonly el:HTMLElement;
  readonly tally:RunTally=emptyTally();
  private readonly parts:HudPart[];
  private readonly result;
  private readonly ctx:HudContext;
  private last?:RunView;
  private readonly stack:HTMLElement;
  private readonly alerts:HudPart;
  private readonly hurt:ReturnType<typeof createHurtFrame>;
  /** Banner box measured in its normal (top) slot, so the low slot can be left once the hero walks away. */
  private topSlot?:Rect;
  /** Bumps on window resize or when a HUD part changes size (ResizeObserver): cached boxes are read again only then. */
  private layoutVersion=0;
  private rowsKey='';private rowsVersion=-1;private rowsBox?:Rect;
  private readouts:{el:HTMLElement;rect:Rect}[]=[];private readoutVersion=-1;
  private zonesCache?:ScreenZones;private zonesVersion=-1;private zonesFresh=false;
  private readonly relayout=()=>{this.layoutVersion++;};
  private observer?:ResizeObserver;

  constructor(parent:HTMLElement,options:RunHudOptions){
    this.ctx={localId:options.localId,portrait:options.portrait??defaultPortrait,tally:this.tally,critterIcon:options.critterIcon};
    this.el=document.createElement('div');
    this.el.className='rh';
    this.el.setAttribute('aria-label','Placar da partida');
    const stack=document.createElement('div');stack.className='rh-stack';
    const hurt=createHurtFrame(),top=createTopBar(),announcer=createAnnouncer(),team=createTeamStrip(),alerts=createReviveAlerts(),offer=createOfferPanel({onChoose:options.onChoose,onStamp:options.onStamp??playStamp});
    this.result=createResultScreen({onRematch:()=>options.onRematch?.(),onExit:options.onExit?()=>options.onExit?.():undefined});
    // The stack is the top band's announcement slot (UX-zonas-tela): the round/boss banner, then the one notice.
    stack.append(announcer.el,alerts.el);this.stack=stack;this.alerts=alerts;
    this.hurt=hurt;this.parts=[hurt,top,announcer,team,alerts,offer];
    this.el.append(hurt.el,top.el,stack,team.el,offer.el,offer.chip,offer.hint,this.result.el);
    // Interactive panels must not leak taps to the canvas/joystick underneath.
    // Passive readouts (round chip, XP, boss bar, team strip, revive alerts) also swallow taps (VGM-043: a tap on the
    // round chip used to walk the hero towards the sea). Only the empty space between them reaches the game.
    for(const panel of [offer.el,offer.chip,this.result.el,top.el,team.el,alerts.el])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)panel.addEventListener(type,event=>event.stopPropagation());
    parent.append(this.el);
    addEventListener('resize',this.relayout);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.relayout);for(const part of [top.el,team.el,stack,offer.el])this.observer.observe(part);}
  }

  update(view:RunView){
    this.last=view;
    applyEvents(this.tally,view);
    // On the result the run is over: no damage edge (it would frame the result screen).
    for(const part of this.parts)if(part!==this.hurt||!this.el.classList.contains('rh-ended'))part.update(view,this.ctx);
    // One row in the announcement slot: a fall/rescue/connection notice outranks the round name (danger over the joke).
    const marquee=this.stack.querySelector<HTMLElement>('.rh-marquee');
    // The offer window outranks it too (design onda 3 B4): the banner shrinks into the round chip at once.
    if(marquee&&!marquee.hidden&&this.stack.querySelector('.rh-alert:not([hidden])'))marquee.hidden=true;
    if(marquee&&!marquee.hidden&&this.el.querySelector('.rh-offer:not([hidden])'))marquee.hidden=true;
  }

  showResult(result:RunResult){
    this.el.classList.add('rh-ended');this.hurt.reset();
    this.result.show(result,this.ctx);
  }

  /** Hides the result and starts a fresh tally: call on rematch so awards and kills do not carry over. */
  hideResult(){
    this.el.classList.remove('rh-ended');
    this.result.hide();
    this.reset();
  }

  /** Connection banner (VGM-043): shown over everything in the center stack while the socket is down. */
  setNetwork(text?:string){
    if(this.ctx.network===text)return;
    this.ctx.network=text;
    if(this.last)this.alerts.update(this.last,this.ctx);
  }

  /**
   * Keeps the center banner off the hero (UX checklist B2: hero rect ±40 px). The banner moves to the low slot
   * while its top slot would cross the hero, and comes back when the top slot is clear again.
   */
  avoidHero(hero:Rect|undefined,margin=HERO_MARGIN_PX){
    if(!hero)return;
    this.veil(hero,margin);
    const rows=[...this.stack.querySelectorAll<HTMLElement>('.rh-marquee:not([hidden]),.rh-alert:not([hidden])')];
    if(!rows.length)return;
    const low=this.stack.classList.contains('rh-stack-low');
    // Layout is read only when it can have changed: rows shown/hidden, slot switched, or a resize (window or HUD part).
    const key=`${rows.map(r=>r.className).join('|')}:${low}`;
    if(key!==this.rowsKey||this.rowsVersion!==this.layoutVersion||!this.rowsBox){
      this.rowsKey=key;this.rowsVersion=this.layoutVersion;
      const r=rows.map(el=>el.getBoundingClientRect()),x=Math.min(...r.map(b=>b.left)),y=Math.min(...r.map(b=>b.top));
      this.rowsBox={x,y,width:Math.max(...r.map(b=>b.right))-x,height:Math.max(...r.map(b=>b.bottom))-y};
      if(!low)this.topSlot=this.rowsBox;
      // In the low slot the rows may be taller or fewer now: keep the top slot's place with the rows' size.
      else if(this.topSlot)this.topSlot={...this.topSlot,height:this.rowsBox.height,width:Math.max(this.topSlot.width,this.rowsBox.width)};
    }
    if(!this.topSlot)return;
    const lowSlot=low?this.rowsBox:{...this.topSlot,y:innerHeight};
    const slot=chooseSlot([this.topSlot,lowSlot],hero,margin);
    if(this.stack.classList.contains('rh-stack-low')!==(slot===1))this.stack.classList.toggle('rh-stack-low',slot===1);
  }
  /**
   * While the camera does not follow the hero (whole-island framing), the hero can walk under the top band or the team
   * strip: those passive readouts go see-through (rh-veiled) so they never hide the hero, and come back when it leaves.
   * Their boxes are cached until the layout changes (the veil only changes opacity, not layout).
   */
  private veil(hero:Rect,margin:number){
    const readouts=[...this.el.querySelectorAll<HTMLElement>('.rh-round,.rh-xp,.rh-boss,.rh-member')];
    if(this.readoutVersion!==this.layoutVersion||readouts.length!==this.readouts.length||readouts.some((el,i)=>this.readouts[i]?.el!==el)){
      this.readoutVersion=this.layoutVersion;
      this.readouts=readouts.map(el=>{const r=el.getBoundingClientRect();return {el,rect:{x:r.left,y:r.top,width:r.width,height:r.height}};});
    }
    veiled(this.readouts,hero,margin).forEach((under,i)=>{const el=this.readouts[i].el;if(el.classList.contains('rh-veiled')!==under)el.classList.toggle('rh-veiled',under);});
  }
  /** The zones of the current layout (top band, team, thumbs, useful area), for the camera and the audit; cached per layout. */
  zones(){
    if(!this.zonesCache||this.zonesVersion!==this.layoutVersion){this.zonesVersion=this.layoutVersion;this.zonesCache=measureZones(this.el.ownerDocument);this.zonesFresh=true;}
    return this.zonesCache;
  }
  /** The zones only when they changed since the last call (resize, rotation, HUD part resized), else undefined. */
  zonesIfChanged(){const zones=this.zones();if(!this.zonesFresh)return undefined;this.zonesFresh=false;return zones;}

  /** The room refused the rematch (042a R2): the result button stops "waiting for the gang" and shows `label`. */
  rematchRefused(label:string){this.result.refuse(label);}

  /** New run (rematch): clears the per-run tally; event de-duplication keeps working across runs. */
  reset(){
    resetTally(this.tally);
  }

  get view(){return this.last;}

  destroy(){
    removeEventListener('resize',this.relayout);this.observer?.disconnect();
    for(const part of this.parts)part.destroy?.();
    this.result.destroy();
    this.el.remove();
  }
}
