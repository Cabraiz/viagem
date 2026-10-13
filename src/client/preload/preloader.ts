/**
 * Downloads a match's files ahead of it (NEW-20261013-ORQ-3g-precarga-partida), so Phaser's loads later hit the cache
 * (the service worker's Cache Storage, public/sw.js; the HTTP cache without it). Priority order, at most 4 fetches at
 * once (2 on a 2g/3g connection, which also holds P2 back until `release()`, the match start), P0 asked with
 * `priority:'high'`. Never throws: a failed file counts as done (the game then falls back as it does today).
 * No DOM beyond an injectable fetch and connection, so it runs in node tests.
 */
import type {AssetPriority,MatchAsset} from './match-assets.ts';

export const MAX_FETCHES=4;
export const SLOW_FETCHES=2;
const SLOW=new Set(['slow-2g','2g','3g']);
/** Network Information API's guess: true on 2g/3g (Chrome/Android; other browsers have no `connection`). */
export const slowConnection=(connection:{effectiveType?:string}|undefined)=>SLOW.has(connection?.effectiveType??'');

/** `fraction`: 0..1, each file weighing the same, a file in flight by its bytes so far (Content-Length) when known. */
export interface PriorityProgress {done:number;total:number;failed:number;fraction:number}
export interface PreloadProgress {P0:PriorityProgress;P1:PriorityProgress;P2:PriorityProgress;bytes:number;slow:boolean}
interface BodyLike {ok:boolean;headers?:{get(name:string):string|null};body?:{getReader():{read():Promise<{done:boolean;value?:{byteLength:number}}>}}|null;blob():Promise<{size:number}>}
type FetchLike=(url:string,init:{signal:AbortSignal;priority:'high'|'auto'|'low';credentials:'same-origin'})=>Promise<BodyLike>;
export interface PreloaderOptions {
  fetch?:FetchLike;
  connection?:{effectiveType?:string};
  onProgress?:(p:PreloadProgress)=>void;
}
export interface Preloader {
  /** Queues the files not asked before (a member or map change adds only the new ones). */
  add(items:readonly MatchAsset[]):void;
  progress():PreloadProgress;
  /** The match started: a slow connection now downloads P2 too. */
  release():void;
  /** Stops every download (leaving the room); later calls do nothing. */
  abort():void;
}
const RANK:Record<AssetPriority,number>={P0:0,P1:1,P2:2};

export function createPreloader(options:PreloaderOptions={}):Preloader{
  const fetcher=options.fetch??((url,init)=>fetch(url,init as RequestInit));
  const slow=slowConnection(options.connection??(typeof navigator!=='undefined'?(navigator as {connection?:{effectiveType?:string}}).connection:undefined));
  const limit=slow?SLOW_FETCHES:MAX_FETCHES;
  const controller=new AbortController();
  const seen=new Set<string>(),queue:MatchAsset[]=[];
  const counts={P0:{done:0,total:0,failed:0},P1:{done:0,total:0,failed:0},P2:{done:0,total:0,failed:0}};
  /** Files in flight: bytes received and expected (0 = unknown). */
  const flight=new Map<MatchAsset,{got:number;of:number}>();
  let bytes=0,running=0,released=!slow,stopped=false;
  const part=(p:AssetPriority)=>{
    const c=counts[p];if(!c.total)return {...c,fraction:1};
    let partial=0;for(const [a,f] of flight)if(a.priority===p&&f.of>0)partial+=Math.min(1,f.got/f.of);
    return {...c,fraction:Math.min(1,(c.done+partial)/c.total)};
  };
  const progress=():PreloadProgress=>({P0:part('P0'),P1:part('P1'),P2:part('P2'),bytes,slow});
  const notify=()=>{try{options.onProgress?.(progress());}catch{/* a broken listener never stops the downloads */}};
  const next=()=>{
    const i=queue.findIndex(a=>released||a.priority!=='P2');
    return i<0?undefined:queue.splice(i,1)[0];
  };
  const pump=()=>{
    while(!stopped&&running<limit){
      const item=next();if(!item)return;
      running++;
      void get(item).then(ok=>{
        running--;
        if(stopped)return;
        const c=counts[item.priority];c.done++;if(!ok)c.failed++;
        notify();pump();
      });
    }
  };
  const get=async(item:MatchAsset)=>{
    try{
      const r=await fetcher(item.url,{signal:controller.signal,priority:item.priority==='P0'?'high':item.priority==='P2'?'low':'auto',credentials:'same-origin'});
      if(!r.ok)return false;
      // The body is read so the whole file lands in the cache (a response left unread may be cut off).
      const reader=r.body?.getReader();
      if(!reader){bytes+=(await r.blob()).size;return true;}
      const f={got:0,of:Number(r.headers?.get('content-length'))||item.bytes||0};flight.set(item,f);
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        const n=value?.byteLength??0;f.got+=n;bytes+=n;
        if(f.of)notify();
      }
      return true;
    }catch{return false;}
    finally{flight.delete(item);}
  };
  return {
    add(items){
      if(stopped)return;
      let added=false;
      for(const a of items){
        if(seen.has(a.url))continue;
        seen.add(a.url);queue.push(a);counts[a.priority].total++;added=true;
      }
      if(!added)return;
      queue.sort((a,b)=>RANK[a.priority]-RANK[b.priority]); // stable: plan order inside a priority
      notify();pump();
    },
    progress,
    release(){if(released||stopped)return;released=true;pump();},
    abort(){if(stopped)return;stopped=true;queue.length=0;controller.abort();},
  };
}
