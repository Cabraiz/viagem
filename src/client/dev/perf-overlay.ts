/**
 * `?perf=1` (card BUG-20261014-ORQ-engasgo-andando-celular): a frame meter on the phone itself, so the user can measure
 * the stutter while walking and send a print. Loaded on demand only with the flag (dev/perf-flag.ts).
 * - Every animation frame: its interval. A frame over STALL_MS is a "travada"; it is charged to the work marked during
 *   it (the relief bake, a city chunk, texture uploads, a network frame, the HUD, Phaser's logic and render), the rest
 *   to "?" — or "GC?" when the JS heap shrank by more than GC_DROP_BYTES in that frame (Chrome only).
 * - The panel (4 times a second): fps, the frame p95, travadas per minute, the worst of the last minute and the last one
 *   with its causes; a tap opens the last stalls and the canvas size (DPR). `window.__perf` has the numbers.
 * Pure meter (perf-meter.ts PerfMeter, tested under node) plus this thin DOM part (startPerfOverlay).
 */
import './perf.css';
import {PERF_KINDS,perf} from './perf-flag.ts';
import {PerfMeter,STALL_MS,STALLS_KEPT,causesText} from './perf-meter.ts';

/** Times texture uploads (every WebGL context's texImage2D/texSubImage2D) as 'upload'. Once per page. */
function hookUploads(){
  const g=globalThis as unknown as Record<string,{prototype:Record<string,unknown>}|undefined>;
  for(const name of ['WebGLRenderingContext','WebGL2RenderingContext']){
    const proto=g[name]?.prototype;if(!proto||proto.__perfHooked)continue;
    proto.__perfHooked=true;
    for(const fn of ['texImage2D','texSubImage2D','compressedTexImage2D']){
      const orig=proto[fn] as ((...a:unknown[])=>unknown)|undefined;if(typeof orig!=='function')continue;
      proto[fn]=function(this:unknown,...a:unknown[]){const t=performance.now();try{return orig.apply(this,a);}finally{perf.mark('upload',performance.now()-t);}};
    }
  }
}

type Heap={usedJSHeapSize:number};
/** Starts the meter and its panel (idempotent). */
export function startPerfOverlay(){
  const w=window as unknown as {__perf?:unknown};
  if(w.__perf)return;
  const meter=new PerfMeter();
  perf.on=true;perf.mark=(kind,ms)=>meter.mark(kind,ms);
  hookUploads();
  const panel=document.createElement('div');panel.className='perf-hud';panel.setAttribute('aria-hidden','true');
  const lines=[0,1,2].map(()=>{const p=document.createElement('p');panel.append(p);return p;});
  const more=document.createElement('pre');more.className='perf-hud-mais';more.hidden=true;panel.append(more);
  panel.addEventListener('click',()=>{more.hidden=!more.hidden;});
  for(const type of ['pointerdown','touchstart'])panel.addEventListener(type,e=>e.stopPropagation());
  document.body.append(panel);
  const memory=()=>(performance as unknown as {memory?:Heap}).memory?.usedJSHeapSize??0;
  let last=performance.now(),heap=memory(),shown=0;
  const step=(now:number)=>{
    const h=memory();meter.frame(now-last,now,heap-h);last=now;heap=h;
    if(now-shown>=250){shown=now;draw(now);}
    requestAnimationFrame(step);
  };
  const draw=(now:number)=>{
    const s=meter.stats(now),canvas=document.querySelector('canvas');
    lines[0].textContent=`${s.fps} fps · p95 ${Math.round(s.p95)} ms · p50 ${Math.round(s.p50)} ms`;
    lines[1].textContent=`travadas ${s.perMin.toFixed(1)}/min (>${STALL_MS} ms) · pior ${Math.round(s.worst)} ms`;
    lines[2].textContent=s.last?`última ${Math.round(s.last.ms)} ms há ${Math.round((now-s.last.at)/1000)} s: ${causesText(s.last)}`:'nenhuma travada no último minuto';
    if(!more.hidden)more.textContent=[`DPR ${devicePixelRatio} · canvas ${canvas?.width??0}×${canvas?.height??0}`,
      ...meter.stalls.slice(-STALLS_KEPT).reverse().map(t=>`${Math.round(t.ms)} ms há ${Math.round((now-t.at)/1000)} s: ${causesText(t)}`)].join('\n');
  };
  w.__perf={meter,kinds:PERF_KINDS,stats:()=>meter.stats(performance.now())};
  requestAnimationFrame(step);
}
