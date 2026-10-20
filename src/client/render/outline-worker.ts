/**
 * City outline copies painted off the main thread (card pior-quadro-2s): a 1536×768 movement128 clip took ~200 ms of
 * one frame on a 4× phone (getImageData ~100 ms, the distance transform ~70 ms; the "você" sticker ~170 ms). Same
 * steps as CityOutlines.build's sync path: every cell resampled into its slot, the ring or the sticker's bands grown on
 * the RGBA pixels, and the canvas handed back as an ImageBitmap.
 */
import {bandsRgba,outlineRgba,type Band} from './outline.ts';

export interface OutlineJob {
  id:number;source:ImageBitmap;width:number;height:number;
  /** Source rect → destination rect per cell (already cropped and padded). */
  cells:{sx:number;sy:number;sw:number;sh:number;dx:number;dy:number;dw:number;dh:number}[];
  slotW:number;slotH:number;
  ring?:{radius:number;color:number;alpha:number};
  bands?:Band[];
}
export type OutlineReply={id:number;bitmap:ImageBitmap}|{id:number;error:string};

export function paint(job:OutlineJob):ImageBitmap{
  const canvas=new OffscreenCanvas(job.width,job.height),c=canvas.getContext('2d',{willReadFrequently:true});
  if(!c)throw new Error('no 2d context');
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  for(const k of job.cells)c.drawImage(job.source,k.sx,k.sy,k.sw,k.sh,k.dx,k.dy,k.dw,k.dh);
  job.source.close();
  const img=c.getImageData(0,0,job.width,job.height);
  img.data.set(job.bands?bandsRgba(img.data,job.width,job.height,job.bands,job.slotW,job.slotH)
    :outlineRgba(img.data,job.width,job.height,{...job.ring!,cellW:job.slotW,cellH:job.slotH}));
  c.putImageData(img,0,0);
  return canvas.transferToImageBitmap();
}

const scope=globalThis as unknown as {onmessage:((e:MessageEvent<OutlineJob>)=>void)|null;postMessage(m:OutlineReply,t?:Transferable[]):void;document?:unknown};
if(typeof scope.document==='undefined'&&typeof OffscreenCanvas!=='undefined')scope.onmessage=e=>{
  try{const bitmap=paint(e.data);scope.postMessage({id:e.data.id,bitmap},[bitmap]);}
  catch(error){scope.postMessage({id:e.data.id,error:String(error)});}
};
