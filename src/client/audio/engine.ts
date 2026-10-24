/**
 * WebAudio engine (VGM-050). No AudioContext exists before the first user gesture,
 * so nothing can play until then. Voice limit, per-sound throttle, optional vibration and two buses under the master
 * (config-audio-musica-efeitos): "effects" (the sounds) and "music" (music.ts tracks), each with its own
 * volume and mute (settings.ts); the master stays at 1 and feeds the limiter.
 *
 * Sounds are files (sfx.ts, NEW-20261022-ORQ-sons-ia-ace-step) fetched and decoded on demand: a sound's takes start
 * loading the first time it is asked for (or at unlock for SFX_WARM), and until one is ready, or for good when its file
 * fails, the procedural recipe (recipes.ts) plays instead; a file-only sound is silent meanwhile.
 */
import type {SoundId,SoundRecipe,Tone} from './types.ts';
import {recipeLength} from './types.ts';
import {RECIPES} from './recipes.ts';
import {SFX,SFX_WARM,alignTake,drawTake,pickSfxFormat,sfxUrl,type SfxFormat,type SfxSpec} from './sfx.ts';
import {busGain,busQuiet,clampVolume,copySettings,loadSettings,saveSettings,type AudioSettings,type Bus,type StorageLike} from './settings.ts';

export {DEFAULT_SETTINGS,SETTINGS_KEY,LEGACY_SETTINGS_KEY,type AudioSettings,type Bus,type BusSettings} from './settings.ts';
/** Simultaneous sounds; mobile speakers turn more into mush and cost CPU. */
export const MAX_VOICES=10;
/** Events that count as user activation for audio (a touch pointerdown does not, on iOS or per spec). */
export const UNLOCK_EVENTS=['pointerup','touchend','click','keydown'] as const;
const SILENT=.0001;
/** Buttons that do not click: the match's actions (explore.ts .explore-actions) and opt-outs. */
const SILENT_BUTTONS='.explore-actions,[data-sfx="off"]';
/** After a gesture asks to resume, sounds may be scheduled on a still-suspended context for this long. */
const RESUME_GRACE_MS=500;
/** Time constant of a bus's volume change: smooth while a slider drags, no clicks. */
const BUS_RAMP_S=.02;
interface EngineOptions {
  recipes?:Readonly<Partial<Record<SoundId,SoundRecipe>>>;
  /** The files' table (sfx.ts); `null` plays the procedural sounds only. */
  sfx?:Readonly<Partial<Record<SoundId,SfxSpec>>>|null;
  /** Downloads one file (default: a low-priority fetch in a browser, none elsewhere); `null` = no files. */
  loadFile?:((url:string)=>Promise<ArrayBuffer>)|null;
  /** The files' format (default: what an <audio> element says it plays, pickSfxFormat). */
  format?:SfxFormat|null;
  /** Draws the take (default Math.random). */
  random?:()=>number;
  createContext?:()=>AudioContext;
  storage?:StorageLike|null;
  vibrate?:(pattern:number[])=>boolean;
  maxVoices?:number;
  nowMs?:()=>number;
}
interface Voice {id:SoundId;priority:number;startedAt:number;endsAt:number;out:GainNode;sources:AudioScheduledSourceNode[]}
/**
 * One play's own level and speed: a footstep's jitter (footsteps.ts), an ally farther away; `pan` (-1 left … 1 right) puts
 * a file's take where its figure is on screen (the recipes stay centred).
 */
export interface PlayOptions {gain?:number;rate?:number;pan?:number}
/** The output latency the engine reports at most (a context that claims more is not believed). */
export const MAX_LATENCY_MS=150;
type FileState=AudioBuffer|'loading'|'failed';

async function fetchFile(url:string):Promise<ArrayBuffer>{
  const response=await fetch(url,{priority:'low'} as RequestInit);
  if(!response.ok)throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}
function defaultLoader():((url:string)=>Promise<ArrayBuffer>)|null{
  return globalThis.location&&typeof globalThis.fetch==='function'?fetchFile:null;
}
function defaultFormat():SfxFormat|null{
  try{
    const audio=globalThis.document?.createElement?.('audio');
    return audio&&typeof audio.canPlayType==='function'?pickSfxFormat(type=>audio.canPlayType(type)):null;
  }catch{return null;}
}

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

export class AudioEngine {
  private ctx:AudioContext|undefined;
  private master:GainNode|undefined;
  private buses:Partial<Record<Bus,GainNode>>={};
  /** The gain each bus is heading to (an AudioParam's value lags behind a ramp). */
  private busTarget:Partial<Record<Bus,number>>={};
  private noise:AudioBuffer|undefined;
  private voices:Voice[]=[];
  private lastPlay=new Map<SoundId,number>();
  private listeners=new Set<()=>void>();
  private detachers=new Set<()=>void>();
  private state:AudioSettings;
  private isUnlocked=false;
  private hushed=false;
  private resumeAskedAt=-Infinity;
  private cleanups:(()=>void)[]=[];
  private readonly recipes:Readonly<Partial<Record<SoundId,SoundRecipe>>>;
  private readonly sfx:Readonly<Partial<Record<SoundId,SfxSpec>>>;
  private readonly loadFile:((url:string)=>Promise<ArrayBuffer>)|null;
  private readonly format:SfxFormat|null;
  private readonly random:()=>number;
  /** Each file's state by URL: decoded, on its way, or failed (then the recipe plays for good). */
  private files=new Map<string,FileState>();
  /** An aligned sound's take (SfxSpec.align): where its attack starts and the gain that evens it. */
  private aligned=new WeakMap<AudioBuffer,{offset:number;gain:number}>();
  private lastTake=new Map<SoundId,number>();
  private readonly createContext:()=>AudioContext;
  private readonly storage:StorageLike|null;
  private readonly vibrateFn:((pattern:number[])=>boolean)|undefined;
  private readonly maxVoices:number;
  private readonly nowMs:()=>number;

  constructor(opts:EngineOptions={}){
    this.recipes=opts.recipes??RECIPES;
    this.sfx=opts.sfx===null?{}:opts.sfx??SFX;
    this.loadFile=opts.loadFile===undefined?defaultLoader():opts.loadFile;
    this.format=opts.format===undefined?(this.loadFile?defaultFormat():null):opts.format;
    this.random=opts.random??Math.random;
    this.createContext=opts.createContext??defaultContext;
    this.storage=opts.storage===undefined?null:opts.storage;
    this.vibrateFn=opts.vibrate;
    this.maxVoices=Math.max(1,opts.maxVoices??MAX_VOICES);
    this.nowMs=opts.nowMs??(()=>performance.now());
    this.state=loadSettings(this.storage).settings;
  }

  get unlocked(){return this.isUnlocked;}
  get settings():AudioSettings{return copySettings(this.state);}

  /** True once the context is actually producing sound. */
  get running(){return this.ctx?.state==='running';}

  /** The context, the master (limiter) and the music bus (its volume and mute) once unlocked: music.ts tracks join it. */
  get context():AudioContext|undefined{return this.ctx;}
  get output():AudioNode|undefined{return this.master;}
  get musicOutput():AudioNode|undefined{return this.buses.music;}
  /**
   * How late a sound started now reaches the speakers (ms): the context's base and output latency, 0 before unlock or
   * where the browser does not say; at most MAX_LATENCY_MS. footsteps.ts plays that much ahead of the foot.
   */
  get latencyMs(){
    const ctx=this.ctx as (AudioContext&{outputLatency?:number})|undefined;
    const s=(Number(ctx?.baseLatency)||0)+(Number(ctx?.outputLatency)||0);
    return Math.max(0,Math.min(MAX_LATENCY_MS,s*1000));
  }

  /**
   * Unlocks on the first gesture on `target` and keeps listening: any later gesture revives a context that
   * iOS suspended or interrupted (app switch, call). A click on a button also clicks (ui-botao), except the match's
   * action buttons (attack, skill, SOS: pressed nonstop) and anything under [data-sfx="off"]. Returns a detach function.
   */
  attachUnlock(target:EventTarget):()=>void{
    const handler=(event:Event)=>{
      if(this.isUnlocked)this.wake();else this.unlock();
      if(event.type==='click')this.buttonClick(event.target);
    };
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
      this.master.gain.value=this.hushed?0:1;
      // A limiter keeps a boss roar plus a fall plus hits from hard-clipping on phone speakers.
      const limiter=ctx.createDynamicsCompressor?.();
      if(limiter){
        limiter.threshold.value=-6;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.2;
        this.master.connect(limiter);limiter.connect(ctx.destination);
      }else this.master.connect(ctx.destination);
      for(const bus of ['effects','music'] as const){
        const gain=this.buses[bus]=ctx.createGain();
        gain.gain.value=this.busTarget[bus]=busGain(this.state[bus]);
        gain.connect(this.master);
      }
      this.wake();
      this.preload(SFX_WARM);
      const doc=globalThis.document;
      if(doc){
        const onVisible=()=>{if(doc.visibilityState==='visible')this.wake();};
        doc.addEventListener('visibilitychange',onVisible);
        this.cleanups.push(()=>doc.removeEventListener('visibilitychange',onVisible));
      }
    }catch{this.ctx=undefined;this.master=undefined;this.buses={};}
    this.emit();
  }

  /** Pauses the context (e.g. leaving the sound lab); the next gesture revives it. */
  suspend(){
    for(const voice of this.voices)this.stopVoice(voice);
    this.voices=[];
    void this.ctx?.suspend?.().catch(()=>{});
    this.emit();
  }

  /** A bus's volume (0..1); `persist:false` for live slider drags, persist on release. */
  setVolume(bus:Bus,volume:number,opts:{persist?:boolean}={}){
    if(!Number.isFinite(volume))return;
    this.update({[bus]:{...this.state[bus],volume:clampVolume(volume)}},opts.persist??true);
  }
  setMuted(bus:Bus,muted:boolean){this.update({[bus]:{...this.state[bus],muted}});}
  /** Silences everything for an ad break (ads/ads.ts) without touching the saved settings; false restores. */
  setHushed(on:boolean){
    this.hushed=on;
    const ctx=this.ctx,master=this.master;
    if(!ctx||!master)return;
    master.gain.cancelScheduledValues?.(ctx.currentTime);
    master.gain.setValueAtTime?.(on?0:1,ctx.currentTime);
    master.gain.value=on?0:1;
  }
  setVibration(vibration:boolean){this.update({vibration});}

  activeVoices(){this.prune();return this.voices.length;}

  onChange(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}

  /** True when a decoded take of the sound is ready (its file plays, not the recipe). */
  hasFile(id:SoundId){
    const file=this.sfx[id],format=this.format;
    if(!file||!format)return false;
    for(let take=0;take<file.takes;take++)if(typeof this.files.get(sfxUrl(id,take,format))==='object')return true;
    return false;
  }

  /** Starts downloading every take of these sounds (once each); no-op before the context exists or without files. */
  preload(ids:Iterable<SoundId>){
    const ctx=this.ctx,load=this.loadFile,format=this.format;
    if(!ctx||!load||!format)return;
    for(const id of ids){
      const file=this.sfx[id];
      if(!file)continue;
      for(let take=0;take<file.takes;take++){
        const url=sfxUrl(id,take,format);
        if(this.files.has(url))continue;
        this.files.set(url,'loading');
        let job:Promise<ArrayBuffer>;
        try{job=load(url);}catch(error){job=Promise.reject(error);}
        job.then(data=>ctx.decodeAudioData(data)).then(buffer=>{
          if(file.align){try{this.aligned.set(buffer,alignTake(buffer.getChannelData(0),buffer.sampleRate));}catch{/* plays whole */}}
          this.files.set(url,buffer);
        },()=>{this.files.set(url,'failed');});
      }
    }
  }

  /**
   * Plays a sound: a take of its file when one is decoded, else its recipe (and its file starts loading). False when
   * locked, unknown, throttled, muted, suspended, dropped by the voice limit, or a file-only sound not loaded yet.
   */
  play(id:SoundId,opts:PlayOptions={}):boolean{
    if(!this.isUnlocked)return false;
    const recipe=this.recipes[id],file=this.sfx[id];
    if(!recipe&&!file)return false;
    const throttleMs=file?.throttleMs??recipe!.throttleMs,priority=file?.priority??recipe!.priority;
    const now=this.nowMs(),last=this.lastPlay.get(id);
    if(last!==undefined&&now-last<throttleMs)return false;
    const ctx=this.ctx,out=this.buses.effects;
    if(busQuiet(this.state.effects)||!ctx||!out){
      // Haptics follow their own toggle, so a muted phone can still buzz on a fall.
      this.lastPlay.set(id,now);
      if(recipe)this.buzz(recipe);
      return false;
    }
    if(ctx.state!=='running'&&now-this.resumeAskedAt>RESUME_GRACE_MS){
      // Suspended outside a gesture: scheduling would pile sounds onto a frozen clock and burst on resume.
      void ctx.resume?.().catch(()=>{});
      return false;
    }
    const take=file?this.pickTake(id,file):undefined;
    if(!take&&!recipe)return false;
    this.prune();
    // A drop by the voice limit was never heard, so it neither starts the throttle window nor vibrates.
    if(this.voices.length>=this.maxVoices&&!this.steal(priority))return false;
    this.lastPlay.set(id,now);
    const voice=ctx.createGain(),level=Math.max(0,Math.min(2,Number.isFinite(opts.gain)?opts.gain!:1));
    voice.connect(out);
    const start=ctx.currentTime+.005,sources:AudioScheduledSourceNode[]=[];
    let length:number;
    if(take){
      const rate=Math.max(.5,Math.min(2,Number.isFinite(opts.rate)?opts.rate!:1));
      const src=ctx.createBufferSource(),align=this.aligned.get(take.buffer),offset=align?.offset??0;
      src.buffer=take.buffer;
      if(src.playbackRate)src.playbackRate.value=rate;
      voice.gain.value=file!.gain*level*(align?.gain??1);
      // Panned before the voice: the voice's release (releaseOnEnd, a steal) cuts the whole chain off the bus.
      const pan=Number.isFinite(opts.pan)?Math.max(-1,Math.min(1,opts.pan!)):0,panner=Math.abs(pan)>.01?ctx.createStereoPanner?.():undefined;
      if(panner){panner.pan.value=pan;src.connect(panner);panner.connect(voice);}else src.connect(voice);
      src.start(start,offset);
      sources.push(src);
      length=Math.max(0,take.buffer.duration-offset)/rate;
      this.lastTake.set(id,take.index);
    }else{
      voice.gain.value=level;
      for(const tone of recipe!.tones)sources.push(...this.schedule(ctx,voice,tone,start));
      length=recipeLength(recipe!);
    }
    releaseOnEnd(voice,sources);
    this.voices.push({id,priority,startedAt:start,endsAt:start+length+.05,out:voice,sources});
    if(recipe)this.buzz(recipe);
    this.emit();
    return true;
  }

  dispose(){
    for(const detach of [...this.detachers])detach();
    for(const cleanup of this.cleanups.splice(0))cleanup();
    for(const voice of this.voices)this.stopVoice(voice);
    this.voices=[];
    void this.ctx?.close?.().catch(()=>{});
    this.ctx=undefined;this.master=undefined;this.buses={};
    this.isUnlocked=false;
    this.listeners.clear();
  }

  // ---- internals ----

  private buttonClick(target:EventTarget|null){
    const el=(target as Element|null)?.closest?.('button,[role="button"]');
    if(!el||(el as HTMLButtonElement).disabled||el.closest(SILENT_BUTTONS))return;
    this.play('ui-botao');
  }

  /** A decoded take, drawn without repeating the last; any other ready one while the drawn one loads. Loads them all. */
  private pickTake(id:SoundId,file:SfxSpec):{buffer:AudioBuffer;index:number}|undefined{
    const format=this.format;
    if(!format||!this.loadFile)return undefined;
    this.preload([id]);
    const last=this.lastTake.get(id),drawn=drawTake(file.takes,last,this.random());
    let fallback:{buffer:AudioBuffer;index:number}|undefined;
    for(let k=0;k<file.takes;k++){
      const index=(drawn+k)%file.takes,state=this.files.get(sfxUrl(id,index,format));
      if(typeof state!=='object')continue;
      if(index!==last||file.takes===1)return {buffer:state,index};
      fallback={buffer:state,index};
    }
    return fallback;
  }

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

  private update(patch:Partial<AudioSettings>,persist=true){
    this.state={...copySettings(this.state),...patch};
    if(persist)saveSettings(this.storage,this.state);
    const ctx=this.ctx;
    if(ctx)for(const bus of ['effects','music'] as const){
      const param=this.buses[bus]?.gain,to=busGain(this.state[bus]);
      // Live: a short exponential approach (no click), only for the bus that changed.
      if(param&&this.busTarget[bus]!==to){this.busTarget[bus]=to;try{param.setTargetAtTime(to,ctx.currentTime,BUS_RAMP_S);}catch{/* ignored */}}
    }
    if(busQuiet(this.state.effects)){for(const voice of this.voices)this.stopVoice(voice);this.voices=[];}
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
