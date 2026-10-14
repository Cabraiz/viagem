/**
 * Kill-cam window (VGM-053B): when a round's last critter falls, the announcement slot of the top band shows, for
 * KILLCAM_MS, the critter's portrait in a small frame (`.rh-killcam-tv`: the HUD's critter sticker, ctx.critterIcon,
 * its own imported art by roster id) next to a street-banner caption: "Último bicho!" and who closed the bill. The
 * round's end is stamped "FEITO" on the caption (the stamp: the one show moment, design §2.5). It never takes the camera
 * or the controls, gives way to any notice (danger over the joke) and closes by itself.
 * No picture (no sticker, or it fails to load) → no frame at all: the caption takes the width (BUG-20261013-ORQ-balao-
 * ultimo-bicho-sem-imagem: the frame used to be a transparent window for a second scene camera, and showed empty when
 * that camera did not draw). The frame shows only once the picture has loaded, so it is never an empty box.
 */
import type {RunView} from '../../contract/index.ts';
import {KILLCAM_MS,killcamCaption} from '../fun/zueira.ts';
import type {HudContext,HudPart} from './model.ts';
import type {Rect} from './zones.ts';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent?:HTMLElement)=>{
  const node=document.createElement(tag);node.className=className;parent?.append(node);return node;
};

/** Name for the caption: "Você" for the local player, the nickname otherwise (always through textContent). */
/** A caído this close to bleeding out (ticks) takes the moment instead of the kill-cam. */
export const RESCUE_FIRST_TICKS=100;
export function closerName(view:Pick<RunView,'players'>,by:string|undefined,localId:string){
  if(!by)return undefined;
  if(by===localId)return 'Você';
  return view.players.find(p=>p.id===by)?.name;
}

/** What showPortrait needs of the frame and its <img> (plain objects in the tests). */
export interface PortraitFrame {hidden:boolean|string}
export interface PortraitImage {src:string;readonly complete?:boolean;readonly naturalWidth?:number;onload:((...args:never[])=>unknown)|null;onerror:((...args:never[])=>unknown)|null;removeAttribute?(name:string):void}
/**
 * Puts `src` in the portrait: the frame stays hidden until the picture loads (at once when it already has), and hides
 * again on a load error; no `src` → no frame.
 */
export function showPortrait(frame:PortraitFrame,img:PortraitImage,src:string|undefined){
  frame.hidden=true;img.onload=img.onerror=null;
  if(!src){img.removeAttribute?.('src');return;}
  img.onload=()=>{frame.hidden=false;};
  img.onerror=()=>{frame.hidden=true;};
  if(img.src!==src)img.src=src;
  if(img.complete&&(img.naturalWidth??0)>0)frame.hidden=false;
}

export interface KillcamPart extends HudPart {
  /**
   * The box (viewport CSS px) for the scene's second kill-cam camera: always undefined now, the frame holds the
   * critter's portrait (an opaque picture the camera would draw under).
   */
  rect():Rect|undefined;
  readonly shown:boolean;
  readonly age:number;
}

export function createKillcam(now:()=>number=()=>performance.now()):KillcamPart{
  const root=el('div','rh-killcam');root.hidden=true;root.setAttribute('role','status');
  const tv=el('div','rh-killcam-tv',root);tv.setAttribute('aria-hidden','true');tv.hidden=true;
  const pic=el('img','rh-killcam-pic',tv);pic.alt='';pic.draggable=false;pic.decoding='async';
  const caption=el('div','rh-killcam-caption',root);
  const title=el('strong','rh-killcam-title',caption),line=el('span','rh-killcam-line',caption);
  const stamp=el('span','rh-killcam-stamp',caption);stamp.textContent='FEITO';stamp.setAttribute('aria-hidden','true');
  let seen=-1,until=0,timer:ReturnType<typeof setTimeout>|undefined,lastRound=0;
  /** Captions already shown this run (they never repeat inside a run). */
  const used=new Set<string>();
  let shownAt=-Infinity;
  const hide=()=>{root.hidden=true;root.classList.remove('rh-killcam-in');};
  return {
    el:root,
    get shown(){return !root.hidden;},
    /** ms since the window opened (the intermission offer waits for the stamp, design review D2). */
    get age(){return root.hidden?Infinity:now()-shownAt;},
    update(view:RunView,ctx:HudContext){
      for(const event of view.events){
        if(event.eventId<=seen)continue;
        seen=event.eventId;
        if(event.type!=='last-bicho')continue;
        // Someone about to bleed out (≤ 5 s): the eye goes to the rescue, not to the TV (design review D5).
        if(view.players.some(p=>p.downed&&!p.eliminated&&p.downed.bleedOutTick-view.tick<=RESCUE_FIRST_TICKS))continue;
        if(event.round<lastRound)used.clear();
        lastRound=event.round;
        const copy=killcamCaption(closerName(view,event.by,ctx.localId),event.kind,event.eventId,used);
        used.add(copy.template);
        title.textContent=copy.title;line.textContent=copy.line;
        showPortrait(tv,pic,ctx.critterIcon?.(event.kind));
        root.dataset.kind=event.kind;root.hidden=false;shownAt=now();
        root.classList.remove('rh-killcam-in');void root.offsetWidth;root.classList.add('rh-killcam-in');
        until=now()+KILLCAM_MS;clearTimeout(timer);timer=setTimeout(hide,KILLCAM_MS);
      }
      if(!root.hidden&&now()>until)hide();
    },
    rect(){return undefined;},
    destroy(){clearTimeout(timer);},
  };
}
