/**
 * Run HUD (VGM-040): DOM overlay over the game canvas, driven only by RunView.
 * The root ignores pointer events; only interactive panels opt back in and stop propagation,
 * so tapping the HUD never moves the character or reaches the joystick/canvas.
 */
import './hud.css';
import type {RunView} from '../sim/view.ts';
import {applyEvents,emptyTally,resetTally,type HudContext,type HudPart,type RunResult,type RunTally} from './model.ts';
import {createTopBar,createAnnouncer} from './topbar.ts';
import {createOfferPanel} from './offer.ts';
import {createTeamStrip,createReviveAlerts} from './team.ts';
import {createResultScreen} from './result.ts';

export interface RunHudOptions {
  localId:string;
  onChoose(offerId:string,index:number):void;
  onRematch?():void;
  onExit?():void;
  /** Defaults to the approved portraits under /art/portraits. */
  portrait?(classId:string,detailed?:boolean):string;
}

export const defaultPortrait=(classId:string,detailed=false)=>`/art/portraits/${classId}${detailed?'':'-thumb'}.webp`;

export class RunHud {
  readonly el:HTMLElement;
  readonly tally:RunTally=emptyTally();
  private readonly parts:HudPart[];
  private readonly result;
  private readonly ctx:HudContext;
  private last?:RunView;

  constructor(parent:HTMLElement,options:RunHudOptions){
    this.ctx={localId:options.localId,portrait:options.portrait??defaultPortrait,tally:this.tally};
    this.el=document.createElement('div');
    this.el.className='rh';
    this.el.setAttribute('aria-label','Placar da partida');
    const stack=document.createElement('div');stack.className='rh-stack';
    const top=createTopBar(),announcer=createAnnouncer(),team=createTeamStrip(),alerts=createReviveAlerts(),offer=createOfferPanel({onChoose:options.onChoose});
    this.result=createResultScreen({onRematch:()=>options.onRematch?.(),onExit:options.onExit?()=>options.onExit?.():undefined});
    stack.append(alerts.el);
    this.parts=[top,announcer,team,alerts,offer];
    this.el.append(top.el,stack,team.el,offer.el,announcer.el,this.result.el);
    // Interactive panels must not leak taps to the canvas/joystick underneath.
    // Passive readouts (round chip, XP, boss bar, team strip, revive alerts) also swallow taps (VGM-043: a tap on the
    // round chip used to walk the hero towards the sea). Only the empty space between them reaches the game.
    for(const panel of [offer.el,this.result.el,top.el,team.el,alerts.el])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)panel.addEventListener(type,event=>event.stopPropagation());
    parent.append(this.el);
  }

  update(view:RunView){
    this.last=view;
    applyEvents(this.tally,view);
    for(const part of this.parts)part.update(view,this.ctx);
  }

  showResult(result:RunResult){
    this.el.classList.add('rh-ended');
    this.result.show(result,this.ctx);
  }

  /** Hides the result and starts a fresh tally: call on rematch so awards and kills do not carry over. */
  hideResult(){
    this.el.classList.remove('rh-ended');
    this.result.hide();
    this.reset();
  }

  /** The room refused the rematch (042a R2): the result button stops "waiting for the gang" and shows `label`. */
  rematchRefused(label:string){this.result.refuse(label);}

  /** New run (rematch): clears the per-run tally; event de-duplication keeps working across runs. */
  reset(){
    resetTally(this.tally);
  }

  get view(){return this.last;}

  destroy(){
    for(const part of this.parts)part.destroy?.();
    this.result.destroy();
    this.el.remove();
  }
}
