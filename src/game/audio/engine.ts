/**
 * Procedural WebAudio engine (VGM-050). No AudioContext exists before the first user gesture,
 * so nothing can play until then. Voice limit, per-sound throttle, volume, mute and optional vibration.
 */
import type {SoundId,SoundRecipe,Tone} from './types.ts';
import {recipeLength} from './types.ts';
import {RECIPES} from './recipes.ts';

export interface AudioSettings {volume:number;muted:boolean;vibration:boolean}
export const DEFAULT_SETTINGS:Readonly<AudioSettings>=Object.freeze({volume:.7,muted:false,vibration:true});
export const SETTINGS_KEY='viagem:audio:v1';
/** Simultaneous sounds; mobile speakers turn more into mush and cost CPU. */
export const MAX_VOICES=10;
/** Events that count as user activation for audio (a touch pointerdown does not, on iOS or per spec). */
const UNLOCK_EVENTS=['pointerup','touchend','click','keydown'] as const;
const SILENT=.0001;
/** After a gesture asks to resume, sounds may be scheduled on a still-suspended context for this long. */
const RESUME_GRACE_MS=500;

type StorageLike=Pick<Storage,'getItem'|'setItem'>;
interface EngineOptions {
  recipes?:Readonly<Record<SoundId,SoundRecipe>>;
  createContext?:()=>AudioContext;
  storage?:StorageLike|null;
  vibrate?:(pattern:number[])=>boolean;
  maxVoices?:number;
  nowMs?:()=>number;
}
interface Voice {id:SoundId;priority:number;startedAt:number;endsAt:number;out:GainNode;sources:AudioScheduledSourceNode[]}

/** Disconnects the voice output once every source has ended, so finished graphs can be collected. */
function releaseOnEnd(out:GainNode,sources:AudioScheduledSourceNode[]){
  let remaining=sources.length;
  const done=()=>{if(--remaining===0){try{out.disconnect();}catch{/* already disconnected */}}};
  for(const source of sources)source.onended=done;
}

function defaultContext():AudioContext{
  const Ctor=globalThis.AudioContext??(globalThis as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Ctor)throw new Error('WebAudio unavailable');
  return new Ctor();
}

function readSettings(storage:StorageLike|null):AudioSettings{
  const settings={...DEFAULT_SETTINGS};
  try{
    const saved=JSON.parse(storage?.getItem(SETTINGS_KEY)??'null');
    if(saved&&typeof saved==='object'){
      if(typeof saved.volume==='number'&&Number.isFinite(saved.volume))settings.volume=Math.max(0,Math.min(1,saved.volume));
      if(typeof saved.muted==='boolean')settings.muted=saved.muted;
      if(typeof saved.vibration==='boolean')settings.vibration=saved.vibration;
    }
  }catch{/* storage blocked or corrupt: defaults */}
  return settings;
}

export class AudioEngine {
  private ctx:AudioContext|undefined;
  private master:GainNode|undefined;
  private noise:AudioBuffer|undefined;
  private voices:Voice[]=[];
  private lastPlay=new Map<SoundId,number>();
  private listeners=new Set<()=>void>();
  private detachers=new Set<()=>void>();
  private state:AudioSettings;
  private isUnlocked=false;
  private resumeAskedAt=-Infinity;
  private cleanups:(()=>void)[]=[];
  private readonly recipes:Readonly<Record<SoundId,SoundRecipe>>;
  private readonly createContext:()=>AudioContext;
  private readonly storage:StorageLike|null;
  private readonly vibrateFn:((pattern:number[])=>boolean)|undefined;
  private readonly maxVoices:number;
  private readonly nowMs:()=>number;

  constructor(opts:EngineOptions={}){
    this.recipes=opts.recipes??RECIPES;
    this.createContext=opts.createContext??defaultContext;
    this.storage=opts.storage===undefined?null:opts.storage;
    this.vibrateFn=opts.vibrate;
    this.maxVoices=Math.max(1,opts.maxVoices??MAX_VOICES);
    this.nowMs=opts.nowMs??(()=>performance.now());
    this.state=readSettings(this.storage);
  }

  get unlocked(){return this.isUnlocked;}
  get settings():AudioSettings{return {...this.state};}

  /** True once the context is actually producing sound. */
  get running(){return this.ctx?.state==='running';}

  /**
   * Unlocks on the first gesture on `target` and keeps listening: any later gesture revives a context that
   * iOS suspended or interrupted (app switch, call). Returns a detach function.
   */
  attachUnlock(target:EventTarget):()=>void{
    const handler=()=>{if(this.isUnlocked)this.wake();else this.unlock();};
    const detach=()=>{for(const type of UNLOCK_EVENTS)target.removeEventListener(type,handler);this.detachers.delete(detach);};
    for(const type of UNLOCK_EVENTS)target.addEventListener(type,handler,{passive:true});
    this.detachers.add(detach);
    return detach;
  }

  /** Must run inside a user gesture: creates and resumes the context, plays one silent sample (iOS). */
  unlock(){
    if(this.isUnlocked)return;
    this.isUnlocked=true;
    try{
      const ctx=this.ctx=this.createContext();
      this.master=ctx.createGain();
      this.master.gain.value=this.masterGain();
      // A limiter keeps a boss roar plus a fall plus hits from hard-clipping on phone speakers.
      const limiter=ctx.createDynamicsCompressor?.();
      if(limiter){
        limiter.threshold.value=-6;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.2;
        this.master.connect(limiter);limiter.connect(ctx.destination);
      }else this.master.connect(ctx.destination);
      this.wake();
      const doc=globalThis.document;
      if(doc){
        const onVisible=()=>{if(doc.visibilityState==='visible')this.wake();};
        doc.addEventListener('visibilitychange',onVisible);
        this.cleanups.push(()=>doc.removeEventListener('visibilitychange',onVisible));
      }
    }catch{this.ctx=undefined;this.master=undefined;}
    this.emit();
  }

  /** Pauses the context (e.g. leaving the sound lab); the next gesture revives it. */
  suspend(){
    for(const voice of this.voices)this.stopVoice(voice);
    this.voices=[];
    void this.ctx?.suspend?.().catch(()=>{});
    this.emit();
  }

  /** `persist:false` for live slider drags; persist on release. */
  setVolume(volume:number,opts:{persist?:boolean}={}){
    if(!Number.isFinite(volume))return;
    this.update({volume:Math.max(0,Math.min(1,volume))},opts.persist??true);
  }
  setMuted(muted:boolean){this.update({muted});}
  setVibration(vibration:boolean){this.update({vibration});}

  activeVoices(){this.prune();return this.voices.length;}

  onChange(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}

  /** Plays a sound. False when locked, unknown, throttled, muted, suspended or dropped by the voice limit. */
  play(id:SoundId):boolean{
    if(!this.isUnlocked)return false;
    const recipe=this.recipes[id];
    if(!recipe)return false;
    const now=this.nowMs(),last=this.lastPlay.get(id);
    if(last!==undefined&&now-last<recipe.throttleMs)return false;
    const ctx=this.ctx,master=this.master;
    if(this.state.muted||!ctx||!master||this.state.volume<=0){
      // Haptics follow their own toggle, so a muted phone can still buzz on a fall.
      this.lastPlay.set(id,now);
      this.buzz(recipe);
      return false;
    }
    if(ctx.state!=='running'&&now-this.resumeAskedAt>RESUME_GRACE_MS){
      // Suspended outside a gesture: scheduling would pile sounds onto a frozen clock and burst on resume.
      void ctx.resume?.().catch(()=>{});
      return false;
    }
    this.prune();
    // A drop by the voice limit was never heard, so it neither starts the throttle window nor vibrates.
    if(this.voices.length>=this.maxVoices&&!this.steal(recipe.priority))return false;
    this.lastPlay.set(id,now);
    const out=ctx.createGain();
    out.connect(master);
    const start=ctx.currentTime+.005,sources:AudioScheduledSourceNode[]=[];
    for(const tone of recipe.tones)sources.push(...this.schedule(ctx,out,tone,start));
    releaseOnEnd(out,sources);
    this.voices.push({id,priority:recipe.priority,startedAt:start,endsAt:start+recipeLength(recipe)+.05,out,sources});
    this.buzz(recipe);
    this.emit();
    return true;
  }

  dispose(){
    for(const detach of [...this.detachers])detach();
    for(const cleanup of this.cleanups.splice(0))cleanup();
    for(const voice of this.voices)this.stopVoice(voice);
    this.voices=[];
    void this.ctx?.close?.().catch(()=>{});
    this.ctx=undefined;this.master=undefined;
    this.isUnlocked=false;
    this.listeners.clear();
  }

  // ---- internals ----

  /** Inside a gesture: resume plus a silent sample, which is what iOS needs to really start output. */
  private wake(){
    const ctx=this.ctx;
    if(!ctx||ctx.state==='running')return;
    this.resumeAskedAt=this.nowMs();
    try{
      const blip=ctx.createBufferSource();
      blip.buffer=ctx.createBuffer(1,1,ctx.sampleRate);
      blip.connect(ctx.destination);blip.start(0);
    }catch{/* best effort */}
    void ctx.resume?.().then(()=>this.emit(),()=>{});
  }

  private buzz(recipe:SoundRecipe){
    if(recipe.vibrate&&this.state.vibration&&this.vibrateFn){try{this.vibrateFn([...recipe.vibrate]);}catch{/* ignored */}}
  }

  private masterGain(){
    // Squared volume tracks loudness perception better on a 0..1 slider.
    return this.state.muted?0:this.state.volume*this.state.volume;
  }

  private update(patch:Partial<AudioSettings>,persist=true){
    this.state={...this.state,...patch};
    if(persist){try{this.storage?.setItem(SETTINGS_KEY,JSON.stringify(this.state));}catch{/* storage blocked */}}
    if(this.ctx&&this.master)this.master.gain.setTargetAtTime(this.masterGain(),this.ctx.currentTime,.02);
    if(this.state.muted||this.state.volume<=0){for(const voice of this.voices)this.stopVoice(voice);this.voices=[];}
    this.emit();
  }

  private emit(){for(const listener of [...this.listeners])listener();}

  private prune(){
    const t=this.ctx?.currentTime??0;
    if(this.voices.some(v=>v.endsAt<=t))this.voices=this.voices.filter(v=>v.endsAt>t);
  }

  /** Frees one slot by stopping the oldest lowest-priority voice, unless every voice outranks the newcomer. */
  private steal(priority:number):boolean{
    let victim:Voice|undefined;
    for(const voice of this.voices)if(!victim||voice.priority<victim.priority||(voice.priority===victim.priority&&voice.startedAt<victim.startedAt))victim=voice;
    if(!victim||victim.priority>priority)return false;
    this.stopVoice(victim);
    this.voices=this.voices.filter(v=>v!==victim);
    return true;
  }

  /** Short fade instead of a hard cut (no click); releaseOnEnd disconnects once the sources stop. */
  private stopVoice(voice:Voice){
    const t=this.ctx?.currentTime??0;
    try{voice.out.gain.cancelScheduledValues(t);voice.out.gain.setTargetAtTime(0,t,.005);}catch{/* already gone */}
    for(const source of voice.sources){try{source.stop(t+.03);}catch{/* already stopped */}}
  }

  private noiseBuffer(ctx:AudioContext){
    if(this.noise)return this.noise;
    const buffer=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*.5)),ctx.sampleRate),data=buffer.getChannelData(0);
    // Deterministic LCG noise: same texture every session, no Math.random.
    let seed=0x2f6b4a1d;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
    return this.noise=buffer;
  }

  private schedule(ctx:AudioContext,out:GainNode,tone:Tone,start:number):AudioScheduledSourceNode[]{
    const t0=start+Math.max(0,tone.at),dur=Math.max(.01,tone.dur),attack=Math.min(dur*.9,Math.max(.001,tone.attack??.005));
    const peak=Math.max(SILENT,Math.min(1,tone.gain)),from=Math.max(1,tone.from),to=Math.max(1,tone.to);
    const env=ctx.createGain();
    env.gain.setValueAtTime(SILENT,t0);
    env.gain.linearRampToValueAtTime(peak,t0+attack);
    env.gain.exponentialRampToValueAtTime(SILENT,t0+dur);
    let tail:AudioNode=env;
    if(tone.filter){
      const filter=ctx.createBiquadFilter();
      filter.type=tone.filter.type;filter.frequency.value=tone.filter.freq;filter.Q.value=tone.filter.q??1;
      env.connect(filter);tail=filter;
    }
    tail.connect(out);
    const sources:AudioScheduledSourceNode[]=[];
    if(tone.wave==='noise'){
      const src=ctx.createBufferSource();
      src.buffer=this.noiseBuffer(ctx);src.loop=true;
      const band=ctx.createBiquadFilter();
      band.type='bandpass';band.Q.value=1.2;
      band.frequency.setValueAtTime(from,t0);band.frequency.exponentialRampToValueAtTime(to,t0+dur);
      src.connect(band);band.connect(env);
      sources.push(src);
    }else{
      const osc=ctx.createOscillator();
      osc.type=tone.wave;
      osc.frequency.setValueAtTime(from,t0);
      if(to!==from)osc.frequency.exponentialRampToValueAtTime(to,t0+dur);
      if(tone.vibrato&&tone.vibrato.depth>0){
        const lfo=ctx.createOscillator(),depth=ctx.createGain();
        lfo.frequency.value=tone.vibrato.rate;depth.gain.value=tone.vibrato.depth;
        lfo.connect(depth);depth.connect(osc.frequency);
        sources.push(lfo);
      }
      osc.connect(env);
      sources.push(osc);
    }
    for(const source of sources){source.start(t0);source.stop(t0+dur+.02);}
    return sources;
  }
}

let shared:AudioEngine|undefined;
/** App-wide engine with localStorage settings and navigator.vibrate when available. */
export function getAudio():AudioEngine{
  if(shared)return shared;
  let storage:StorageLike|null=null;
  try{storage=globalThis.localStorage??null;}catch{storage=null;}
  const nav=globalThis.navigator as Navigator|undefined;
  const vibrate=typeof nav?.vibrate==='function'?(pattern:number[])=>nav.vibrate(pattern):undefined;
  return shared=new AudioEngine({storage,vibrate});
}
