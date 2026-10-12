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
 * phone (DPR 1, under the cap of 2 the card asks for; tests/economy.test.ts and scripts/perf-lab.cjs check the canvas).
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
 * The FPS watch: frame intervals (ms) from the scene while the game is visible and running. After a warm-up it looks
 * at windows of `windowMs`; `lowWindows` windows in a row under `minFps` ask for economy (once).
 * A frame longer than `gapMs` (the app coming back from the background) resets the window instead of counting as
 * slowness; pause, hidden tab and the lobby reset the watch from the scene. A phone at 2 fps still counts as slow.
 */
export interface FpsWatchOptions {warmupMs:number;windowMs:number;minFps:number;lowWindows:number;gapMs:number}
export const FPS_WATCH:Readonly<FpsWatchOptions>=Object.freeze({warmupMs:8000,windowMs:5000,minFps:40,lowWindows:2,gapMs:2000});
export class FpsWatch {
  private readonly o:FpsWatchOptions;
  private warm=0;private span=0;private frames=0;private low=0;private fired=false;
  /** Last whole windows' fps (newest last, up to 12), for the lab report. */
  readonly history:number[]=[];
  constructor(options:Partial<FpsWatchOptions>={}){this.o={...FPS_WATCH,...options};}
  /** One rendered frame `deltaMs` after the last. True once, when economy should turn on. */
  frame(deltaMs:number):boolean{
    if(this.fired||!(deltaMs>0))return false;
    if(deltaMs>this.o.gapMs){this.span=0;this.frames=0;return false;}
    if(this.warm<this.o.warmupMs){this.warm+=deltaMs;return false;}
    this.span+=deltaMs;this.frames++;
    if(this.span<this.o.windowMs)return false;
    const fps=this.frames*1000/this.span;
    this.history.push(Math.round(fps*10)/10);if(this.history.length>12)this.history.shift();
    this.span=0;this.frames=0;
    this.low=fps<this.o.minFps?this.low+1:0;
    if(this.low>=this.o.lowWindows){this.fired=true;return true;}
    return false;
  }
  /** Paused, hidden or economy already on: start over (the warm-up too). */
  reset(){this.warm=0;this.span=0;this.frames=0;this.low=0;}
  get done(){return this.fired;}
}
