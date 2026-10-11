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
import {createCamp,type CampPart,type ForgeAnswer,type HeroSpot} from './camp.ts';
import type {RecipeId} from '../sim/stonewards/rules.ts';
import './zones.css';
import {EdgeArrows} from './edges.ts';
import {Minimap} from './minimap.ts';
import './camp.css';

export interface RunHudOptions {
  localId:string;
  onChoose(offerId:string,index:number):void;
  onRematch?():void;
  onExit?():void;
  /** Defaults to the approved portraits under /art/portraits. */
  portrait?(classId:string,detailed?:boolean):string;
  /** Critter sticker for "what got you" (the scene hands the horde atlas texture as a data URL). */
  critterIcon?(kind:string):string|undefined;
  /**
   * Real game (explore.ts): falls and rescues are read in the world, so the HUD mounts the edge arrows and the minimap
   * (driven every frame by the caller) and the fall/rescue banners leave the top band (UX-resgate-e-ping).
   */
  worldRescue?:boolean;
  /** Stamp feedback when an offer is picked; defaults to the "carimbo" sound (with its 15 ms buzz). */
  onStamp?():void;
  /** Forge tap (VGM-046B): sends the purchase, returns its request id (undefined: cannot reach the room now). */
  onForge?(recipe:RecipeId):number|undefined;
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
  /** Base ficha, forge window and horn notice (VGM-046B, hud/camp.ts). */
  private readonly camp:CampPart;
  /** Banner box measured in its normal (top) slot, so the low slot can be left once the hero walks away. */
  private topSlot?:Rect;
  /** Bumps on window resize or when a HUD part changes size (ResizeObserver): cached boxes are read again only then. */
  private layoutVersion=0;
  private rowsKey='';private rowsVersion=-1;private rowsBox?:Rect;
  private readouts:{el:HTMLElement;rect:Rect}[]=[];private readoutVersion=-1;
  private zonesCache?:ScreenZones;private zonesVersion=-1;private zonesFresh=false;
  private readonly relayout=()=>{this.layoutVersion++;};
  private observer?:ResizeObserver;
  /** Edge arrows and minimap (UX-bordas-fora-da-tela, ORQ-minimapa); only with worldRescue. */
  readonly edges?:EdgeArrows;
  readonly minimap?:Minimap;

  constructor(parent:HTMLElement,options:RunHudOptions){
    this.ctx={localId:options.localId,portrait:options.portrait??defaultPortrait,tally:this.tally,critterIcon:options.critterIcon,worldRescue:options.worldRescue};
    this.el=document.createElement('div');
    this.el.className='rh';
    this.el.setAttribute('aria-label','Placar da partida');
    const stack=document.createElement('div');stack.className='rh-stack';
    const hurt=createHurtFrame(),top=createTopBar(),announcer=createAnnouncer(),team=createTeamStrip(),alerts=createReviveAlerts(),offer=createOfferPanel({onChoose:options.onChoose,onStamp:options.onStamp??playStamp});
    this.result=createResultScreen({onRematch:()=>options.onRematch?.(),onExit:options.onExit?()=>options.onExit?.():undefined});
    const camp=this.camp=createCamp({onForge:recipe=>options.onForge?.(recipe)});
    // The base ficha is a status readout of the top band; the horn is a notice of the announcement slot.
    top.el.append(camp.readout);
    // The stack is the top band's announcement slot (UX-zonas-tela): the round/boss banner, then the one notice.
    stack.append(announcer.el,alerts.el,camp.notice);this.stack=stack;this.alerts=alerts;
    this.hurt=hurt;this.parts=[hurt,top,announcer,team,alerts,offer,camp];
    this.el.append(hurt.el,top.el,stack,team.el,offer.el,camp.forge,offer.chip,offer.hint,this.result.el);
    // Under the offer and the result (DOM order): arrows on the useful area's rim, the minimap in its corner.
    if(options.worldRescue){this.edges=new EdgeArrows(this.el);this.minimap=new Minimap(this.el);this.el.insertBefore(this.edges.el,offer.el);this.el.insertBefore(this.minimap.el,offer.el);}
    // Interactive panels must not leak taps to the canvas/joystick underneath.
    // Passive readouts (round chip, XP, boss bar, team strip, revive alerts) also swallow taps (VGM-043: a tap on the
    // round chip used to walk the hero towards the sea). Only the empty space between them reaches the game.
    for(const panel of [offer.el,offer.chip,this.result.el,top.el,team.el,alerts.el])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)panel.addEventListener(type,event=>event.stopPropagation());
    parent.append(this.el);
    addEventListener('resize',this.relayout);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.relayout);for(const part of [top.el,team.el,stack,offer.el,camp.forge,camp.readout,...(this.minimap?[this.minimap.el]:[])])this.observer.observe(part);}
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

  /** The room's answer to a forge tap (VGM-046B). */
  forged(answer:ForgeAnswer){this.camp.forged(answer);}
  /** The hero's predicted spot and the base's bearing on screen (explore.ts), for the forge and the horn arrow. */
  setHero(spot:HeroSpot|undefined){this.camp.setHero(spot);}

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

  private watchName?:string;private watchSince=0;
  /**
   * Out or watching (camera-segue): the teammate the camera follows. The "Você tá fora" notice stays 3 s, then the
   * banner says "Assistindo: Tia" (a tap on a team portrait changes who).
   */
  setWatching(name?:string,now=performance.now()){
    if(name!==this.watchName){if(!this.watchName&&name)this.watchSince=now;this.watchName=name;}
    const show=name&&now-this.watchSince>=3000?name:undefined;
    if(this.ctx.watching===show)return;
    this.ctx.watching=show;
    if(this.last)this.alerts.update(this.last,this.ctx);
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
   * Safety net: the follow camera keeps the hero in the useful area, but if the hero ever gets under the top band or
   * the team strip (resize, a HUD box that grew): those passive readouts go see-through (rh-veiled) so they never hide the hero, and come back when it leaves.
   * Their boxes are cached until the layout changes (the veil only changes opacity, not layout).
   */
  private veil(hero:Rect,margin:number){
    const readouts=[...this.el.querySelectorAll<HTMLElement>('.rh-round,.rh-xp,.rh-boss,.rh-member,.rh-camp')];
    if(this.readoutVersion!==this.layoutVersion||readouts.length!==this.readouts.length||readouts.some((el,i)=>this.readouts[i]?.el!==el)){
      this.readoutVersion=this.layoutVersion;
      this.readouts=readouts.map(el=>{const r=el.getBoundingClientRect();return {el,rect:{x:r.left,y:r.top,width:r.width,height:r.height}};});
    }
    veiled(this.readouts,hero,margin).forEach((under,i)=>{const el=this.readouts[i].el;if(el.classList.contains('rh-veiled')!==under)el.classList.toggle('rh-veiled',under);});
  }
  /** The zones of the current layout (top band, team, thumbs, useful area), for the camera and the audit; cached per layout. */
  zones(){
    if(!this.zonesCache||this.zonesVersion!==this.layoutVersion){
      this.zonesVersion=this.layoutVersion;this.zonesCache=measureZones(this.el.ownerDocument);this.zonesFresh=true;
      // Portrait with the minimap: the announcement slot starts where the zones say (under the minimap or the boss bar).
      if(this.minimap){const y=`${Math.round(this.zonesCache.announce.y)}px`;if(this.el.style.getPropertyValue('--rh-anuncio')!==y)this.el.style.setProperty('--rh-anuncio',y);}
    }
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
