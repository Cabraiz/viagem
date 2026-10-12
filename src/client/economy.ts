/**
 * Economy mode (VGM-048): 30 fps and fewer effects for phones that choke on the horde.
 * Pure module (no Phaser, no DOM): the settings (persisted with try/catch, like the coach and the audio), the profile
 * the scene applies, and the FPS watch that turns economy on by itself when the measured frame rate stays low.
 */
import type {EffectsProfile} from './render/legibility.ts';

export const ECONOMY_KEY='viagem:economia:v1';

export interface EconomySettings {
  /** Economy mode on. */
  on:boolean;
  /** It was turned on by the FPS watch (not by a tap): the settings say so and the toast offers "Desligar". */
  auto:boolean;
  /** The player turned it off after the watch turned it on: the watch never turns it on again on this phone. */
  declined:boolean;
}
export const DEFAULT_ECONOMY:Readonly<EconomySettings>=Object.freeze({on:false,auto:false,declined:false});

/** Storage that may be missing or throw (private mode, blocked site data, the thumbnail capture). */
export interface KeyValue {getItem(key:string):string|null;setItem(key:string,value:string):void}

export function loadEconomy(storage?:KeyValue|null):EconomySettings{
  try{
    const raw=storage?.getItem(ECONOMY_KEY);if(!raw)return {...DEFAULT_ECONOMY};
    const v=JSON.parse(raw) as Partial<EconomySettings>|null;
    if(!v||typeof v!=='object')return {...DEFAULT_ECONOMY};
    const on=v.on===true;
    return {on,auto:on&&v.auto===true,declined:v.declined===true};
  }catch{return {...DEFAULT_ECONOMY};}
}
/** False when the phone would not keep it (the setting still applies for this session). */
export function saveEconomy(storage:KeyValue|null|undefined,settings:EconomySettings):boolean{
  try{if(!storage)return false;storage.setItem(ECONOMY_KEY,JSON.stringify(settings));return true;}catch{return false;}
}
/** A tap on the switch. Turning off what the watch turned on remembers the "no". */
export function toggleEconomy(s:EconomySettings,on:boolean):EconomySettings{
  if(on)return {on:true,auto:false,declined:s.declined};
  return {on:false,auto:false,declined:s.declined||s.auto};
}
/** The watch asked for economy: on, unless the player already said no to it (or it is on). */
export function autoEconomy(s:EconomySettings):EconomySettings|undefined{
  if(s.on||s.declined)return undefined;
  return {on:true,auto:true,declined:false};
}

/**
 * No DPR knob here: Phaser 3.90 has no `resolution`, so the world canvas already renders one pixel per CSS px on any
 * phone (DPR 1, under the cap of 2 the card asks for; tests/client/economy.test.ts and scripts/perf-lab.cjs check the canvas).
 * The HUD is DOM and keeps the phone's own DPR, so its text stays sharp in both modes.
 */
export const NORMAL_FPS=60,ECONOMY_FPS=30;

export interface RenderProfile {fps:number;effects:EffectsProfile}
export function renderProfile(economy:boolean):RenderProfile{
  return economy?{fps:ECONOMY_FPS,effects:'reduced'}:{fps:NORMAL_FPS,effects:'full'};
}
/**
 * Phaser's frame gate (TimeStep._limitRate, ms) for a target fps: 85% of the period, between "one screen frame too
 * few" and "enough" on 60, 90 and 120 Hz screens. With the plain period a 60 Hz frame that comes a hair early waits
 * for the next one (30 fps drops to 20 now and then; Phaser's own limit:60 does the same to 60).
 */
export const frameGateMs=(fps:number)=>1000/fps*.85;

/**
 * The FPS watch: drawn-frame intervals (ms) from the scene while the game is visible and running. After a warm-up it
 * looks at windows of `windowMs`; `lowWindows` counted windows in a row under `minFps` ask for economy (once).
 * Windows that do not say "the phone chokes" are thrown away (they neither count nor break the streak):
 *  - any frame longer than `gapMs` in it: the rAF stopped (notification shade, a call, a locked screen), not slowness;
 *  - the tab hidden at any moment of it (`taint()`, from the scene).
 * A steady ~30 Hz rAF (iOS Low Power Mode caps it there) is not choking: economy would draw at 30 anyway. A window
 * where `steadyShare` of the frames sit within ±`steadyMs` of 33.3 ms breaks the streak instead of counting as low.
 * Pause and the lobby reset the whole watch (warm-up too) from the scene.
 */
export interface FpsWatchOptions {warmupMs:number;windowMs:number;minFps:number;lowWindows:number;gapMs:number;steadyMs:number;steadyShare:number}
export const FPS_WATCH:Readonly<FpsWatchOptions>=Object.freeze({warmupMs:8000,windowMs:5000,minFps:40,lowWindows:2,gapMs:250,steadyMs:4,steadyShare:.85});
/** The interval of a 30 Hz screen refresh (Low Power Mode). */
const CAPPED_30_MS=1000/30;
export class FpsWatch {
  private readonly o:FpsWatchOptions;
  private warm=0;private span=0;private frames=0;private steady=0;private tainted=false;private low=0;private fired=false;
  /** Last whole windows' fps (newest last, up to 12), for the lab report. */
  readonly history:number[]=[];
  /** Windows thrown away (pause in the rAF or hidden tab) and windows read as a steady 30 Hz cap. */
  ignored=0;capped=0;
  constructor(options:Partial<FpsWatchOptions>={}){this.o={...FPS_WATCH,...options};}
  /** One drawn frame `deltaMs` after the last. True once, when economy should turn on. */
  frame(deltaMs:number):boolean{
    if(this.fired||!(deltaMs>0))return false;
    if(this.warm<this.o.warmupMs){this.warm+=deltaMs;return false;}
    if(deltaMs>this.o.gapMs)this.tainted=true;
    this.span+=deltaMs;this.frames++;
    if(Math.abs(deltaMs-CAPPED_30_MS)<=this.o.steadyMs)this.steady++;
    if(this.span<this.o.windowMs)return false;
    const fps=this.frames*1000/this.span,steady=this.steady/this.frames,tainted=this.tainted;
    this.span=0;this.frames=0;this.steady=0;this.tainted=false;
    if(tainted){this.ignored++;return false;}
    this.history.push(Math.round(fps*10)/10);if(this.history.length>12)this.history.shift();
    if(steady>=this.o.steadyShare){this.capped++;this.low=0;return false;}
    this.low=fps<this.o.minFps?this.low+1:0;
    if(this.low>=this.o.lowWindows){this.fired=true;return true;}
    return false;
  }
  /** The tab was hidden during the current window: it does not count. */
  taint(){this.tainted=true;}
  /** Paused, out of combat or economy already on: start over (the warm-up too). */
  reset(){this.warm=0;this.span=0;this.frames=0;this.steady=0;this.tainted=false;this.low=0;}
  get done(){return this.fired;}
}
