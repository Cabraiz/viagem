/**
 * The frame meter of `?perf=1` (card BUG-20261014-ORQ-engasgo-andando-celular), pure: frame intervals, the stalls and
 * what was charged to them (dev/perf-flag.ts marks). dev/perf-overlay.ts drives it from requestAnimationFrame.
 */
import type {PerfKind} from './perf-flag.ts';

/** A frame this long (ms) is a stall ("travada"); the user feels it while walking. */
export const STALL_MS=50;
/** The frames the percentiles read (≈ 5 s at 60 fps), and the stalls kept for the panel. */
export const WINDOW_FRAMES=300,STALLS_KEPT=8;
/** A heap shrink this big inside one frame is a garbage collection ("GC?"). */
export const GC_DROP_BYTES=1<<20;
const MINUTE_MS=60000;

export type StallCause=PerfKind|'gc?'|'?';
export interface Stall {at:number;ms:number;causes:{kind:StallCause;ms:number}[]}
export interface PerfStats {fps:number;p50:number;p95:number;perMin:number;worst:number;last?:Stall;frames:number}

const pct=(sorted:readonly number[],q:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))]:0;

export class PerfMeter {
  /** Frame intervals (ms) and when each ended (ms), oldest first, at most WINDOW_FRAMES. */
  private dts:number[]=[];private ends:number[]=[];
  /** Work marked since the last frame, by kind (ms). */
  private pending=new Map<PerfKind,number>();
  /** Every stall of the last minute (for the rate and the worst), newest last. */
  stalls:Stall[]=[];
  mark(kind:PerfKind,ms:number){if(ms>0)this.pending.set(kind,(this.pending.get(kind)??0)+ms);}
  /**
   * A frame ended at `at` after `dt` ms; `heapDrop`: bytes the JS heap shrank in it. Returns the stall when it was one.
   * Marks are charged to the frame they were made in, then cleared.
   */
  frame(dt:number,at:number,heapDrop=0):Stall|undefined{
    this.dts.push(dt);this.ends.push(at);
    if(this.dts.length>WINDOW_FRAMES){this.dts.shift();this.ends.shift();}
    let stall:Stall|undefined;
    if(dt>STALL_MS){
      const causes:{kind:StallCause;ms:number}[]=[...this.pending].map(([kind,ms])=>({kind,ms}));
      // logica and render contain the others (the bake runs inside the render, a chunk inside the logic): they are
      // shown only for the time the finer marks do not explain.
      const fine=causes.filter(c=>c.kind!=='logica'&&c.kind!=='render').reduce((s,c)=>s+c.ms,0);
      const coarse=causes.filter(c=>c.kind==='logica'||c.kind==='render').reduce((s,c)=>s+c.ms,0);
      const shown=causes.filter(c=>c.kind!=='logica'&&c.kind!=='render');
      if(coarse>fine)shown.push({kind:coarse-fine>0&&causes.some(c=>c.kind==='render')?'render':'logica',ms:coarse-fine});
      const rest=dt-Math.max(fine,coarse)-1000/60;
      if(rest>5)shown.push({kind:heapDrop>GC_DROP_BYTES?'gc?':'?',ms:rest});
      stall={at,ms:dt,causes:shown.sort((a,b)=>b.ms-a.ms)};
      this.stalls.push(stall);
    }
    this.pending.clear();
    while(this.stalls.length&&at-this.stalls[0].at>MINUTE_MS)this.stalls.shift();
    return stall;
  }
  stats(at:number):PerfStats{
    let n=0;for(let i=this.ends.length-1;i>=0&&at-this.ends[i]<=1000;i--)n++;
    const sorted=[...this.dts].sort((a,b)=>a-b);
    const span=Math.min(MINUTE_MS,this.ends.length?at-this.ends[0]+(this.dts[0]??0):0);
    const perMin=span>0?this.stalls.length*MINUTE_MS/Math.max(span,10000):0;
    return {fps:n,p50:pct(sorted,.5),p95:pct(sorted,.95),perMin,worst:this.stalls.reduce((m,s)=>Math.max(m,s.ms),0),
      ...(this.stalls.length?{last:this.stalls[this.stalls.length-1]}:{}),frames:this.dts.length};
  }
}

/** "bake 40 · upload 12 · ? 20" (ms, rounded; the three biggest). */
export const causesText=(s:Stall)=>s.causes.slice(0,3).map(c=>`${c.kind} ${Math.round(c.ms)}`).join(' · ')||'?';

