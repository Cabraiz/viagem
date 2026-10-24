/**
 * Run HUD (VGM-040): DOM overlay over the game canvas, driven only by RunView.
 * The root ignores pointer events; only interactive panels opt back in and stop propagation,
 * so tapping the HUD never moves the character or reaches the joystick/canvas.
 */
import {perfNow,perfSpan} from '../dev/perf-flag.ts';
import './hud.css';
import './offer-centro.css';
import './you.css';
import type {RunPause,RunView} from '../../contract/index.ts';
import {applyEvents,emptyTally,nestTally,resetTally,type HudContext,type HudPart,type RunResult,type RunTally} from './model.ts';
import {createTopBar,createAnnouncer} from './topbar.ts';
import {createOfferPanel} from './offer.ts';
import {createTeamStrip,createReviveAlerts} from './team.ts';
import {createPix,PIX_TOAST_MS} from './pix.ts';
import './pix.css';
import {createCacaNiquel} from './caca-niquel.ts';
import './caca-niquel.css';
import {createResultScreen,type ResultRoster,type RematchVotes} from './result.ts';
import {getAudio} from '../audio/engine.ts';
import {GameMusic,musicCue} from '../audio/music.ts';
import {createHurtFrame} from './hurt.ts';
import {chooseSlot,crosses,measureZoneInput,measureZones,veiled,ZONE_WINDOWS_BESIDE_OBRA,type Rect,type ScreenZones,type ZoneInput} from './zones.ts';
import {createCamp,type CampPart,type ForgeAnswer,type HeroSpot} from './camp.ts';
import type {RecipeId} from '../../rules/index.ts';
import './zones.css';
import {EdgeArrows} from './edges.ts';
import {MoodBoard} from './moods.ts';
import type {EmoteId} from '../fun/emotes.ts';
import {Coach,createCoachRow,type CoachPart,type CoachShow,type Lesson} from './coach.ts';
import {WcMinimap} from './wc-minimap/minimap.ts';
import {CityObjectiveTracker,createObjectiveRow,objectiveSlot,prewarmCityRoute,cityAssetOf,ROW_WAITS_OBJECTIVE_MS,type CityObjective,type ObjectivePart} from './city/index.ts';
import {RowQueue} from './row-queue.ts';
import {createKillcam,type KillcamPart} from './killcam.ts';
import {createMinerva} from './minerva.ts';
import {createMission,MissionTracker,type MissionPart} from './missao.ts';
import './missao.css';
import {isTowerKit,kitPiece} from '../../rules/index.ts';
import './camp.css';
import {createCida,type CidaAnswer,type CidaPart} from './cida.ts';
import {createInventory,type InventoryCommand,type InventoryPart} from './inventory.ts';
import './inventory.css';
import {MotoReason,REASON_MS,liveObjective} from './chaveiro.ts';
import {BankAlert,BANK_ALERT_MS} from './bancos.ts';
import {BICO_LINE_MS,bicoLine} from './bicos.ts';
import {icon} from '../ui/icon.ts';
import {stickerOrIcon} from '../ui/sticker.ts';
import type {CidaItemId,PixResult} from '../../contract/index.ts';
import {finePointer,type InputKind} from '../desktop-input.ts';
import './pausa.css';
import './minerva.css';
import {createPausePart} from './pausa.ts';
// Last: the phone's overrides (hud-mobile-minimo) win over hud.css, camp.css and cida.css at equal specificity.
import './fone.css';
import {teamColumnVar} from './fone-layout.ts';
import {viewportSize} from './box-cache.ts';

export interface RunHudOptions {
  localId:string;
  onChoose(offerId:string,index:number):void;
  /** D-052: "Pular" and "Rolar de novo" on the shown offer (absent: the buttons stay off). */
  onSkip?(offerId:string):void;
  onReroll?(offerId:string):void;
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
  /** Dona Cida tap (D-047, hud/cida.ts): sends {t:'cida'}, returns its request id (undefined: cannot reach the room now). */
  onCida?(item:CidaItemId):number|undefined;
  /** PIX to a friend (carteira-e-pix, hud/pix.ts): sends {t:'pix'}, resolves with the room's answer; undefined: cannot reach the room now. */
  onPix?(to:string,amount:number):Promise<PixResult>|undefined;
  /** D-051 inventory tap (hud/inventory.ts): net.inventory; false when nothing could be sent. */
  onInventory?(command:InventoryCommand):boolean;
  /** The kit de torre selected (construir-no-botao): the inventory marks its slot. */
  kitSlot?():number|undefined;
  /** Where the first-run coach remembers what this phone learned (VGM-056); defaults to localStorage. The sandbox passes a fresh one. */
  coachStorage?:Pick<Storage,'getItem'|'setItem'>;
  /** The hero's box on screen now (scene.heroScreenRect): the hint steps aside at view rate, not only at avoidHero's 10 Hz. */
  heroRect?():Rect|undefined;
  /**
   * The input kind (D-044, desktop-input.ts): 'touch' lays the phone's minimal HUD out (hud-mobile-minimo, fone.css),
   * 'mouse' the desktop's. Defaults to the fine-pointer query; the shell keeps it in step with setInput.
   */
  input?:InputKind;
  /** The level-up pause's clock (D-050, hud/pausa.ts); performance.now by default, the sandbox's frozen scenes stop it. */
  pauseClock?():number;
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
/** The passive readouts that go see-through over the hero (RunHud.veil). */
const READOUT_CLASSES=['rh-round','rh-xp','rh-boss','rh-member','rh-camp'];

/** What rescue.ts hands the HUD for the city's walk to the plaza (RunHud.setCityRoute). */
export interface CityRouteInput {terrain:unknown;hero:{x:number;y:number};view:number}

export const defaultPortrait=(classId:string,detailed=false)=>`/art/portraits/${classId}${detailed?'':'-thumb'}.webp`;

export class RunHud {
  readonly el:HTMLElement;
  readonly tally:RunTally=emptyTally();
  private readonly parts:HudPart[];
  /** The match music (musica-do-chefe): the low theme from the start, the boss's while it lives; gone with the HUD. */
  private readonly music=new GameMusic({engine:getAudio()});
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
  /** The mission line (inicio-no-uno-caixas-120, hud/missao.ts): big in the middle, then a row of the slot. */
  private readonly mission:MissionPart;private readonly missionTracker=new MissionTracker();private unoArrowNow:{urgent:boolean}|undefined;
  /** Banner box measured in its normal (top) slot, so the low slot can be left once the hero walks away. */
  private topSlot?:Rect;
  /** Bumps on window resize or when a HUD part changes size (ResizeObserver): cached boxes are read again only then. */
  private layoutVersion=0;
  private rowsKey='';private rowsVersion=-1;private rowsBox?:Rect;
  private readouts:{el:HTMLElement;rect:Rect}[]=[];private readoutVersion=-1;
  private readoutLists?:HTMLCollectionOf<HTMLElement>[];
  private zonesCache?:ScreenZones;private zonesVersion=-1;private zonesFresh=false;
  private readonly relayout=()=>{this.layoutVersion++;};
  private obraInput?:ZoneInput;private obraInputVersion=-1;
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
  /** Edge arrows (UX-bordas-fora-da-tela); only with worldRescue. */
  readonly edges?:EdgeArrows;
  /**
   * The Warcraft-3-style minimap (card NEW-20261013-ORQ-minimapa-wc3, wc-minimap/*): the one in the `.rh-minimap` slot,
   * on every map (the city's whole map, the endless map around the hero, the island). Drawn by rescue.ts at ≤ 10 Hz.
   */
  readonly wc?:WcMinimap;
  /**
   * The city's round-1 walk to the plaza (card cidade-08, city/route.ts): a row of the announcement slot, driven by
   * setCityRoute (rescue.ts, every frame) and by the views (round, the local hero standing).
   */
  private readonly objectiveRow:ObjectivePart;
  private readonly objective=new CityObjectiveTracker();
  private routeInput?:CityRouteInput;
  /** What the objective wants to show now (before the slot's turn), and its box (read with the slot's other rows). */
  private objectiveWant?:CityObjective;private objectiveRect?:Rect;
  /** Dona Cida's button and tray (D-047, hud/cida.ts). */
  private readonly cida:CidaPart;
  /** The manual combat's 6 slots (D-051, hud/inventory.ts); hidden without `hand`. */
  private readonly inventory:InventoryPart;
  /** Why the chaveiro stopped (D-047): one quiet row of the announcement slot for REASON_MS (hud/chaveiro.ts MotoReason). */
  private readonly reasonRow:HTMLElement;private readonly reason=new MotoReason();
  /** Bancos: the row "Bicho sacando no …!" (hud/bancos.ts BankAlert). */
  private readonly bankRow:HTMLElement;private readonly bankAlert=new BankAlert();
  /** Bicos: the row of the local player's own shift, and the last room event it read. */
  private readonly bicoRow:HTMLElement;private bicoEvent=-1;
  /** Who the forge yields to: the obra window (torres-ligar) or Dona Cida's tray. */
  private obraOpen=false;
  /** The top band and the team strip: on the phone the strip is a fan inside the band (setInput). */
  private readonly topEl:HTMLElement;private readonly teamEl:HTMLElement;

  constructor(parent:HTMLElement,options:RunHudOptions){
    this.ctx={localId:options.localId,portrait:options.portrait??defaultPortrait,tally:this.tally,critterIcon:options.critterIcon,worldRescue:options.worldRescue,mood:id=>this.moods.active(id,performance.now())};
    this.el=document.createElement('div');
    this.el.className='rh';
    this.music.attach(document);
    this.el.setAttribute('aria-label','Placar da partida');
    const stack=document.createElement('div');stack.className='rh-stack';
    const hurt=createHurtFrame(),top=createTopBar(),announcer=createAnnouncer(),team=createTeamStrip(),alerts=createReviveAlerts(),offer=createOfferPanel({onChoose:options.onChoose,onSkip:options.onSkip,onReroll:options.onReroll,onStamp:options.onStamp??playStamp,localId:options.localId,onChipTap:()=>this.coach.did('chip')});
    this.coach=new Coach(options.coachStorage);this.heroRectOf=options.heroRect;this.coachRow=createCoachRow();this.chip=offer.chip;this.offerEl=offer.el;
    this.objectiveRow=createObjectiveRow(parent.ownerDocument);
    this.result=createResultScreen({onRematch:()=>options.onRematch?.(),onExit:options.onExit?()=>options.onExit?.():undefined,
      onKick:id=>options.onKick?.(id),onAddBot:()=>options.onAddBot?.(),onRemoveBot:id=>options.onRemoveBot?.(id)});
    const camp=this.camp=createCamp({onForge:(recipe,target)=>options.onForge?.(recipe,target)});this.forgeEl=camp.forge;
    const killcam=this.killcam=createKillcam();
    // The Minuto de Minerva clock (relogio-minerva): the slot's first row while the monsters sleep.
    const minerva=createMinerva();
    const mission=this.mission=createMission(parent.ownerDocument);
    const cida=this.cida=createCida({onBuy:item=>options.onCida?.(item),onWindow:open=>{this.camp.yieldTo(this.obraOpen||open);this.relayout();}});
    const inventory=this.inventory=createInventory({onCommand:command=>options.onInventory?.(command)??false,cidaOpen:()=>cida.open,kitSlot:()=>options.kitSlot?.()},parent.ownerDocument);
    const reasonRow=this.reasonRow=document.createElement('div');reasonRow.className='rh-chaveiro-motivo';reasonRow.setAttribute('role','status');reasonRow.hidden=true;
    const bankRow=this.bankRow=document.createElement('div');bankRow.className='rh-chaveiro-motivo rh-banco-roubo';bankRow.setAttribute('role','status');bankRow.hidden=true;bankRow.dataset.urgente='true';
    const bicoRow=this.bicoRow=document.createElement('div');bicoRow.className='rh-chaveiro-motivo rh-bico';bicoRow.setAttribute('role','status');bicoRow.hidden=true;
    // The base ficha is a status readout of the top band; the horn is a notice of the announcement slot.
    top.el.append(camp.readout);
    // The stack is the top band's announcement slot (UX-zonas-tela): the round/boss banner, then the one notice.
    // The coach's hint is the last row: it only shows while no other row holds the slot (VGM-056). The city's walk to
    // the plaza (cidade-08) sits right above it: the coach's hints wait for it, it waits for the rows above.
    stack.append(minerva.el,mission.band,mission.row,announcer.el,killcam.el,alerts.el,camp.notice,this.objectiveRow.el,this.coachRow.el);this.stack=stack;this.alerts=alerts;
    // The level-up pause (D-050, hud/pausa.ts; reads ctx.pause): its veil under every part, its title right before the offer.
    const pausa=createPausePart(parent.ownerDocument,{root:this.el,offer:offer.el,top:top.el,now:options.pauseClock});
    this.hurt=hurt;this.parts=[hurt,top,minerva,announcer,killcam,team,alerts,offer,camp,cida,pausa,inventory];this.topEl=top.el;this.teamEl=team.el;
    this.el.append(pausa.dim,hurt.el,top.el,stack,team.el,pausa.el,offer.el,camp.forge,cida.panel,offer.chip,cida.button,inventory.el,this.result.el,pausa.live);
    // Under the offer and the result (DOM order): arrows on the useful area's rim, the minimap in its corner.
    // The PIX balloon by a friend's portrait and its toasts (carteira-e-pix, hud/pix.ts): over the strip, under the result.
    const pix=createPix({root:this.el,send:(to,amount)=>options.onPix?.(to,amount),say:(row,mine)=>this.queueRow(row,PIX_TOAST_MS,{answer:mine}),
      live:()=>!this.el.hidden&&!this.el.classList.contains('rh-ended')});
    this.el.insertBefore(pix.el,this.result.el);this.parts.push(pix);
    // The caça-níquel when a crate turns DOURADA for me (caixa-gamble, hud/caca-niquel.ts): over the play, under the result.
    const cacaNiquel=createCacaNiquel(parent.ownerDocument,{onPlay:()=>{const audio=getAudio();if(audio.unlocked)audio.play('caca-niquel');}});
    this.el.insertBefore(cacaNiquel.el,this.result.el);this.parts.push(cacaNiquel);
    if(options.worldRescue){this.edges=new EdgeArrows(this.el);this.wc=new WcMinimap(this.el.ownerDocument);this.el.insertBefore(this.edges.el,offer.el);this.el.insertBefore(this.wc.el,offer.el);}
    // Interactive panels must not leak taps to the canvas/joystick underneath.
    // Passive readouts (round chip, XP, boss bar, team strip, revive alerts) also swallow taps (VGM-043: a tap on the
    // round chip used to walk the hero towards the sea). Only the empty space between them reaches the game.
    for(const panel of [offer.el,offer.chip,this.result.el,top.el,team.el,alerts.el,this.coachRow.el,this.objectiveRow.el])for(const type of ['pointerdown','pointerup','touchstart','mousedown','click'] as const)panel.addEventListener(type,event=>event.stopPropagation());
    parent.append(this.el);
    addEventListener('resize',this.relayout);
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(this.relayout);for(const part of [top.el,team.el,stack,offer.el,camp.forge,camp.readout,cida.panel,cida.button,...(this.wc?[this.wc.el]:[])])this.observer.observe(part);
      // NEW-UX-nome-do-time-na-coluna: the portrait column is as wide as its widest name; the windows and the announcement
      // slot start right of it (hud.css --rh-coluna), so a 9-letter name never goes under the offer or the forge.
      this.columnObserver=new ResizeObserver(()=>this.writeColumn());
      this.columnObserver.observe(team.el);}
    this.setInput(options.input??(finePointer()?'mouse':'touch'));
  }

  /**
   * The phone's minimal HUD (card NEW-20261014-ORQ-hud-mobile-minimo, fone.css) or the desktop's (D-044): data-hud on the
   * root. On the phone the team strip becomes a fan of small portraits inside the top band (a status row there, under the
   * team's bar and level), so it never takes a column or a floor of the field; on the desktop it goes back to its column.
   */
  setInput(kind:InputKind){
    const hud=kind==='touch'?'fone':'mesa';
    if(this.el.dataset.hud===hud)return;
    this.el.dataset.hud=hud;
    if(hud==='fone'){if(this.teamEl.parentElement!==this.topEl)this.topEl.append(this.teamEl);}
    else if(this.teamEl.parentElement!==this.el)this.stack.after(this.teamEl);
    this.writeColumn();this.relayout();
  }
  /** --rh-coluna from the team column's width, the desktop's only (fone-layout.ts teamColumnVar). */
  private writeColumn(){
    const v=teamColumnVar(this.el.dataset.hud==='fone',this.teamEl.getBoundingClientRect().width);
    if(v===undefined)this.el.style.removeProperty('--rh-coluna');else this.el.style.setProperty('--rh-coluna',v);
  }

  /** A relayed emote (net onEmote): the sender's portrait shows it for 2.2 s, starting at the next view. */
  emote(playerId:string,id:EmoteId,now=performance.now()){this.moods.record(playerId,id,now);}

  /** D-050: the room's level-up pause (net.run.pause), or undefined; the parts see it at once, on the last view. */
  setPause(pause?:RunPause){
    const was=this.ctx.pause;
    if(was===pause||(!!was&&!!pause&&was.leftMs===pause.leftMs&&was.totalMs===pause.totalMs&&was.level===pause.level&&was.waiting.join()===pause.waiting.join()
      // D-052: a reroll changes only the counters.
      &&JSON.stringify([was.skips,was.rerolls])===JSON.stringify([pause.skips,pause.rerolls])))return;
    if(pause)this.ctx.pause=pause;else delete this.ctx.pause;
    if(this.last)this.update(this.last);
  }

  /** Minuto de Minerva: the room's RunState.minervaAteTick (combat only), or undefined; the clock reads it on each view. */
  setMinerva(untilTick?:number){
    if(untilTick===undefined)delete this.ctx.minervaAteTick;else this.ctx.minervaAteTick=untilTick;
  }
  /** The time to explore after a wave (RunState.exploraDesdeTick/exploraAteTick), or undefined; the clock and the mission read it. */
  setExplora(window?:{from:number;until:number}){
    if(!window)delete this.ctx.explora;else this.ctx.explora=window;
  }
  /** The Uno gets its edge arrow now (the mission: the Minerva, the last seconds of a time to explore); urgent: "Volte ao Uno.". */
  get unoArrow(){return this.unoArrowNow;}

  update(view:RunView){
    const t0=perfNow(); // ?perf=1: the HUD's work this frame
    this.last=view;
    applyEvents(this.tally,view);
    this.music.update(musicCue(view,this.el.classList.contains('rh-ended')));
    // On the result the run is over: no damage edge (it would frame the result screen).
    for(const part of this.parts)if(part!==this.hurt||!this.el.classList.contains('rh-ended'))part.update(view,this.ctx);
    this.stepMission(view);
    // One row in the announcement slot: a fall/rescue/connection notice outranks the round name (danger over the joke).
    const marquee=this.stack.querySelector<HTMLElement>('.rh-marquee');
    // The offer window outranks it too (design onda 3 B4): the banner shrinks into the round chip at once.
    if(marquee&&!marquee.hidden&&this.stack.querySelector('.rh-alert:not([hidden])'))marquee.hidden=true;
    if(marquee&&!marquee.hidden&&this.el.querySelector('.rh-offer:not([hidden])'))marquee.hidden=true;
    // The mission's big band (inicio-no-uno-caixas-120) too: one big line under the clock, the hero kept in view.
    if(marquee&&!marquee.hidden&&!this.mission.band.hidden)marquee.hidden=true;
    // The kill-cam (VGM-053B) gives way to any notice (danger over the joke) and takes the round banner's turn
    // ("Intervalo!": the round chip already says it).
    const notice=!!this.stack.querySelector('.rh-alert:not([hidden])');
    this.killcam.el.classList.toggle('rh-killcam-yield',notice);
    if(this.killcam.shown&&!notice&&marquee&&!marquee.hidden&&marquee.dataset.tone==='interval')marquee.hidden=true;
    // The intermission offer opens after the FEITO stamp (design review D2): never two stamps in the same second.
    const wait=!notice&&this.killcam.age<OFFER_AFTER_KILLCAM_MS;
    if(this.el.classList.contains('rh-offer-waits')!==wait)this.el.classList.toggle('rh-offer-waits',wait);
    this.stepReason(view);
    this.stepBanks(view);
    this.stepBicos(view);
    this.turnRows();
    this.stepObjective();
    this.updateCoach(view);
    this.renderObjective();
    perfSpan('hud',t0);
  }

  private stepMission(view:RunView){
    const me=view.players.find(p=>p.id===this.ctx.localId),ended=this.el.classList.contains('rh-ended');
    const playing=!!me&&!me.spectator&&!me.eliminated&&!ended;
    const towerKit=!!me?.weapons.some(w=>{const piece=kitPiece(w.id);return !!piece&&isTowerKit(piece);});
    const out=this.missionTracker.step({tick:view.tick,...(this.ctx.minervaAteTick!==undefined?{minervaAte:this.ctx.minervaAteTick}:{}),
      ...(this.ctx.explora?{explora:this.ctx.explora}:{}),towerKit,playing});
    this.unoArrowNow=out.pointUno?{urgent:out.line?.key==='volta'}:undefined;
    this.mission.render(out.line);
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
    // The walk just became wanted (the first city frame of the run) while the coach shows a row: the coach holds it
    // now, not at the next view, so the two rows never take turns.
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
   * The car's arrow (the walk to the plaza): shown whenever it is wanted, beside whatever else the slot holds (a notice,
   * a shell row, the kill-cam, the banner); only a hidden HUD or an open offer window takes it off (card seta-carro). The
   * coach still holds every other hint while it is wanted (coach.ts). Its second line never says how to walk (one
   * written walk hint only: the waiting room's label, BUG-dica-tutorial-duplicada).
   */
  private renderObjective(){
    const want=this.objectiveWant;
    // The car's arrow never steps out for a notice, a row (the economy toast), the kill-cam, the coach or the banner
    // (card seta-carro, ORQ 18/10): they stack beside it in the slot. Only a hidden HUD or an open offer window hides it.
    const held=!!this.el.hidden||this.offerOpen();
    const slot=objectiveSlot({wanted:!!want,round:this.last?.round?.index,walkLearned:this.coach.done.has('walk'),banner:false,held});
    if(this.objectiveRow.render(slot.show?want:undefined)){
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
   * The joystick wears Amarelo while the coach's "andar" is lit (Coach.stick: round 1, until the first steps or 6 s);
   * it is the only combat cue for walking, with no row of its own. explore.css reads data-coach-stick (static).
   */
  private lightStick(){
    const stick=this.coach.stick;
    if(('coachStick' in this.el.dataset)!==stick){if(stick)this.el.dataset.coachStick='';else delete this.el.dataset.coachStick;}
  }

  /**
   * The first-run coach (VGM-056): it waits while any other row holds the announcement slot, the HUD is hidden (out of
   * the round) or the result is up; "andar" only lights the joystick (lightStick), it never takes the slot.
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
  /** The hint on screen now, the lit joystick counting as "walk" (playtest metrics, dev/ux-metrics.ts). */
  get coachHint():{lesson:Lesson;done:boolean}|undefined{return this.coachShow??(this.coach.stick?{lesson:'walk',done:false}:undefined);}
  /** The "+N" chip waits for a tap: in combat, or the intermission window folded into it with "Depois" (janela-caido). */
  private chipWaits(){return !this.chip.hidden&&(this.chip.dataset.mode==='combat'||this.offerEl.hidden===true);}
  /** The intermission window, or the LEVEI stamp of the combat strip (the strip itself sits far from the slot). */
  private offerOpen(){return !this.offerEl.hidden&&(this.offerEl.dataset.mode!=='combat'||this.offerEl.classList.contains('rh-offer-stamping'));}
  /** The kill-cam picture (viewport CSS px) while it shows, for the scene's second camera (VGM-053B). */
  killcamRect(){return this.el.classList.contains('rh-ended')?undefined:this.killcam.rect();}

  /**
   * Why the chaveiro stopped (D-047): the view where he stops queues one row (it waits for notices, the kill-cam and the
   * coach like the shell's rows, and moves off the hero with the slot); riding again or the end takes it out of line.
   */
  private stepReason(view:RunView){
    const step=this.reason.step(this.el.classList.contains('rh-ended')?undefined:liveObjective(view)?.moto.mode);
    if(step.show){
      // Dead moto: the push sticker (ui/empurrar) asks for hands; any other stop keeps the moto.
      const row=this.reasonRow;row.innerHTML=step.show.mode==='morta'?stickerOrIcon('empurrar','moto'):icon('moto');row.append(step.show.text);
      row.dataset.urgente=String(step.show.urgent);row.dataset.modo=step.show.mode;
      this.queueRow(row,REASON_MS);
    }else if(step.drop)this.dropRow(this.reasonRow);
  }
  /** Bancos: a critter starts robbing a bank → one urgent row (it waits in line like the chaveiro's reason). */
  private stepBanks(view:RunView){
    const banks=this.el.classList.contains('rh-ended')?undefined:view.banks;
    const step=this.bankAlert.step(banks,performance.now());
    // The robbery ended (the critter left or the bank emptied) before or while its row shows: the row leaves the line.
    const called=this.bankRow.dataset.banco;
    if(called&&!banks?.some(b=>b.id===called&&b.state==='bicho')){delete this.bankRow.dataset.banco;this.dropRow(this.bankRow);}
    if(!step.show)return;
    const row=this.bankRow;row.innerHTML=icon('caixa-eletronico');row.append(step.show.text);row.dataset.banco=step.show.bank;
    this.queueRow(row,BANK_ALERT_MS);
  }
  /** Bicos (hud/bicos.ts bicoLine): the local player's own shift, entering (the gig's joke) or thrown out (the manager). */
  private stepBicos(view:RunView){
    let line:string|undefined;
    for(const e of view.events??[]){
      if(e.eventId<=this.bicoEvent)continue;
      this.bicoEvent=e.eventId;
      if(e.type==='bico')line=bicoLine(e,this.ctx.localId,view.banks)??line;
    }
    if(!line||this.el.classList.contains('rh-ended'))return;
    const row=this.bicoRow;row.innerHTML=icon('caixa-eletronico');row.append(line);
    this.queueRow(row,BICO_LINE_MS,{answer:true});
  }
  /** The reason row on screen now (the sandbox and the acceptance scripts). */
  get reasonShown(){return this.reasonRow.hidden?undefined:this.reasonRow.textContent??undefined;}
  /** The room's answer to a Dona Cida tap (D-047, {t:'bought'}). */
  bought(answer:CidaAnswer){this.cida.bought(answer);}
  /** The room's answer to an inventory tap ({t:'inv'}, net.onInventory): a refusal shows as a line over the slots. */
  inventoryAnswer(result:{cmd:string;ok:boolean;reason?:string}){this.inventory.answer(result);}

  /** The room's answer to a forge tap (VGM-046B). */
  forged(answer:ForgeAnswer){this.camp.forged(answer);}
  /** The hero's predicted spot and the base's bearing on screen (explore.ts), for the forge and the horn arrow. */
  setHero(spot:HeroSpot|undefined){this.camp.setHero(spot);this.cida.setHero(spot);this.inventory.setHero(spot);this.hero=spot&&{x:spot.x,y:spot.y};}

  showResult(result:RunResult){
    this.el.classList.add('rh-ended');this.hurt.reset();
    this.music.update({boss:false,ended:true});
    // First run of the phone: what the coach showed in this run counts as learned (VGM-056).
    this.coach.endRun();this.coachShow=undefined;this.coachRow.render(undefined,0);delete this.el.dataset.coach;delete this.el.dataset.coachStick;
    this.objective.reset();this.objectiveWant=undefined;this.objectiveRow.render(undefined);
    // D-051: in the nests mode the round line counts the nests that fell (the last view still has them).
    this.result.show(result,this.ctx,nestTally(this.last));
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
    // An answer to the player's own tap ("Gira fora da briga") does not wait for the coach's hint: it takes the slot
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
    // The chaveiro's stop (D-047) and a bank robbery also wait for the round banner (≤ MARQUEE_MS): never two rows in the slot at once.
    const banner=(head===this.reasonRow||head===this.bankRow)&&!this.rows.shown&&!!this.stack.querySelector('.rh-marquee:not([hidden])');
    const busy=banner||!!this.el.hidden||this.el.classList.contains('rh-ended')||!!this.stack.querySelector(answer?'.rh-alert:not([hidden]),.rh-killcam:not([hidden])':'.rh-alert:not([hidden]),.rh-killcam:not([hidden]),.rh-coach:not([hidden])');
    // The car's arrow (the walk) no longer takes turns with the rows: a row shows beside it (card seta-carro).
    const {show,hide}=this.rows.turn(now,busy,{busy:false,ms:ROW_WAITS_OBJECTIVE_MS});
    for(const el of hide)el.hidden=true;
    if(show)show.hidden=false;
    if(show||hide.length)this.relayout();
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
    const lowSlot=low?this.rowsBox:{...this.topSlot,y:viewportSize().height};
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
   * The hero's real box decides, not the useful area: the follow camera puts the body at the viewport centre
   * (BUG-20261013-ORQ-camera-centro-heroi), which may sit outside the useful area (844×390: left of it). Whenever the
   * hero is under the top band or the team strip (that, a resize, a HUD box that grew): those passive readouts go see-through (rh-veiled) so they never hide the hero, and come back when it leaves.
   * Their boxes are cached until the layout changes (the veil only changes opacity, not layout).
   */
  private veil(hero:Rect,margin:number){
    // Live class lists (Q6): a querySelectorAll per frame walked the whole HUD; the browser keeps these up to date.
    const lists=this.readoutLists??=READOUT_CLASSES.map(name=>this.el.getElementsByClassName(name) as HTMLCollectionOf<HTMLElement>);
    let same=this.readoutVersion===this.layoutVersion,n=0;
    for(const list of lists)for(let i=0;i<list.length;i++,n++)if(this.readouts[n]?.el!==list[i])same=false;
    if(!same||n!==this.readouts.length){
      this.readoutVersion=this.layoutVersion;
      this.readouts=lists.flatMap(list=>[...list]).map(el=>{const r=el.getBoundingClientRect();return {el,rect:{x:r.left,y:r.top,width:r.width,height:r.height}};});
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
  /** The zone input without the obra window (torres-ligar), for the obra HUD's own layout; cached per layout like zones(). */
  zoneInputBesideObra():ZoneInput{
    if(!this.obraInput||this.obraInputVersion!==this.layoutVersion){this.obraInputVersion=this.layoutVersion;this.obraInput=measureZoneInput(this.el.ownerDocument,ZONE_WINDOWS_BESIDE_OBRA);}
    return this.obraInput;
  }
  /** Something outside the HUD's observed parts moved (the obra window opened or closed): zones are measured again. */
  layoutChanged(){this.relayout();}
  /**
   * The obra window is open: the forge steps aside until it closes (they share the intermission's window place), and
   * so does Dona Cida (D-047): her button hides and her tray closes, the last opened window wins (she cannot open over it).
   */
  yieldForge(obra:boolean){this.obraOpen=obra;this.cida.yieldTo(obra);this.camp.yieldTo(obra||this.cida.open);}
  /** The offer window is on screen (round offer in the intermission, or a level offer): the obra menu waits for it. */
  get offerShown(){return !this.offerEl.hidden;}

  /** The room refused the rematch (042a R2): the result button stops "waiting for the gang" and shows `label`. */
  rematchRefused(label:string){this.result.refuse(label);}
  /** Owner and bots on the result screen (D-025): crown, robot and the owner's "Arrumar turma". */
  setRoster(roster:ResultRoster){this.result.setRoster(roster);}
  /** The room's rematch vote on the result (UX-resultado-revanche): "✓ topa" on the cards, "Revanche (3/6)" on the button. */
  setRematch(votes:RematchVotes|undefined){this.result.setRematch(votes);}

  /** New run (rematch): clears the per-run tally; event de-duplication keeps working across runs. */
  reset(){
    resetTally(this.tally);
    this.objective.reset();
    this.reason.reset();this.dropRow(this.reasonRow);
    this.bankAlert.reset();delete this.bankRow.dataset.banco;this.dropRow(this.bankRow);this.dropRow(this.bicoRow);this.bicoEvent=-1;
  }

  get view(){return this.last;}

  destroy(){
    // Leaving mid-run still was this phone's first run: what the coach showed counts as learned (VGM-056).
    this.coach.endRun();
    removeEventListener('resize',this.relayout);this.observer?.disconnect();this.columnObserver?.disconnect();
    for(const part of this.parts)part.destroy?.();
    this.result.destroy();
    this.music.dispose();
    this.el.remove();
  }
}
