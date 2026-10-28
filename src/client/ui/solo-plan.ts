/**
 * "Jogar sozinho" (BUG-20261013-ORQ-jogar-sozinho-abre-ilha): a real match in the Cidade Nevada, alone with 0–5 room
 * bots. The room is the co-op one: created by itself, no lobby dialog, no invite. Pure (no DOM, no imports), so the
 * menu can import it statically (menu-perf) and node tests run it. The waiting room (lobby.ts mountWaitingRoom) asks
 * soloNext what to send at each poll: the city, then the bots one by one, then "pronto" once the ready gate opens.
 */

export const SOLO_MAP='cidade-nevada' as const;
export const BOTS_MIN=0,BOTS_MAX=5,BOTS_DEFAULT=3;
export const BOTS_KEY='viagem:solo-bots:v1';

/** A bot count from anything (stored text, a tap): whole, within 0..5; garbage is the default (3). */
export function clampBots(value:unknown):number{
  const n=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  return Number.isFinite(n)?Math.max(BOTS_MIN,Math.min(BOTS_MAX,Math.round(n))):BOTS_DEFAULT;
}
type Store={getItem(key:string):string|null;setItem(key:string,value:string):void};
/** The remembered count; the default when storage is off, empty or holds garbage. */
export function readBots(store:Store|undefined):number{
  try{const raw=store?.getItem(BOTS_KEY);return raw==null?BOTS_DEFAULT:clampBots(raw);}catch{return BOTS_DEFAULT;}
}
/** Remembers the count (clamped) when storage allows; returns what was kept. */
export function saveBots(store:Store|undefined,value:unknown):number{
  const n=clampBots(value);
  try{store?.setItem(BOTS_KEY,String(n));}catch{/* storage off: this session only */}
  return n;
}
/** The stepper's text for a count ("3 bots", "1 bot", "Sem bots"), read by the live region. */
export const botsLabel=(n:number)=>n===0?'Sem bots':n===1?'1 bot':`${n} bots`;

export interface SoloPlan {map:typeof SOLO_MAP;bots:number}
export const soloPlan=(bots:unknown):SoloPlan=>({map:SOLO_MAP,bots:clampBots(bots)});
/**
 * What the page asks the room for: always the nests ('ninhos', with the city's objective, the chaveiro) and the manual
 * combat (the attack button, no skill). D-051, rodada-legado: the waves (?modo=ondas), the wall (?modo=muralha) and the
 * automatic weapons (?combate=auto) are legacy, only in the code; the address no longer reaches them. The room Worker
 * plays the nests anyway (createOptions), so a cached old site gets them too.
 */
export function objectiveFromSearch(_search?:string):{mode:'ninhos';combat:'manual'}{
  return {mode:'ninhos',combat:'manual'};
}

/** Our owner commands go at least this far apart (the room drops one within its OWNER_GAP_MS, 300 ms, of the last). */
export const SOLO_GAP_MS=450;
/** A command the room has not answered after this long is sent again (lost on a bad network). */
export const SOLO_RETRY_MS=2500;

/** What the waiting room sees of the room at a poll. */
export interface SoloRoom {
  connected:boolean;
  /** The run's phase; undefined before the first run state. */
  phase?:string;
  /** This player owns the room (the solo player made it). */
  owner:boolean;
  /** The room's map (the one downloading counts: the room already switched). */
  map:string;
  /** Room bots seated now. */
  bots:number;
  seatsLeft:number;
  selfReady:boolean;
  /** The ready gate (map download, this phone's P0 for up to 25 s) still holds the ready button. */
  readyBlocked:boolean;
}
/** What the driver remembers between polls (ms timestamps of the same clock as `now`). */
export interface SoloMemory {last:number;mapAt?:number;asked:number;askedAt:number;readyAt?:number;done:boolean}
export const soloMemory=():SoloMemory=>({last:-Infinity,asked:0,askedAt:-Infinity,done:false});
export type SoloAction='wait'|'map'|'bot'|'ready'|'done';

/**
 * The next step of the solo start, pure: the city first (the map change resets readies), then the bots one at a time
 * (each waits for the room's answer, so a slow network never seats one too many), then "pronto" when the gate opens.
 * Done once this player is ready or the countdown started: a later "Ops, peraí" is the player's own and stays.
 */
export function soloNext(plan:SoloPlan,room:SoloRoom,mem:SoloMemory,now:number):{action:SoloAction;mem:SoloMemory}{
  if(mem.done)return {action:'done',mem};
  if(room.selfReady||room.phase!==undefined&&room.phase!=='lobby')return {action:'done',mem:{...mem,done:true}};
  if(!room.connected||room.phase!=='lobby'||!room.owner||now-mem.last<SOLO_GAP_MS)return {action:'wait',mem};
  if(room.map!==plan.map){
    if(mem.mapAt!==undefined&&now-mem.mapAt<SOLO_RETRY_MS)return {action:'wait',mem};
    return {action:'map',mem:{...mem,last:now,mapAt:now}};
  }
  if(room.bots<plan.bots&&room.seatsLeft>0){
    if(room.bots<mem.asked&&now-mem.askedAt<SOLO_RETRY_MS)return {action:'wait',mem};
    return {action:'bot',mem:{...mem,last:now,asked:room.bots+1,askedAt:now}};
  }
  if(room.readyBlocked||mem.readyAt!==undefined&&now-mem.readyAt<SOLO_RETRY_MS)return {action:'wait',mem};
  return {action:'ready',mem:{...mem,last:now,readyAt:now}};
}

/** The pt-BR line under the buttons when the solo start fails: our own messages pass, platform ones do not. */
export const SOLO_FAILED='Não foi possível começar a partida. Tente novamente.';
export function soloErrorText(error:unknown):string{
  return error instanceof Error&&error.name==='Error'&&error.message?error.message:SOLO_FAILED;
}
/** `?ilha=1` (tests only): "Jogar sozinho" opens the old island exploration, without a room. */
export const islandFlag=(search:string)=>new URLSearchParams(search).get('ilha')==='1';

/**
 * "Jogar sozinho"'s steps on the card while the match opens (auditoria-ui-menus 5: only "Preparando…" for seconds). Each
 * weighs its share of the bar and has its own line; the bar reaches a step's share only when it really finished (the
 * game's code and the city's map download side by side, so either may end first).
 */
export type SoloStep='code'|'city'|'room'|'join';
export const SOLO_STEPS:readonly {step:SoloStep;weight:number;text:string}[]=Object.freeze([
  {step:'code',weight:.35,text:'Baixando o jogo…'},
  {step:'city',weight:.35,text:'Baixando a cidade…'},
  {step:'room',weight:.15,text:'Abrindo a sala…'},
  {step:'join',weight:.15,text:'Entrando…'},
]);
/**
 * The bar (0..1) and the line for how far each step got (0..1; a missing step has not moved): the line is the first
 * step not done yet. The city's map reports its bytes, the others only their end.
 */
export function soloProgress(parts:Partial<Record<SoloStep,number>>):{fraction:number;text:string}{
  const got=(s:SoloStep)=>Math.max(0,Math.min(1,parts[s]??0));
  const fraction=SOLO_STEPS.reduce((sum,s)=>sum+s.weight*got(s.step),0);
  const next=SOLO_STEPS.find(s=>got(s.step)<1);
  return {fraction:Math.min(1,Math.round(fraction*100)/100),text:next?.text??SOLO_STEPS.at(-1)!.text};
}
/** The ready button of a solo room during the countdown: "Ops, peraí" (un-ready) read as an error in a match alone. */
export const SOLO_STARTING='Começando…';
