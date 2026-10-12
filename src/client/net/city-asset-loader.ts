/**
 * The Cidade Nevada asset on the phone (cidade-09, D-034/D-035): the small manifest early (its ref goes in `join.maps`,
 * so the room knows this build can load the city), the 392 KB city itself only when a room switches to it, read as
 * text and decoded by `cityTerrainFrom` (which checks the sha256 and keeps one instance per hash).
 */
import {cityTerrainFrom} from '../../maps/index.ts';
import {readMapRef,type MapRef} from '../../protocol/index.ts';

export const CITY_MANIFEST_URL='/maps/cidade-nevada.manifest.json',CITY_ASSET_URL='/maps/cidade-nevada.json';
/** The manifest is a few bytes: a phone that cannot get it this fast joins without the city (the room accepts that). */
export const MANIFEST_TIMEOUT_MS=4000;
/** The city download on a bad 4G (392 KB): past this the attempt fails and the selector says so. */
export const CITY_TIMEOUT_MS=30_000;
/** Shown when the city does not arrive (selector subtitle and the room's news strip). */
export const CITY_FAILED='A cidade não baixou (o 4G congelou). Pede pro dono voltar pro infinito ou atualiza a página.';

type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;

/** The manifest's ref ({id,version,hash}, extra keys such as `bytes` dropped), or undefined when it is not one. */
export function readCityManifest(value:unknown):(MapRef&{bytes?:number})|undefined{
  if(typeof value!=='object'||value===null)return undefined;
  const {id,version,hash,bytes}=value as Record<string,unknown>;
  const ref=readMapRef({id,version,hash});
  if(!ref||ref.id!=='cidade-nevada')return undefined;
  return typeof bytes==='number'&&Number.isSafeInteger(bytes)&&bytes>0?{...ref,bytes}:ref;
}

let manifest:Promise<(MapRef&{bytes?:number})|undefined>|undefined;
/** The city's ref from the manifest, once per page; undefined when it cannot be read (the join then omits the city). */
export function loadCityManifest(fetcher:Fetch=(u,i)=>fetch(u,i)):Promise<(MapRef&{bytes?:number})|undefined>{
  manifest??=fetcher(CITY_MANIFEST_URL,{cache:'no-cache',signal:AbortSignal.timeout(MANIFEST_TIMEOUT_MS)})
    .then(r=>r.ok?r.json():undefined).then(readCityManifest).catch(()=>undefined)
    .then(ref=>{if(!ref)manifest=undefined;return ref;});
  return manifest;
}

const cities=new Map<string,Promise<string|undefined>>();
/**
 * Downloads and decodes the city of `ref`; resolves undefined when `cityTerrainFor(ref.hash)` is ready, or the text why
 * not. `onProgress` gets 0..1 (bytes read over the manifest's size). One download per hash at a time; a failure is not
 * kept, so the next switch or reconnection tries again.
 */
export function loadCity(ref:MapRef&{bytes?:number},onProgress:(fraction:number)=>void=()=>{},fetcher:Fetch=(u,i)=>fetch(u,i)):Promise<string|undefined>{
  const hash=ref.hash;
  if(!hash)return Promise.resolve(CITY_FAILED);
  const running=cities.get(hash);
  if(running)return running;
  const job=(async()=>{
    try{
      const response=await fetcher(CITY_ASSET_URL,{signal:AbortSignal.timeout(CITY_TIMEOUT_MS)});
      if(!response.ok)return CITY_FAILED;
      const total=ref.bytes??(Number(response.headers.get('content-length'))||0);
      let text:string;
      const reader=response.body?.getReader();
      if(!reader)text=await response.text();
      else{
        const decoder=new TextDecoder(),parts:string[]=[];let read=0;
        for(;;){
          const {done,value}=await reader.read();
          if(done)break;
          read+=value.byteLength;parts.push(decoder.decode(value,{stream:true}));
          if(total>0)onProgress(Math.min(.99,read/total));
        }
        parts.push(decoder.decode());text=parts.join('');
      }
      const decoded=await cityTerrainFrom(text,hash);
      if(!decoded.ok)return CITY_FAILED;
      onProgress(1);
      return undefined;
    }catch{return CITY_FAILED;}
  })();
  cities.set(hash,job);
  void job.then(error=>{if(error)cities.delete(hash);});
  return job;
}
