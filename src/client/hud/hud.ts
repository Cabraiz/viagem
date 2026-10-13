/**
 * Run HUD (VGM-040): DOM overlay over the game canvas, driven only by RunView.
 * The root ignores pointer events; only interactive panels opt back in and stop propagation,
 * so tapping the HUD never moves the character or reaches the joystick/canvas.
 */
import './hud.css';
import './you.css';
import type {RunView} from '../../contract/index.ts';
import {applyEvents,emptyTally,resetTally,type HudContext,type HudPart,type RunResult,type RunTally} from './model.ts';
import {createTopBar,createAnnouncer} from './topbar.ts';
import {createOfferPanel} from './offer.ts';
import {createTeamStrip,createReviveAlerts} from './team.ts';
import {createResultScreen,type ResultRoster} from './result.ts';
import {getAudio} from '../audio/engine.ts';
import {createHurtFrame} from './hurt.ts';
import {chooseSlot,crosses,measureZones,union,veiled,type Rect,type ScreenZones} from './zones.ts';
import {createCamp,type CampPart,type ForgeAnswer,type HeroSpot} from './camp.ts';
import type {RecipeId} from '../../rules/index.ts';
import './zones.css';
import {EdgeArrows} from './edges.ts';
import {MoodBoard} from './moods.ts';
import type {EmoteId} from '../fun/emotes.ts';
import {Coach,LESSONS,createCoachRow,type CoachPart,type CoachShow} from './coach.ts';
import {Minimap} from './minimap.ts';
import {CityMinimap,BigMapState,cityHudLayout,CityObjectiveTracker,createObjectiveRow,objectiveSlot,prewarmCityRoute,cityAssetOf,ROW_WAITS_OBJECTIVE_MS,type NoticeKind,type BlockReason,type CityObjective,type ObjectivePart} from './city/index.ts';
import {RowQueue} from './row-queue.ts';
import {createKillcam,type KillcamPart} from './killcam.ts';
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
  /** The owner's commands from the result screen (D-025). */
  onKick?(id:string):void;onAddBot?():void;onRemoveBot?(id:string):void;
  /**
   * Forge tap (VGM-046B): sends the purchase, returns its request id (undefined: cannot reach the room now). `target`
   * only for a city barricade's repair ('barricada-N', camp.ts).
   */
  onForge?(recipe:RecipeId,target?:string):number|undefined;
  /** Where the first-run coach remembers what this phone learned (VGM-056); defaults to localStorage. The sandbox passes a fresh one. */
  coachStorage?:Pick<Storage,'getItem'|'setItem'>;
  /** The hero's box on screen now (scene.heroScreenRect): the hint steps aside at view rate, not only at avoidHero's 10 Hz. */
  heroRect?():Rect|undefined;
}

/** Runs inside the pick's tap, so it may unlock the audio engine (iOS needs a gesture) before the "tum". */
export function playStamp(){
  const audio=getAudio();
  if(!audio.unlocked)audio.unlock();
  audio.play('carimbo');
}

/** The intermission offer shows this long after the kill-cam opened: FEITO (700 ms + 140 ms) first, then LEVEI. */
export const OFFER_AFTER_KILLCAM_MS=1000;
/** Clearance kept between the hero's sprite and the center banner, in CSS px. */
export const HERO_MARGIN_PX=40;

/** What rescue.ts hands the HUD for the city's walk to the plaza (RunHud.setCityRoute). */
export interface CityRouteInput {terrain:unknown;hero:{x:number;y:number};view:number}

export const defaultPortrait=(classId:string,detailed=false)=>`/art/portraits/${classId}${detailed?'':'-thumb'}.webp`;

export class RunHud {
  readonly el:HTMLElement;
  readonly tally:RunTally=emptyTally();
  private readonly parts:HudPart[];
  private readonly result;
  private readonly ctx:HudContext;
  /** Who is laughing now (rostos-kkkk): fed by emote(), read by the team strip through ctx.mood. */
  readonly moods=new MoodBoard();
  private last?:RunView;
  private readonly stack:HTMLElement;
  /** The shell's quiet rows (queueRow): one at a time in the announcement slot. */
  private readonly rows=new RowQueue<HTMLElement>();
  private readonly alerts:HudPart;
  private readonly hurt:ReturnType<typeof createHurtFrame>;
  /** Base ficha, forge window and horn notice (VGM-046B, hud/camp.ts). */
  private readonly camp:CampPart;
  /** Kill-cam of the round's last critter (VGM-053B), in the announcement slot. */
  private readonly killcam:KillcamPart;
  /** Banner box measured in its normal (top) slot, so the low slot can be left once the hero walks away. */
  private topSlot?:Rect;
  /** Bumps on window resize or when a HUD part changes size (ResizeObserver): cached boxes are read again only then. */
  private layoutVersion=0;
  private rowsKey='';private rowsVersion=-1;private rowsBox?:Rect;
  private readouts:{el:HTMLElement;rect:Rect}[]=[];private readoutVersion=-1;
  private zonesCache?:ScreenZones;private zonesVersion=-1;private zonesFresh=false;
  private readonly relayout=()=>{this.layoutVersion++;};
  private observer?:ResizeObserver;
  private columnObserver?:ResizeObserver;
  /** Shell rows that answer a tap (queueRow answer): they go ahead of the coach's hint. */
  private readonly answers=new Set<HTMLElement>();
  /** First-run coach (VGM-056): one hint at a time in the announcement slot. */
  readonly coach:Coach;
  private readonly coachRow:CoachPart;
  private coachShow?:CoachShow;
  private hero?:{x:number;y:number};
  private readonly chip:HTMLButtonElement;
  private readonly offerEl:HTMLElement;
  private readonly forgeEl:HTMLElement;
  /** The hint row's box, read with the other rows of the slot (same cache: rowsKey/layoutVersion). */
  private coachRect?:Rect;
  private readonly heroRectOf?:()=>Rect|undefined;
  /** Edge arrows and minimap (UX-bordas-fora-da-tela, ORQ-minimapa); only with worldRescue. */
  readonly edges?:EdgeArrows;
  readonly minimap?:Minimap;
  /**
   * The city's minimap (design/cidade-hud.md §1–§2, card cidade-04): built the first time the world is the city and put
   * in the `.rh-minimap` slot instead of `minimap` while it is (useCityMinimap). Only one of the two is in the DOM.
   */
  private city?:CityMinimap;
  private cityOn=false;
  /** The big city minimap: open or closed, and whether it changed since the last draw (doc §2). */
  readonly cityMap=new BigMapState();
  private cityBlock?:BlockReason;
  private cityBigCache?:{side:number;coversAnnounce:boolean};private cityBigVersion=-1;
  /**
   * The city's round-1 walk to the plaza (card cidade-08, city/route.ts): a row of the announcement slot, driven by
   * setCityRoute (rescue.ts, every frame) and by the views (round, the local hero standing).
   */
  private readonly objectiveRow:ObjectivePart;
  private readonly objective=new CityObjectiveTracker();
  private routeInput?:CityRouteInput;
  /** What the objective wants to show now (before the slot's turn), and its box (read with the slot's other rows). */
  private objectiveWant?:CityObjective;private objectiveRect?:Rect;

  constructor(parent:HTMLElement,options:RunHudOptions){
    this.ctx={localId:options.localId,portrait:options.portrait??defaultPortrait,tally:this.tally,critterIcon:options.critterIcon,worldRescue:options.worldRescue,mood:id=>this.moods.active(id,performance.now())};
    this.el=document.createElement('div');
    this.el.className='rh';
    this.el.setAttribute('aria-label','Placar da partida');
    const stack=document.createElement('div');stack.className='rh-stack';
    const hurt=createHurtFrame(),top=createTopBar(),announcer=createAnnouncer(),team=createTeamStrip(),alerts=createReviveAlerts(),offer=createOfferPanel({onChoose:options.onChoose,onStamp:options.onStamp??playStamp,localId:options.localId,onChipTap:()=>this.coach.did('chip')});
    this.coach=new Coach(options.coachStorage);this.heroRectOf=options.heroRect;this.coachRow=createCoachRow();this.chip=offer.chip;this.offerEl=offer.el;
    this.objectiveRow=createObjectiveRow(parent.ownerDocument);
    this.result=createResultScreen({onRematch:()=>options.onRematch?.(),onExit:options.onExit?()=>options.onExit?.():undefined,
      onKick:id=>options.onKick?.(id),onAddBot:()=>options.onAddBot?.(),onRemoveBot:id=>options.onRemoveBot?.(id)});
    const camp=this.camp=createCamp({onForge:(recipe,target)=>options.onForge?.(recipe,target)});this.forgeEl=camp.forge;
    const killcam=this.killcam=createKillcam();
    // The base ficha is a status readout of the top band; the horn is a notice of the announcement slot.
    top.el.append(camp.readout);
    // The stack is the top band's announcement slot (UX-zonas-tela): the round/boss banner, then the one notice.
    // The coach's hint is the last row: it only shows while no other row holds the slot (VGM-056). The city's walk to
    // the plaza (cidade-08) sits right above it: the coach's hints wait for it, it waits for the rows above.
    stack.append(announcer.el,killcam.el,alerts.el,camp.notice,this.objectiveRow.el,this.coachRow.el);this.stack=stack;this.alerts=alerts;
    this.hurt=hurt;this.parts=[hurt,top,announcer,killcam,team,alerts,offer,camp];
    this.el.append(hurt.el,top.el,stack,team.el,offer.el,camp.forge,offer.chip,this.result.el);
    // Under the offer and the result (DOM order): arrows on the useful area's rim, the minimap in its corner.
    if(options.worldRescue){this.edges=new EdgeArrows(this.el);this.minimap=new Minimap(this.el);this.el.insertBefore(this.edges.el,offer.el);this.el.insertBefore(this.minimap.el,offer.el);}
    // Interactive panels must not leak taps to the canvas/joystick underneath.
    // Passive readouts (round chip, XP, boss bar, team strip, revive alerts) also swallow taps (VGM-043: a tap on the
    // round chip used to walk the hero towards the sea). Only the empty space between them reaches the game.
    for(const panel of [offer.el,offer.chip,this.result.el,top.el,team.el,alerts.el,this.coachRow.el,this.objectiveRow.el])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)panel.addEventListener(type,event=>event.stopPropagation());
    parent.append(this.el);
    addEventListener('resize',this.relayout);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.relayout);for(const part of [top.el,team.el,stack,offer.el,camp.forge,camp.readout,...(this.minimap?[this.minimap.el]:[])])this.observer.observe(part);
      // NEW-UX-nome-do-time-na-coluna: the portrait column is as wide as its widest name; the windows and the announcement
      // slot start right of it (hud.css --rh-coluna), so a 9-letter name never goes under the offer or the forge.
      this.columnObserver=new ResizeObserver(()=>{this.el.style.setProperty('--rh-coluna',`${Math.ceil(team.el.getBoundingClientRect().width)}px`);});
      this.columnObserver.observe(team.el);}
  }

  /**
   * Swaps the minimap in the `.rh-minimap` slot: the city's (whole city as a diamond, tap opens the big one) while the
   * run's world is the city, else the island/endless one. Called every frame by the driver (rescue.ts): the room may
   * switch maps in the lobby, and the HUD is built once (explore.ts). A no-op when nothing changes.
   */
  useCityMinimap(on:boolean){
    if(!this.minimap||on===this.cityOn)return;
    this.cityOn=on;
    const city=on?(this.city??=this.createCityMinimap()):this.city!;
    const [from,to]=on?[this.minimap.el,city.element]:[city.element,this.minimap.el];
    if(!on){this.closeCityMap();city.big.remove();}
    from.replaceWith(to);
    // The layout watches the minimap in the slot (its box moves the announcement slot and the useful area).
    this.observer?.unobserve(from);this.observer?.observe(to);
    this.relayout();
  }
  private createCityMinimap(){
    const city=new CityMinimap(this.el.ownerDocument);
    city.onTap=()=>this.cityMap.tap(performance.now(),this.cityBig().side,this.cityBlock);
    return city;
  }
  /** Closes the big city minimap now (out of the wave, where no city frame redraws it). */
  closeCityMap(){this.cityMap.close();this.city?.collapse();}
  /** The city minimap while it holds the slot (useCityMinimap), else undefined. */
  get cityMinimap(){return this.cityOn?this.city:undefined;}
  /** Why a tap must not open the big city minimap now (a critter near, a notice up): the collapsed border turns Cone. */
  blockCityMap(reason:BlockReason|undefined){this.cityBlock=reason;this.city?.setBlocked(reason);}
  /**
   * The big city minimap's side and whether it covers the announcement slot, for the live layout (city/layout.ts
   * cityHudLayout over the measured controls, doc §2); cached per layout. A side under BIG_MIN_SIDE: it does not open.
   */
  cityBig(){
    if(this.cityBigCache&&this.cityBigVersion===this.layoutVersion)return this.cityBigCache;
    this.cityBigVersion=this.layoutVersion;
    const doc=this.el.ownerDocument,rect=(el:Element|null):Rect|undefined=>{
      if(!el||(el as HTMLElement).closest('[hidden]'))return undefined;
      const r=el.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;
    };
    const one=(s:string)=>rect(doc.querySelector(s)),all=(s:string)=>[...doc.querySelectorAll(s)].map(rect);
    const style=getComputedStyle(this.el),px=(name:string)=>parseFloat(style.getPropertyValue(name))||0;
    const viewport={width:innerWidth,height:innerHeight},open=one('.rh-offer')??one('.rh-forge');
    const layout=cityHudLayout({viewport,safe:{top:px('--rh-t'),right:px('--rh-r'),bottom:px('--rh-b'),left:px('--rh-l')},
      textScale:(this.edges?.scale()??1)>1.1?1.25:1,windowOpen:!!open,
      controls:{status:[...all('.explore-camera button'),one('.explore-config'),...all('.rh-top>*')],team:union(all('.rh-member')),
        joystick:one('.explore-stick'),skill:one('#coop-attack')??one('#coop-sos'),emote:one('.fun-emote-toggle'),chip:one('.rh-offer-chip'),offer:open}});
    return this.cityBigCache={side:layout.minimapBig?.width??0,coversAnnounce:layout.bigCoversAnnounce};
  }
  /** What the announcement slot shows now, for the big city minimap (doc §2: a danger notice blocks and closes it). */
  cityNotice():NoticeKind|undefined{
    if(this.stack.querySelector('.rh-horn:not([hidden])'))return 'corneta';
    if(this.stack.querySelector('.rh-alert:not([hidden])'))return 'caido';
    const marquee=this.stack.querySelector<HTMLElement>('.rh-marquee:not([hidden])');
    if(marquee)return marquee.dataset.tone==='boss'?'chefe':'outro';
    return this.stack.querySelector('.rh-killcam:not([hidden]),.rh-row:not([hidden])')?'outro':undefined;
  }
  /** The connection notice is up (reconnecting): the city minimap's marks stay still at 50% with sem-linha (B13). */
  get offline(){return !!this.ctx.network;}
  /** A relayed emote (net onEmote): the sender's portrait shows it for 2.2 s, starting at the next view. */
  emote(playerId:string,id:EmoteId,now=performance.now()){this.moods.record(playerId,id,now);}

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
    // The kill-cam (VGM-053B) gives way to any notice (danger over the joke) and takes the round banner's turn
    // ("Intervalo!": the round chip already says it).
    const notice=!!this.stack.querySelector('.rh-alert:not([hidden])');
    this.killcam.el.classList.toggle('rh-killcam-yield',notice);
    if(this.killcam.shown&&!notice&&marquee&&!marquee.hidden&&marquee.dataset.tone==='interval')marquee.hidden=true;
    // The intermission offer opens after the FEITO stamp (design review D2): never two stamps in the same second.
    const wait=!notice&&this.killcam.age<OFFER_AFTER_KILLCAM_MS;
    if(this.el.classList.contains('rh-offer-waits')!==wait)this.el.classList.toggle('rh-offer-waits',wait);
    this.turnRows();
    this.stepObjective();
    this.updateCoach(view);
    this.renderObjective();
  }

  /**
   * The city's round-1 walk (card cidade-08): the run's terrain, the local hero's predicted spot and the camera's view,
   * every frame (rescue.ts); undefined out of a run. The row shows from the opening countdown through round 1 while the
   * hero is out of the plaza (CityObjectiveTracker), when the announcement slot is free for it (renderObjective).
   */
  setCityRoute(input:CityRouteInput|undefined){
    this.routeInput=input;
    // The camp's barricade tags find each barricade's mouth on the decoded city (camp.ts, city/barricade.ts).
    this.camp.setBocas(input?cityAssetOf(input.terrain as {world?:string})?.points.bocas:undefined);
    const was=!!this.objectiveWant;
    this.stepObjective();
    // The walk just became wanted (the first city frame of the run) while the coach shows its own "andar": the coach
    // folds it into the walk now, not at the next view, so the two rows never take turns.
    if(!was&&this.objectiveWant&&this.coachShow&&this.last)this.updateCoach(this.last);
    this.renderObjective();
  }
  /**
   * The run's world as soon as it is known (rescue.ts, every frame from the lobby on): a city gets its walking route
   * built on an idle moment now, so round 1's first frame never pays for it (city/route.ts prewarmCityRoute). Once per terrain.
   */
  prewarmCity(terrain:unknown){prewarmCityRoute(terrain);}
  private stepObjective(){
    const view=this.last,me=view?.players.find(p=>p.id===this.ctx.localId);
    const standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0;
    const input=this.routeInput,ended=this.el.classList.contains('rh-ended');
    this.objectiveWant=this.objective.step({terrain:ended?undefined:input?.terrain,round:view?.round,standing,hero:input?.hero,view:input?.view??0});
  }
  /**
   * One row at a time: the objective waits for a notice, the kill-cam, a shell row, an open window and the coach's rescue
   * hint (the coach holds every other hint while the objective is wanted, coach.ts), and for the round banner (1.8 s),
   * except in round 1 while "andar" is still to learn: then it is the joystick lesson and takes the banner's slot, as
   * the coach's "andar" does (UX-1; city/route.ts objectiveSlot): the round name folds into the round chip.
   */
  private renderObjective(){
    const want=this.objectiveWant,marquee=this.stack.querySelector<HTMLElement>('.rh-marquee');
    const held=!!this.el.hidden||this.offerOpen()||!!this.coachShow||!!this.stack.querySelector('.rh-alert:not([hidden]),.rh-killcam:not([hidden]),.rh-row:not([hidden])');
    const slot=objectiveSlot({wanted:!!want,round:this.last?.round?.index,walkLearned:this.coach.done.has('walk'),banner:!!marquee&&!marquee.hidden,held});
    if(slot.foldBanner)marquee!.hidden=true;
    if(this.objectiveRow.render(slot.show?want:undefined,!this.coach.done.has('walk'))){
      const r=this.objectiveRow.el.hidden?undefined:this.objectiveRow.el.getBoundingClientRect();
      this.objectiveRect=r&&{x:r.left,y:r.top,width:r.width,height:r.height};
      this.turnRows();
    }
    this.lightStick();
    const hero=this.heroRectOf?.();
    if(hero)this.objectiveYield(hero,HERO_MARGIN_PX);
  }
  /** The city's walk to the plaza is on screen (the sandbox and the playtest metrics). */
  get objectiveShown(){return !this.objectiveRow.el.hidden;}
  /**
   * The joystick keeps calling (Amarelo) while "andar" is still to learn and its hint is on screen, or only pushed aside
   * by the rescue hint (a caído outranks it), or folded into the city's walk to the plaza while that walk is wanted (its
   * row on screen or only waiting for a notice or a shell row: the light never blinks); explore.css reads data-coach-stick.
   */
  private lightStick(){
    const lesson=this.coachShow&&!this.coachShow.done?this.coachShow.lesson:'';
    const stick=!this.coach.done.has('walk')&&(lesson==='walk'||lesson==='rescue'||!!this.objectiveWant);
    if(('coachStick' in this.el.dataset)!==stick){if(stick)this.el.dataset.coachStick='';else delete this.el.dataset.coachStick;}
  }

  /**
   * The first-run coach (VGM-056): it waits while any other row holds the announcement slot, the HUD is hidden (out of
   * the round) or the result is up; the joystick wears the hint's Amarelo while "andar" shows (data-coach on the root).
   */
  private updateCoach(view:RunView,now=performance.now()){
    if(this.coach.finished&&!this.coachShow)return;
    const ended=this.el.classList.contains('rh-ended');
    // The kill-cam and its FEITO (VGM-053B) hold the slot too, even while yielding to a notice; and no hint while the
    // intermission window is open or a LEVEI stamp hits (one moment at a time).
    // The forge window too (VGM-046B): the gathering hint never shows over an open forge.
    const blocked=ended||!!this.el.hidden||!!this.stack.querySelector('.rh-alert:not([hidden]),.rh-killcam:not([hidden]),.rh-row:not([hidden])')||this.offerOpen()||!this.forgeEl.hidden;
    const marquee=this.stack.querySelector<HTMLElement>('.rh-marquee');
    const banner=!!marquee&&!marquee.hidden;
    const show=this.coach.step({view,localId:this.ctx.localId,hero:this.hero,chip:this.chipWaits(),blocked,banner,objective:!!this.objectiveWant},now);
    // "Anda!" outranks the street banner (UX-1: the 1st step in ≤ 3 s): the round name folds into the round chip, as it
    // does for a notice or the offer window.
    if(show&&banner&&LESSONS[show.lesson].overBanner&&view.round?.index===1)marquee!.hidden=true;
    this.coachShow=show;
    // A hint that just appeared or changed is measured now and steps aside at once if it is over the hero; between
    // changes the box comes from the slot's cache (avoidHero), and the hero's box is read fresh on every view.
    if(this.coachRow.render(show,view.offers.length)){const r=this.coachRow.el.hidden?undefined:this.coachRow.el.getBoundingClientRect();this.coachRect=r&&{x:r.left,y:r.top,width:r.width,height:r.height};}
    const hero=this.heroRectOf?.();
    if(hero)this.coachYield(hero,HERO_MARGIN_PX);
    const lesson=show&&!show.done?show.lesson:'';
    if((this.el.dataset.coach??'')!==lesson){if(lesson)this.el.dataset.coach=lesson;else delete this.el.dataset.coach;}
    this.lightStick();
  }
  /** The hint on screen now (playtest metrics, dev/ux-metrics.ts). */
  get coachHint():CoachShow|undefined{return this.coachShow;}
  /** The "+N" chip waits for a tap: in combat, or the intermission window folded into it with "Depois" (janela-caido). */
  private chipWaits(){return !this.chip.hidden&&(this.chip.dataset.mode==='combat'||this.offerEl.hidden===true);}
  /** The intermission window, or the LEVEI stamp of the combat strip (the strip itself sits far from the slot). */
  private offerOpen(){return !this.offerEl.hidden&&(this.offerEl.dataset.mode!=='combat'||this.offerEl.classList.contains('rh-offer-stamping'));}
  /** The kill-cam picture (viewport CSS px) while it shows, for the scene's second camera (VGM-053B). */
  killcamRect(){return this.el.classList.contains('rh-ended')?undefined:this.killcam.rect();}

  /** The room's answer to a forge tap (VGM-046B). */
  forged(answer:ForgeAnswer){this.camp.forged(answer);}
  /** The hero's predicted spot and the base's bearing on screen (explore.ts), for the forge and the horn arrow. */
  setHero(spot:HeroSpot|undefined){this.camp.setHero(spot);this.hero=spot&&{x:spot.x,y:spot.y};}

  showResult(result:RunResult){
    this.el.classList.add('rh-ended');this.hurt.reset();
    // First run of the phone: what the coach showed in this run counts as learned (VGM-056).
    this.coach.endRun();this.coachShow=undefined;this.coachRow.render(undefined,0);delete this.el.dataset.coach;delete this.el.dataset.coachStick;
    this.objective.reset();this.objectiveWant=undefined;this.objectiveRow.render(undefined,false);
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

  /**
   * A quiet row of the shell's own for the announcement slot (VGM-048: "modo econômico ligou sozinho"), shown for `ms`.
   * One row at a time: it waits in line while a notice, the kill-cam or the coach's hint holds the slot, holds the slot
   * against the coach while it shows, and steps out (its time paused) when a notice comes. It moves with the slot (top
   * or low, off the hero) like the other rows.
   */
  queueRow(el:HTMLElement,ms:number,options:{answer?:boolean}={}){
    if(el.parentElement!==this.stack)this.stack.insertBefore(el,this.coachRow.el);
    el.classList.add('rh-row');el.hidden=true;
    // An answer to the player's own tap ("Gira no intervalo") does not wait for the coach's hint: it takes the slot
    // from it (the coach steps back while a row shows). Notices and the kill-cam still go first.
    if(options.answer)this.answers.add(el);else this.answers.delete(el);
    this.rows.queue(el,ms);this.turnRows();
  }
  /** The row leaves the line and the slot (its own button answered it). */
  dropRow(el:HTMLElement){this.rows.drop(el);if(!el.hidden){el.hidden=true;this.relayout();}}
  /**
   * Who holds the announcement slot for the shell's rows: a notice, the kill-cam, the coach's hint, or nothing to show on.
   * The city's walk to the plaza may last the whole round 1: a row waits for it ROW_WAITS_OBJECTIVE_MS at most, then the
   * walk steps out for the row's time and comes back after it (interleaved, never a row lost behind a 40 s walk).
   */
  private turnRows(now=performance.now()){
    const head=this.rows.shown??this.rows.next,answer=!!head&&this.answers.has(head);
    const busy=!!this.el.hidden||this.el.classList.contains('rh-ended')||!!this.stack.querySelector(answer?'.rh-alert:not([hidden]),.rh-killcam:not([hidden])':'.rh-alert:not([hidden]),.rh-killcam:not([hidden]),.rh-coach:not([hidden])');
    const walk=!answer&&!this.objectiveRow.el.hidden;
    const {show,hide}=this.rows.turn(now,busy,{busy:walk,ms:ROW_WAITS_OBJECTIVE_MS});
    for(const el of hide)el.hidden=true;
    if(show)show.hidden=false;
    if(show||hide.length)this.relayout();
    // The row took the slot from the walk: the walk's row leaves in the same task (never two rows on screen).
    if(show&&!this.objectiveRow.el.hidden)this.renderObjective();
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
    const rows=[...this.stack.querySelectorAll<HTMLElement>('.rh-marquee:not([hidden]),.rh-killcam:not([hidden]):not(.rh-killcam-yield),.rh-alert:not([hidden]),.rh-objetivo:not([hidden]),.rh-coach:not([hidden]),.rh-row:not([hidden])')];
    if(!rows.length)return;
    const low=this.stack.classList.contains('rh-stack-low');
    // Layout is read only when it can have changed: rows shown/hidden, slot switched, or a resize (window or HUD part).
    // The hint's lesson is in the key: another lesson may wrap to another height with the same classes.
    const key=`${rows.map(r=>`${r.className}${r.dataset.lesson??''}`).join('|')}:${low}`;
    if(key!==this.rowsKey||this.rowsVersion!==this.layoutVersion||!this.rowsBox){
      this.rowsKey=key;this.rowsVersion=this.layoutVersion;
      const r=rows.map(el=>el.getBoundingClientRect()),x=Math.min(...r.map(b=>b.left)),y=Math.min(...r.map(b=>b.top));
      this.rowsBox={x,y,width:Math.max(...r.map(b=>b.right))-x,height:Math.max(...r.map(b=>b.bottom))-y};
      const c=r[rows.indexOf(this.coachRow.el)],o=r[rows.indexOf(this.objectiveRow.el)];
      this.coachRect=c&&{x:c.left,y:c.top,width:c.width,height:c.height};
      this.objectiveRect=o&&{x:o.left,y:o.top,width:o.width,height:o.height};
      if(!low)this.topSlot=this.rowsBox;
      // In the low slot the rows may be taller or fewer now: keep the top slot's place with the rows' size.
      else if(this.topSlot)this.topSlot={...this.topSlot,height:this.rowsBox.height,width:Math.max(this.topSlot.width,this.rowsBox.width)};
    }
    if(!this.topSlot)return;
    const lowSlot=low?this.rowsBox:{...this.topSlot,y:innerHeight};
    const slot=chooseSlot([this.topSlot,lowSlot],hero,margin);
    if(this.stack.classList.contains('rh-stack-low')!==(slot===1))this.stack.classList.toggle('rh-stack-low',slot===1);
    this.coachYield(hero,margin);this.objectiveYield(hero,margin);
  }
  /**
   * The first-run hint never sits on the hero (VGM-056): if neither slot clears it (a camera still catching up after a
   * jump), the hint steps aside (visibility only, it keeps its place in the slot) until the hero is clear again.
   */
  private coachYield(hero:Rect,margin:number){
    const row=this.coachRow.el;
    const over=!row.hidden&&!!this.coachRect&&crosses(this.coachRect,hero,margin);
    if(row.classList.contains('rh-coach-yield')!==over)row.classList.toggle('rh-coach-yield',over);
  }
  /** The city's walk to the plaza steps aside the same way (visibility only) while its box is over the hero. */
  private objectiveYield(hero:Rect,margin:number){
    const row=this.objectiveRow.el;
    const over=!row.hidden&&!!this.objectiveRect&&crosses(this.objectiveRect,hero,margin);
    if(row.classList.contains('rh-objetivo-yield')!==over)row.classList.toggle('rh-objetivo-yield',over);
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
      // The announcement slot starts where the zones say (under the minimap, the base ficha or the boss bar).
      {const y=`${Math.round(this.zonesCache.announce.y)}px`;if(this.el.style.getPropertyValue('--rh-anuncio')!==y)this.el.style.setProperty('--rh-anuncio',y);}
    }
    return this.zonesCache;
  }
  /** The zones only when they changed since the last call (resize, rotation, HUD part resized), else undefined. */
  zonesIfChanged(){const zones=this.zones();if(!this.zonesFresh)return undefined;this.zonesFresh=false;return zones;}

  /** The room refused the rematch (042a R2): the result button stops "waiting for the gang" and shows `label`. */
  rematchRefused(label:string){this.result.refuse(label);}
  /** Owner and bots on the result screen (D-025): crown, robot and the owner's "Arrumar turma". */
  setRoster(roster:ResultRoster){this.result.setRoster(roster);}

  /** New run (rematch): clears the per-run tally; event de-duplication keeps working across runs. */
  reset(){
    resetTally(this.tally);
    this.objective.reset();
  }

  get view(){return this.last;}

  destroy(){
    // Leaving mid-run still was this phone's first run: what the coach showed counts as learned (VGM-056).
    this.coach.endRun();
    removeEventListener('resize',this.relayout);this.observer?.disconnect();this.columnObserver?.disconnect();this.city?.destroy();
    for(const part of this.parts)part.destroy?.();
    this.result.destroy();
    this.el.remove();
  }
}
