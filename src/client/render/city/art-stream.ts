/**
 * The city's imported art after the first frame (NEW-20261020-ORQ-partida-abre-com-P0): the match opens once the art of
 * the chunks around the camera is in (`nearReady`); the rest streams behind it a few files at a time, always the nearest
 * missing art first (the camera moves meanwhile, so the order is asked again for every free slot). Before, the scene's
 * preload waited for every building, decor and live sheet of the map (~68 MB, ~68 s on a 9 Mbps phone).
 * Q3 fatia 3: the art also leaves the GPU. Over the quality level's budget (ART_BUDGET), the art no live chunk draws and
 * far from the camera goes, the least recently near first, and comes back when the camera nears it again (an LRU by
 * proximity, on top of the lite copies of decor-lite-arte-perto: the stream keeps loading the plan's url, lite or not).
 * Pure: the scene hands it the loader and the city's distances (CityLayer.missingArt, CityLayer.artDistance).
 */
import type {QualityLevel} from '../../quality.ts';

/** Files in flight at once (the waiting room's pre-download uses as many, preloader.ts MAX_FETCHES). */
export const STREAM_FILES=4;
/** The match opens without the near art after this long (a dead link): those chunks show their mounds meanwhile. */
export const NEAR_ART_CAP_MS=20_000;
const MB=1024*1024;
/**
 * Decoded bytes (w×h×4 on the GPU) of the city's streamed art kept by quality level. Art a live chunk draws is never
 * dropped, so the city may sit above it on dense blocks; past it the least recently near art goes. Far art is fetched
 * ahead only while there is room (no download dropped on arrival). The whole match aims at ≤ 250 MB of texture on Leve
 * and ≤ 400 MB on Normal (design/estudo-desempenho.md 5.2); Alta keeps the map's art (~590 MB of originals) mostly in.
 */
export const ART_BUDGET:Readonly<Record<QualityLevel,number>>=Object.freeze({leve:48*MB,normal:96*MB,alta:256*MB});
/**
 * Screen px from the camera to a key's nearest chunk (CityLayer.artDistance): dropped art comes back within RELOAD_PX
 * (city-layer CHUNK_KEEP_PX, well before the chunk is built at CHUNK_SHOW_PX) and only art past EVICT_PX goes, so a key
 * at the border is not dropped and fetched again over and over.
 */
export const RELOAD_PX=1024,EVICT_PX=1536;
/** The trim and the reload run at most this often (tick, from the scene's update). */
export const TICK_MS=250;

interface Box {x:number;y:number;w:number;h:number}
/**
 * Of the chunks' art (each chunk's screen bounds and texture keys), the keys not loaded yet, each once with the distance
 * (px) from `want` (the camera grown by the build margin) to the nearest chunk drawing it, nearest first (ties by key).
 */
export function missingByDistance(chunks:readonly {bounds:Box;keys:readonly string[]}[],want:Box,loaded:(key:string)=>boolean):{key:string;px:number}[]{
  const best=new Map<string,number>();
  for(const {bounds:b,keys} of chunks){
    const missing=keys.filter(k=>!loaded(k));
    if(!missing.length)continue;
    const px=Math.hypot(Math.max(0,want.x-(b.x+b.w),b.x-(want.x+want.w)),Math.max(0,want.y-(b.y+b.h),b.y-(want.y+want.h)));
    for(const k of missing){const was=best.get(k);if(was===undefined||px<was)best.set(k,px);}
  }
  return [...best].map(([key,px])=>({key,px})).sort((a,b)=>a.px-b.px||(a.key<b.key?-1:a.key>b.key?1:0));
}

/** A key of the stream's art on the GPU: its camera distance (px), its decoded size and whether a live chunk draws it. */
export interface ResidentArt {key:string;px:number;bytes:number;inUse:boolean}
/**
 * The keys to drop for the resident art to fit `budget` bytes: never one a live chunk draws nor one within EVICT_PX;
 * the least recently near first (`lastNear`: larger is more recent), then the farthest, then by key.
 */
export function evictions(resident:readonly ResidentArt[],budget:number,lastNear:(key:string)=>number):string[]{
  let total=resident.reduce((s,r)=>s+r.bytes,0);
  if(total<=budget)return [];
  const out:string[]=[];
  const can=resident.filter(r=>!r.inUse&&r.px>EVICT_PX)
    .sort((a,b)=>lastNear(a.key)-lastNear(b.key)||b.px-a.px||(a.key<b.key?-1:a.key>b.key?1:0));
  for(const r of can){if(total<=budget)break;out.push(r.key);total-=r.bytes;}
  return out;
}

export interface ArtStreamHost {
  /** Art not loaded yet, nearest first; px 0 = needed by the first frame. */
  missing():readonly {key:string;px:number}[];
  /** Starts the download of a key (px: its distance, 0 = the first frame needs it); false when the key is unknown. */
  load(key:string,px:number):boolean;
  /** The stream's art on the GPU (Q3 fatia 3); without it (and evict, budget) nothing is ever dropped. */
  resident?():readonly ResidentArt[];
  /** Drops a key's texture (no live chunk draws it); it is fetched again once near. */
  evict?(key:string):void;
  /** The budget now, bytes (ART_BUDGET of the quality level). */
  budget?():number;
}

export class CityArtStream {
  private readonly flight=new Set<string>();
  /** Files answered (loaded or failed) and unknown keys: never asked again, never waited for (until evicted). */
  private readonly answered=new Set<string>();
  /** Keys the LRU dropped: fetched again only within RELOAD_PX. */
  private readonly evicted=new Set<string>();
  /** The last tick each resident key was near (a live chunk draws it, or within RELOAD_PX) or arrived. */
  private readonly near=new Map<string,number>();
  private clock=0;
  /** The budget has filled once: from then on only art within RELOAD_PX is fetched. */
  private filled=false;
  private lastTick=-Infinity;
  private readonly host:ArtStreamHost;
  private readonly files:number;
  constructor(host:ArtStreamHost,files=STREAM_FILES){this.host=host;this.files=Math.max(1,files);}
  /**
   * Fills the free slots with the nearest missing art; while the first frame's art is not all in, only that art (a
   * farther file would take the link from its last ones: cena-nasce-rapido, the nests' ~5 MB under the cover). Art past
   * RELOAD_PX waits when it was dropped, and all of it once the budget has filled (it would only push other art out).
   */
  pump(){
    if(this.flight.size>=this.files)return;
    const missing=this.host.missing(),nearLeft=()=>missing.some(m=>m.px===0&&!this.answered.has(m.key));
    let cap:boolean|undefined;
    const capped=()=>cap??=this.capped();
    for(const {key,px} of missing){
      if(this.flight.size>=this.files||px>0&&nearLeft())break;
      if(this.flight.has(key)||this.answered.has(key))continue;
      if(px>RELOAD_PX&&(this.evicted.has(key)||capped()))continue;
      if(this.host.load(key,px))this.flight.add(key);else this.answered.add(key);
    }
  }
  /** A file answered: loaded, or failed (its chunks keep their mounds); either way it is not asked again. */
  settled(key:string,ok:boolean){
    if(!this.flight.delete(key))return;
    this.answered.add(key);this.evicted.delete(key);
    if(ok){this.near.set(key,this.clock);this.trim();}
    this.pump();
  }
  /**
   * From the scene's update: at most every TICK_MS, marks the art near the camera, drops what is over the budget and
   * fetches what came near again (a dropped key, or a file the full budget held).
   */
  tick(now:number){
    if(now-this.lastTick<TICK_MS)return;
    this.lastTick=now;this.clock++;
    this.trim();this.pump();
  }
  /** Nothing the first frame needs is still missing (answered files do not hold it). */
  nearReady(){return !this.host.missing().some(m=>m.px===0&&!this.answered.has(m.key));}
  /** Downloads under way (tests and the dev probe). */
  get inFlight(){return this.flight.size;}
  /** Keys dropped and not fetched again yet (tests and the dev probe). */
  get dropped(){return this.evicted.size;}

  /** Marks the near art, then drops the least recently near art over the budget. */
  private trim(){
    const {host}=this;
    if(!host.resident||!host.evict||!host.budget)return;
    const resident=host.resident();
    for(const r of resident)if(r.inUse||r.px<=RELOAD_PX)this.near.set(r.key,this.clock);
    for(const key of evictions(resident,host.budget(),k=>this.near.get(k)??-1)){
      host.evict(key);this.filled=true;
      this.answered.delete(key);this.evicted.add(key);this.near.delete(key);
    }
  }
  /** The budget has filled (once is enough: far art would only take the place of other art from then on). */
  private capped(){
    const {host}=this;
    if(this.filled||!host.resident||!host.budget)return this.filled;
    return this.filled=host.resident().reduce((s,r)=>s+r.bytes,0)>=host.budget();
  }
}
