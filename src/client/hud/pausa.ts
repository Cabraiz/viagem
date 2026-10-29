/**
 * The team's level-up pause (D-050, card NEW-20261014-E4-levelup-pausa-hud): when the team levels up in combat the room
 * freezes the round and everyone picks a card at the same time, until all humans picked or the short deadline runs out.
 * The room says so in the run state (`RunState.pause`, resent at each whole second of leftMs and when `waiting` changes);
 * explore.ts hands it to Hud.setPause, which keeps it in ctx.pause (E6's channel). This module is the HUD's visual layer:
 * - a dim layer over the world (under the top band, the offer and every window; it never takes a tap);
 * - the title "Escolham! 9 s" ("+2 escolhas! 9 s" when this phone has two cards to pick in the one pause: two
 *   level-ups on one tick, or levels queued during the gap, open ONE pause, card levelup-espalhado) and the deadline bar, right above the offer's cards (or under the top band once this phone
 *   picked and its offer closed), and who the team still waits for ("Esperando: Tia e Zé", "Falta você!");
 * - the marks on the team strip (team.ts): a check on who picked, a "thinking" ficha on who did not yet.
 * The offer itself (opening by itself during the pause, with no clock of its own) is offer.ts, of Executor-6.
 * The clock is local between the room's updates: the last leftMs counted down with performance.now, clamped at 0 and
 * synced again on every message; the DOM is written only when what it shows changed, at most every PAUSE_TICK_MS.
 */
import type {PlayerRunView,RunPause,RunView} from '../../contract/index.ts';
import {teamOrder,type HudContext,type HudPart} from './model.ts';
import {railName} from '../../rules/index.ts';
import {crosses,type Rect} from './zones.ts';
import {afterPaint,viewportSize,type Schedule} from './box-cache.ts';
import {putTextData} from './dom-put.ts';

/**
 * The pause as the room sends it (D-050, src/contract/run.ts RunPause): leftMs of the deadline, the deadline's whole
 * length, the level reached and the ids of the humans the room still waits for. Absent: no pause.
 */
export type {RunPause};
/** The pause itself, or undefined when absent or malformed (the overlay never shows "NaN s"). */
export const validPause=(pause:RunPause|undefined):RunPause|undefined=>
  pause&&Number.isFinite(pause.leftMs)&&Number.isFinite(pause.totalMs)&&Array.isArray(pause.waiting)?pause:undefined;

/** At this many ms left (3 s, like the offer's clock) the title and the bar turn Laranja Cone. */
export const PAUSE_URGENT_MS=3000;
/** The overlay is written at most this often (and only what changed) while a pause lasts. */
export const PAUSE_TICK_MS=200;
/** Names spelled out in "Esperando: …"; past them, "e mais N". */
export const PAUSE_NAMES_MAX=3;
/**
 * The title's place is checked again this often while a pause lasts (a window or a row of the slot resizing), besides
 * whenever what decides it changes. The check reads the layout after the paint (box-cache afterPaint), never in the tick.
 */
export const PAUSE_PLACE_MS=1000;
/** Gap (CSS px) between the title box and the offer's cards, and the screen's edges. */
export const PAUSE_GAP=8;

/** Who the pause can wait for: the run's players (names from the view, states for "você já escolheu"; bots never pick). */
export interface PauseMember {id:string;name:string;spectator?:boolean;eliminated?:boolean;online?:boolean;bot?:boolean}

export interface PauseView {
  /** Interpolated ms left (clamped to 0..totalMs). */
  leftMs:number;
  /** Whole seconds shown (ceil): "9 s". */
  seconds:number;
  /** What is left of the deadline bar, 0..1. */
  fraction:number;
  urgent:boolean;
  /**
   * "Escolham! 9 s"; "+2 escolhas! 9 s" while this phone has 2+ cards left in this pause; "Voltando em 9 s" once nobody
   * is missing (no "Escolham!" over "Todo mundo escolheu!").
   */
  title:string;
  /** Who the team waits for ("Esperando: você, Tia e Zé", "Falta você!", "Você já escolheu. Esperando: Tia"). */
  line:string;
  /** This phone's player has not picked yet. */
  localWaiting:boolean;
  /** Only this phone's player is missing ("Falta você!"). */
  onlyLocal:boolean;
  /** The waiting ids the roster knows (unknown ones are dropped). */
  waiting:string[];
  level:number;
  /** Cards this phone still has to pick in this pause (its pending offers; 0 once it picked them all). */
  cards:number;
  /**
   * One human in the run (bots aside; levelup-sem-arma-e-solo): the words are singular ("Escolha! 9 s") and the line,
   * which could only say "Falta você!" or "Todo mundo escolheu!", is empty.
   */
  solo:boolean;
}

/** The leftMs counted down from the message's arrival (`receivedAtMs`) to `nowMs`, clamped to 0..totalMs. */
export function pauseLeftMs(pause:RunPause,nowMs:number,receivedAtMs=nowMs){
  const total=Math.max(0,pause.totalMs);
  const left=pause.leftMs-Math.max(0,nowMs-receivedAtMs);
  return Math.max(0,Math.min(total>0?total:Math.max(0,pause.leftMs),left));
}

/** pt-BR list: "Tia", "Tia e Zé", "Tia, Zé e Bia", past PAUSE_NAMES_MAX "Tia, Zé, Bia e mais 2". */
export function namesList(names:readonly string[],max=PAUSE_NAMES_MAX){
  if(names.length<=1)return names[0]??'';
  if(names.length>max)return `${names.slice(0,max).join(', ')} e mais ${names.length-max}`;
  return `${names.slice(0,-1).join(', ')} e ${names[names.length-1]}`;
}

/** Whether a member takes part in the pick (a spectator or someone out of the run never picks). */
const picks=(m:PauseMember|undefined)=>!!m&&!m.spectator&&!m.eliminated;

/**
 * Pure view of the pause for this phone: the title, the bar, who is still missing. `roster` gives the names (railName,
 * the strip's short name); waiting ids it does not know are ignored; this phone's player is "você" and comes first.
 * `receivedAtMs` is when that pause arrived (pauseLeftMs); undefined pause → undefined (no overlay).
 * `cards`: this phone's pending offers (RunView.offers.length); counted only while the room waits for it.
 */
export function pauseView(pause:RunPause|undefined,roster:readonly PauseMember[],localId:string,nowMs:number,receivedAtMs=nowMs,cards=1):PauseView|undefined{
  if(!pause)return undefined;
  const leftMs=pauseLeftMs(pause,nowMs,receivedAtMs);
  const seconds=Math.ceil(leftMs/1000);
  const fraction=pause.totalMs>0?Math.max(0,Math.min(1,leftMs/pause.totalMs)):0;
  const byId=new Map(roster.map(m=>[m.id,m]));
  const ids=new Set(pause.waiting.filter(id=>byId.has(id)));
  // This phone first, then the strip's order (the roster's).
  const waiting=[...(ids.has(localId)?[localId]:[]),...roster.filter(m=>m.id!==localId&&ids.has(m.id)).map(m=>m.id)];
  const localWaiting=ids.has(localId),others=waiting.filter(id=>id!==localId);
  const names=others.map(id=>railName(byId.get(id)!.name));
  const onlyLocal=localWaiting&&!others.length;
  const solo=roster.filter(m=>!m.bot).length<=1;
  let line:string;
  if(solo&&!others.length)line='';
  else if(!waiting.length)line='Todo mundo escolheu!';
  else if(onlyLocal)line='Falta você!';
  else if(localWaiting)line=`Esperando: ${namesList(['você',...names])}`;
  else if(picks(byId.get(localId)))line=`Você já escolheu. Esperando: ${namesList(names)}`;
  else line=`Esperando: ${namesList(names)}`;
  const mine=localWaiting?Math.max(1,Math.floor(cards)||1):0;
  const title=!waiting.length?`Voltando em ${seconds} s`:mine>1?`+${mine} escolhas! ${seconds} s`:`${solo?'Escolha':'Escolham'}! ${seconds} s`;
  return {leftMs,seconds,fraction,urgent:leftMs<=PAUSE_URGENT_MS,title,line,localWaiting,onlyLocal,waiting,level:pause.level,cards:mine,solo};
}

/** A teammate's mark on the strip while a pause lasts. */
export type PickMark='escolheu'|'pensando';
/**
 * The strip's marks: "pensando" on whoever the room still waits for, "escolheu" on the others who take part in the pick
 * (online, not watching, not out). Offline members and spectators get no mark (the room never waits for them). No pause:
 * no marks.
 */
export function pickMarks(pause:RunPause|undefined,roster:readonly PauseMember[]):Map<string,PickMark>{
  const marks=new Map<string,PickMark>();
  if(!pause)return marks;
  const waiting=new Set(pause.waiting);
  for(const m of roster){
    if(waiting.has(m.id))marks.set(m.id,'pensando');
    else if(picks(m)&&m.online!==false)marks.set(m.id,'escolheu');
  }
  return marks;
}

/**
 * What the screen reader hears (aria-live polite), never every second: the pause starting ("Subiu pro nível 5! Escolham
 * a carta: 12 segundos."; "… Escolham 2 cartas: 16 segundos." with two to pick) and the moment only this phone is
 * missing ("Falta você!"). Undefined: nothing new to say.
 */
export function pauseAnnouncement(before:PauseView|undefined,now:PauseView|undefined):string|undefined{
  if(!now)return undefined;
  if(!before)return `Subiu pro nível ${now.level}! ${now.solo?'Escolha':'Escolham'} ${now.cards>1?`${now.cards} cartas`:'a carta'}: ${now.seconds} segundos.`;
  if(now.onlyLocal&&!before.onlyLocal&&!now.solo)return 'Falta você!';
  return undefined;
}

/**
 * Where the title box goes (left/top, CSS px), the first of these places that stays on screen, under the top band and
 * clear of the offer window and of `avoid` (the minimap):
 * 1. centred over the offer and PAUSE_GAP above it (portrait and desktop: the window sits over the thumbs); with no
 *    offer (this phone picked, its window closed) centred under the top band;
 * 2. beside an `avoid` box at that height (right or left, nearer the centre first), or under it;
 * 3. left of the offer at its top (landscape: the window is the right column under the top band), right of it, under it.
 * None fits (a screen smaller than the four reference ones): the first place anyway.
 */
export function pauseSpot(input:{viewport:{width:number;height:number};box:{width:number;height:number};top:number;offer?:Rect;avoid?:readonly Rect[]}):{x:number;y:number}{
  const {viewport,box,top,offer,avoid=[]}=input,g=PAUSE_GAP,minY=top+g;
  const clampX=(x:number)=>Math.max(g,Math.min(viewport.width-box.width-g,x));
  const want=offer?offer.x+offer.width/2-box.width/2:(viewport.width-box.width)/2;
  const first={x:clampX(want),y:offer?offer.y-g-box.height:minY};
  const places=[first];
  const near=(y:number,o:Rect)=>[o.x+o.width+g,o.x-g-box.width].sort((a,b)=>Math.abs(a-want)-Math.abs(b-want)).map(x=>({x,y}));
  for(const o of avoid)places.push(...near(first.y,o),{x:first.x,y:o.y+o.height+g});
  if(offer){
    const y=Math.max(minY,offer.y);
    places.push({x:offer.x-g-box.width,y},{x:offer.x+offer.width+g,y},{x:first.x,y:offer.y+offer.height+g});
    for(const o of avoid)places.push(...near(y,o));
  }
  const fits=(p:{x:number;y:number})=>p.x>=g&&p.x+box.width<=viewport.width-g&&p.y>=minY&&p.y+box.height<=viewport.height-g
    &&[...(offer?[offer]:[]),...avoid].every(o=>!crosses({...p,...box},o));
  const spot=places.find(fits)??{x:first.x,y:Math.max(minY,first.y)};
  return {x:Math.round(spot.x),y:Math.round(spot.y)};
}
/**
 * Over the px39 offer (offer-centro.css: a veil over the whole screen, z 30) the title box rides on top of it (z 31,
 * `data-na-oferta`): centred over the offer's title plaque (`head`) and PAUSE_GAP above it; the offer keeps that room
 * free at its top in a pause (--pausa-reserva). With no room above the plaque, the screen's top edge (never off screen).
 * Card oferta-pausa-hud-consertos (auditoria-ui-menus-28-10 item 1: the clock and who is missing were under the veil).
 */
export function pauseOverOffer(input:{viewport:{width:number;height:number};box:{width:number;height:number};head:Rect;top?:number}):{x:number;y:number}{
  const {viewport,box,head,top=0}=input,g=PAUSE_GAP;
  const x=Math.max(g,Math.min(viewport.width-box.width-g,head.x+head.width/2-box.width/2));
  const y=Math.max(top+g/2,head.y-g-box.height);
  return {x:Math.round(x),y:Math.round(y)};
}
/** The title's box at a spot crosses the offer (the layout test, and a guard for the sandbox). */
export const spotCrosses=(spot:{x:number;y:number},box:{width:number;height:number},other:Rect)=>crosses({...spot,...box},other);

/**
 * The local clock of a pause: the last sample and when it arrived. A new pause object (Hud.setPause stores one only when
 * the room's values changed) is a new sample; the same object again keeps counting down.
 */
export class PauseClock {
  private sample?:RunPause;private at=0;
  /** True when this is a new sample (or the pause started/ended). */
  sync(pause:RunPause|undefined,nowMs:number){
    if(pause===this.sample)return false;
    this.sample=pause;this.at=nowMs;return true;
  }
  get pause(){return this.sample;}
  get receivedAt(){return this.at;}
  view(roster:readonly PauseMember[],localId:string,nowMs:number,cards=1){return pauseView(this.sample,roster,localId,nowMs,this.at,cards);}
}

const el=<K extends keyof HTMLElementTagNameMap>(doc:Document,tag:K,className:string,parent?:HTMLElement)=>{
  const node=doc.createElement(tag);node.className=className;parent?.append(node);return node;
};

/** What the part needs from RunHud: the HUD root (ended, the minimap), the offer and the top band (pauseSpot). */
export interface PausePartHost {root:HTMLElement;offer:HTMLElement;top:HTMLElement;
  /** The clock (performance.now by default; the sandbox's frozen scenes stop it). */
  now?():number;
  /** When the title's place is measured again (afterPaint by default; tests run it at once). */
  schedule?:Schedule;
}

/** The roster of the pause from the view's players, in the strip's order (teamOrder: this phone first, then by id). */
export const pauseRoster=(players:readonly PlayerRunView[],localId:string):PauseMember[]=>
  teamOrder(players,localId).map(p=>({id:p.id,name:p.name,spectator:p.spectator,eliminated:p.eliminated,online:p.online,bot:p.bot}));

/**
 * The pause's HUD part (D-050): the veil (`dim`, RunHud puts it under every part), the title box (`el`) and the polite
 * live region (`live`). update(view, ctx) reads ctx.pause (Hud.setPause, E6's channel): a new pause object is a new
 * sample of the room's clock; between samples a PAUSE_TICK_MS timer counts down, writing only what changed.
 */
export function createPausePart(doc:Document,host:PausePartHost):HudPart&{dim:HTMLElement;live:HTMLElement}{
  const dim=el(doc,'div','rh-pausa-veu');dim.hidden=true;dim.setAttribute('aria-hidden','true');
  const box=el(doc,'div','rh-pausa');box.hidden=true;box.lang='pt-BR';
  box.setAttribute('role','group');box.setAttribute('aria-label','Pausa pra escolher a carta');
  const title=el(doc,'strong','rh-pausa-titulo',box);
  const track=el(doc,'div','rh-pausa-prazo',box),fill=el(doc,'i','rh-pausa-prazo-fill',track);
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Tempo pra escolher');
  track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
  const line=el(doc,'span','rh-pausa-linha',box);
  const live=el(doc,'span','rh-sr');live.setAttribute('aria-live','polite');
  const clock=new PauseClock(),now=()=>host.now?.()??performance.now();
  let last:PauseView|undefined,shown=false,spot='',bar='',secs=-1,roster:PauseMember[]=[],localId='',cards=1;
  let timer:ReturnType<typeof setInterval>|undefined,destroyed=false,placed='',placedAt=-Infinity,pending=false;
  const render=(view:PauseView|undefined)=>{
    const announce=pauseAnnouncement(last,view);
    if(announce)live.textContent=announce;
    // Over: everything hides, and the live region empties (no stale "Falta você!" for the virtual cursor).
    if(!view){if(shown){shown=false;dim.hidden=true;box.hidden=true;delete box.dataset.urgente;delete box.dataset.naOferta;spot='';placed='';placedAt=-Infinity;bar='';secs=-1;live.textContent='';}last=undefined;return;}
    if(!shown){shown=true;dim.hidden=false;box.hidden=false;}
    // The text node changes in place (dom-put putTextData): a new node each second made Chrome check the page's :has()
    // rules up to <html> and restyle the whole document, which the place's read then paid for (BUG-20261025-ORQ-levelup-pausa-mede-1s).
    putTextData(title,view.title);putTextData(line,view.line);
    // Laranja Cone with a pulse at ≤ 3 s, never by colour alone (the seconds say it too).
    if(('urgente' in box.dataset)!==view.urgent){if(view.urgent)box.dataset.urgente='';else delete box.dataset.urgente;}
    const scale=`scaleX(${view.fraction.toFixed(3)})`;
    if(scale!==bar){bar=scale;fill.style.transform=scale;}
    if(view.seconds!==secs){secs=view.seconds;track.setAttribute('aria-valuenow',String(Math.round(view.fraction*100)));track.setAttribute('aria-valuetext',`${view.seconds} segundos`);}
    last=view;
  };
  /**
   * Above the offer window (or under the top band once it closed), clear of the minimap and of the announcement slot's
   * rows (pauseSpot). Measured only when what decides it may have changed (the box's text, the window shown or not, the
   * screen) and every PAUSE_PLACE_MS (a window or a row resizing), never on every paint; and, but for the pause's first
   * place (the box must not show a frame at the corner), after the paint: read in the tick, right after the HUD wrote,
   * the boxes made the browser recalculate style and layout there (50–130 ms on a 4× phone, card levelup-pausa-mede-1s).
   */
  const place=(view:PauseView)=>{
    const screen=viewportSize(),key=`${view.title.length}|${view.line}|${view.urgent}|${host.offer.hidden}|${host.offer.classList.contains('rh-ofc-only-wait')}|${screen.width}x${screen.height}`;
    const t=now();
    if(key===placed&&Math.abs(t-placedAt)<PAUSE_PLACE_MS)return;
    placed=key;placedAt=t;
    if(!spot){measure();return;}
    if(pending)return;
    pending=true;(host.schedule??afterPaint)(()=>{pending=false;if(shown&&!destroyed)measure();});
  };
  const measure=()=>{
    const screen=viewportSize();
    const rect=(node:Element|null)=>{if(!node||(node as HTMLElement).hidden)return undefined;const r=node.getBoundingClientRect();return r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;};
    const offer=rect(host.offer),head=offer&&host.offer.classList.contains('rh-ofc')?rect(host.offer.querySelector('.rh-offer-head')):undefined;
    // The px39 offer covers the screen: the box goes over it, above the title plaque (pauseOverOffer).
    const over=!!head;
    if(over!==('naOferta' in box.dataset)){if(over)box.dataset.naOferta='';else delete box.dataset.naOferta;}
    if(head){
      const at=pauseOverOffer({viewport:screen,box:{width:box.offsetWidth,height:box.offsetHeight},head});
      const where=`o${at.x},${at.y}`;if(where===spot)return;spot=where;
      box.style.left=`${at.x}px`;box.style.top=`${at.y}px`;return;
    }
    const top=rect(host.top),minimap=rect(host.root.querySelector('.rh-minimap'));
    const rows=[...host.root.querySelectorAll('.rh-stack>:not([hidden])')].map(rect).filter((r):r is Rect=>!!r&&r.height>0);
    const at=pauseSpot({viewport:{width:screen.width,height:screen.height},box:{width:box.offsetWidth,height:box.offsetHeight},
      top:top?top.y+top.height:0,offer,avoid:[...(minimap?[minimap]:[]),...rows]});
    const where=`${at.x},${at.y}`;if(where===spot)return;spot=where;
    box.style.left=`${at.x}px`;box.style.top=`${at.y}px`;
  };
  const stop=()=>{if(timer!==undefined){clearInterval(timer);timer=undefined;}};
  const paint=()=>{
    const ended=host.root.classList.contains('rh-ended');
    if(ended)stop();
    const view=ended?undefined:clock.view(roster,localId,now(),cards);
    render(view);
    if(view)place(view);
  };
  return {el:box,dim,live,update(view:RunView,ctx:HudContext){
    if(destroyed)return;
    roster=pauseRoster(view.players,ctx.localId);localId=ctx.localId;cards=view.offers?.length??1;
    const pause=validPause(ctx.pause);
    clock.sync(pause,now());
    if(pause&&timer===undefined&&!host.root.classList.contains('rh-ended'))timer=setInterval(paint,PAUSE_TICK_MS);
    if(!pause)stop();
    paint();
  },destroy(){destroyed=true;stop();}};
}
