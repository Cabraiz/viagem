/**
 * Match music (NEW-20261014-ORQ-musica-do-chefe), two files kept as light as possible on a phone: the theme
 * ("Radio na Floresta", looping very low through the match) and the boss's ("Static Riff", while the boss lives).
 * - Format: Opus/WebM when the browser can play it, else AAC/M4A, else that track stays silent.
 * - Streaming: each track is one `<audio loop>` routed by a MediaElementAudioSourceNode into its own gain (its relative
 *   level), then into the engine's music bus, so the "Música" volume and mute (settings.ts) and the limiter apply. No decodeAudioData: the files
 *   stay compressed (a minute of PCM would be 11-22 MB).
 * - iOS unlock: in a gesture (the engine unlocks its context in the same one) each element plays a tiny silent WAV
 *   (a data URI, no network) at gain 0 and pauses. iOS then lets that element play() outside a gesture, after its
 *   src changes too, which is what the music needs: the boss shows up without a tap.
 * - Loading: one low-priority fetch of the whole file, a plain GET, so the service worker keeps it for the next
 *   matches (the element's own Range requests skip the worker); the element then reads a blob URL. A failed fetch
 *   falls back to streaming the URL. The theme waits a few seconds into the match (never the 3G entry); the boss
 *   waits for round 6, the chaveiro's ETA under 3 min, or the boss itself. Silence until a file arrives.
 * - Each track: idle -> loading -> ready -> playing (fade-in) -> stopping (fade-out) -> ready. GameMusic decides:
 *   the boss comes, the theme fades out (1.5 s) as the boss fades in (1 s); the boss dies, its music fades out (2 s)
 *   and then the theme fades back in (2 s); the run ends, both fade out (2 s). Mute or a hidden tab pause both
 *   elements; they resume where wanted. Never throws; a play() refused by the autoplay policy waits for a gesture.
 * - The menu's track (menu-music.ts) is a MusicTrack too; its download is abortable (cancelLoad) so it yields to the match.
 */
import type {RunView} from '../../contract/index.ts';
import {UNLOCK_EVENTS} from './engine.ts';
import {busQuiet,type BusSettings} from './settings.ts';

export interface TrackSpec {webm:string;m4a:string;
  /** Gain under the music bus at full fade (times the "Música" volume). */
  level:number;
  /** Starts from the top every time (the boss) instead of where it stopped (the theme). */
  rewind:boolean}
export const BOSS_TRACK:Readonly<TrackSpec>=Object.freeze({webm:'/audio/boss.webm',m4a:'/audio/boss.m4a',level:.6,rewind:true});
/** The theme's level: ~25 % of the music bus, under the effects (tune by ear here). */
export const THEME_LEVEL=.25;
export const THEME_TRACK:Readonly<TrackSpec>=Object.freeze({webm:'/audio/tema.webm',m4a:'/audio/tema.m4a',level:THEME_LEVEL,rewind:false});
export const MUSIC_WEBM=BOSS_TRACK.webm;
export const MUSIC_M4A=BOSS_TRACK.m4a;
export const MUSIC_LEVEL=BOSS_TRACK.level;

export const LOAD_FROM_ROUND=6;
export const LOAD_ETA_S=180;
/** The theme's download starts this long after the first match view: the entry's own downloads go first. */
export const THEME_LOAD_DELAY_MS=3000;
export const FADE_IN_S=1;
export const FADE_OUT_S=2;
export const THEME_OUT_S=1.5;
export const THEME_IN_S=2;
export const END_OUT_S=2;

export type MusicState='idle'|'loading'|'ready'|'playing'|'stopping';
/** What the music needs from a view: how far the match is, whether the boss is alive and whether the run is over. */
export interface MusicCue {round?:number;etaS?:number;boss:boolean;ended?:boolean}

/** The file of `track` this browser should stream, or null when it plays neither. */
export function pickMusicSource(canPlay:(type:string)=>string,track:{webm:string;m4a:string}=BOSS_TRACK):string|null{
  const ok=(type:string)=>{try{const answer=canPlay(type);return answer==='probably'||answer==='maybe';}catch{return false;}};
  return ok('audio/webm; codecs="opus"')?track.webm:ok('audio/mp4; codecs="mp4a.40.2"')?track.m4a:null;
}

/** The boss file: far enough from the start that the download cannot compete with the match's entrance. */
export function shouldLoad(cue:MusicCue):boolean{
  return cue.boss||(cue.round??0)>=LOAD_FROM_ROUND||(cue.etaS!==undefined&&cue.etaS>0&&cue.etaS<LOAD_ETA_S);
}

export function musicCue(view:RunView,ended:boolean):MusicCue{
  const objective=view.objective,over=ended||!!objective?.ended;
  return {round:view.round?.index??view.wave?.index,etaS:objective&&!objective.ended?objective.etaS:undefined,
    boss:!over&&view.enemies.some(enemy=>enemy.boss&&enemy.hp>0),ended:over};
}

export interface MusicElement {
  src:string;loop:boolean;preload:string;currentTime:number;readonly paused:boolean;
  canPlayType(type:string):string;play():Promise<void>|void;pause():void;load():void;removeAttribute(name:string):void;
}
export interface MusicEngine {
  readonly unlocked:boolean;readonly context:AudioContext|undefined;
  /** The music bus ("Música" volume and mute, then the master's limiter). */
  readonly musicOutput:AudioNode|undefined;
  readonly settings:{music:BusSettings};
  onChange(listener:()=>void):()=>void;
  attachUnlock(target:EventTarget):()=>void;
}
export interface MusicOptions {
  engine:MusicEngine;
  createElement?:(track:Readonly<TrackSpec>)=>MusicElement|undefined;
  /** Overrides the format pick per track (tests); null silences that track. */
  sources?:{boss?:string|null;theme?:string|null};
  /** Downloads a file and gives a URL the element can read (default: low-priority fetch to a blob URL); `signal` aborts it. */
  fetchUrl?:(url:string,signal?:AbortSignal)=>Promise<string>;
  revokeUrl?:(url:string)=>void;
  setTimer?:(fn:()=>void,ms:number)=>unknown;
  clearTimer?:(id:unknown)=>void;
}
export interface TrackHost {
  engine:MusicEngine;
  fetchUrl:(url:string,signal?:AbortSignal)=>Promise<string>;
  revokeUrl:(url:string)=>void;
  setTimer:(fn:()=>void,ms:number)=>unknown;
  clearTimer:(id:unknown)=>void;
  /** Music muted, music volume 0 or a hidden tab: the elements pause. */
  quiet:()=>boolean;
}
export type Page=EventTarget&{visibilityState?:string};

let silent:string|undefined;
/** 8 samples of 8-bit silence, ~70 bytes: enough for iOS to count the element as played in a gesture. */
function silentWav():string{
  if(silent)return silent;
  const samples=8,bytes=new Uint8Array(44+samples),view=new DataView(bytes.buffer);
  const text=(at:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,36+samples,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,8000,true);
  view.setUint16(32,1,true);view.setUint16(34,8,true);text(36,'data');view.setUint32(40,samples,true);bytes.fill(128,44);
  return silent='data:audio/wav;base64,'+btoa(String.fromCharCode(...bytes));
}

async function fetchBlobUrl(url:string,signal?:AbortSignal):Promise<string>{
  const response=await fetch(url,{priority:'low',signal} as RequestInit);
  if(!response.ok)throw new Error(String(response.status));
  return URL.createObjectURL(await response.blob());
}

export function defaultElement():MusicElement|undefined{
  const audio=globalThis.document?.createElement('audio');
  if(!audio||typeof audio.canPlayType!=='function')return undefined;
  audio.preload='none';
  return audio;
}

/** One looping file: its element, its gain and its state; GameMusic says when it plays. */
export class MusicTrack {
  private st:MusicState='idle';
  private readonly el:MusicElement|undefined;
  private readonly url:string|null;
  private readonly spec:Readonly<TrackSpec>;
  private readonly host:TrackHost;
  private gain:GainNode|undefined;
  private node:AudioNode|undefined;
  private want=false;
  private fadeS=FADE_IN_S;
  private delayS=0;
  private blocked=false;
  private unlockedEl=false;
  private realSrc=false;
  private objectUrl:string|undefined;
  private timer:unknown;
  private disposed=false;
  /** Bumped by cancelLoad: a download that answers after it is dropped. */
  private loadGen=0;
  private loadAbort:AbortController|undefined;

  constructor(spec:Readonly<TrackSpec>,host:TrackHost,el:MusicElement|undefined,source?:string|null){
    this.spec=spec;this.host=host;
    let url:string|null=null;
    try{if(el)url=source!==undefined?source:pickMusicSource(type=>el.canPlayType(type),spec);}catch{url=null;}
    this.url=url;this.el=url?el:undefined;
  }

  get state():MusicState{return this.st;}
  get source(){return this.url;}
  get wanted(){return this.want;}
  /** Playing or fading out. */
  get active(){return this.st==='playing'||this.st==='stopping';}
  /** Whether the element is actually producing the music right now. */
  get sounding(){return !!this.el&&!this.el.paused&&this.realSrc;}

  load(){
    if(!this.el||this.disposed||this.st!=='idle')return;
    this.st='loading';
    const url=this.url!,gen=this.loadGen;
    const abort=this.loadAbort=typeof AbortController==='function'?new AbortController():undefined;
    let job:Promise<string>;
    try{job=this.host.fetchUrl(url,abort?.signal);}catch(error){job=Promise.reject(error);}
    void job.then(found=>found,()=>url).then(found=>{
      if(gen!==this.loadGen||this.disposed||!this.el){if(found!==url)this.host.revokeUrl(found);return;}
      this.loadAbort=undefined;
      if(found!==url)this.objectUrl=found;
      try{this.el.loop=true;this.el.preload='auto';this.el.src=found;}catch{return;}
      this.realSrc=true;this.st='ready';
      if(this.want)this.start();
    });
  }

  /** Gives the bandwidth back: a download still running is aborted and the track is idle again (load() restarts it). */
  cancelLoad(){
    if(this.st!=='loading')return;
    this.loadGen++;this.st='idle';
    const abort=this.loadAbort;this.loadAbort=undefined;
    try{abort?.abort();}catch{/* ignored */}
  }

  /** Fades in over `fadeS` after `delayS` (now, or as soon as the file arrives). */
  play(fadeS:number,delayS=0){
    if(!this.el||this.disposed||this.want)return;
    this.want=true;this.fadeS=fadeS;this.delayS=delayS;
    if(this.st==='ready'||this.st==='stopping')this.start();
  }

  /** Fades out over `fadeS`, then pauses (and rewinds, for the boss). */
  stop(fadeS:number){
    if(!this.el||this.disposed||!this.want)return;
    this.want=false;
    if(this.st!=='playing')return;
    this.st='stopping';
    this.ramp(0,fadeS);
    this.cancelTimer();
    this.timer=this.host.setTimer(()=>{this.timer=undefined;this.finishStop();},fadeS*1000);
    this.follow();
  }

  /** Brings the element in line with the state, the settings and the tab. */
  follow(){
    const el=this.el;
    if(!el||this.disposed)return;
    const quiet=this.host.quiet();
    if(this.st==='stopping'&&quiet){this.finishStop();return;}
    if(this.active&&this.realSrc&&!quiet){if(el.paused&&!this.blocked)this.attempt();}
    else if(!el.paused){try{el.pause();}catch{/* ignored */}}
  }

  /** Inside a gesture: unlocks the element once, or retries a play the autoplay policy refused. */
  gesture(){
    const el=this.el;
    if(this.disposed||!el)return;
    this.route();
    if(this.unlockedEl&&!this.blocked)return;
    const first=!this.unlockedEl;
    this.unlockedEl=true;this.blocked=false;
    if(this.active&&this.realSrc){this.follow();return;}
    if(!first)return;
    try{if(!this.realSrc)el.src=silentWav();}catch{return;}
    this.attempt(()=>{if(this.st!=='playing'||!this.realSrc)try{el.pause();}catch{/* ignored */}});
  }

  dispose(){
    if(this.disposed)return;
    this.cancelLoad();
    this.disposed=true;
    this.cancelTimer();
    const el=this.el;
    if(el){try{el.pause();el.removeAttribute('src');el.load();}catch{/* ignored */}}
    try{this.node?.disconnect();this.gain?.disconnect();}catch{/* ignored */}
    this.node=this.gain=undefined;
    if(this.objectUrl){this.host.revokeUrl(this.objectUrl);this.objectUrl=undefined;}
    this.st='idle';
  }

  // ---- internals ----

  private start(){
    this.cancelTimer();
    this.st='playing';
    this.ramp(this.spec.level,this.fadeS,this.delayS);
    this.follow();
  }

  private finishStop(){
    this.cancelTimer();
    if(this.st==='stopping')this.st='ready';
    const ctx=this.host.engine.context,param=this.gain?.gain;
    if(ctx&&param){try{param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(0,ctx.currentTime);}catch{/* ignored */}}
    if(this.el){try{this.el.pause();if(this.spec.rewind)this.el.currentTime=0;}catch{/* ignored */}}
  }

  private attempt(after?:()=>void){
    const el=this.el!;
    this.route();
    // Only through the context: an unrouted element would bypass the volume, the mute and the fades.
    if(!this.gain){this.blocked=true;return;}
    try{
      const played=el.play();
      if(played&&typeof played.then==='function')played.then(()=>after?.(),error=>{
        // AbortError: a pause() (mute, hidden tab, the unlock) beat the play; only a policy refusal waits for a gesture.
        if((error as {name?:string}|undefined)?.name==='NotAllowedError')this.blocked=true;
      });
      else after?.();
    }catch{this.blocked=true;}
  }

  /** Element -> track gain -> music bus, once the engine has a context; fades in if the track should be playing. */
  private route(){
    if(this.gain||!this.el)return;
    const ctx=this.host.engine.context,out=this.host.engine.musicOutput;
    if(!ctx||!out)return;
    try{
      const gain=ctx.createGain();
      gain.gain.value=0;
      const node=ctx.createMediaElementSource(this.el as unknown as HTMLMediaElement);
      node.connect(gain);gain.connect(out);
      this.gain=gain;this.node=node;
    }catch{return;}
    if(this.st==='playing')this.ramp(this.spec.level,this.fadeS);
  }

  private ramp(to:number,seconds:number,delay=0){
    const ctx=this.host.engine.context,param=this.gain?.gain;
    if(!ctx||!param)return;
    const t=ctx.currentTime,from=param.value;
    try{
      param.cancelScheduledValues(t);param.setValueAtTime(from,t);
      if(delay>0)param.setValueAtTime(from,t+delay);
      param.linearRampToValueAtTime(to,t+delay+seconds);
    }catch{/* ignored */}
  }

  private cancelTimer(){
    if(this.timer!==undefined){this.host.clearTimer(this.timer);this.timer=undefined;}
  }
}

/** The tracks' shared plumbing: the defaults, and quiet = music muted, music volume 0 or `page()` hidden. */
export function musicHost(opts:MusicOptions,page:()=>Page|undefined):TrackHost{
  const engine=opts.engine;
  return {engine,
    fetchUrl:opts.fetchUrl??fetchBlobUrl,
    revokeUrl:opts.revokeUrl??(url=>{try{URL.revokeObjectURL(url);}catch{/* ignored */}}),
    setTimer:opts.setTimer??((fn,ms)=>setTimeout(fn,ms)),
    clearTimer:opts.clearTimer??(id=>clearTimeout(id as ReturnType<typeof setTimeout>)),
    quiet:()=>busQuiet(engine.settings.music)||page()?.visibilityState==='hidden'};
}

/** The engine's unlock, `onGesture` on every gesture and `onVisible` on visibilitychange; returns a detach function. */
export function bindPage(engine:MusicEngine,page:Page,onGesture:()=>void,onVisible:()=>void):()=>void{
  // The engine's listener first: the tracks' gesture needs the context it creates.
  const offEngine=engine.attachUnlock(page);
  for(const type of UNLOCK_EVENTS)page.addEventListener(type,onGesture,{passive:true});
  page.addEventListener('visibilitychange',onVisible);
  return ()=>{
    offEngine();
    for(const type of UNLOCK_EVENTS)page.removeEventListener(type,onGesture);
    page.removeEventListener('visibilitychange',onVisible);
  };
}

/** The match's two tracks: the theme from the start, the boss's while it lives, crossfaded. */
export class GameMusic {
  readonly boss:MusicTrack;
  readonly theme:MusicTrack;
  private readonly host:TrackHost;
  private page:Page|undefined;
  private started=false;
  private loadTimer:unknown;
  private disposed=false;
  private detachers:(()=>void)[]=[];
  private readonly offChange:()=>void;

  constructor(opts:MusicOptions){
    const engine=opts.engine;
    this.host=musicHost(opts,()=>this.page);
    const make=(spec:Readonly<TrackSpec>,source:string|null|undefined)=>{
      let el:MusicElement|undefined;
      try{el=(opts.createElement??defaultElement)(spec);}catch{el=undefined;}
      return new MusicTrack(spec,this.host,el,source);
    };
    this.boss=make(BOSS_TRACK,opts.sources?.boss);
    this.theme=make(THEME_TRACK,opts.sources?.theme);
    this.offChange=this.enabled?engine.onChange(()=>this.follow()):()=>{};
  }

  get enabled(){return !!(this.boss.source||this.theme.source);}

  /** Gestures (unlock and retries) and visibilitychange on `page` (the document); returns a detach function. */
  attach(page:Page):()=>void{
    if(!this.enabled||this.disposed)return ()=>{};
    this.page=page;
    const detach=bindPage(this.host.engine,page,()=>{this.boss.gesture();this.theme.gesture();},()=>this.follow());
    this.detachers.push(detach);
    return detach;
  }

  /** Every match view (the HUD only gets them once the match is on), and the run's end. */
  update(cue:MusicCue){
    if(this.disposed||!this.enabled)return;
    if(!this.started){
      this.started=true;
      this.loadTimer=this.host.setTimer(()=>{this.loadTimer=undefined;this.theme.load();},THEME_LOAD_DELAY_MS);
    }
    if(shouldLoad(cue))this.boss.load();
    if(cue.ended){this.boss.stop(END_OUT_S);this.theme.stop(END_OUT_S);return;}
    if(cue.boss){this.theme.stop(THEME_OUT_S);this.boss.play(FADE_IN_S);return;}
    this.boss.stop(FADE_OUT_S);
    // After the boss's fade-out, not over it.
    this.theme.play(THEME_IN_S,this.boss.active?FADE_OUT_S:0);
  }

  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    for(const detach of this.detachers.splice(0))detach();
    this.offChange();
    if(this.loadTimer!==undefined){this.host.clearTimer(this.loadTimer);this.loadTimer=undefined;}
    this.boss.dispose();this.theme.dispose();
  }

  private follow(){this.boss.follow();this.theme.follow();}
}
