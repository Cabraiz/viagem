/**
 * HUD boxes read without forcing a layout (estudo-desempenho §3.2, F3). Reading getBoundingClientRect in the middle of a
 * frame, after the frame already wrote to the DOM, makes the browser recalculate style and layout right there; on a 4×
 * slower phone that was 4–7 s of style recalculation in 40 s. Here the read waits for the frame to be painted (the layout
 * is clean then, so it costs only the reads) and the frame keeps using the last boxes meanwhile: at most one frame late,
 * as the old twice-a-second read already was.
 */

/** Runs `read` once the browser has painted: after the next animation frame, in a task of its own. */
export type Schedule=(read:()=>void)=>void;

export const afterPaint:Schedule=read=>{
  if(typeof requestAnimationFrame!=='function'){setTimeout(read,0);return;}
  requestAnimationFrame(()=>setTimeout(read,0));
};

/**
 * A value read from the layout, refreshed at most every `maxAgeMs` or when `key` changes (the HUD's zones: a window
 * opening, a resize). The first read is synchronous (nothing to show before it); every later one waits for the paint.
 */
export class LayoutCache<T>{
  private value?:T;private at=-Infinity;private key?:unknown;private pending=false;
  private readonly read:()=>T;private readonly maxAgeMs:number;private readonly schedule:Schedule;
  constructor(read:()=>T,maxAgeMs:number,schedule:Schedule=afterPaint){this.read=read;this.maxAgeMs=maxAgeMs;this.schedule=schedule;}
  get(now:number,key?:unknown):T{
    if(this.value===undefined){this.at=now;this.key=key;this.value=this.read();return this.value;}
    if(!this.pending&&(now-this.at>this.maxAgeMs||key!==this.key)){
      this.pending=true;this.at=now;this.key=key;
      this.schedule(()=>{this.pending=false;this.value=this.read();});
    }
    return this.value;
  }
}
