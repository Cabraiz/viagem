/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1: the chefão's arrival scene on this phone. The room holds the sim for CENA.totalMs
 * and says so (RunState.cena, multiplayer/boss-scene.ts); here the camera goes to him (CENA.goMs), holds on him with his
 * name (CENA.holdMs) and comes back (CENA.backMs). One clock (CenaClock) for the scene (camera, shake) and the HUD (the
 * title, the skip): started at the first sight of a scene (its leftMs says how far in it already is: a phone that joins
 * mid-scene starts there), then local, to its end; one scene per arrival (his enemy id).
 * Skip (the user, 23/10: "pular com toque/clique só para quem já viu"): only from the 2nd scene this browser ever saw;
 * the camera comes back over CENA.backMs (the room still holds the sim: nobody moves earlier).
 */
import type {RunCena} from '../../contract/index.ts';
import {CENA} from '../../rules/index.ts';

const smooth=(t:number)=>t<=0?0:t>=1?1:t*t*(3-2*t);
/** How much the camera is on him at `ms` into a scene: 0 on the hero, 1 on him (smoothstep in and out). */
export function cenaWeight(ms:number,c:{goMs:number;holdMs:number;backMs:number;totalMs:number}=CENA){
  if(!(ms>=0)||ms>=c.totalMs)return 0;
  if(ms<c.goMs)return smooth(ms/c.goMs);
  const back=c.goMs+c.holdMs;
  return ms<back?1:1-smooth((ms-back)/c.backMs);
}
/** Scenes this browser saw (localStorage): from 1 on, the next one may be skipped. */
export const CENA_SEEN_KEY='viagem.chefao.cenas';
export interface CenaStore {getItem(key:string):string|null;setItem(key:string,value:string):void}

/** The scene at one moment, for the camera and the HUD. */
export interface CenaFrame {
  cena:RunCena;
  /** ms into the scene (local clock). */
  ms:number;
  /** Camera weight 0..1 (cenaWeight, or the way back after a skip). */
  weight:number;
  /** The camera holds on him (the shake and the title). */
  hold:boolean;
  /** The title shows (from halfway through the way there to the start of the way back; never after a skip). */
  title:boolean;
  /** A tap or click skips it now. */
  skippable:boolean;
}

interface Open {cena:RunCena;start:number;skippable:boolean;skipAt?:number;skipFrom?:number}
export class CenaClock {
  private open?:Open;
  private done=new Set<string>();
  private readonly store?:CenaStore|null;
  constructor(store?:CenaStore|null){this.store=store;}
  /** Scenes seen before (the store's count; none without a store). */
  seen(){const n=Number(this.read());return Number.isFinite(n)&&n>0?Math.floor(n):0;}
  private read(){try{return this.store?.getItem(CENA_SEEN_KEY)??null;}catch{return null;}}
  /**
   * The room's scene (combat only; undefined outside it): a new arrival opens the clock and counts as seen. Its absence
   * does not stop a running clock (the room ends it on its own clock; the camera comes back on this one).
   * True when a scene opened now.
   */
  sync(cena:RunCena|undefined,now:number){
    if(!cena)return false;
    if(this.open?.cena.enemy===cena.enemy){this.open.cena=cena;return false;}
    if(this.done.has(cena.enemy))return false;
    const seen=this.seen();
    this.open={cena,start:now-Math.max(0,Math.min(cena.totalMs,cena.totalMs-cena.leftMs)),skippable:seen>0};
    try{this.store?.setItem(CENA_SEEN_KEY,String(seen+1));}catch{/* private mode: always the first time */}
    return true;
  }
  /** A new run (out of combat): no scene, none played. */
  reset(){this.open=undefined;this.done.clear();}
  /** The scene now, or undefined (none, or over: then it is closed for good). */
  frame(now:number):CenaFrame|undefined{
    const o=this.open;if(!o)return undefined;
    const ms=now-o.start;
    let weight:number;
    if(o.skipAt!==undefined){const t=(now-o.skipAt)/CENA.backMs;weight=t>=1?0:(o.skipFrom??1)*(1-smooth(t));}
    else weight=cenaWeight(ms);
    if(ms>=CENA.totalMs||(o.skipAt!==undefined&&weight<=0)){this.done.add(o.cena.enemy);this.open=undefined;return undefined;}
    const hold=o.skipAt===undefined&&ms>=CENA.goMs&&ms<CENA.goMs+CENA.holdMs;
    const title=o.skipAt===undefined&&ms>=CENA.goMs/2&&ms<CENA.goMs+CENA.holdMs;
    return {cena:o.cena,ms,weight,hold,title,skippable:o.skippable&&o.skipAt===undefined};
  }
  /** Skips the running scene (only one that may be skipped): the camera comes back from where it is. */
  skip(now:number){
    const f=this.frame(now),o=this.open;
    if(!f||!o||!f.skippable)return false;
    o.skipFrom=f.weight;o.skipAt=now;return true;
  }
}
