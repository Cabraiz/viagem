/**
 * The page's pixel worker (render/outline-worker.ts, card pior-quadro-2s): city outline copies and figure boxes are
 * read and painted off the main thread. undefined without Worker/OffscreenCanvas/createImageBitmap (tests, old
 * browsers) or after it failed: the callers then do the work on the main thread as before.
 */
import type {FigureBox} from '../sprites/sprite-catalog.ts';
import type {OutlineReply,WorkerJob} from './outline-worker.ts';

let worker:Worker|undefined,broken=false,serial=0;
const listeners=new Set<(reply:OutlineReply)=>void>(),brokenListeners=new Set<()=>void>();

export function pixelWorker():Worker|undefined{
  if(worker||broken)return worker;
  if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap!=='function')return undefined;
  try{
    worker=new Worker(new URL('./outline-worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=(e:MessageEvent<OutlineReply>)=>{for(const l of listeners)l(e.data);};
    worker.onerror=()=>{broken=true;worker?.terminate();worker=undefined;for(const l of brokenListeners)l();};
  }catch{broken=true;worker=undefined;}
  return worker;
}
/** Job ids are page-wide: every listener sees every reply and keeps only its own ids. */
export const nextJobId=()=>++serial;
export function onReply(fn:(reply:OutlineReply)=>void,onBroken:()=>void){
  listeners.add(fn);brokenListeners.add(onBroken);
  return ()=>{listeners.delete(fn);brokenListeners.delete(onBroken);};
}
export function post(job:WorkerJob){worker?.postMessage(job,[job.source]);}

/**
 * The figure box (alpha > 20, every `cell` px cell folded together) of `source`, measured in the worker; undefined
 * when there is no worker (measure on the main thread then). Resolves null for an empty sheet or a failure.
 */
export function figureOffThread(source:ImageBitmapSource,cell:number):Promise<FigureBox|null>|undefined{
  if(!pixelWorker())return undefined;
  return createImageBitmap(source).then(bitmap=>new Promise<FigureBox|null>(resolve=>{
    const id=nextJobId();
    const off=onReply(reply=>{
      if(reply.id!==id)return;off();
      resolve('box' in reply?reply.box:null);
    },()=>{off();resolve(null);});
    post({kind:'figure',id,source:bitmap,cell});
  }),()=>null);
}
