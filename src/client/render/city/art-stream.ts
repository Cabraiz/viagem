/**
 * The city's imported art after the first frame (NEW-20261020-ORQ-partida-abre-com-P0): the match opens once the art of
 * the chunks around the camera is in (`nearReady`); the rest streams behind it a few files at a time, always the nearest
 * missing art first (the camera moves meanwhile, so the order is asked again for every free slot). Before, the scene's
 * preload waited for every building, decor and live sheet of the map (~68 MB, ~68 s on a 9 Mbps phone).
 * Pure: the scene hands it the loader and the city's distances (CityLayer.missingArt).
 */

/** Files in flight at once (the waiting room's pre-download uses as many, preloader.ts MAX_FETCHES). */
export const STREAM_FILES=4;
/** The match opens without the near art after this long (a dead link): those chunks show their mounds meanwhile. */
export const NEAR_ART_CAP_MS=20_000;

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

export interface ArtStreamHost {
  /** Art not loaded yet, nearest first; px 0 = needed by the first frame. */
  missing():readonly {key:string;px:number}[];
  /** Starts the download of a key (px: its distance, 0 = the first frame needs it); false when the key is unknown. */
  load(key:string,px:number):boolean;
}

export class CityArtStream {
  private readonly flight=new Set<string>();
  /** Files answered (loaded or failed) and unknown keys: never asked again, never waited for. */
  private readonly answered=new Set<string>();
  private readonly host:ArtStreamHost;
  private readonly files:number;
  constructor(host:ArtStreamHost,files=STREAM_FILES){this.host=host;this.files=Math.max(1,files);}
  /**
   * Fills the free slots with the nearest missing art; while the first frame's art is not all in, only that art (a
   * farther file would take the link from its last ones: cena-nasce-rapido, the nests' ~5 MB under the cover).
   */
  pump(){
    if(this.flight.size>=this.files)return;
    const missing=this.host.missing(),nearLeft=()=>missing.some(m=>m.px===0&&!this.answered.has(m.key));
    for(const {key,px} of missing){
      if(this.flight.size>=this.files||px>0&&nearLeft())break;
      if(this.flight.has(key)||this.answered.has(key))continue;
      if(this.host.load(key,px))this.flight.add(key);else this.answered.add(key);
    }
  }
  /** A file answered: loaded, or failed (its chunks keep their mounds); either way it is not asked again. */
  settled(key:string,_ok:boolean){
    if(!this.flight.delete(key))return;
    this.answered.add(key);
    this.pump();
  }
  /** Nothing the first frame needs is still missing (answered files do not hold it). */
  nearReady(){return !this.host.missing().some(m=>m.px===0&&!this.answered.has(m.key));}
  /** Downloads under way (tests and the dev probe). */
  get inFlight(){return this.flight.size;}
}
