/**
 * The match on a phone (NEW-20261029-ORQ-celular-voltar-e-pinca, auditoria-controles-celular A and F).
 * - Back guard: the match pushes one history entry when it opens. The iPhone's edge swipe, the browser's back button or a
 *   second Android Back that Chrome no longer lets the dialog's `cancel` stop all land on `popstate`: the entry comes
 *   back and the gear opens. Leaving for real stays the gear menu's "Sair"; closing the match takes the entry away.
 * - The gear wears a short "Pausa" tag during the phone's first match, until a match ends.
 */
/** The key of the match's history entry (the state keeps whatever was there, like insta-post's `instaPost`). */
export const MATCH_ENTRY='partida';
export interface BackHistory {readonly state:unknown;pushState(data:unknown,unused:string):void;back():void}
export interface PopTarget {addEventListener(type:'popstate',listener:()=>void,options:{signal:AbortSignal}):void}

const onTop=(state:unknown)=>!!state&&typeof state==='object'&&(state as Record<string,unknown>)[MATCH_ENTRY]===true;

/**
 * Pushes the match's entry and answers each step back with `onBack` (the entry is pushed again first). The listener lives
 * until `signal` aborts; the returned release takes the entry away if it is still on top (call it after aborting).
 */
export function guardBack(history:BackHistory,target:PopTarget,onBack:()=>void,signal:AbortSignal):()=>void{
  const push=()=>history.pushState({...(history.state as object|null),[MATCH_ENTRY]:true},'');
  push();
  target.addEventListener('popstate',()=>{if(onTop(history.state))return;push();onBack();},{signal});
  return ()=>{if(onTop(history.state))history.back();};
}

/** Stored once a match ends: the gear's "Pausa" tag is for the first one only. */
export const GEAR_TAG_KEY='viagem:engrenagem-pausa';
export interface TagStore {getItem(key:string):string|null;setItem(key:string,value:string):void}
const defaultStore=():TagStore|undefined=>{try{return globalThis.localStorage;}catch{return undefined;}};

export function wantsGearTag(store:TagStore|undefined=defaultStore()):boolean{
  try{return store?.getItem(GEAR_TAG_KEY)!=='1';}catch{return true;}
}
export function gearTagSeen(store:TagStore|undefined=defaultStore()){
  try{store?.setItem(GEAR_TAG_KEY,'1');}catch{/* quota or private tab: the tag comes again next match */}
}
