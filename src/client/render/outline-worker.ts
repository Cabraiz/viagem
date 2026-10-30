/**
 * Pixel work off the main thread (card pior-quadro-2s; render/outline-jobs.ts posts the jobs):
 * - 'outline': a city outline copy. A 1536×768 movement128 clip took ~200 ms of one frame on a 4× phone
 *   (getImageData ~100 ms, the distance transform ~70 ms). Same steps as CityOutlines.build's sync
 *   path: every cell resampled into its slot, the ring grown on the RGBA pixels, and the canvas handed back as an ImageBitmap.
 * - 'figure': a hero atlas's figure box (CharacterSprites.measurePage: 2.7 MP read, ~270 ms on a 4× phone).
 */
import {outlineRgba} from './outline.ts';
import type {FigureBox} from '../sprites/sprite-catalog.ts';

export interface OutlineJob {
  kind:'outline';id:number;source:ImageBitmap;width:number;height:number;
  /** Source rect → destination rect per cell (already cropped and padded). */
  cells:{sx:number;sy:number;sw:number;sh:number;dx:number;dy:number;dw:number;dh:number}[];
  slotW:number;slotH:number;
  ring:{radius:number;color:number;alpha:number};
}
export interface FigureJob {kind:'figure';id:number;source:ImageBitmap;cell:number}
export type WorkerJob=OutlineJob|FigureJob;
export type OutlineReply={id:number;bitmap:ImageBitmap}|{id:number;box:FigureBox|null}|{id:number;error:string};

function context(w:number,h:number){
  const canvas=new OffscreenCanvas(w,h),c=canvas.getContext('2d',{willReadFrequently:true});
  if(!c)throw new Error('no 2d context');
  return {canvas,c};
}
export function paint(job:OutlineJob):ImageBitmap{
  const {canvas,c}=context(job.width,job.height);
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  for(const k of job.cells)c.drawImage(job.source,k.sx,k.sy,k.sw,k.sh,k.dx,k.dy,k.dw,k.dh);
  job.source.close();
  const img=c.getImageData(0,0,job.width,job.height);
  img.data.set(outlineRgba(img.data,job.width,job.height,{...job.ring,cellW:job.slotW,cellH:job.slotH}));
  c.putImageData(img,0,0);
  return canvas.transferToImageBitmap();
}
/** Same scan as CharacterSprites.measurePage's main-thread fallback. */
export function figureBox(data:ArrayLike<number>,width:number,height:number,cell:number):FigureBox|null{
  let left=cell,top=cell,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>20){
    const fx=x%cell,fy=y%cell;if(fx<left)left=fx;if(fx>right)right=fx;if(fy<top)top=fy;if(fy>bottom)bottom=fy;
  }
  return right>=left?{left,top,right:right+1,bottom:bottom+1}:null;
}
function measure(job:FigureJob):FigureBox|null{
  const w=job.source.width,h=job.source.height,{c}=context(w,h);
  c.drawImage(job.source,0,0);job.source.close();
  return figureBox(c.getImageData(0,0,w,h).data,w,h,job.cell);
}

const scope=globalThis as unknown as {onmessage:((e:MessageEvent<WorkerJob>)=>void)|null;postMessage(m:OutlineReply,t?:Transferable[]):void;document?:unknown};
if(typeof scope.document==='undefined'&&typeof OffscreenCanvas!=='undefined')scope.onmessage=e=>{
  const job=e.data;
  try{
    if(job.kind==='figure'){scope.postMessage({id:job.id,box:measure(job)});return;}
    const bitmap=paint(job);scope.postMessage({id:job.id,bitmap},[bitmap]);
  }catch(error){job.source.close();scope.postMessage({id:job.id,error:String(error)});}
};
