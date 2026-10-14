/**
 * Boss music (NEW-20261014-ORQ-musica-do-chefe), the game's one audio file, kept as light as possible on a phone.
 * - Format: Opus/WebM (226 KB) when the browser can play it, else AAC/M4A (359 KB), else no music.
 * - Streaming: one `<audio loop>` routed by a MediaElementAudioSourceNode into a music gain, then into the engine's
 *   master bus, so the settings' volume and mute and the limiter apply. No decodeAudioData: the compressed file
 *   stays compressed (59 s of PCM would be 11-22 MB).
 * - iOS unlock: in a gesture (the engine unlocks its context in the same one) the element plays a tiny silent WAV
 *   (a data URI, no network) at gain 0 and pauses. iOS then lets the same element play() outside a gesture, after its
 *   src changes too, which is what the boss needs: it shows up without a tap.
 * - Loading: only once the match is far along (round >= 6, the chaveiro's ETA under 3 min, or the boss already there),
 *   one low-priority fetch of the whole file. It is a plain GET, so the service worker keeps it for the next matches
 *   (the element's own Range requests skip the worker); the element then reads a blob URL. A failed fetch falls back
 *   to streaming the URL.
 * - States: idle -> loading -> ready -> playing (fade-in 1 s) -> stopping (fade-out 2 s) -> ready. Mute or a hidden
 *   tab pause the element, unmute or visible resume it while the boss is there. Never throws; a play() refused by
 *   the autoplay policy waits for the next gesture.
 */
import type {RunView} from '../../contract/view.ts';
import {UNLOCK_EVENTS} from './engine.ts';

export const MUSIC_WEBM='/audio/boss.webm';
export const MUSIC_M4A='/audio/boss.m4a';
export const LOAD_FROM_ROUND=6;
export const LOAD_ETA_S=180;
export const FADE_IN_S=1;
export const FADE_OUT_S=2;
/** Music gain under the master: the effects stay readable over it. */
export const MUSIC_LEVEL=.6;

export type MusicState='idle'|'loading'|'ready'|'playing'|'stopping';
/** What the music needs from a view: how far the match is and whether the boss is alive (and the run not over). */
export interface MusicCue {round?:number;etaS?:number;boss:boolean}

/** The file this browser should stream, or null when it plays neither. */
export function pickMusicSource(canPlay:(type:string)=>string):string|null{
  const ok=(type:string)=>{try{const answer=canPlay(type);return answer==='probably'||answer==='maybe';}catch{return false;}};
  return ok('audio/webm; codecs="opus"')?MUSIC_WEBM:ok('audio/mp4; codecs="mp4a.40.2"')?MUSIC_M4A:null;
}

/** Far enough from the start that the download cannot compete with the match's entrance (3G, D-preload). */
export function shouldLoad(cue:MusicCue):boolean{
  return cue.boss||(cue.round??0)>=LOAD_FROM_ROUND||(cue.etaS!==undefined&&cue.etaS>0&&cue.etaS<LOAD_ETA_S);
}

export function musicCue(view:RunView,ended:boolean):MusicCue{
  const objective=view.objective,over=ended||!!objective?.ended;
  return {round:view.round?.index??view.wave?.index,etaS:objective&&!objective.ended?objective.etaS:undefined,
    boss:!over&&view.enemies.some(enemy=>enemy.boss&&enemy.hp>0)};
}

export interface MusicElement {
  src:string;loop:boolean;preload:string;currentTime:number;readonly paused:boolean;
  canPlayType(type:string):string;play():Promise<void>|void;pause():void;load():void;removeAttribute(name:string):void;
}
export interface MusicEngine {
  readonly unlocked:boolean;readonly context:AudioContext|undefined;readonly output:AudioNode|undefined;
  readonly settings:{volume:number;muted:boolean};
  onChange(listener:()=>void):()=>void;
  attachUnlock(target:EventTarget):()=>void;
}
export interface MusicOptions {
  engine:MusicEngine;
  createElement?:()=>MusicElement|undefined;
  /** Overrides the format pick (tests). */
  source?:string|null;
  /** Downloads the file and gives a URL the element can read (default: low-priority fetch to a blob URL). */
  fetchUrl?:(url:string)=>Promise<string>;
  revokeUrl?:(url:string)=>void;
  setTimer?:(fn:()=>void,ms:number)=>unknown;
  clearTimer?:(id:unknown)=>void;
}
type Page=EventTarget&{visibilityState?:string};

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

async function fetchBlobUrl(url:string):Promise<string>{
  const response=await fetch(url,{priority:'low'} as RequestInit);
  if(!response.ok)throw new Error(String(response.status));
  return URL.createObjectURL(await response.blob());
}

function defaultElement():MusicElement|undefined{
  const audio=globalThis.document?.createElement('audio');
  if(!audio||typeof audio.canPlayType!=='function')return undefined;
  audio.preload='none';
  return audio;
}

export class BossMusic {
  private st:MusicState='idle';
  private readonly el:MusicElement|undefined;
  private readonly url:string|null;
  private readonly engine:MusicEngine;
  private readonly fetchUrl:(url:string)=>Promise<string>;
  private readonly revokeUrl:(url:string)=>void;
  private readonly setTimer:(fn:()=>void,ms:number)=>unknown;
  private readonly clearTimer:(id:unknown)=>void;
  private gain:GainNode|undefined;
  private node:AudioNode|undefined;
  private page:Page|undefined;
  private want=false;
  private blocked=false;
  private unlockedEl=false;
  private realSrc=false;
  private objectUrl:string|undefined;
  private timer:unknown;
  private disposed=false;
  private detachers:(()=>void)[]=[];
  private readonly offChange:()=>void;

  constructor(opts:MusicOptions){
    this.engine=opts.engine;
    this.fetchUrl=opts.fetchUrl??fetchBlobUrl;
    this.revokeUrl=opts.revokeUrl??(url=>{try{URL.revokeObjectURL(url);}catch{/* ignored */}});
    this.setTimer=opts.setTimer??((fn,ms)=>setTimeout(fn,ms));
    this.clearTimer=opts.clearTimer??(id=>clearTimeout(id as ReturnType<typeof setTimeout>));
    let el:MusicElement|undefined,url:string|null=null;
    try{
      el=(opts.createElement??defaultElement)();
      if(el){const audio=el;url=opts.source!==undefined?opts.source:pickMusicSource(type=>audio.canPlayType(type));}
    }catch{el=undefined;}
    this.url=url;this.el=url?el:undefined;
    this.offChange=this.el?this.engine.onChange(()=>this.follow()):()=>{};
  }

  get state():MusicState{return this.st;}
  get source(){return this.url;}
  /** Whether the element is actually producing (or fading) the music right now. */
  get sounding(){return !!this.el&&!this.el.paused&&this.realSrc;}

  /** Gestures (unlock and retries) and visibilitychange on `page` (the document); returns a detach function. */
  attach(page:Page):()=>void{
    if(!this.el||this.disposed)return ()=>{};
    this.page=page;
    const offEngine=this.engine.attachUnlock(page);
    const onGesture=()=>this.gesture(),onVisible=()=>this.follow();
    for(const type of UNLOCK_EVENTS)page.addEventListener(type,onGesture,{passive:true});
    page.addEventListener('visibilitychange',onVisible);
    const detach=()=>{
      offEngine();
      for(const type of UNLOCK_EVENTS)page.removeEventListener(type,onGesture);
      page.removeEventListener('visibilitychange',onVisible);
    };
    this.detachers.push(detach);
    return detach;
  }

  /** Every view (or a run's end with boss:false). */
  update(cue:MusicCue){
    if(this.disposed||!this.el)return;
    this.want=cue.boss;
    if(this.st==='idle'&&shouldLoad(cue))this.load();
    if(cue.boss&&(this.st==='ready'||this.st==='stopping'))this.start();
    else if(!cue.boss&&this.st==='playing')this.stop();
  }

  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    for(const detach of this.detachers.splice(0))detach();
    this.offChange();
    this.cancelTimer();
    const el=this.el;
    if(el){try{el.pause();el.removeAttribute('src');el.load();}catch{/* ignored */}}
    try{this.node?.disconnect();this.gain?.disconnect();}catch{/* ignored */}
    this.node=this.gain=undefined;
    if(this.objectUrl){this.revokeUrl(this.objectUrl);this.objectUrl=undefined;}
    this.st='idle';
  }

  // ---- internals ----

  private load(){
    this.st='loading';
    const url=this.url!;
    let job:Promise<string>;
    try{job=this.fetchUrl(url);}catch(error){job=Promise.reject(error);}
    void job.then(found=>found,()=>url).then(found=>{
      if(this.disposed||!this.el){if(found!==url)this.revokeUrl(found);return;}
      if(found!==url)this.objectUrl=found;
      try{this.el.loop=true;this.el.preload='auto';this.el.src=found;}catch{return;}
      this.realSrc=true;this.st='ready';
      if(this.want)this.start();
    });
  }

  private start(){
    this.cancelTimer();
    this.st='playing';
    this.ramp(MUSIC_LEVEL,FADE_IN_S);
    this.follow();
  }

  private stop(){
    this.st='stopping';
    this.ramp(0,FADE_OUT_S);
    this.timer=this.setTimer(()=>{this.timer=undefined;this.finishStop();},FADE_OUT_S*1000);
    this.follow();
  }

  /** Paused and rewound: the next boss starts the song from the top. */
  private finishStop(){
    this.cancelTimer();
    if(this.st==='stopping')this.st='ready';
    const ctx=this.engine.context,param=this.gain?.gain;
    if(ctx&&param){try{param.cancelScheduledValues(ctx.currentTime);param.setValueAtTime(0,ctx.currentTime);}catch{/* ignored */}}
    if(this.el){try{this.el.pause();this.el.currentTime=0;}catch{/* ignored */}}
  }

  /** Brings the element in line with the state, the settings and the tab. */
  private follow(){
    const el=this.el;
    if(!el||this.disposed)return;
    const settings=this.engine.settings,quiet=settings.muted||settings.volume<=0||this.page?.visibilityState==='hidden';
    if(this.st==='stopping'&&quiet){this.finishStop();return;}
    const on=(this.st==='playing'||this.st==='stopping')&&this.realSrc&&!quiet;
    if(on){if(el.paused&&!this.blocked)this.attempt();}
    else if(!el.paused){try{el.pause();}catch{/* ignored */}}
  }

  /** Inside a gesture: unlocks the element once, or retries a play the autoplay policy refused. */
  private gesture(){
    const el=this.el;
    if(this.disposed||!el)return;
    this.route();
    if(this.unlockedEl&&!this.blocked)return;
    const first=!this.unlockedEl;
    this.unlockedEl=true;this.blocked=false;
    if((this.st==='playing'||this.st==='stopping')&&this.realSrc){this.follow();return;}
    if(!first)return;
    try{if(!this.realSrc)el.src=silentWav();}catch{return;}
    this.attempt(()=>{if(this.st!=='playing'||!this.realSrc)try{el.pause();}catch{/* ignored */}});
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

  /** Element -> music gain -> master, once the engine has a context; fades in if the boss is already there. */
  private route(){
    if(this.gain||!this.el)return;
    const ctx=this.engine.context,out=this.engine.output;
    if(!ctx||!out)return;
    try{
      const gain=ctx.createGain();
      gain.gain.value=0;
      const node=ctx.createMediaElementSource(this.el as unknown as HTMLMediaElement);
      node.connect(gain);gain.connect(out);
      this.gain=gain;this.node=node;
    }catch{return;}
    if(this.st==='playing')this.ramp(MUSIC_LEVEL,FADE_IN_S);
  }

  private ramp(to:number,seconds:number){
    const ctx=this.engine.context,param=this.gain?.gain;
    if(!ctx||!param)return;
    const t=ctx.currentTime;
    try{param.cancelScheduledValues(t);param.setValueAtTime(param.value,t);param.linearRampToValueAtTime(to,t+seconds);}catch{/* ignored */}
  }

  private cancelTimer(){
    if(this.timer!==undefined){this.clearTimer(this.timer);this.timer=undefined;}
  }
}
