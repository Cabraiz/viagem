/**
 * Playtest metrics (NEW-20261009-UX-playtest-metricas): what a novice does in the first minutes, measured on the phone
 * itself and handed over as a JSON file. Without a measure no UX change can be proven.
 *
 * Rules:
 * - Only with `?dev=1` in the page address (dev/ux-flag.ts). Off by default, and off costs nothing: this module is
 *   imported on demand only when the flag is on, `createUxMetrics` returns undefined before touching window, the DOM or a
 *   timer, and every call site is `ux?.…`.
 * - Local only: no server, no network request. The JSON leaves the phone only when someone taps "Métricas" (share sheet
 *   or download) or reads `window.__uxMetrics` from the console. The last session also stays in this tab's
 *   sessionStorage, so "Métricas" is still there on the start screen after "Sair".
 * - No positions and no personal data: no names, no player ids, no room code, no coordinates (distances are turned into
 *   "moved or not" on the spot), no user agent. Phones of the same group are joined by a random label (`g`, ux-flag.ts).
 * - Counted only what the room took: a command that never left the phone is "não enviado"; a pick counts once its offer
 *   leaves the queue; an owner's command once the roster shows it.
 * Pure state (UxRecorder, unit-tested under node) plus a thin DOM part (UxMetrics) that explore.ts drives.
 */
import type {RunView} from '../../contract/index.ts';
import type {RunState} from '../../sim/run.ts';
import type {SosPing} from '../../rules/index.ts';
import {groupLabel,measuringTeam,setMeasuringTeam,uxMetricsEnabled} from './ux-flag.ts';
export {UX_FLAG,uxMetricsEnabled} from './ux-flag.ts';

export const UX_SCHEMA='viagem-ux/1';
/** Still time is counted only in this first stretch of each run (ms, from when the hero can walk). */
export const STILL_WINDOW_MS=60000;
/**
 * Still time is read in buckets of this length (ms): a bucket where the hero moved less than STILL_DISTANCE counts as
 * standing still. Buckets, not view to view: on a slow phone the hero's spot may only change every few frames.
 */
export const STILL_BUCKET_MS=2000;
/** Less than this (world units) in a whole bucket is standing still (walking covers ~6 u in 2 s). */
export const STILL_DISTANCE=0.15;
/** The first movement: this far (world units) from where the hero stood when it could first walk. */
export const FIRST_MOVE_DISTANCE=0.25;
/** A jump this long between two views is a snap (spawn, reconnection), not a step (same as the coach's). */
export const SNAP_DISTANCE=2.5;
/** Views farther apart than this (tab in the background): the bucket in progress is dropped, not counted either way. */
export const MAX_VIEW_GAP_MS=1000;
/** This tab's last session export (sessionStorage): the start screen's "Métricas" after "Sair". */
export const LAST_KEY='viagem:ux-ultima';

export type CoachLessonId='walk'|'xp'|'chip'|'rescue'|'gather';
export const COACH_LESSONS:readonly CoachLessonId[]=['walk','xp','chip','rescue','gather'];
export interface UxCoachLesson {
  /** This phone already knew it when the run started (an earlier run): no hint expected. */
  knownAtStart:boolean;
  /** ms from the run start to the first time the hint showed; null: never showed in this run. */
  shownMs:number|null;
  /** ms from the run start to learned; by: did the action, or saw the hint ≥ 8 s until the run ended (coach rule). */
  learnedMs:number|null;by:'action'|'sight'|null;
}
export interface UxOfferPhase {chosen:number;defaulted:number}
export interface UxRun {
  /** The room's run number (1, then 2 after a rematch…). */
  run:number;
  /** result: reached the result screen; left: the player left mid-run; open: still running at export time. */
  ended:'result'|'left'|'open';
  outcome:'victory'|'defeat'|'timeout'|null;
  durationMs:number;roundReached:number;
  team:{people:number;bots:number};
  /**
   * The clock of the first movement starts on the first screen where the hero can walk: the room takes input only in
   * combat (CoopClient.input), so from the first combat frame with the scene ready. `firstStickMs`: the finger's first
   * drag on the joystick (the report's "1º movimento"); `firstMoveMs`: the hero's first step as the game saw it.
   */
  firstStickMs:number|null;firstMoveMs:number|null;
  /** Seconds standing (not caído) without moving inside the first STILL_WINDOW_MS, and how much of it was seen standing. */
  still60:{seconds:number;windowSeconds:number};
  downs:{me:number;meRound1:number;team:number;teamRound1:number};
  /** Falls that ended: rescued (by anyone, by this player) or lost (bled out). */
  fallen:{rescued:number;rescuedByMe:number;lost:number};
  /**
   * Offers by the phase they ARRIVED in. chosen: tapped and then gone from the queue; defaulted: gone without a tap
   * (the room's deadline); pendingAtEnd: still there when the run ended; unsent: taps that never left the phone.
   */
  offers:{total:number;chosen:number;defaulted:number;pendingAtEnd:number;unsent:number;combat:UxOfferPhase;intermission:UxOfferPhase;
    /** ms from the offer reaching the head of the queue to the tap that chose it. */
    choiceMs:number[];choiceMsAvg:number|null;
    /** Taps on "Depois" (the intermission window folded into the chip, janela-caido). */
    later:number};
  /** The first level offer (the "+N" chip, D-021) and the first tap on it, ms from the run start. */
  chip:{firstMs:number|null;firstTapMs:number|null};
  coach:Record<CoachLessonId,UxCoachLesson>;
  /** "Me salva" pings: sent by this player (as the room echoed them) and from the others. */
  pings:{sent:number;received:number};
  /** The emote bar of 053A lives only in the sandbox for now (not in the room): available false, sent 0. */
  emotes:{available:boolean;sent:number};
  /** Laughter moments that happened (VGM-053B), for the observer's laugh sheet: happening:boletos, killcam, shame… */
  moments:Record<string,number>;
  /** pressedMs: this player's tap that left the phone (ms after the result); started: the room began the next run. */
  rematch:{pressedMs:number|null;started:boolean};
}
export interface UxExport {
  schema:typeof UX_SCHEMA;
  /** Day only (YYYY-MM-DD), to order files; no clock time. */
  date:string;
  /** Random group label (`g` of the invite, else this tab's own): phones with the same label played together. */
  group:string;
  device:{viewport:string;orientation:'retrato'|'paisagem';dpr:number;text:string;touch:boolean};
  /** The coach knew no lesson when the session started: a first-time phone (the playtest's novice). */
  novice:boolean;
  sessionMs:number;
  /** The waiting room: ms from the scene ready to the first drag on the joystick there (the hero cannot walk yet). */
  waitingRoom:{stickMs:number|null};
  /**
   * The owner's commands the room carried out (seen in the roster); unconfirmed: sent but never seen (refused, or the
   * roster moved for another reason); unsent: never left the phone.
   */
  owner:{isOwner:boolean;kick:number;botAdd:number;botRemove:number;unconfirmed:number;unsent:number};
  runs:UxRun[];
}

/** What the client sends (CoopClient.onCommand): the room's run commands (choose, rematch, owner's, ready). */
export interface UxCommand {t:string;offer?:string;index?:number;id?:string}
/** What the HUD's coach shows and knows (RunHud.coachHint / RunHud.coach.done). */
export interface UxCoachState {done:ReadonlySet<string>;show?:{lesson:string;done:boolean}}
/** The hero's spot in this view; used only to tell "moved" from "stood", never stored. */
export interface UxHero {x:number;y:number}
type Members=readonly {id:string;bot?:true}[];

interface OfferTrack {source:string;headAt?:number;tappedAt?:number;gone?:'chosen'|'default';phase:'combat'|'intermission'}
interface RunTrack {
  rec:UxRun;startedAt:number;resultAt?:number;
  /** When the hero could first walk (combat and scene ready); the first-move clock and the still window start here. */
  moveFrom?:number;
  anchor?:UxHero;lastHero?:UxHero;lastViewAt?:number;stillMs:number;stillSeenMs:number;
  /** The still-time bucket in progress: when it began, where the hero was, and whether it stood (not caído) all along. */
  bucket?:{start:number;hero:UxHero;standing:boolean};
  offers:Map<string,OfferTrack>;
}

const emptyLesson=(known:boolean):UxCoachLesson=>({knownAtStart:known,shownMs:null,learnedMs:null,by:null});
const isLesson=(id:string):id is CoachLessonId=>(COACH_LESSONS as readonly string[]).includes(id);

/**
 * The metrics' state for one room session (one openExploration). Time comes in (`now`, ms, performance.now()), so tests
 * drive it without clocks. It never throws on odd input: a playtest tool must not break the game.
 */
export class UxRecorder {
  private readonly startedAt:number;
  private readonly runs:RunTrack[]=[];
  private current?:RunTrack;
  private lastRun?:{round:number;phase:string};
  private readonly owner={isOwner:false,kick:0,botAdd:0,botRemove:0,unconfirmed:0,unsent:0};
  /** Owner commands sent and not yet seen in the roster. */
  private readonly pending={kick:new Set<string>(),botAdd:0,botRemove:0};
  private roster?:{bots:number;people:Set<string>;key:string};
  /** eventIds grow across runs (D-011): an event of the old run seen again after the rematch is not counted twice. */
  private lastEventId=-1;
  private sceneReadyAt?:number;
  private readonly waitingRoom:{stickMs:number|null}={stickMs:null};
  private knownAtStart?:Set<string>;
  private coachDone=new Set<string>();
  private readonly meta:{group:string;device:UxExport['device'];date:string};
  constructor(meta:{group:string;device:UxExport['device'];date:string},now:number){this.meta=meta;this.startedAt=now;}

  /** The scene is up (the joystick works): the waiting room's clock, and the first-move clock of a run already going. */
  sceneReady(now:number){
    if(this.sceneReadyAt!==undefined)return;
    this.sceneReadyAt=now;
    const t=this.current;if(t&&t.rec.ended==='open'&&t.moveFrom===undefined)t.moveFrom=now;
  }

  /** The room's run state (every frame is fine: only changes do work). */
  runState(run:Pick<RunState,'round'|'phase'|'members'|'owner'|'outcome'|'shame'>|undefined,localId:string|undefined,now:number,coach?:UxCoachState){
    if(!run)return;
    if(localId)this.owner.isOwner=run.owner===localId;
    this.watchRoster(run.members??[]);
    const last=this.lastRun;
    if(last&&last.round===run.round&&last.phase===run.phase)return;
    this.lastRun={round:run.round,phase:run.phase};
    // A run that left its result for a later run number: someone started the rematch.
    if(last?.phase==='result'&&run.round>last.round){const done=this.runs.find(r=>r.rec.run===last.round);if(done)done.rec.rematch.started=true;}
    if(run.phase==='combat'&&this.current?.rec.run!==run.round){
      if(this.current&&this.current.rec.ended==='open')this.close(this.current,'left',now);
      this.current=this.start(run.round,run.members??[],now,coach);
    }
    if(run.phase==='result'&&this.current&&this.current.rec.run===run.round&&this.current.rec.ended==='open'){
      const cur=this.current;
      cur.rec.outcome=run.outcome??null;
      if(run.shame)this.moment(cur,'shame');
      // The coach's end-of-run rule (seen ≥ 8 s counts as learned) ran in RunHud.showResult just before this.
      if(coach)this.coach(coach,now,'sight');
      this.close(cur,'result',now);
    }
  }

  /** Owner's commands are counted when the roster shows them: a bot more or less, a person gone after a kick. */
  private watchRoster(members:Members){
    const key=members.map(m=>`${m.id}${m.bot?'*':''}`).join(',');
    if(this.roster?.key===key)return;
    const bots=members.filter(m=>m.bot).length,people=new Set(members.filter(m=>!m.bot).map(m=>m.id));
    const before=this.roster;this.roster={bots,people,key};
    if(!before)return;
    const p=this.pending;
    if(bots>before.bots&&p.botAdd){const n=Math.min(p.botAdd,bots-before.bots);p.botAdd-=n;this.owner.botAdd+=n;}
    if(bots<before.bots&&p.botRemove){const n=Math.min(p.botRemove,before.bots-bots);p.botRemove-=n;this.owner.botRemove+=n;}
    for(const id of before.people)if(!people.has(id)&&p.kick.delete(id))this.owner.kick++;
  }

  private start(round:number,members:Members,now:number,coach?:UxCoachState):RunTrack{
    if(!this.knownAtStart)this.knownAtStart=new Set(coach?.done??[]);
    const known=new Set(coach?.done??[]);this.coachDone=new Set(known);
    const coachRec=Object.fromEntries(COACH_LESSONS.map(l=>[l,emptyLesson(known.has(l))])) as Record<CoachLessonId,UxCoachLesson>;
    const rec:UxRun={run:round,ended:'open',outcome:null,durationMs:0,roundReached:0,
      team:{people:members.filter(m=>!m.bot).length,bots:members.filter(m=>m.bot).length},
      firstStickMs:null,firstMoveMs:null,still60:{seconds:0,windowSeconds:0},
      downs:{me:0,meRound1:0,team:0,teamRound1:0},fallen:{rescued:0,rescuedByMe:0,lost:0},
      offers:{total:0,chosen:0,defaulted:0,pendingAtEnd:0,unsent:0,combat:{chosen:0,defaulted:0},intermission:{chosen:0,defaulted:0},choiceMs:[],choiceMsAvg:null,later:0},
      chip:{firstMs:null,firstTapMs:null},coach:coachRec,pings:{sent:0,received:0},emotes:{available:false,sent:0},moments:{},
      rematch:{pressedMs:null,started:false}};
    const track:RunTrack={rec,startedAt:now,moveFrom:this.sceneReadyAt!==undefined?now:undefined,stillMs:0,stillSeenMs:0,offers:new Map()};
    this.runs.push(track);
    return track;
  }

  private close(track:RunTrack,ended:'result'|'left',now:number){
    track.rec.ended=ended;track.resultAt=now;track.rec.durationMs=Math.round(now-track.startedAt);
    for(const offer of track.offers.values())if(!offer.gone)track.rec.offers.pendingAtEnd++;
    this.sealStill(track);
  }
  private sealStill(track:RunTrack){
    track.rec.still60={seconds:Math.round(track.stillMs/100)/10,windowSeconds:Math.round(Math.min(STILL_WINDOW_MS,track.stillSeenMs)/100)/10};
  }

  /**
   * A run view (explore.ts runView, every phase). Events advance the last seen id always; the rest counts only in
   * combat. `hero`: the predicted spot, only compared, never kept past the next view.
   */
  view(view:RunView,localId:string,hero:UxHero|undefined,connected:boolean,now:number,coach?:UxCoachState,combat=true){
    const fresh=view.events.filter(e=>e.eventId>this.lastEventId);
    for(const e of fresh)this.lastEventId=Math.max(this.lastEventId,e.eventId);
    const track=this.current;
    if(!combat||!track||track.rec.ended!=='open')return;
    const rec=track.rec,at=Math.round(now-track.startedAt);
    if(view.round?.index)rec.roundReached=Math.max(rec.roundReached,view.round.index);
    const me=view.players.find(p=>p.id===localId);
    const standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0;
    if(hero&&track.moveFrom!==undefined)this.move(track,hero,standing,now);
    // Events: falls, rescues and laughter moments ("Me salva" comes apart, sos).
    const round=view.round?.index??0;
    for(const e of fresh){
      if(e.type==='downed'){rec.downs.team++;if(round===1)rec.downs.teamRound1++;if(e.player===localId){rec.downs.me++;if(round===1)rec.downs.meRound1++;}}
      else if(e.type==='revived'){rec.fallen.rescued++;if(e.by===localId)rec.fallen.rescuedByMe++;}
      else if(e.type==='eliminated')rec.fallen.lost++;
      else if(e.type==='happening')this.moment(track,`happening:${e.kind}`);
      else if(e.type==='last-bicho')this.moment(track,'killcam');
    }
    // Offers: the phase they arrive in; the head of the queue starts the choice clock; gone with a tap that left the
    // phone = chosen, gone without one = the room's default.
    const phase=view.round?.phase==='wave'?'combat':'intermission';
    const ids=new Set(view.offers.map(o=>o.id));
    view.offers.forEach((offer,i)=>{
      let t=track.offers.get(offer.id);
      if(!t){t={source:offer.source,phase};track.offers.set(offer.id,t);rec.offers.total++;
        if(offer.source==='level'&&rec.chip.firstMs===null)rec.chip.firstMs=at;}
      // Back after a reconnection: it was not resolved after all.
      if(t.gone)this.unresolve(rec,t);
      if(i===0&&t.headAt===undefined)t.headAt=now;
    });
    // While offline the offers can look gone: decide only with the room in view.
    if(connected)for(const [id,t] of track.offers)if(!t.gone&&!ids.has(id))this.resolve(rec,t);
    if(coach)this.coach(coach,now,'action');
  }
  private resolve(rec:UxRun,t:OfferTrack){
    if(t.tappedAt!==undefined){
      t.gone='chosen';rec.offers.chosen++;rec.offers[t.phase].chosen++;
      rec.offers.choiceMs.push(Math.round(t.tappedAt-(t.headAt??t.tappedAt)));
      const list=rec.offers.choiceMs;rec.offers.choiceMsAvg=Math.round(list.reduce((a,b)=>a+b,0)/list.length);
    }else{t.gone='default';rec.offers.defaulted++;rec.offers[t.phase].defaulted++;}
  }
  private unresolve(rec:UxRun,t:OfferTrack){
    if(t.gone==='chosen'){rec.offers.chosen--;rec.offers[t.phase].chosen--;rec.offers.choiceMs.pop();
      const list=rec.offers.choiceMs;rec.offers.choiceMsAvg=list.length?Math.round(list.reduce((a,b)=>a+b,0)/list.length):null;}
    else if(t.gone==='default'){rec.offers.defaulted--;rec.offers[t.phase].defaulted--;}
    t.gone=undefined;
  }

  /** First step and still time, from when the hero could walk: distances only, compared and dropped. */
  private move(track:RunTrack,hero:UxHero,standing:boolean,now:number){
    const rec=track.rec,from=track.moveFrom!;
    const last=track.lastHero,dt=track.lastViewAt===undefined?0:now-track.lastViewAt;
    const step=last?Math.hypot(hero.x-last.x,hero.y-last.y):0;
    const snap=step>=SNAP_DISTANCE;
    if(!track.anchor||snap)track.anchor={x:hero.x,y:hero.y};
    else if(rec.firstMoveMs===null&&standing&&Math.hypot(hero.x-track.anchor.x,hero.y-track.anchor.y)>=FIRST_MOVE_DISTANCE)rec.firstMoveMs=Math.round(now-from);
    const windowEnd=from+STILL_WINDOW_MS;
    let b=track.bucket;
    // A snap or a long gap drops the bucket in progress: neither still nor moving can be told.
    if(b&&(snap||dt>MAX_VIEW_GAP_MS))b=track.bucket=undefined;
    if(b&&now-b.start>=STILL_BUCKET_MS){
      const dur=Math.min(now,windowEnd)-b.start;
      if(dur>0&&b.standing){track.stillSeenMs+=dur;if(Math.hypot(hero.x-b.hero.x,hero.y-b.hero.y)<STILL_DISTANCE)track.stillMs+=dur;}
      b=track.bucket=undefined;
    }
    if(b)b.standing&&=standing;
    else if(now<windowEnd)track.bucket={start:now,hero:{x:hero.x,y:hero.y},standing};
    track.lastHero={x:hero.x,y:hero.y};track.lastViewAt=now;
  }

  /** The coach's state after the HUD drew this view: first time each hint shows, and when it got learned. */
  private coach(state:UxCoachState,now:number,by:'action'|'sight'){
    const track=this.current;if(!track)return;
    const at=Math.round(now-track.startedAt);
    const show=state.show;
    if(show&&isLesson(show.lesson)&&!show.done){const l=track.rec.coach[show.lesson];if(l.shownMs===null)l.shownMs=at;}
    for(const id of state.done)if(!this.coachDone.has(id)){
      this.coachDone.add(id);
      if(isLesson(id)){const l=track.rec.coach[id];if(l.learnedMs===null&&!l.knownAtStart){l.learnedMs=at;l.by=by;}}
    }
  }

  private moment(track:RunTrack,kind:string){track.rec.moments[kind]=(track.rec.moments[kind]??0)+1;}

  /** A command the player tapped (CoopClient.onCommand); `sent`: it left the phone. */
  command(command:UxCommand,sent:boolean,now:number){
    const track=this.current,open=track&&track.rec.ended==='open'?track:undefined;
    const owner=command.t==='kick'||command.t==='bot-add'||command.t==='bot-remove';
    if(owner&&!sent){this.owner.unsent++;return;}
    switch(command.t){
      case 'kick':if(command.id)this.pending.kick.add(command.id);break;
      case 'bot-add':this.pending.botAdd++;break;
      case 'bot-remove':this.pending.botRemove++;break;
      case 'choose':{
        const t=command.offer?open?.offers.get(command.offer):undefined;
        if(!open||!t)break;
        if(!sent){open.rec.offers.unsent++;break;}
        if(t.tappedAt===undefined)t.tappedAt=now;
        // Already gone as a default in the same frame (the tap and the deadline crossed): the tap wins if the room took it.
        if(t.gone==='default'){this.unresolve(open.rec,t);this.resolve(open.rec,t);}
        break;
      }
      case 'rematch':{
        if(!sent)break;
        // The rematch is pressed on the result of the last run that ended.
        const done=[...this.runs].reverse().find(r=>r.rec.ended==='result');
        if(done&&done.rec.rematch.pressedMs===null&&done.resultAt!==undefined)done.rec.rematch.pressedMs=Math.round(now-done.resultAt);
        break;
      }
    }
  }
  /** A "Me salva" relayed by the room (the player's own echo included). */
  sos(own:boolean){const t=this.current;if(!t||t.rec.ended!=='open')return;if(own)t.rec.pings.sent++;else t.rec.pings.received++;}
  /**
   * The finger dragged the joystick with a direction (explore.ts updateStick): the first one of each run counts, from
   * when the hero could walk; before the first run, the waiting room's.
   */
  stick(now:number){
    const t=this.current;
    if(t&&t.rec.ended==='open'){if(t.rec.firstStickMs===null&&t.moveFrom!==undefined)t.rec.firstStickMs=Math.round(now-t.moveFrom);return;}
    if(!this.runs.length&&this.sceneReadyAt!==undefined&&this.waitingRoom.stickMs===null)this.waitingRoom.stickMs=Math.round(now-this.sceneReadyAt);
  }
  /** A tap on the HUD the metrics care about ("Depois", the "+N" chip). */
  tap(kind:'later'|'chip',now:number){
    const t=this.current;if(!t||t.rec.ended!=='open')return;
    if(kind==='later')t.rec.offers.later++;
    else if(t.rec.chip.firstTapMs===null)t.rec.chip.firstTapMs=Math.round(now-t.startedAt);
  }
  /** The player left the room (explore close): a run still going ends as "left". */
  leave(now:number){if(this.current&&this.current.rec.ended==='open')this.close(this.current,'left',now);}

  /** The JSON-safe export (a copy: later views do not change it). */
  snapshot(now:number):UxExport{
    const open=this.current&&this.current.rec.ended==='open'?this.current:undefined;
    if(open){open.rec.durationMs=Math.round(now-open.startedAt);this.sealStill(open);}
    const p=this.pending;
    return JSON.parse(JSON.stringify({schema:UX_SCHEMA,date:this.meta.date,group:this.meta.group,device:this.meta.device,
      novice:!!this.knownAtStart&&![...this.knownAtStart].some(isLesson),sessionMs:Math.round(now-this.startedAt),waitingRoom:this.waitingRoom,
      owner:{...this.owner,unconfirmed:p.kick.size+p.botAdd+p.botRemove},runs:this.runs.map(r=>r.rec)})) as UxExport;
  }
}

// ---------- DOM ----------

type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** The page around the metrics: the browser's window, or a fake one in tests. */
export interface UxHost {
  location:{search:string};
  innerWidth:number;innerHeight:number;devicePixelRatio?:number;
  document:Document;navigator:Navigator;performance:{now():number};
  matchMedia?(query:string):{matches:boolean};
  sessionStorage?:Store;
}
export interface UxHud {
  readonly el:HTMLElement;
  readonly coach:{readonly done:ReadonlySet<string>};
  readonly coachHint?:{lesson:string;done:boolean};
}
export interface UxNet {
  readonly code:string;readonly id:string;readonly run?:RunState;readonly connected:boolean;
  onCommand?:(command:UxCommand,sent:boolean)=>void;
  onSos:(ping:SosPing)=>void;
}
/** The console handle: `__uxMetrics.data()`, `__uxMetrics.json()`, `__uxMetrics.download()`. */
export interface UxHandle {schema:typeof UX_SCHEMA;data():UxExport|undefined;json():string;download():Promise<ShareOutcome>}
export type ShareOutcome='share'|'download'|'cancelled'|'failed';

/** Hint selectors on the HUD (offer.ts): the "Depois" button and the "+N" chip. */
export const LATER_SELECTOR='.rh-offer-later',CHIP_SELECTOR='.rh-offer-chip',
  /**
   * The result's title block (title and joke line): the chip goes there, so it never adds a line to the stats row (a
   * line more there pushed cards out of view). ux-metrics.css puts it in the head's free corner in portrait and under
   * the joke line in landscape.
   */
  RESULT_SELECTOR='.rh-result-titles',
  /** The waiting room's invite row ("Chamar a turma"): the "Medir a turma" toggle sits there. */
  WAITING_SELECTOR='.coop-wait-code';
export const EXPORT_LABEL='Métricas',TEAM_LABEL='Medir a turma';

export function fileName(data:Pick<UxExport,'group'|'date'>,stamp:number){return `viagem-ux-${data.date}-${data.group||'grupo'}-${stamp}.json`;}

const readStore=(host:{sessionStorage?:Store}|undefined)=>{try{return host?.sessionStorage;}catch{return undefined;}};

/** Hands the JSON over: the phone's share sheet with the file when it can, else a plain download. */
export async function shareJson(doc:Document,nav:Navigator,data:Pick<UxExport,'group'|'date'>,json:string):Promise<ShareOutcome>{
  const name=fileName(data,Date.now());
  const n=nav as Navigator&{canShare?(d:ShareData):boolean};
  try{
    const file=new File([json],name,{type:'application/json'});
    if(n.share&&n.canShare?.({files:[file]})){await n.share({files:[file],title:name});return 'share';}
  }catch(e){
    // Closing the share sheet is not an error: the button just goes back to its label.
    if((e as DOMException)?.name==='AbortError')return 'cancelled';
  }
  try{
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const a=doc.createElement('a');a.href=url;a.download=name;a.hidden=true;doc.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    return 'download';
  }catch{return 'failed';}
}

/**
 * The quiet "Métricas" chip (dev only): a 44 px tall button whose visible part is the chip inside it, so the row it sits
 * in keeps its height. `run` hands the JSON over; the label says how it went for 2 s (a cancelled share says nothing).
 */
export function createExportButton(doc:Document,run:()=>Promise<ShareOutcome>,className='ux-dev-export'){
  const b=doc.createElement('button');b.type='button';b.className=className;
  const chip=doc.createElement('span');chip.className='ux-dev-chip';chip.textContent=EXPORT_LABEL;b.append(chip);
  b.setAttribute('aria-label','Métricas do playtest (dev): compartilhar o arquivo JSON');
  for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)b.addEventListener(type,e=>e.stopPropagation());
  let timer:ReturnType<typeof setTimeout>|undefined;
  b.addEventListener('click',async e=>{
    e.stopPropagation();
    const how=await run();
    clearTimeout(timer);
    if(how==='cancelled'){chip.textContent=EXPORT_LABEL;return;}
    chip.textContent=how==='failed'?'Não deu':how==='share'?'Enviado':'Baixado';
    timer=setTimeout(()=>{chip.textContent=EXPORT_LABEL;},2000);
  });
  return b;
}

/**
 * The start screen (dev only): "Métricas" for this tab's last room session, kept in sessionStorage, so the file can be
 * taken after "Sair" too. Does nothing without a stored session or when the button is already there.
 */
export function mountHomeExport(host:Pick<UxHost,'document'|'navigator'|'sessionStorage'>){
  const doc=host.document;
  if(doc.querySelector('.ux-dev-home'))return;
  void import('./ux-metrics.css').catch(()=>undefined);
  let json:string|null|undefined;try{json=readStore(host)?.getItem(LAST_KEY);}catch{json=undefined;}
  if(!json)return;
  const b=createExportButton(doc,async()=>{
    const raw=readStore(host)?.getItem(LAST_KEY);if(!raw)return 'failed';
    try{const data=JSON.parse(raw) as UxExport;return shareJson(doc,host.navigator,data,raw);}catch{return 'failed';}
  },'ux-dev-export ux-dev-home');
  doc.body.append(b);
}

/**
 * Turns the metrics on for this room session, only with `?dev=1`; otherwise returns undefined and touches nothing
 * (not even `window`). explore.ts calls the returned object's methods with `?.`.
 */
export function createUxMetrics(host:UxHost|undefined,net:UxNet):UxMetrics|undefined{
  if(!host||!uxMetricsEnabled(host.location.search))return undefined;
  return new UxMetrics(host,net);
}

export class UxMetrics {
  readonly recorder:UxRecorder;
  private readonly host:UxHost;
  private readonly net:UxNet;
  private hud?:UxHud;
  private button?:HTMLButtonElement;
  private toggle?:HTMLButtonElement;
  private readonly abort=new AbortController();
  private readonly onCommand:UxNet['onCommand'];
  private readonly onSos:UxNet['onSos'];
  private readonly prevCommand:UxNet['onCommand'];
  private readonly prevSos:UxNet['onSos'];
  private lastPhase?:string;
  constructor(host:UxHost,net:UxNet){
    this.host=host;this.net=net;
    const w=host.innerWidth,h=host.innerHeight;
    const text=host.document.documentElement.dataset.texto??'100';
    this.recorder=new UxRecorder({group:groupLabel(host.location.search,readStore(host)),date:new Date().toISOString().slice(0,10),
      device:{viewport:`${w}x${h}`,orientation:h>=w?'retrato':'paisagem',dpr:host.devicePixelRatio??1,text,touch:!!host.matchMedia?.('(pointer: coarse)').matches}},host.performance.now());
    // Run commands and the owner's ones, from the waiting room too (mountWaitingRoom shares this client); "Me salva"
    // relayed by the room after RescueBoard's own handler. Both go back as they were on destroy.
    const prevCommand=this.prevCommand=net.onCommand,prevSos=this.prevSos=net.onSos;
    this.onCommand=(command,sent)=>{prevCommand?.(command,sent);this.recorder.command(command,sent,this.host.performance.now());};
    this.onSos=ping=>{prevSos(ping);this.recorder.sos(ping.id===net.id);};
    net.onCommand=this.onCommand;net.onSos=this.onSos;
    const handle:UxHandle={schema:UX_SCHEMA,data:()=>this.data(),json:()=>JSON.stringify(this.data(),null,2),download:()=>this.download()};
    (host as unknown as {__uxMetrics?:UxHandle}).__uxMetrics=handle;
    // The CSS of the dev buttons is loaded only now (never with the flag off).
    void import('./ux-metrics.css').catch(()=>undefined);
    this.mountToggle();
  }
  data(){return this.recorder.snapshot(this.host.performance.now());}

  /** "Medir a turma" next to "Chamar a turma": only then do this tab's invites carry `&dev=1&g=…` (ux-flag.ts). */
  private mountToggle(){
    if(this.toggle?.isConnected)return;
    const row=this.host.document.querySelector<HTMLElement>(WAITING_SELECTOR);if(!row)return;
    const b=this.toggle=this.host.document.createElement('button');
    b.type='button';b.className='ux-dev-export ux-dev-team';
    const chip=this.host.document.createElement('span');chip.className='ux-dev-chip';chip.textContent=TEAM_LABEL;b.append(chip);
    const store=readStore(this.host);
    const sync=()=>{const on=measuringTeam(store);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'Medir a turma: ligado, o convite leva as métricas':'Medir a turma: desligado');};
    sync();
    b.addEventListener('click',()=>{setMeasuringTeam(!measuringTeam(store),store);sync();},{signal:this.abort.signal});
    row.append(b);
  }

  /** The run HUD: taps on "Depois" and the chip (capture phase: the HUD's panels stop their own bubbling), the button. */
  attachHud(hud:UxHud){
    this.hud=hud;
    hud.el.addEventListener('click',event=>{
      const target=event.target as Element|null;if(!target?.closest)return;
      const now=this.host.performance.now();
      if(target.closest(LATER_SELECTOR))this.recorder.tap('later',now);
      else if(target.closest(CHIP_SELECTOR))this.recorder.tap('chip',now);
    },{capture:true,signal:this.abort.signal});
    const stats=hud.el.querySelector<HTMLElement>(RESULT_SELECTOR);
    if(stats){this.button=createExportButton(this.host.document,()=>this.download());stats.append(this.button);}
  }
  ready(){this.recorder.sceneReady(this.host.performance.now());}
  /** Every frame (explore.ts position): only run phase changes do work. */
  tick(){
    const hud=this.hud,run=this.net.run;
    this.recorder.runState(run,this.net.id,this.host.performance.now(),hud&&{done:hud.coach.done,show:hud.coachHint});
    if(run&&run.phase!==this.lastPhase){
      this.lastPhase=run.phase;
      if(run.phase==='result')this.save();
      if(run.phase!=='combat')this.mountToggle();
    }
  }
  /** Every view, after the HUD drew it (the coach's state is fresh); `combat`: the run phase is combat. */
  view(view:RunView,hero:UxHero|undefined,combat=true){
    const hud=this.hud;
    this.recorder.view(view,this.net.id,hero,this.net.connected,this.host.performance.now(),hud&&{done:hud.coach.done,show:hud.coachHint},combat);
  }
  stick(){this.recorder.stick(this.host.performance.now());}
  /** This tab keeps the last session (sessionStorage): the start screen's "Métricas" after "Sair". */
  private save(){try{readStore(this.host)?.setItem(LAST_KEY,JSON.stringify(this.data()));}catch{/* storage off: console only */}}
  /** The player left: the run still going ends as "left"; the hooks go back; the start screen keeps "Métricas". */
  destroy(){
    this.recorder.leave(this.host.performance.now());this.save();
    if(this.net.onCommand===this.onCommand)this.net.onCommand=this.prevCommand;
    if(this.net.onSos===this.onSos)this.net.onSos=this.prevSos;
    this.abort.abort();this.button?.remove();this.toggle?.remove();
    mountHomeExport(this.host);
  }
  download(){const data=this.data();return shareJson(this.host.document,this.host.navigator,data,JSON.stringify(data,null,2));}
}
