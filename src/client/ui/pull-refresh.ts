/**
 * Pull-to-refresh of our own in the menus (BUG-20261024-ORQ-arrastar-atualiza-versao-nova). The browser's gesture
 * never fires in the game: the menu locks html's overflow, a phone enters fullscreen on the first tap and the
 * installed app runs fullscreen. Pulling down from a spot that is not scrolled reloads into the newest build
 * (update-toast.ts updateNow: resume saved, then reload; the service worker loads the page with no-cache).
 * Off in a match (the joystick and the camera live there) and on the controls that drag (canvas, joystick, inputs,
 * sliders, the hero carousel's own swipe is sideways and never counts).
 * Listeners are passive: nothing is prevented, scrolling stays as it was. Pure decisions in pullStep (tests).
 */
import {icon} from './icon.ts';

/** Pull (CSS px, finger travel) at which letting go reloads. */
export const PULL_RELOAD_PX=110;
/** Below this the pull is not shown (a tap or a small jitter). */
export const PULL_SHOW_PX=14;
/** The indicator follows the finger at this share, up to PULL_MAX_PX. */
export const PULL_FOLLOW=.55,PULL_MAX_PX=96;
export const PULL_TEXT={pull:'Puxe para atualizar',release:'Solte para atualizar',going:'Atualizando…'} as const;
/** Where a pull never starts (the controls that drag, and anything that opts out). */
export const PULL_SKIP='canvas,input,textarea,select,[contenteditable],.explore-stick,.explore-canvas,[data-sem-puxar]';

export type PullState={kind:'idle'}|{kind:'pulling';dy:number;ready:boolean}|{kind:'cancelled'};

/** The pull after a move from (x0,y0) to (x,y): vertical and downward, else cancelled for this touch. */
export function pullStep(x0:number,y0:number,x:number,y:number):PullState{
  const dx=x-x0,dy=y-y0;
  if(dy<0&&-dy>PULL_SHOW_PX)return {kind:'cancelled'};
  if(Math.abs(dx)>PULL_SHOW_PX&&Math.abs(dx)>dy*.7)return {kind:'cancelled'};
  if(dy<PULL_SHOW_PX)return {kind:'idle'};
  return {kind:'pulling',dy,ready:dy>=PULL_RELOAD_PX};
}
/** The indicator's drop (px) for a pull. */
export const pullOffset=(dy:number)=>Math.min(PULL_MAX_PX,Math.max(0,dy*PULL_FOLLOW));

interface ScrollLike {readonly scrollTop:number;readonly parentElement:ScrollLike|null}
/** A pull starts only where nothing above the finger is scrolled down (else the finger scrolls back up). */
export function atTop(el:ScrollLike|null,doc:{readonly scrollingElement:{readonly scrollTop:number}|null}):boolean{
  for(let n=el;n;n=n.parentElement)if(n.scrollTop>0)return false;
  return (doc.scrollingElement?.scrollTop??0)<=0;
}

export interface PullDeps {
  doc:Document;win:Window;
  /** True in countdown/combat or the solo island (update-toast.ts inMatchOf). */
  inMatch():boolean;
  refresh():void;
}

export function startPullToRefresh(deps:PullDeps):{stop():void}{
  const {doc,win}=deps;
  let start:{x:number;y:number;id:number}|undefined,state:PullState={kind:'idle'},badge:HTMLElement|undefined,going=false;
  const show=()=>{
    if(!badge){
      badge=doc.createElement('div');badge.className='pull-refresh';badge.setAttribute('role','status');
      badge.innerHTML=`<span class="pull-refresh-icon">${icon('girar')}</span><span class="pull-refresh-text"></span>`;
    }
    // A modal <dialog> is in the top layer: the badge goes inside the open one to be seen over it.
    const dialogs=doc.querySelectorAll<HTMLDialogElement>('dialog[open]'),host=dialogs[dialogs.length-1]??doc.body;
    if(badge.parentElement!==host)host.append(badge);
    return badge;
  };
  const hide=()=>{badge?.remove();};
  const paint=(s:PullState)=>{
    if(s.kind!=='pulling'){hide();return;}
    const b=show(),off=pullOffset(s.dy);
    b.style.setProperty('--pull',`${off}px`);
    b.style.setProperty('--pull-turn',`${Math.min(1,s.dy/PULL_RELOAD_PX)*300}deg`);
    b.dataset.ready=String(s.ready);
    b.querySelector('.pull-refresh-text')!.textContent=s.ready?PULL_TEXT.release:PULL_TEXT.pull;
  };
  const onStart=(e:TouchEvent)=>{
    start=undefined;state={kind:'idle'};
    if(going||e.touches.length!==1||deps.inMatch())return;
    const target=e.target as Element|null;
    if(target?.closest?.(PULL_SKIP)||!atTop(target as unknown as ScrollLike,doc))return;
    const t=e.touches[0];start={x:t.clientX,y:t.clientY,id:t.identifier};
  };
  const onMove=(e:TouchEvent)=>{
    if(!start||state.kind==='cancelled')return;
    if(e.touches.length!==1){state={kind:'cancelled'};paint(state);return;}
    const t=e.touches[0];if(t.identifier!==start.id)return;
    state=pullStep(start.x,start.y,t.clientX,t.clientY);paint(state);
  };
  const onEnd=()=>{
    const ready=state.kind==='pulling'&&state.ready;
    start=undefined;state={kind:'idle'};
    if(!ready||deps.inMatch()){hide();return;}
    going=true;
    const b=show();b.dataset.ready='true';b.dataset.going='true';b.querySelector('.pull-refresh-text')!.textContent=PULL_TEXT.going;
    deps.refresh();
  };
  const opts={passive:true,capture:true} as const;
  doc.addEventListener('touchstart',onStart,opts);
  doc.addEventListener('touchmove',onMove,opts);
  doc.addEventListener('touchend',onEnd,opts);
  const onCancel=()=>{start=undefined;state={kind:'idle'};hide();};
  doc.addEventListener('touchcancel',onCancel,opts);
  // Coming back from another tab mid-gesture: start over.
  win.addEventListener('blur',onCancel);
  return {stop(){
    doc.removeEventListener('touchstart',onStart,opts);doc.removeEventListener('touchmove',onMove,opts);
    doc.removeEventListener('touchend',onEnd,opts);doc.removeEventListener('touchcancel',onCancel,opts);
    win.removeEventListener('blur',onCancel);hide();
  }};
}
