/**
 * Game-style full screen (celular-deitado-tela-cheia, the user, 23/10: "tem uma feature que diz para o celular que é um
 * jogo e você ativa que some o header do navegador"). The Fullscreen API on the whole page, from a tap only (browsers
 * refuse it without one): a touch screen asks for it on SELECIONAR and JOGAR; the menu's corner button turns it on and
 * off anywhere. A match started on its side keeps the phone on its side (screen.orientation.lock, fullscreen only);
 * upright stays free (the game plays both ways, D-009). The installed app (manifest.webmanifest `fullscreen`) is already
 * without the bar. iPhone Safari has no page fullscreen: no button there, and nothing is asked.
 * Leaving it (Esc, the phone's back, the button) is the browser's own; a player who turned it off with the button is not
 * asked again on this device.
 */
export interface TelaCheiaDoc {
  fullscreenEnabled?:boolean;
  fullscreenElement?:Element|null;
  webkitFullscreenEnabled?:boolean;
  webkitFullscreenElement?:Element|null;
  documentElement:{requestFullscreen?(options?:FullscreenOptions):Promise<void>;webkitRequestFullscreen?():void};
  exitFullscreen?():Promise<void>;
  webkitExitFullscreen?():void;
}
export interface TelaCheiaEnv {
  doc:TelaCheiaDoc;
  /** matchMedia(query).matches */
  media(query:string):boolean;
  orientation?:{type?:string;lock?(o:string):Promise<void>;unlock?():void};
  storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
}
/** The player turned it off with the button: never asked again by SELECIONAR/JOGAR on this device. */
export const TELA_CHEIA_KEY='viagem:tela-cheia:v1';
/** A touch screen, not a PC: SELECIONAR and JOGAR ask for the full screen there only. */
export const TOQUE_QUERY='(pointer: coarse)';
/** Opened from the home screen (the manifest's display): the browser's bar is already gone. */
export const APP_QUERY='(display-mode: fullscreen), (display-mode: standalone)';

export const canFullscreen=(doc:TelaCheiaDoc)=>!!(doc.fullscreenEnabled??doc.webkitFullscreenEnabled)&&
  !!(doc.documentElement.requestFullscreen??doc.documentElement.webkitRequestFullscreen);
export const isFullscreen=(doc:TelaCheiaDoc)=>!!(doc.fullscreenElement??doc.webkitFullscreenElement);
/**
 * The corner button: only where the page can go full screen and is not already an installed app. In full screen it stays
 * (to leave it): Chrome's `display-mode: fullscreen` also matches a page the API put there.
 */
export const showButton=(env:TelaCheiaEnv)=>canFullscreen(env.doc)&&(isFullscreen(env.doc)||!env.media(APP_QUERY));

/** Full screen, the navigation bar hidden too. Resolves false when the browser says no (no tap, a policy, iOS). */
export async function enterFullscreen(doc:TelaCheiaDoc):Promise<boolean>{
  if(isFullscreen(doc))return true;
  if(!canFullscreen(doc))return false;
  const el=doc.documentElement;
  try{
    if(el.requestFullscreen)await el.requestFullscreen({navigationUI:'hide'});else el.webkitRequestFullscreen!();
    return true;
  }catch{return false;}
}
export async function exitFullscreen(doc:TelaCheiaDoc){
  if(!isFullscreen(doc))return;
  try{if(doc.exitFullscreen)await doc.exitFullscreen();else doc.webkitExitFullscreen?.();}catch{/* already out */}
}
const turnedOff=(env:TelaCheiaEnv)=>{try{return env.storage?.getItem(TELA_CHEIA_KEY)==='off';}catch{return false;}};
/** The button: on ↔ off, and the choice remembered (off: SELECIONAR/JOGAR stop asking). */
export async function toggleFullscreen(env:TelaCheiaEnv){
  const off=isFullscreen(env.doc);
  try{if(off)env.storage?.setItem(TELA_CHEIA_KEY,'off');else env.storage?.removeItem(TELA_CHEIA_KEY);}catch{/* no storage */}
  if(off){unlockOrientation(env);await exitFullscreen(env.doc);}else await enterFullscreen(env.doc);
}
/** SELECIONAR / JOGAR (inside the tap): a touch screen goes full screen unless its player turned it off. */
export function autoFullscreen(env:TelaCheiaEnv):Promise<boolean>{
  if(!env.media(TOQUE_QUERY)||env.media(APP_QUERY)||turnedOff(env))return Promise.resolve(isFullscreen(env.doc));
  return enterFullscreen(env.doc);
}
/** A match started on its side stays on its side (fullscreen only; upright stays free: the game plays both ways). */
export async function lockMatchOrientation(env:TelaCheiaEnv){
  const o=env.orientation;
  if(!o?.lock||!isFullscreen(env.doc)||!env.media('(orientation: landscape)'))return false;
  try{await o.lock('landscape');return true;}catch{return false;}
}
export function unlockOrientation(env:TelaCheiaEnv){try{env.orientation?.unlock?.();}catch{/* not locked */}}

/** Two corner brackets out, two in: the usual full-screen glyph (currentColor, like the gear's sticker). */
export const telaCheiaSvg=(on:boolean)=>`<svg class="tela-cheia-ic" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${
  on?'<path d="M12 5v7H5M20 5v7h7M12 27v-7H5M20 27v-7h7"/>':'<path d="M5 12V5h7M27 12V5h-7M5 20v7h7M27 20v7h-7"/>'}</svg>`;
/** The button's face and name for the state it is in. */
export function paintButton(button:HTMLElement,on:boolean){
  const label=on?'Sair da tela cheia':'Tela cheia';
  if(button.getAttribute('aria-label')!==label){button.setAttribute('aria-label',label);button.innerHTML=telaCheiaSvg(on);}
}
