/**
 * Boot of the imported art v2 (NEW-20261012-ORQ-importar-arte-b-ligacao). main.ts starts it without waiting, so the
 * menu never waits for the network; the game (explore.ts) and the horde sandbox await the same promise
 * (`artReady()`) before Phaser preloads, so enemies and items already know which pieces exist. Icons drawn before
 * the index arrives stay SVG until they are drawn again. It never throws and never waits more than `timeoutMs`:
 * a slow, failed or late answer leaves the index empty and everything stays procedural/SVG for the session.
 */
import {loadArtManifest} from '../art/manifest.ts';

type Answer={ok:boolean;json():Promise<unknown>};
export interface ArtBootOptions {
  timeoutMs?:number;
  fetcher?:(url:string,init:{cache:RequestCache;signal?:AbortSignal})=>Promise<Answer>;
}

/** Resolves true when a valid index arrived in time; false on timeout, network failure, !ok or bad JSON. */
export async function bootArt({timeoutMs=1500,fetcher=(url,init)=>fetch(url,init)}:ArtBootOptions={}):Promise<boolean>{
  let late=false,arrived=false,timer:ReturnType<typeof setTimeout>|undefined;
  const abort=typeof AbortController==='function'?new AbortController():undefined;
  // After the deadline any answer is refused, so a late manifest can't swap half the icons mid-session.
  const guarded=async(url:string):Promise<Answer>=>{
    const r=await fetcher(url,{cache:'no-cache',signal:abort?.signal});
    if(late)throw new Error('art manifest after the deadline');
    return {ok:r.ok,json:async()=>{const v=await r.json();if(late)throw new Error('art manifest after the deadline');arrived=r.ok;return v;}};
  };
  const deadline=new Promise<false>(resolve=>{timer=setTimeout(()=>{late=true;abort?.abort();resolve(false);},timeoutMs);});
  try{
    return await Promise.race([loadArtManifest(guarded).then(()=>arrived&&!late),deadline]);
  }catch{
    return false;
  }finally{
    clearTimeout(timer);
  }
}

let pending:Promise<boolean>|undefined;
/** The one boot of this page: started by main.ts, awaited by whoever needs the index (game, sandboxes). */
export const artReady=()=>pending??=bootArt();
