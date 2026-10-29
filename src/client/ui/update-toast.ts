/**
 * The page's side of the version watch (NEW-20261012-E5-chunk-velho-deploy, watch in ./version-watch.ts):
 *  - the "Versão nova do jogo" notice the player taps to reload (never a reload mid-match without that tap);
 *  - what counts as "in a match" for the watch (read from the island shell that explore.ts keeps up to date);
 *  - where to come back after a reload (sessionStorage RESUME_KEY: the lobby, and the room when one was joined);
 *  - the link that lets the lazy chunks (lobby.ts, explore.ts) reach the watch main.ts created.
 * main.ts imports this statically, so it lives in the entry chunk: after a deploy the old lazy chunks answer 404, and
 * the code that reacts to that cannot be one of them (its CSS, update-toast.css, comes in with the menu for the same
 * reason). No DOM at import time: the pure parts run in node (tests/client/version-wiring.test.ts).
 */
import {icon} from './icon.ts';
import type {UpdateReason} from './version-watch.ts';

/** The notice, one line: in a match it is all there is (the joke below shows only out of the round, UX B5). */
/** The one "new version" line (T9 of the texts audit): the notice, the retry window, the lobby and the map reuse it. */
export const UPDATE_NEWS='Saiu versão nova do jogo.';
export const UPDATE_TITLE=`${UPDATE_NEWS} Toca pra atualizar.`;
/** Optional second line (the joke), outside the HUD slot only. */
export const UPDATE_LINE='Saiu ajuste fresquinho.';
/** How long the notice may hold the HUD's announcement slot: a whole run (30 min); danger notices still go first. */
export const UPDATE_ROW_MS=30*60_000;

/** sessionStorage {view,room?,at}: written right before a version reload, read and deleted by main.ts at startup. */
export const RESUME_KEY='viagem:resume';
/** A resume older than this is stale (a reload takes seconds; the room's seat waits GRACE_MS = 2 min). */
export const RESUME_MAX_MS=2*60_000;
/** Phases of a room run that count as "in a match": the reload waits for the player's tap. */
export const MATCH_PHASES:readonly string[]=Object.freeze(['countdown','combat']);
const ROOM_CODE=/^[A-F0-9]{10}$/;

export interface Resume {view:'lobby'|'menu';room?:string;at:number}
export type ResumeIntent=Omit<Resume,'at'>;
type Store={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

/** The slice of a <dialog> these rules read (a real HTMLDialogElement fits; tests pass plain objects). */
export interface ShellLike {readonly classList:{contains(name:string):boolean};readonly dataset:Record<string,string|undefined>}
export interface DocLike {querySelector(selector:string):ShellLike|null}

const OPEN_SHELL='dialog.explore-shell[open]';
const OPEN_LOBBY='dialog.coop-lobby[open]';
const roomOf=(code:string|undefined)=>code&&ROOM_CODE.test(code)?code:undefined;

/**
 * In a match: the solo island is open (it has no lobby), or the room's run is in countdown/combat
 * (explore.ts writes the phase to the shell's data-run-phase). Menu, lobby window, waiting room and result are not.
 */
export function inMatchOf(doc:DocLike):boolean{
  const shell=doc.querySelector(OPEN_SHELL);
  if(!shell)return false;
  if(!shell.classList.contains('coop-shell'))return true;
  return MATCH_PHASES.includes(shell.dataset.runPhase??'');
}

/** The phase went from countdown/combat to anything else (the result, the waiting room): the match ended. */
export const leftMatch=(previous:string|undefined,next:string|undefined)=>MATCH_PHASES.includes(previous??'')&&!MATCH_PHASES.includes(next??'');

let intent:ResumeIntent|undefined;
/**
 * Where to come back right now: the room of the open room shell (waiting room, result, or the match after a tap),
 * the open lobby window (with the room it joined, lobby.ts data-room), what the player was opening when a lazy chunk
 * failed (`opening`), or the menu. The solo island comes back to the menu (the hero is in localStorage).
 */
export function resumeOf(doc:DocLike,now:number):Resume{
  const shell=doc.querySelector(OPEN_SHELL);
  if(shell){
    const room=shell.classList.contains('coop-shell')?roomOf(shell.dataset.room):undefined;
    return room?{view:'lobby',room,at:now}:{view:'menu',at:now};
  }
  const lobby=doc.querySelector(OPEN_LOBBY);
  if(lobby){const room=roomOf(lobby.dataset.room);return room?{view:'lobby',room,at:now}:{view:'lobby',at:now};}
  if(intent){const room=roomOf(intent.room);return room?{view:intent.view,room,at:now}:{view:intent.view,at:now};}
  return {view:'menu',at:now};
}

/**
 * Runs `load` (a lazy import and what opens with it) with `next` as the place to come back to. Vite reports a failed
 * chunk ('vite:preloadError') before the import rejects, so the watch may reload while `load` is still pending:
 * the intent has to be in place before the import starts.
 */
export async function opening<T>(next:ResumeIntent,load:()=>Promise<T>):Promise<T>{
  const previous=intent;intent=next;
  try{return await load();}finally{intent=previous;}
}

export function saveResume(store:Store|undefined,resume:Resume){
  try{store?.setItem(RESUME_KEY,JSON.stringify(resume));}catch{/* storage off: the reload lands on the menu */}
}
/** Reads and deletes the resume; undefined when missing, malformed, from the future or older than RESUME_MAX_MS. */
export function takeResume(store:Store|undefined,now:number):Resume|undefined{
  let raw:string|null|undefined;
  try{raw=store?.getItem(RESUME_KEY);store?.removeItem(RESUME_KEY);}catch{return undefined;}
  if(!raw)return undefined;
  let value:{view?:unknown;room?:unknown;at?:unknown};
  try{value=JSON.parse(raw);}catch{return undefined;}
  if(!value||typeof value!=='object'||(value.view!=='lobby'&&value.view!=='menu')||typeof value.at!=='number')return undefined;
  const age=now-value.at;
  if(!(age>=0&&age<=RESUME_MAX_MS))return undefined;
  const room=typeof value.room==='string'?roomOf(value.room):undefined;
  return room&&value.view==='lobby'?{view:'lobby',room,at:value.at}:{view:value.view,at:value.at};
}

// ---------- The link to the watch ----------

/** What the lazy chunks need from the watch (version-watch.ts VersionWatch fits). */
export interface WatchLink {chunkFailed(e:unknown):boolean;matchEnded():void;update():void;readonly pending:UpdateReason|undefined;readonly reloading?:boolean}
/** The match screen's announcement slot (explore.ts with the room HUD): `take` answers false when it cannot show it now. */
export interface MatchSlot {take(el:HTMLElement):boolean;drop(el:HTMLElement):void}

let link:WatchLink|undefined,slot:MatchSlot|undefined,notice:HTMLElement|undefined,reloading=false;

export function linkWatch(watch:WatchLink|undefined){link=watch;}
/**
 * For every catch around a lazy import: true when `e` is a chunk of an older deploy (the watch then reloads, or shows
 * the notice in a match), so the caller says nothing and does nothing that would lose the seat; false otherwise.
 */
export const chunkFailed=(e:unknown)=>!!link?.chunkFailed(e);
/** True once the page is reloading for a new version: only then may a caller skip leaving the room (the resume rejoins). */
export const reloadUnderway=()=>reloading||!!link?.reloading;
/**
 * "Atualizar agora" and the pull-to-refresh (BUG-20261024-ORQ-arrastar-atualiza-versao-nova): the watch's tap (resume
 * saved, guard recorded, reload); without a watch, a plain reload.
 */
export function updateNow(target:{reload():void}=location){if(link)link.update();else reloadPage(target);}
/** The reload the watch calls: marks the page as leaving so nothing re-shows the notice while it unloads. */
export function reloadPage(target:{reload():void}){reloading=true;target.reload();}

/** explore.ts registers its HUD slot while a room match is on screen, and clears it when the shell closes. */
export function setMatchSlot(next:MatchSlot|undefined){
  if(slot&&notice&&slot!==next)slot.drop(notice);
  slot=next;
  if(notice&&link?.pending&&!reloading)place(notice);
}
/** The match ended (explore.ts: phase left countdown/combat, or the shell closed): reload now if one waits. */
export function matchEnded(){
  if(notice&&slot)slot.drop(notice);
  link?.matchEnded();
  // Still here (the guard forbids another automatic reload): the notice moves out of the HUD slot, which the result hides.
  if(notice&&link?.pending&&!reloading)place(notice);
}

// ---------- The notice (DOM) ----------

function build(doc:Document):HTMLElement{
  const el=doc.createElement('div');el.className='update-toast';el.setAttribute('role','status');
  el.innerHTML=`<button type="button" class="update-toast-tap"><span class="update-toast-icon">${icon('pipoca')}</span><span class="update-toast-text"><strong></strong><span class="update-toast-line"></span></span></button>`;
  // A live region inserted already filled is not announced by most screen readers: fill it right after it is placed.
  setTimeout(()=>{el.querySelector('strong')!.textContent=UPDATE_TITLE;el.querySelector('.update-toast-line')!.textContent=UPDATE_LINE;},0);
  el.querySelector('button')!.addEventListener('click',event=>{event.stopPropagation();link?.update();});
  // Over the map: its taps never reach the game (like the HUD panels and the economy toast).
  for(const type of ['pointerdown','touchstart'])el.addEventListener(type,event=>event.stopPropagation());
  return el;
}
/**
 * In a room match the HUD's announcement slot takes it (one row at a time, off the hero and the thumbs). Otherwise it
 * floats at the top of the screen inside the window on top (a modal <dialog> makes everything outside it inert).
 */
function place(el:HTMLElement){
  if(slot?.take(el)){el.classList.remove('update-toast-floating');return;}
  slot?.drop(el);
  const doc=el.ownerDocument;
  const dialogs=[...doc.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(d=>!d.closest('dialog.explore-shell')||d.matches('dialog.explore-shell'));
  const host=doc.querySelector<HTMLElement>(`${OPEN_SHELL} .explore-layout`)??dialogs.at(-1)??doc.body;
  el.classList.add('update-toast-floating');el.hidden=false;
  if(el.parentElement!==host)host.append(el);
}
/** The watch's onAvailable: shows the notice (once; a later call only moves it to where it can be seen now). */
export function showUpdateToast(doc:Document=document):HTMLElement{
  notice??=build(doc);
  place(notice);
  return notice;
}
