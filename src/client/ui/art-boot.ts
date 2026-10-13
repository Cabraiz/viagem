/**
 * Boot of the imported art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao). main.ts starts the download without
 * waiting (`startArt()`), so the menu never waits for the network; the game (explore.ts) and the horde sandbox await
 * `artReady()` before Phaser preloads, so enemies and items already know which pieces exist. Icons drawn before the
 * index arrives stay SVG until they are drawn again. It never throws.
 *
 * Two clocks (manifesto-enxuto-3g): the download itself may take seconds on a slow phone (BACKGROUND_MS), all of it
 * spent while the person is still in the menu; whoever needs the index waits at most WAIT_MS from the moment it asks.
 * When that wait runs out the index is sealed: an answer that comes later is refused, so the game never switches
 * from today's art to the imported one mid-session.
 */
import {loadArtManifest} from '../art/manifest.ts';

type Answer={ok:boolean;json():Promise<unknown>};
export interface ArtBootOptions {
  timeoutMs?:number;
  /** Settling it has the same effect as the deadline: later answers are refused (artReady's seal). */
  until?:Promise<unknown>;
  fetcher?:(url:string,init:{cache:RequestCache;signal?:AbortSignal})=>Promise<Answer>;
}

/** Resolves true when a valid index arrived in time; false on timeout, seal, network failure, !ok or bad JSON. */
export async function bootArt({timeoutMs=1500,until,fetcher=(url,init)=>fetch(url,init)}:ArtBootOptions={}):Promise<boolean>{
  let late=false,arrived=false,timer:ReturnType<typeof setTimeout>|undefined;
  const abort=typeof AbortController==='function'?new AbortController():undefined;
  // After the deadline any answer is refused, so a late manifest can't swap half the icons mid-session.
  const guarded=async(url:string):Promise<Answer>=>{
    const r=await fetcher(url,{cache:'no-cache',signal:abort?.signal});
    if(late)throw new Error('art manifest after the deadline');
    return {ok:r.ok,json:async()=>{const v=await r.json();if(late)throw new Error('art manifest after the deadline');arrived=r.ok;return v;}};
  };
  const deadline=new Promise<false>(resolve=>{
    const expire=()=>{late=true;abort?.abort();resolve(false);};
    timer=setTimeout(expire,timeoutMs);
    void until?.then(expire,expire);
  });
  try{
    return await Promise.race([loadArtManifest(guarded).then(()=>arrived&&!late),deadline]);
  }catch{
    return false;
  }finally{
    clearTimeout(timer);
  }
}

/** How long the background download may take (the menu does not wait for it). */
export const BACKGROUND_MS=20000;
/** How long the game waits for the index from the moment it asks (then the session keeps today's art). */
export const WAIT_MS=1500;

let boot:Promise<boolean>|undefined,ready:Promise<boolean>|undefined;
let seal:()=>void=()=>{};
const sealed=new Promise<void>(resolve=>{seal=resolve;});
/** The one download of this page, started by main.ts at boot. */
export const startArt=()=>boot??=bootArt({timeoutMs:BACKGROUND_MS,until:sealed});
/**
 * The index for whoever needs it (game, sandboxes): the download's answer if it comes within WAIT_MS of the first
 * call, else false and the index is sealed for the session. One promise per page.
 */
export const artReady=()=>ready??=(async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const ok=await Promise.race([startArt(),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),WAIT_MS);})]);
  clearTimeout(timer);
  if(!ok)seal();
  return ok;
})();
