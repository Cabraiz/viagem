/**
 * No upload spike in the middle of a fight (estudo-desempenho §3.2, F1): every image the Phaser loader brings in used
 * to be decoded on the main thread and uploaded to the GPU the moment it arrived (`filecomplete → texImage2D`), one
 * frozen frame per sheet on a phone. Here the loader decodes with createImageBitmap (off the main thread) and hands the
 * finished images to the texture manager through a queue that lets at most one big sheet through per frame.
 */

/** Pixels a frame may upload: one big sheet (a 2136×1424 death sheet is 3 MP) or a few dozen small icons. */
export const UPLOAD_BUDGET_PX=1_000_000;
/**
 * Q4 (NEW-20261021-ORQ-q4-preaquecer-contagem): out of combat (the waiting room, the 3-2-1) nobody walks or fights, so a
 * frame may upload this much: the city's art around the spawn and the teammates' sheets drain before the first step
 * instead of falling into its frames. The scene switches it by the run's phase (setUploadBudget).
 */
export const WARMUP_BUDGET_PX=4_000_000;
let budget=UPLOAD_BUDGET_PX;
/** The page queue's per-frame budget (UPLOAD_BUDGET_PX in combat, WARMUP_BUDGET_PX before it). */
export function setUploadBudget(px:number){budget=Number.isFinite(px)&&px>0?px:UPLOAD_BUDGET_PX;}
export const uploadBudget=()=>budget;

/**
 * Uploads waiting for a frame, in arrival order. `tick` runs them until the frame's budget is spent; the first one always
 * runs, so a sheet bigger than the budget still goes (alone) and nothing waits forever.
 */
export class UploadQueue{
  private items:{px:number;run:()=>void}[]=[];
  private head=0;
  get size(){return this.items.length-this.head;}
  push(px:number,run:()=>void){this.items.push({px:Math.max(0,px),run});}
  /** Runs this frame's share; returns how many ran. */
  tick(budget=UPLOAD_BUDGET_PX){
    let spent=0,ran=0;
    while(this.head<this.items.length){
      const item=this.items[this.head];
      if(ran>0&&spent+item.px>budget)break;
      this.items[this.head++]=undefined as never;spent+=item.px;ran++;
      try{item.run();}catch(error){console.error(error);}
    }
    if(this.head===this.items.length){this.items.length=0;this.head=0;}
    return ran;
  }
  /** Everything at once (a hidden tab draws no frames). */
  flush(){while(this.size)this.tick(Infinity);}
}

/** fetch and createImageBitmap exist: a sheet can be fetched and decoded off the main thread (fetchBitmap). */
export const bitmapsAvailable=()=>typeof createImageBitmap==='function'&&typeof fetch==='function';
/**
 * A sheet fetched outside Phaser's loader (whose queue is first-in first-out) and decoded off the main thread,
 * premultiplied as Phaser uploads (installUploadQueue); hand it to the texture manager through queueUpload.
 */
export async function fetchBitmap(url:string,priority:'high'|'low'|'auto'='auto'):Promise<ImageBitmap>{
  const res=await fetch(url,{priority} as RequestInit);
  if(!res.ok)throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(),{premultiplyAlpha:'premultiply'});
}

type ImageFileLike={state:number;data:unknown;xhrLoader?:{response?:unknown};loader?:unknown;onProcessComplete():void;onProcessError():void};
interface PhaserLike{
  Loader:{FileTypes:{ImageFile:{prototype:{onProcess():void}}};FILE_PROCESSING:number};
}

let installed=false;
/** localStorage `viagem:upload-queue` = `0` keeps Phaser's own path: the A/B of the bench (estudo.mjs --sem-fila). */
const off=(win:object)=>{try{return (win as {localStorage?:Storage}).localStorage?.getItem('viagem:upload-queue')==='0';}catch{return false;}};
/** The page's queue (dev probe and the bench read its size). */
export const uploads=new UploadQueue();
let enqueue:((px:number,run:()=>void)=>void)|undefined;
/**
 * A texture upload outside the Phaser loader (movement128 clips, city outline copies) through the same per-frame budget;
 * runs at once when the queue is not installed (no createImageBitmap, the A/B switch, tests).
 */
export function queueUpload(px:number,run:()=>void){if(enqueue)enqueue(px,run);else run();}

/**
 * Patches Phaser's ImageFile (and so SpriteSheetFile) once: the XHR blob is decoded with createImageBitmap and the file
 * completes from the upload queue. Without createImageBitmap, or when it fails (a format it does not take), Phaser's
 * own path runs. Files loaded through an <img> tag (base64 data) keep Phaser's path too: they never reach onProcess.
 */
export function installUploadQueue(Phaser:PhaserLike,win:{createImageBitmap?:typeof createImageBitmap;requestAnimationFrame(cb:()=>void):number;document:{hidden:boolean}}=window){
  if(installed||typeof win.createImageBitmap!=='function'||off(win))return false;
  installed=true;
  const proto=Phaser.Loader.FileTypes.ImageFile.prototype,original=proto.onProcess,PROCESSING=Phaser.Loader.FILE_PROCESSING;
  let scheduled=false;
  const frame=()=>{scheduled=false;uploads.tick(budget);if(uploads.size)schedule();};
  const schedule=()=>{
    if(win.document.hidden){uploads.flush();return;}
    if(!scheduled){scheduled=true;win.requestAnimationFrame(frame);}
  };
  enqueue=(px,run)=>{uploads.push(px,run);schedule();};
  // A tab hidden while sheets wait: no frames come, so they go at once.
  (win.document as unknown as EventTarget).addEventListener?.('visibilitychange',()=>{if(win.document.hidden)uploads.flush();});
  proto.onProcess=function(this:ImageFileLike){
    const blob=this.xhrLoader?.response;
    if(!(blob instanceof Blob))return original.call(this);
    this.state=PROCESSING;
    // premultiply: Phaser uploads with UNPACK_PREMULTIPLY_ALPHA, which WebGL ignores for an ImageBitmap.
    win.createImageBitmap!(blob,{premultiplyAlpha:'premultiply'}).then(bitmap=>{
      this.data=bitmap;
      uploads.push(bitmap.width*bitmap.height,()=>{if(this.loader)this.onProcessComplete();else bitmap.close();});
      schedule();
    },()=>original.call(this));
  };
  return true;
}
