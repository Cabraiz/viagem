// F5 volta pra sala (auditoria multijogador 29/10, achados 1 e 2): a page reloaded (F5, or the phone's browser that
// threw the tab away in the background) or a new tab opened from the group's link comes back to the same seat.
//  - The room rides in the address (`?sala=CODE`) from the welcome until the player leaves, so the reload lands on the
//    invite path (main.ts autoJoin), which joins with the saved token.
//  - The seat token is kept per room in localStorage (all tabs of the device), not sessionStorage (one tab): a new tab
//    takes the seat back, and an old tab still open gets REPLACED_CLOSE (4009) from the room.
// Import-free apart from invite.ts: the pure parts run in node (tests/client/room-return.test.ts).
import {inviteCode} from '../ui/invite.ts';

/** Storage key (+ room code) of this device's seat: {token,until}. */
export const SEAT_KEY='viagem:room:';
type Store={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void;readonly length?:number;key?(i:number):string|null};
const local=():Store|undefined=>{try{return globalThis.localStorage;}catch{return undefined;}};
/** Where tokens lived before (one tab): still read, so a page open across the deploy keeps its seat (copied over). */
const session=():Store|undefined=>{try{return globalThis.sessionStorage;}catch{return undefined;}};

function parseSeat(raw:string|null|undefined,now:number):{token:string;until:number}|undefined{
  try{const s=JSON.parse(raw??'null');if(typeof s?.token==='string'&&s.token&&Number(s.until)>now)return {token:s.token,until:Number(s.until)};}catch{}
  return undefined;
}
/** The seat token saved for `code` that is still good at `now`; expired seats of any room are dropped on the way. */
export function readSeat(code:string,now=Date.now(),store=local(),legacy=session()):string|undefined{
  const key=SEAT_KEY+code;
  let seat:ReturnType<typeof parseSeat>;
  try{seat=parseSeat(store?.getItem(key),now);}catch{}
  if(!seat){
    try{seat=parseSeat(legacy?.getItem(key),now);}catch{}
    if(seat)saveSeat(code,seat.token,seat.until,store);
  }
  pruneSeats(now,store);
  return seat?.token;
}
export function saveSeat(code:string,token:string,until:number,store=local()){
  try{store?.setItem(SEAT_KEY+code,JSON.stringify({token,until}));}catch{/* private window: this tab's memory only */}
}
export function forgetSeat(code:string,store=local(),legacy=session()){
  try{store?.removeItem(SEAT_KEY+code);}catch{}
  try{legacy?.removeItem(SEAT_KEY+code);}catch{}
}
/** Seats past their `until` (rooms long gone) leave localStorage, which, unlike a tab's storage, never ends by itself. */
export function pruneSeats(now=Date.now(),store=local()){
  try{
    if(!store||typeof store.key!=='function'||typeof store.length!=='number')return;
    const old:string[]=[];
    for(let i=0;i<store.length;i++){const k=store.key(i);if(k?.startsWith(SEAT_KEY)&&!parseSeat(store.getItem(k),now))old.push(k);}
    for(const k of old)store.removeItem(k);
  }catch{}
}

/** `href` with the room in its query (`?sala=CODE`; the older `?room=` goes), or without it (`code` undefined). Rest kept. */
export function withRoom(href:string,code:string|undefined):string{
  const url=new URL(href);
  url.searchParams.delete('room');
  if(code)url.searchParams.set('sala',code);else url.searchParams.delete('sala');
  return url.href;
}
interface Place {readonly href:string;readonly search:string}
interface History {readonly state:unknown;replaceState(data:unknown,unused:string,url?:string):void}
const place=():{location:Place;history:History}|undefined=>
  typeof location==='undefined'||typeof history==='undefined'?undefined:{location,history};
/** Joined `code`: the address says so (no new history entry), so a reload comes back to it. */
export function markRoom(code:string,at=place()){
  if(!at)return;
  try{const next=withRoom(at.location.href,code);if(next!==at.location.href)at.history.replaceState(at.history.state,'',next);}catch{}
}
/** Left `code` on purpose: the address forgets it (only when it still names that room), so a reload opens the menu. */
export function unmarkRoom(code:string,at=place()){
  if(!at||inviteCode(at.location.search)!==code)return;
  try{at.history.replaceState(at.history.state,'',withRoom(at.location.href,undefined));}catch{}
}
