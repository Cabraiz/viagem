/**
 * The `?perf=1` switch (card BUG-20261014-ORQ-engasgo-andando-celular): a frame meter for the user's own phone. This part
 * is always loaded and costs a property read when off; dev/perf-overlay.ts (the meter and its panel) is imported on demand
 * only with the flag on. The game's busy spots time themselves with perfNow/perfSpan: the relief bake, a city chunk built,
 * a texture upload to the GPU, a network frame decoded, the HUD, Phaser's logic step and its render.
 * The flag sticks for the tab (sessionStorage), so the game's own navigation keeps it.
 */
export type PerfKind='chunk'|'bake'|'upload'|'rede'|'hud'|'logica'|'render';
export const PERF_KINDS:readonly PerfKind[]=['chunk','bake','upload','rede','hud','logica','render'];
const KEY='viagem:perf';

/** The live switch and the meter's sink (set by perf-overlay.ts when it starts). */
export const perf:{on:boolean;mark:(kind:PerfKind,ms:number)=>void}={on:false,mark:()=>{}};

/** performance.now() while measuring, else 0 (no clock read at all when off). */
export const perfNow=()=>perf.on?performance.now():0;
/** The time since `t0` (perfNow) charged to `kind`; nothing when off. */
export function perfSpan(kind:PerfKind,t0:number){if(perf.on)perf.mark(kind,performance.now()-t0);}

/** Whether this page measures: `perf=1` in the address (then kept for the tab), `perf=0` turns it off. Never throws. */
export function perfEnabled(search:string|undefined,store:Pick<Storage,'getItem'|'setItem'|'removeItem'>|undefined=sessionStore()):boolean{
  try{
    const v=new URLSearchParams(search??'').get('perf');
    if(v==='1'){store?.setItem(KEY,'1');return true;}
    if(v==='0'){store?.removeItem(KEY);return false;}
    return store?.getItem(KEY)==='1';
  }catch{return false;}
}
function sessionStore(){try{return globalThis.sessionStorage;}catch{return undefined;}}
