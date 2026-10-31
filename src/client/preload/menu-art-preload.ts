/**
 * Card menu-imagens-sem-buraco (o usuário, 31/10: "Melhor lazy loading do que isso, ou já deixar carregando de fundo ao
 * entrar na página"): BORA! opened a popup with no frame, no blocks and no heroes on a slow phone, because every one of
 * its pictures only started downloading then. Now:
 * - once the page is in and the browser is idle, the popup's files (the frame, the X, the two blocks, − and +, the chosen
 *   hero's two escolha arts for the phone's orientation and his picture on top) come down at low priority; a new hero's
 *   come when he is picked. Nothing while Save-Data is on, nor while the match holds the link (background-hold.ts);
 * - a picture still on the way shows its 24 px preview (scripts/menu-previas.mjs, a lazy chunk), blurred, and the real
 *   one fades in over it once decoded (`progressivo`).
 */
import {DEITADO,escolhaArte,POPUP_FIXOS} from '../ui/escolha-popup.ts';

export {DEITADO,POPUP_FIXOS};

/** The hero's picture on top of the popup (a 190 px box at most): the 256 px thumb, the 768 one on a sharp screen. */
export const chosenArtUrl=(classId:string,dpr:number)=>`/art/portraits/${classId}-${dpr>1.5?'768':'thumb'}.webp`;

/** Every file the popup shows for `classId`, the phone upright or on its side (`deitado`). */
export function popupArtUrls(classId:string,deitado:boolean,dpr:number):string[]{
  const arte=escolhaArte(classId);
  const herois=arte?(deitado?[arte.amigosDeitado,arte.sozinhoDeitado]:[arte.amigos,arte.sozinho]):[];
  return [...POPUP_FIXOS,...herois,chosenArtUrl(classId,dpr)];
}

export interface MenuArtEnv {
  saveData():boolean;
  held():boolean;
  /** background-hold.ts onBackgroundFree. */
  onFree(fn:()=>void):()=>void;
  idle(fn:()=>void):void;
  deitado():boolean;
  dpr():number;
  /** Starts a download; resolves once the file is decoded (rejects when it fails). */
  load(url:string,priority:'low'|'high'):Promise<void>;
  /** The previews' chunk (ui/menu-previas.ts). */
  previas():Promise<Readonly<Record<string,string>>>;
}

export interface MenuArtPreload {
  /** After the page's load event: the chosen hero's popup, in idle time. */
  start(classId:string):void;
  /** A new hero picked: his popup files, in idle time (when started). */
  warm(classId:string):void;
  /** BORA!: these files now, at high priority (the ones still missing); resolves when all are in (failures included). */
  now(urls:readonly string[]):Promise<void>;
  /** True once `url` is decoded here (a tag set to it paints at once). */
  ready(url:string):boolean;
  /** The blurred preview of `url`, once the previews' chunk is in. */
  previa(url:string):string|undefined;
  /** Asks for the previews' chunk (once); resolves when it is in or failed. */
  previasProntas():Promise<void>;
  /** `progressivo` below, on this preloader. */
  progressivo(el:HTMLElement,real:string,put:(url:string)=>void):void;
}

export function createMenuArtPreload(env:MenuArtEnv):MenuArtPreload{
  const asked=new Map<string,Promise<void>>(),done=new Set<string>();
  let previas:Readonly<Record<string,string>>|undefined,started=false,wanted:string|undefined,off:(()=>void)|undefined;
  let previasP:Promise<void>|undefined;
  const pedirPrevias=()=>previasP??=env.previas().then(p=>{previas=p;},()=>{previasP=undefined;});
  const fetch1=(url:string,priority:'low'|'high')=>{
    let p=asked.get(url);
    if(!p){
      p=env.load(url,priority).then(()=>{done.add(url);},()=>{asked.delete(url);});
      asked.set(url,p);
    }
    return p;
  };
  const run=()=>{
    if(!wanted||env.saveData())return;
    if(env.held()){off??=env.onFree(()=>{off?.();off=undefined;run();});return;}
    void pedirPrevias();
    for(const url of popupArtUrls(wanted,env.deitado(),env.dpr()))void fetch1(url,'low');
  };
  const art:MenuArtPreload={
    start(classId){wanted=classId;if(started)return;started=true;env.idle(run);},
    warm(classId){if(wanted===classId)return;wanted=classId;if(started)env.idle(run);},
    now(urls){
      void pedirPrevias();
      return Promise.all(urls.map(url=>fetch1(url,'high'))).then(()=>undefined);
    },
    ready:url=>done.has(url),
    previa:url=>previas?.[url],
    previasProntas:pedirPrevias,
    progressivo:(el,real,put)=>progressivo(el,real,put,art),
  };
  return art;
}

/**
 * Shows `real` through `put` (an <img> src, a background): at once when it is decoded, else its preview first, blurred
 * (`el` gets .previa, escolha.css), and the real one when it comes. BORA! tapped before the previews' chunk was in: the
 * real file goes at once and its preview takes the place when the chunk comes, if the real one is still on the way.
 * A later call on the same element wins.
 */
export function progressivo(el:HTMLElement,real:string,put:(url:string)=>void,art:MenuArtPreload):void{
  const token=String((Number(el.dataset.previaToken)||0)+1);el.dataset.previaToken=token;
  const meu=()=>el.dataset.previaToken===token;
  if(art.ready(real)){el.classList.remove('previa');put(real);return;}
  const borrar=()=>{const previa=art.previa(real);if(!previa)return false;put(previa);el.classList.add('previa');return true;};
  if(!borrar()){
    el.classList.remove('previa');put(real);
    void art.previasProntas().then(()=>{if(meu()&&!art.ready(real))borrar();});
  }
  void art.now([real]).then(()=>{
    if(!meu())return;
    put(real);
    // The blur goes on the next frame, once the real picture is painted (the filter's transition fades it out).
    requestAnimationFrame(()=>{if(meu())el.classList.remove('previa');});
  });
}

/** The browser's side of MenuArtEnv. */
export function browserLoad(url:string,priority:'low'|'high'):Promise<void>{
  const img=new Image();img.decoding='async';img.fetchPriority=priority;img.src=url;
  return img.decode();
}
