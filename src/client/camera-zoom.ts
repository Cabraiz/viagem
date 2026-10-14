/**
 * The player's camera zoom (NEW-20261013-ORQ-camera-zoom-out-e-roda, D-046): a factor on the follow zoom of today
 * (framing.ts followZoom / cityZoom, hero 56 CSS px on a 390 px short side), between ZOOM_MIN (the widest legal camera:
 * hero 44 px, the smallest critter still ≥ 28 px; offscreen.ts HERO_WIDEST_SCREEN_PX) and ZOOM_MAX (today's: never
 * closer, the city's baked relief would blur). The default shows ~1.4× today's area (hero ~47 px). Changed by the
 * mouse wheel or a two-finger pinch on the map, eased on screen, saved per browser. Pure: no Phaser, no DOM.
 */
import {HERO_DEFAULT_SCREEN_PX,HERO_MIN_SCREEN_PX,HERO_WIDEST_SCREEN_PX} from '../contract/index.ts';

export const ZOOM_KEY='viagem:zoom:v1';
/**
 * Hero CSS px (on a 390 px short side) at the widest, default and closest zoom, from the contract: the server spawns
 * off the widest one and paces the horde's run-in at the default one (director.ts CATCH_UP_SPEED, CITY_RUN_IN_SPEED).
 */
export const HERO_ZOOM_PX={widest:HERO_WIDEST_SCREEN_PX,default:HERO_DEFAULT_SCREEN_PX,closest:HERO_MIN_SCREEN_PX} as const;
export const ZOOM_MIN=HERO_ZOOM_PX.widest/HERO_ZOOM_PX.closest;
export const ZOOM_MAX=1;
export const ZOOM_DEFAULT=HERO_ZOOM_PX.default/HERO_ZOOM_PX.closest;
/** One wheel notch (100 px of deltaY in pixel mode) zooms by this ratio. */
export const WHEEL_NOTCH=1.1;
/** On-screen easing toward the wanted zoom (ms time constant). */
export const ZOOM_TAU_MS=90;
/** The eased zoom counts as settled (caches made for a zoom may rebuild) once this close to the wanted one. */
export const ZOOM_SETTLED=1e-3;

export interface KeyValue {getItem(key:string):string|null;setItem(key:string,value:string):void}

export const clampZoom=(k:number)=>Number.isFinite(k)?Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,k)):ZOOM_DEFAULT;

export function loadZoom(storage?:KeyValue|null):number{
  try{const raw=storage?.getItem(ZOOM_KEY);if(!raw)return ZOOM_DEFAULT;const v=Number(JSON.parse(raw)?.k);return Number.isFinite(v)?clampZoom(v):ZOOM_DEFAULT;}
  catch{return ZOOM_DEFAULT;}
}
export function saveZoom(storage:KeyValue|null|undefined,k:number):boolean{
  try{if(!storage)return false;storage.setItem(ZOOM_KEY,JSON.stringify({k:clampZoom(k)}));return true;}catch{return false;}
}

/**
 * The factor after a wheel event: deltaY > 0 (scroll down / towards the user) zooms out. deltaMode 1 is lines (≈33 px),
 * 2 pages; a trackpad pinch comes as a wheel with ctrlKey and small deltas, made 4× as strong so it feels like a pinch.
 */
export function wheelZoom(k:number,deltaY:number,deltaMode=0,ctrlKey=false):number{
  if(!Number.isFinite(deltaY)||deltaY===0)return clampZoom(k);
  const px=deltaY*(deltaMode===1?33:deltaMode===2?400:1)*(ctrlKey?4:1);
  return clampZoom(k*Math.pow(WHEEL_NOTCH,-Math.max(-300,Math.min(300,px))/100));
}

/** Eases `now` toward `target` over `dtMs` (exponential, ZOOM_TAU_MS); lands exactly once within ZOOM_SETTLED/10. */
export function easeZoom(now:number,target:number,dtMs:number):number{
  const next=target+(now-target)*Math.exp(-Math.max(0,dtMs)/ZOOM_TAU_MS);
  return Math.abs(next-target)<ZOOM_SETTLED/10?target:next;
}

/**
 * Two-finger pinch on the map (touch pointers on the canvas only: the stick's finger is captured by the stick and never
 * reaches it). `down` returns true when this pointer starts a pinch (the second finger: the caller cancels the walk the
 * first finger's tap started); `move` returns the zoom ratio since the last call while two fingers are down.
 */
export class Pinch {
  private readonly at=new Map<number,{x:number;y:number}>();
  private last=0;
  get active(){return this.at.size>=2;}
  down(id:number,x:number,y:number):boolean{
    this.at.set(id,{x,y});
    if(this.at.size===2){this.last=this.span();return true;}
    return false;
  }
  move(id:number,x:number,y:number):number|undefined{
    const p=this.at.get(id);if(!p)return undefined;
    p.x=x;p.y=y;
    if(this.at.size<2)return undefined;
    const span=this.span(),ratio=this.last>0&&span>0?span/this.last:1;
    this.last=span;return ratio;
  }
  up(id:number){this.at.delete(id);if(this.at.size===2)this.last=this.span();}
  private span(){
    const [a,b]=[...this.at.values()];
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;
  }
}
