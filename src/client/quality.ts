/**
 * Quality levels (Q3, NEW-20261021-E6-q3-niveis-qualidade): Leve / Normal / Alta instead of the economy switch.
 * Pure module (no Phaser, no DOM): the level a device starts at, the saved choice (with the old economy setting
 * migrated), what each level turns on, and the step down the FPS watch asks for.
 * Leve is the old economy mode (30 fps, reduced effects) plus a still scenery; Normal and Alta part ways when the art
 * follows the level (the card's slices 2–4).
 */
import {ECONOMY_KEY,NORMAL_FPS,ECONOMY_FPS,type KeyValue,type FpsWatchOptions} from './economy.ts';
import type {EffectsProfile} from './render/legibility.ts';

export type QualityLevel='leve'|'normal'|'alta';
export const QUALITY_LEVELS:readonly QualityLevel[]=Object.freeze(['leve','normal','alta']);
export const QUALITY_KEY='viagem:qualidade:v1';
export const QUALITY_LABEL:Readonly<Record<QualityLevel,string>>=Object.freeze({leve:'Leve',normal:'Normal',alta:'Alta'});

export interface QualitySettings {
  /** The level the game runs at. */
  level:QualityLevel;
  /** Picked by the player in the gear: the device and the watch never change it again. */
  chosen:boolean;
  /** The watch lowered it (not a tap): the toast offers "Desfazer". */
  auto:boolean;
  /** The player undid a step of the watch: it never steps down by itself again on this device. */
  declined:boolean;
}

/** What the browser tells about the device; every field may be missing (Safari and Firefox have no deviceMemory). */
export interface DeviceHints {
  /** navigator.deviceMemory, GB (rounded down by the browser to 0.25…8). */
  memory?:number;
  /** navigator.hardwareConcurrency. */
  cores?:number;
  /** A fine pointer (a mouse): desktop-input's finePointer(). */
  fine?:boolean;
}

/**
 * The level a device starts at, before any frame: a weak device (≤ 2 GB or ≤ 2 cores) Leve, a mouse with no sign of
 * low memory Alta, the rest (phones) Normal. The watch fixes a wrong guess in the first 10 s of combat.
 */
export function detectQuality(h:DeviceHints):QualityLevel{
  const memory=Number.isFinite(h.memory)&&h.memory!>0?h.memory:undefined,cores=Number.isFinite(h.cores)&&h.cores!>0?h.cores:undefined;
  if(memory!==undefined&&memory<=2||cores!==undefined&&cores<=2)return 'leve';
  if(h.fine&&(memory===undefined||memory>=4))return 'alta';
  return 'normal';
}
/** The hints of this browser (none outside one). */
export function deviceHints(nav:{deviceMemory?:number;hardwareConcurrency?:number}|undefined,fine:boolean):DeviceHints{
  return {memory:nav?.deviceMemory,cores:nav?.hardwareConcurrency,fine};
}

const isLevel=(v:unknown):v is QualityLevel=>typeof v==='string'&&(QUALITY_LEVELS as readonly string[]).includes(v);

/**
 * The saved settings, or the device's level when there are none. An old economy setting (VGM-048) carries over:
 * economy on is Leve (still marked auto if the watch had turned it on), and a "no" to the watch stays a "no".
 */
export function loadQuality(storage:KeyValue|null|undefined,detected:QualityLevel):QualitySettings{
  const fresh={level:detected,chosen:false,auto:false,declined:false};
  try{
    const raw=storage?.getItem(QUALITY_KEY);
    if(raw){
      const v=JSON.parse(raw) as Partial<QualitySettings>|null;
      if(!v||typeof v!=='object'||!isLevel(v.level))return fresh;
      const chosen=v.chosen===true,auto=!chosen&&v.auto===true;
      // Not chosen and not lowered by the watch: the device decides again (a new browser may say more).
      const level=chosen||auto?v.level:detected;
      return {level,chosen,auto,declined:v.declined===true};
    }
    const old=storage?.getItem(ECONOMY_KEY);if(!old)return fresh;
    const e=JSON.parse(old) as {on?:unknown;auto?:unknown;declined?:unknown}|null;
    if(!e||typeof e!=='object')return fresh;
    if(e.on===true)return {level:'leve',chosen:e.auto!==true,auto:e.auto===true,declined:e.declined===true};
    return {...fresh,declined:e.declined===true};
  }catch{return fresh;}
}
/** False when the device would not keep it (the level still applies for this session). */
export function saveQuality(storage:KeyValue|null|undefined,s:QualitySettings):boolean{
  try{if(!storage)return false;storage.setItem(QUALITY_KEY,JSON.stringify(s));return true;}catch{return false;}
}
/** A tap in the gear. Going back up from a level the watch picked is a "no" to the watch. */
export function chooseQuality(s:QualitySettings,level:QualityLevel):QualitySettings{
  const undo=s.auto&&rank(level)>rank(s.level);
  return {level,chosen:true,auto:false,declined:s.declined||undo};
}
/** "Desfazer" on the toast: back to the level before the step, and the watch never steps again. */
export function undoQuality(s:QualitySettings,before:QualityLevel):QualitySettings{
  return {level:before,chosen:true,auto:false,declined:true};
}
const rank=(l:QualityLevel)=>QUALITY_LEVELS.indexOf(l);
/** The watch saw the combat choke: one level down, unless the player picked or said no, or it is already Leve. */
export function stepDown(s:QualitySettings):QualitySettings|undefined{
  if(s.chosen||s.declined||s.level==='leve')return undefined;
  return {level:QUALITY_LEVELS[rank(s.level)-1]!,chosen:false,auto:true,declined:false};
}

/** `?qualidade=leve|normal|alta` (lab, prints): forces the level for this page, never saved. */
export function qualityFromUrl(search:string):QualityLevel|undefined{
  try{const v=new URLSearchParams(search).get('qualidade');return isLevel(v)?v:undefined;}catch{return undefined;}
}

export interface QualityProfile {
  fps:number;
  effects:EffectsProfile;
  /** The economy look: no silhouettes, tower shadows or vignette, three relief shadow taps. */
  economy:boolean;
  /** The scenery holds still: the CityLive loops and lights and the fountain glint on their first frame. */
  still:boolean;
}
export function qualityProfile(level:QualityLevel):QualityProfile{
  return level==='leve'?{fps:ECONOMY_FPS,effects:'reduced',economy:true,still:true}:{fps:NORMAL_FPS,effects:'full',economy:false,still:false};
}

/** The FPS watch for the levels: the first 10 s of combat (2 s warm-up, two 4 s windows under 40 fps). */
export const QUALITY_WATCH:Readonly<Partial<FpsWatchOptions>>=Object.freeze({warmupMs:2000,windowMs:4000,lowWindows:2});
