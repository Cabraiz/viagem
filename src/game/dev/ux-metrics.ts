/**
 * Playtest metrics (NEW-20261009-UX-playtest-metricas): what a novice does in the first minutes, measured on the phone
 * itself and handed over as a JSON file at the end of the run. Without a measure no UX change can be proven.
 *
 * Rules:
 * - Only with `?dev=1` in the page address (dev/ux-flag.ts). Off by default, and off costs nothing: this module is
 *   imported on demand only when the flag is on, `createUxMetrics` returns undefined before touching window, the DOM or a
 *   timer, and every call site is `ux?.…`.
 * - Local only: no server, no network request. The JSON leaves the phone only when someone taps "Métricas" (share sheet
 *   or download) or reads `window.__uxMetrics` from the console.
 * - No positions and no personal data: no names, no player ids, no coordinates (distances are turned into "moved or
 *   not" on the spot), no user agent. The room code stays, so phones of the same group can be put together.
 * Pure state (UxRecorder, unit-tested under node) plus a thin DOM part (createUxMetrics) that explore.ts drives.
 */
import type {RunView} from '../sim/view.ts';
import type {RunState} from '../net/run.ts';
import {uxMetricsEnabled} from './ux-flag.ts';
export {UX_FLAG,uxMetricsEnabled} from './ux-flag.ts';

export const UX_SCHEMA='viagem-ux/1';
/** Still time is counted only in this first stretch of each run (ms). */
export const STILL_WINDOW_MS=60000;
/**
 * Still time is read in buckets of this length (ms): a bucket where the hero moved less than STILL_DISTANCE counts as
 * standing still. Buckets, not view to view: on a slow phone the hero's spot may only change every few frames.
 */
export const STILL_BUCKET_MS=2000;
/** Less than this (world units) in a whole bucket is standing still (walking covers ~6 u in 2 s). */
export const STILL_DISTANCE=0.15;
/** The first movement: this far (world units) from where the hero stood when the run started. */
export const FIRST_MOVE_DISTANCE=0.25;
/** A jump this long between two views is a snap (spawn, reconnection), not a step (same as the coach's). */
export const SNAP_DISTANCE=2.5;
/** Views farther apart than this (tab in the background): the bucket in progress is dropped, not counted either way. */
export const MAX_VIEW_GAP_MS=1000;

export type CoachLessonId='walk'|'xp'|'chip'|'rescue'|'gather';
export const COACH_LESSONS:readonly CoachLessonId[]=['walk','xp','chip','rescue','gather'];
export interface UxCoachLesson {
  /** This phone already knew it when the session started (an earlier run): no hint expected. */
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
   * ms from the run start to the hero's first step as the game saw it (FIRST_MOVE_DISTANCE), and to the finger's first
   * drag on the joystick (the novice's reaction: the report's "1º movimento").
   */
  firstMoveMs:number|null;firstStickMs:number|null;
  /**
   * Seconds standing (not caído) without moving inside the first STILL_WINDOW_MS (in STILL_BUCKET_MS buckets), and how
   * much of that window was seen standing.
   */
  still60:{seconds:number;windowSeconds:number};
  downs:{me:number;meRound1:number;team:number;teamRound1:number};
  /** Falls that ended: rescued (by anyone, by this player) or lost (bled out). */
  fallen:{rescued:number;rescuedByMe:number;lost:number};
  offers:{total:number;chosen:number;defaulted:number;pendingAtEnd:number;combat:UxOfferPhase;intermission:UxOfferPhase;
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
  rematch:{pressedMs:number|null;started:boolean};
}
export interface UxExport {
  schema:typeof UX_SCHEMA;
  /** Day only (YYYY-MM-DD), to order files; no clock time. */
  date:string;
  /** The room code: phones with the same group played together. */
  group:string;
  device:{viewport:string;orientation:'retrato'|'paisagem';dpr:number;text:string;touch:boolean};
  /** The coach knew no lesson when the session started: a first-time phone (the playtest's novice). */
  novice:boolean;
  sessionMs:number;
  owner:{isOwner:boolean;kick:number;botAdd:number;botRemove:number};
  runs:UxRun[];
}

/** What the client sends (CoopClient.onCommand): the room's run commands (choose, rematch, owner's, ready). */
export interface UxCommand {t:string;offer?:string;index?:number}
/** What the HUD's coach shows and knows (RunHud.coachHint / RunHud.coach.done). */
export interface UxCoachState {done:ReadonlySet<string>;show?:{lesson:string;done:boolean}}
/** The hero's spot in this view; used only to tell "moved" from "stood", never stored. */
export interface UxHero {x:number;y:number}

interface OfferTrack {source:string;headAt?:number;chosenAt?:number;gone?:boolean;phase:'combat'|'intermission'}
interface RunTrack {
  rec:UxRun;startedAt:number;resultAt?:number;
  anchor?:UxHero;lastHero?:UxHero;lastViewAt?:number;stillMs:number;stillSeenMs:number;
  /** The still-time bucket in progress: when it began, where the hero was, and whether it stood (not caído) all along. */
  bucket?:{start:number;hero:UxHero;standing:boolean};
  offers:Map<string,OfferTrack>;lastEventId:number;
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
  private readonly owner={isOwner:false,kick:0,botAdd:0,botRemove:0};
  private knownAtStart?:Set<string>;
  private coachDone=new Set<string>();
  private readonly meta:{group:string;device:UxExport['device'];date:string};
  constructor(meta:{group:string;device:UxExport['device'];date:string},now:number){this.meta=meta;this.startedAt=now;}

  /** The room's run state (every frame is fine: only changes do work). */
  runState(run:Pick<RunState,'round'|'phase'|'members'|'owner'|'outcome'|'shame'>|undefined,localId:string|undefined,now:number,coach?:UxCoachState){
    if(!run)return;
    if(localId)this.owner.isOwner=run.owner===localId;
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

  private start(round:number,members:readonly {bot?:true}[],now:number,coach?:UxCoachState):RunTrack{
    if(!this.knownAtStart)this.knownAtStart=new Set(coach?.done??[]);
    const known=new Set(coach?.done??[]);this.coachDone=new Set(known);
    const coachRec=Object.fromEntries(COACH_LESSONS.map(l=>[l,emptyLesson(known.has(l))])) as Record<CoachLessonId,UxCoachLesson>;
    const rec:UxRun={run:round,ended:'open',outcome:null,durationMs:0,roundReached:0,
      team:{people:members.filter(m=>!m.bot).length,bots:members.filter(m=>m.bot).length},
      firstMoveMs:null,firstStickMs:null,still60:{seconds:0,windowSeconds:0},
      downs:{me:0,meRound1:0,team:0,teamRound1:0},fallen:{rescued:0,rescuedByMe:0,lost:0},
      offers:{total:0,chosen:0,defaulted:0,pendingAtEnd:0,combat:{chosen:0,defaulted:0},intermission:{chosen:0,defaulted:0},choiceMs:[],choiceMsAvg:null,later:0},
      chip:{firstMs:null,firstTapMs:null},coach:coachRec,pings:{sent:0,received:0},emotes:{available:false,sent:0},moments:{},
      rematch:{pressedMs:null,started:false}};
    const track:RunTrack={rec,startedAt:now,stillMs:0,stillSeenMs:0,offers:new Map(),lastEventId:-1};
    this.runs.push(track);
    return track;
  }

  private close(track:RunTrack,ended:'result'|'left',now:number){
    track.rec.ended=ended;track.resultAt=now;track.rec.durationMs=Math.round(now-track.startedAt);
    for(const offer of track.offers.values())if(offer.chosenAt===undefined&&!offer.gone)track.rec.offers.pendingAtEnd++;
    this.sealStill(track);
  }
  private sealStill(track:RunTrack){
    track.rec.still60={seconds:Math.round(track.stillMs/100)/10,windowSeconds:Math.round(Math.min(STILL_WINDOW_MS,track.stillSeenMs)/100)/10};
  }

  /** A run view (explore.ts runView, combat only). `hero`: the predicted spot, only compared, never kept past the next view. */
  view(view:RunView,localId:string,hero:UxHero|undefined,connected:boolean,now:number,coach?:UxCoachState){
    const track=this.current;
    if(!track||track.rec.ended!=='open')return;
    const rec=track.rec,at=Math.round(now-track.startedAt);
    if(view.round?.index)rec.roundReached=Math.max(rec.roundReached,view.round.index);
    const me=view.players.find(p=>p.id===localId);
    const standing=!!me&&!me.spectator&&!me.eliminated&&!me.downed&&me.hp>0;
    // Movement and still time: distances only, compared and dropped.
    if(hero){
      const last=track.lastHero,dt=track.lastViewAt===undefined?0:now-track.lastViewAt;
      const step=last?Math.hypot(hero.x-last.x,hero.y-last.y):0;
      const snap=step>=SNAP_DISTANCE;
      if(!track.anchor||snap)track.anchor={x:hero.x,y:hero.y};
      else if(rec.firstMoveMs===null&&standing&&Math.hypot(hero.x-track.anchor.x,hero.y-track.anchor.y)>=FIRST_MOVE_DISTANCE)rec.firstMoveMs=at;
      const windowEnd=track.startedAt+STILL_WINDOW_MS;
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
    // Events (de-duplicated by their monotonic id): falls, rescues, pings come apart (sos), laughter moments.
    const round=view.round?.index??0;
    for(const e of view.events){
      if(e.eventId<=track.lastEventId)continue;track.lastEventId=e.eventId;
      if(e.type==='downed'){rec.downs.team++;if(round===1)rec.downs.teamRound1++;if(e.player===localId){rec.downs.me++;if(round===1)rec.downs.meRound1++;}}
      else if(e.type==='revived'){rec.fallen.rescued++;if(e.by===localId)rec.fallen.rescuedByMe++;}
      else if(e.type==='eliminated')rec.fallen.lost++;
      else if(e.type==='happening')this.moment(track,`happening:${e.kind}`);
      else if(e.type==='last-bicho')this.moment(track,'killcam');
    }
    // Offers: the head of the queue starts the choice clock; an offer gone without this player's tap went by default.
    const phase=view.round?.phase==='wave'?'combat':'intermission';
    const ids=new Set(view.offers.map(o=>o.id));
    view.offers.forEach((offer,i)=>{
      let t=track.offers.get(offer.id);
      if(!t){t={source:offer.source,phase};track.offers.set(offer.id,t);rec.offers.total++;
        if(offer.source==='level'&&rec.chip.firstMs===null)rec.chip.firstMs=at;}
      // Back after a reconnection: it was not resolved after all.
      if(t.gone){t.gone=false;rec.offers.defaulted--;rec.offers[t.phase].defaulted--;}
      t.phase=phase;
      if(i===0&&t.headAt===undefined)t.headAt=now;
    });
    // While offline the offers can look gone: decide only with the room in view.
    if(connected)for(const [id,t] of track.offers)if(!t.gone&&t.chosenAt===undefined&&!ids.has(id)){
      t.gone=true;rec.offers.defaulted++;rec.offers[t.phase].defaulted++;
    }
    if(coach)this.coach(coach,now,'action');
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

  /** A command the player sent (CoopClient.onCommand). */
  command(command:UxCommand,now:number){
    const track=this.current,open=track&&track.rec.ended==='open'?track:undefined;
    switch(command.t){
      case 'kick':this.owner.kick++;break;
      case 'bot-add':this.owner.botAdd++;break;
      case 'bot-remove':this.owner.botRemove++;break;
      case 'choose':{
        const t=command.offer?open?.offers.get(command.offer):undefined;
        if(open&&t&&t.chosenAt===undefined){
          t.chosenAt=now;
          if(t.gone){t.gone=false;open.rec.offers.defaulted--;open.rec.offers[t.phase].defaulted--;}
          open.rec.offers.chosen++;open.rec.offers[t.phase].chosen++;
          const ms=Math.round(now-(t.headAt??now));open.rec.offers.choiceMs.push(ms);
          const list=open.rec.offers.choiceMs;open.rec.offers.choiceMsAvg=Math.round(list.reduce((a,b)=>a+b,0)/list.length);
        }
        break;
      }
      case 'rematch':{
        // The rematch is pressed on the result of the last run that ended.
        const done=[...this.runs].reverse().find(r=>r.rec.ended==='result');
        if(done&&done.rec.rematch.pressedMs===null&&done.resultAt!==undefined)done.rec.rematch.pressedMs=Math.round(now-done.resultAt);
        break;
      }
    }
  }
  /** A "Me salva" relayed by the room (the player's own echo included). */
  sos(own:boolean){const t=this.current;if(!t||t.rec.ended!=='open')return;if(own)t.rec.pings.sent++;else t.rec.pings.received++;}
  /** The finger dragged the joystick with a direction (explore.ts updateStick): the first one counts. */
  stick(now:number){const t=this.current;if(t&&t.rec.ended==='open'&&t.rec.firstStickMs===null)t.rec.firstStickMs=Math.round(now-t.startedAt);}
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
    return JSON.parse(JSON.stringify({schema:UX_SCHEMA,date:this.meta.date,group:this.meta.group,device:this.meta.device,
      novice:!!this.knownAtStart&&![...this.knownAtStart].some(isLesson),sessionMs:Math.round(now-this.startedAt),
      owner:this.owner,runs:this.runs.map(r=>r.rec)})) as UxExport;
  }
}

// ---------- DOM ----------

/** The page around the metrics: the browser's window, or a fake one in tests. */
export interface UxHost {
  location:{search:string};
  innerWidth:number;innerHeight:number;devicePixelRatio?:number;
  document:Document;navigator:Navigator;performance:{now():number};
  matchMedia?(query:string):{matches:boolean};
}
export interface UxHud {
  readonly el:HTMLElement;
  readonly coach:{readonly done:ReadonlySet<string>};
  readonly coachHint?:{lesson:string;done:boolean};
}
export interface UxNet {
  readonly code:string;readonly id:string;readonly run?:RunState;readonly connected:boolean;
  onCommand?:(command:UxCommand)=>void;
}
/** The console handle: `__uxMetrics.data()`, `__uxMetrics.json()`, `__uxMetrics.download()`. */
export interface UxHandle {schema:typeof UX_SCHEMA;data():UxExport;json():string;download():Promise<'share'|'download'|'failed'>}

/** Hint selectors on the HUD (offer.ts): the "Depois" button and the "+N" chip. */
export const LATER_SELECTOR='.rh-offer-later',CHIP_SELECTOR='.rh-offer-chip',
  /** The result's stats row (time, round): the button sits at its end. */
  RESULT_SELECTOR='.rh-result-stats';
export const EXPORT_LABEL='Métricas';

export function fileName(data:Pick<UxExport,'group'|'date'>,stamp:number){return `viagem-ux-${data.date}-${data.group||'sala'}-${stamp}.json`;}

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
  private readonly abort=new AbortController();
  constructor(host:UxHost,net:UxNet){
    this.host=host;this.net=net;
    const w=host.innerWidth,h=host.innerHeight;
    const text=host.document.documentElement.dataset.texto??'100';
    this.recorder=new UxRecorder({group:net.code,date:new Date().toISOString().slice(0,10),
      device:{viewport:`${w}x${h}`,orientation:h>=w?'retrato':'paisagem',dpr:host.devicePixelRatio??1,text,touch:!!host.matchMedia?.('(pointer: coarse)').matches}},host.performance.now());
    // Run commands and the owner's ones, from the waiting room too (mountWaitingRoom shares this client).
    const prev=net.onCommand;
    net.onCommand=command=>{prev?.(command);this.recorder.command(command,this.host.performance.now());};
    const handle:UxHandle={schema:UX_SCHEMA,data:()=>this.data(),json:()=>JSON.stringify(this.data(),null,2),download:()=>this.download()};
    (host as unknown as {__uxMetrics?:UxHandle}).__uxMetrics=handle;
    // The CSS of the dev button is loaded only now (never with the flag off).
    void import('./ux-metrics.css').catch(()=>undefined);
  }
  data(){return this.recorder.snapshot(this.host.performance.now());}

  /** The run HUD: taps on "Depois" and the chip (capture phase: the HUD's panels stop their own bubbling), the button. */
  attachHud(hud:UxHud){
    this.hud=hud;
    hud.el.addEventListener('click',event=>{
      const target=event.target as Element|null;if(!target?.closest)return;
      const now=this.host.performance.now();
      if(target.closest(LATER_SELECTOR))this.recorder.tap('later',now);
      else if(target.closest(CHIP_SELECTOR))this.recorder.tap('chip',now);
    },{capture:true,signal:this.abort.signal});
    const result=hud.el.querySelector<HTMLElement>(RESULT_SELECTOR);
    if(result){
      const b=this.button=this.host.document.createElement('button');
      b.type='button';b.className='ux-dev-export';b.textContent=EXPORT_LABEL;
      b.setAttribute('aria-label','Métricas do playtest (dev): compartilhar o arquivo JSON');
      for(const type of ['pointerdown','pointerup','touchstart','mousedown'] as const)b.addEventListener(type,e=>e.stopPropagation(),{signal:this.abort.signal});
      b.addEventListener('click',async e=>{
        e.stopPropagation();
        const how=await this.download();
        b.textContent=how==='failed'?'Não deu':how==='share'?'Enviado':'Baixado';
        setTimeout(()=>{b.textContent=EXPORT_LABEL;},2000);
      },{signal:this.abort.signal});
      result.append(b);
    }
  }
  /** Every frame (explore.ts position): only run phase changes do work. */
  tick(){
    const hud=this.hud;
    this.recorder.runState(this.net.run,this.net.id,this.host.performance.now(),hud&&{done:hud.coach.done,show:hud.coachHint});
  }
  /** Every combat view, after the HUD drew it (the coach's state is fresh). */
  view(view:RunView,hero:UxHero|undefined){
    const hud=this.hud;
    this.recorder.view(view,this.net.id,hero,this.net.connected,this.host.performance.now(),hud&&{done:hud.coach.done,show:hud.coachHint});
  }
  stick(){this.recorder.stick(this.host.performance.now());}
  sos(own:boolean){this.recorder.sos(own);}
  /** The player left: the run still going ends as "left"; the console handle keeps the data. */
  destroy(){this.recorder.leave(this.host.performance.now());this.abort.abort();this.button?.remove();}

  /** The phone's share sheet with the file (WhatsApp, e-mail…) when it can, else a plain download. */
  async download():Promise<'share'|'download'|'failed'>{
    const data=this.data(),json=JSON.stringify(data,null,2),name=fileName(data,Date.now());
    const nav=this.host.navigator as Navigator&{canShare?(d:ShareData):boolean};
    try{
      const file=new File([json],name,{type:'application/json'});
      if(nav.share&&nav.canShare?.({files:[file]})){await nav.share({files:[file],title:name});return 'share';}
    }catch(e){if((e as DOMException)?.name==='AbortError')return 'failed';/* no share sheet: download */}
    try{
      const doc=this.host.document,url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=doc.createElement('a');a.href=url;a.download=name;a.hidden=true;doc.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      return 'download';
    }catch{return 'failed';}
  }
}
