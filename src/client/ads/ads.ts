/**
 * Ad breaks (NEW-20261023-ORQ-anuncios-h5-games) over the Ad Placement API: one adConfig at boot (preloadAdBreaks, sound)
 * and adBreak({type:'next'}) at the two places the card allows, both on the result screen, never during a match:
 * leaving with "Sair" and the solo rematch. The game never waits on the ad: off = the action runs at once with zero
 * calls; script blocked (adblock), failed or slow = the action runs after FALLBACK_MS; an ad that started is capped too.
 * Sound: the game's master is hushed between beforeAd and afterAd.
 *
 * No rewarded ad: the only rewards that exist (Grana, items, XP) change a shared multiplayer run, so a reward bought by
 * watching an ad would be unfair to the rest of the room. Only the interstitial.
 */
import type { AdsConfig } from './config.ts';
import { getAudio } from '../audio/engine.ts';

export const SCRIPT_URL='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
/** No sign of the API (no beforeAd, no adBreakDone) after this long: the action runs, the ad is forgotten. */
export const FALLBACK_MS=1500;
/** An ad that started and never ended (a broken creative) frees the game after this long. */
export const MAX_AD_MS=60_000;

export interface AdBreakPlacement {
  type:'next';
  name:string;
  beforeAd?():void;
  afterAd?():void;
  adBreakDone?(info:{breakStatus?:string}):void;
}
export interface AdConfigCall {preloadAdBreaks?:'on'|'auto';sound?:'on'|'off';onReady?():void}

export interface AdsDeps {
  config:Readonly<AdsConfig>;
  /** Pushes to window.adsbygoogle (the API's queue; a blocked script means nobody ever reads it). */
  push(call:AdBreakPlacement|AdConfigCall):void;
  /** Adds the async script once; calls onError when it fails to load (adblock, offline). */
  loadScript(src:string,attrs:Record<string,string>,onError:()=>void):void;
  /** Mutes (true) or restores (false) the game's sound. */
  hush(on:boolean):void;
  now():number;
  setTimer(fn:()=>void,ms:number):unknown;
  clearTimer(handle:unknown):void;
}

export type BreakOutcome='off'|'throttled'|'blocked'|'shown'|'none'|'timeout';

export class Ads {
  private failed=false;
  private lastShown=-Infinity;
  private busy=false;
  private readonly deps:AdsDeps;
  constructor(deps:AdsDeps){this.deps=deps;}

  /** Loads the script (async) and sends adConfig. Called once, after the menu is ready. */
  boot(){
    const {config}=this.deps;
    const attrs:Record<string,string>={'data-ad-frequency-hint':`${Math.round(config.minGapMs/1000)}s`};
    if(config.test)attrs['data-adbreak-test']='on';
    const src=config.client?`${SCRIPT_URL}?client=${encodeURIComponent(config.client)}`:SCRIPT_URL;
    if(config.client)attrs['data-ad-client']=config.client;
    try{
      this.deps.loadScript(src,attrs,()=>{this.failed=true;});
      this.deps.push({preloadAdBreaks:'on',sound:'on'});
    }catch{this.failed=true;}
  }

  /**
   * An interstitial at a natural break, then `next` runs exactly once whatever happens. The callback tells why
   * (tests and the UX metrics); the game only cares that it ran.
   */
  interstitial(name:string,next:(outcome:BreakOutcome)=>void){
    const {deps}=this;
    let done=false,shown=false,hushed=false,timer:unknown;
    const finish=(outcome:BreakOutcome)=>{
      if(done)return;done=true;this.busy=false;
      if(timer!==undefined)deps.clearTimer(timer);
      if(hushed)deps.hush(false);
      next(outcome);
    };
    if(this.failed)return finish('blocked');
    if(this.busy||deps.now()-this.lastShown<deps.config.minGapMs)return finish('throttled');
    this.busy=true;
    timer=deps.setTimer(()=>finish('timeout'),FALLBACK_MS);
    try{
      deps.push({type:'next',name,
        beforeAd:()=>{
          if(done)return;shown=hushed=true;this.lastShown=deps.now();deps.hush(true);
          deps.clearTimer(timer);timer=deps.setTimer(()=>finish('timeout'),MAX_AD_MS);
        },
        afterAd:()=>{if(hushed&&!done){hushed=false;deps.hush(false);}},
        adBreakDone:info=>finish(info?.breakStatus==='viewed'||shown?'shown':'none'),
      });
    }catch{finish('blocked');}
  }
}

let shared:Ads|undefined;
/** The app's ads, once booted (main.ts after the menu is ready); undefined = ads off. */
export const sharedAds=()=>shared;

/** Browser wiring: window.adsbygoogle, a <script async> in <head>, the game's audio engine. */
export function bootAds(config:Readonly<AdsConfig>,win:Window&{adsbygoogle?:unknown[]}=window):Ads{
  if(shared)return shared;
  const doc=win.document;
  shared=new Ads({config,
    push:call=>{(win.adsbygoogle=win.adsbygoogle||[]).push(call);},
    loadScript:(src,attrs,onError)=>{
      const script=doc.createElement('script');
      script.async=true;script.src=src;script.crossOrigin='anonymous';
      for(const [key,value] of Object.entries(attrs))script.setAttribute(key,value);
      script.addEventListener('error',onError,{once:true});
      doc.head.appendChild(script);
    },
    hush:on=>getAudio().setHushed(on),
    now:()=>win.performance.now(),
    setTimer:(fn,ms)=>win.setTimeout(fn,ms),
    clearTimer:handle=>win.clearTimeout(handle as number),
  });
  shared.boot();
  return shared;
}

/** A break before `next`, or `next` at once when ads are off. */
export function adBreakThen(name:string,next:()=>void){
  if(!shared)return next();
  shared.interstitial(name,()=>next());
}

/** No other human online in the room (bots do not count): the rematch can wait for an ad without holding anyone. */
export const soloRoom=(members:readonly {id:string;online?:boolean;bot?:boolean}[]|undefined,localId:string)=>
  !members?.some(m=>m.id!==localId&&m.online!==false&&!m.bot);
