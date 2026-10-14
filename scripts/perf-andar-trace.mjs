#!/usr/bin/env node
/**
 * Walking stutter lab with attribution (card BUG-20261014-ORQ-engasgo-andando-celular), the trace companion of
 * scripts/perf-andar.mjs: a phone (Playwright isMobile + touch, 390×844, DPR 3 by default, CDP CPU throttling 4×) plays
 * "Jogar sozinho" on a BUILT site and WALKS a fixed route in the Cidade Nevada: a first pass that keeps entering new
 * areas (a staircase away from the spawn, "novo"), then a second pass back and forth over the same path ("visto").
 * Per pass: frame times from requestAnimationFrame (p50/p95/p99, frames > 50 / > 100 ms, travadas/min while the hero
 * walks), chunk builds / relief bakes / GL uploads / shader compiles per frame, JS heap, layout and style counts, and
 * (--trace on) a Chrome trace whose long tasks (> 50 ms) are attributed: event self time (GC, layout/paint, script), the
 * CPU profile mapped through the build's source maps to src/ functions, and the lab's user-timing marks.
 *
 * No game code changes: an init script wraps requestAnimationFrame and the WebGL upload/compile calls and catches the
 * Phaser.Game as it boots (the bundle sets window.Phaser); the city layer's buildChunk/dropChunk/applyOcclusion and the
 * relief's bake are wrapped on the live instance. The hero walks by the scene's own goTo (a tap / minimap order: the
 * route the game finds), so the run is the same every time.
 *
 *   node node_modules/vite/bin/vite.js build --sourcemap --outDir <dir>     (maps only add .map files: the same code)
 *   node scripts/perf-andar-trace.mjs --dist <dir> [--dpr 3] [--cpu 4] [--seconds 60] [--trace on|off] [--leg 18]
 *        [--out <dir>] [--label <name>] [--port 4288] [--worker-port 8798] [--economy off|on|auto] [--slot browser-2,browser-1]
 *
 * It serves --dist itself (a static server on --port, which must be in 4200–4399 for the rooms Worker's local origins;
 * /multiplayer.json is answered in memory with the local Worker: the file on disk is never touched) and starts the local
 * rooms Worker (scripts/local-worker.mjs, run from the repo root) on --worker-port. --slot claims the first free
 * D:/Gits/viagem-board/locks/<slot> of the list (mkdir + owner.txt, waits 30 s while all are busy) and releases it only if still ours.
 * Writes <out>/<label>-summary.json and, with --trace on, <out>/<label>-<pass>.trace.json.gz (DevTools → Performance →
 * load). Prints the summary on stdout.
 */
import {createRequire} from 'node:module';
import {createServer as createHttpServer} from 'node:http';
import {createGzip} from 'node:zlib';
import {createWriteStream,existsSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname,join,normalize,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {startLocalWorker} from './local-worker.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const arg=(name,fallback)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback;};
const dist=resolve(arg('dist','dist'));
const DPR=Number(arg('dpr','3')),CPU=Number(arg('cpu','4')),SECONDS=Number(arg('seconds','60'));
const TRACE=arg('trace','on')!=='off',ECONOMY=arg('economy','off');
const OUT=resolve(arg('out',join(tmpdir(),'perf-andar')));
const LABEL=arg('label',`dpr${DPR}-cpu${CPU}${TRACE?'-trace':''}`);
const PORT=Number(arg('port','4288')),WORKER_PORT=Number(arg('worker-port','8798'));
const SLOT=arg('slot',undefined),LOCKS='D:/Gits/viagem-board/locks';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.error(new Date().toISOString().slice(11,19),...a);
const round=(n,d=1)=>Math.round(n*10**d)/10**d;
const pct=(list,q)=>{if(!list.length)return 0;const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};

// ---------- the browser slot (board rule: at most 2 headless browsers on the PC) ----------
const owner=`perf-andar-trace pid ${process.pid} ${new Date().toISOString()}`;
let held;
/** --slot browser-2[,browser-1]: the first free one, else waits 30 s and tries again. */
async function claimSlot(){
  if(!SLOT)return;
  for(;;){
    for(const name of SLOT.split(',')){
      const dir=join(LOCKS,name);
      try{mkdirSync(dir);writeFileSync(join(dir,'owner.txt'),owner);held=dir;log('slot',name,'claimed');return;}
      catch(e){if(e.code!=='EEXIST')throw e;}
    }
    log(`slots ${SLOT} busy; waiting 30 s`);await sleep(30000);
  }
}
function releaseSlot(){
  if(!held)return;
  try{if(readFileSync(join(held,'owner.txt'),'utf8').trim()===owner)rmSync(held,{recursive:true});}catch{}
  held=undefined;
}

// ---------- static server for the built site (multiplayer.json in memory) ----------
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.map':'application/json',
  '.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.ico':'image/x-icon','.txt':'text/plain','.wasm':'application/wasm'};
async function serve(dir,port,endpoint){
  const mp=JSON.stringify({...JSON.parse(readFileSync(join(dir,'multiplayer.json'),'utf8')),endpoint});
  const server=createHttpServer((req,res)=>{
    let path;try{path=decodeURIComponent(new URL(req.url,'http://x').pathname);}catch{res.writeHead(400).end();return;}
    if(path==='/multiplayer.json'){res.writeHead(200,{'Content-Type':TYPES['.json'],'Cache-Control':'no-store'});res.end(mp);return;}
    let file=join(dir,normalize(path).replace(/^([\\/]\.\.)+/,''));
    if(!file.startsWith(dir)){res.writeHead(403).end();return;}
    try{if(statSync(file).isDirectory())file=join(file,'index.html');}catch{}
    let st;try{st=statSync(file);}catch{}
    if(!st?.isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':TYPES[extname(file).toLowerCase()]??'application/octet-stream','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:readFileSync(file));
  });
  await new Promise((ok,ko)=>{server.once('error',ko);server.listen(port,'127.0.0.1',ok);});
  return {url:`http://127.0.0.1:${port}`,stop:()=>new Promise(r=>{server.closeAllConnections?.();server.close(()=>r());})};
}

// ---------- in-page recorder (added before any page script) ----------
/* One record per rAF timestamp, holding the work from that frame's start until the next frame (its rAF callbacks and
   every task in between), so record k explains the gap ts[k+1] − ts[k]. Typed arrays: the lab adds no garbage. */
const RECORDER=()=>{
  const N=30000,w=window;
  const F={ts:new Float64Array(N),js:new Float32Array(N),up:new Uint16Array(N),upKB:new Float32Array(N),upMs:new Float32Array(N),tex:new Uint16Array(N),
    fb:new Uint16Array(N),comp:new Uint16Array(N),compMs:new Float32Array(N),build:new Uint8Array(N),buildMs:new Float32Array(N),bakeMs:new Float32Array(N),
    drop:new Uint8Array(N),occMs:new Float32Array(N),mov:new Uint8Array(N),live:new Uint8Array(N)};
  const acc={js:0,up:0,upB:0,upMs:0,tex:0,fb:0,comp:0,compMs:0,build:0,buildMs:0,bakeMs:0,drop:0,occMs:0};
  let n=0,cur=-1,px=NaN,py=NaN;
  const big=[];// uploads >= 2 ms or >= 1 MB
  const flush=()=>{
    if(cur<0||n>=N)return;
    const s=w.__paScene;let mov=0,live=0;
    if(s){const p=s.position;if(p){mov=(p.x!==px||p.y!==py)?1:0;px=p.x;py=p.y;}live=s.city?.live?.size??0;}
    F.ts[n]=cur;F.js[n]=acc.js;F.up[n]=acc.up;F.upKB[n]=acc.upB/1024;F.upMs[n]=acc.upMs;F.tex[n]=acc.tex;F.fb[n]=acc.fb;F.comp[n]=acc.comp;
    F.compMs[n]=acc.compMs;F.build[n]=acc.build;F.buildMs[n]=acc.buildMs;F.bakeMs[n]=acc.bakeMs;F.drop[n]=acc.drop;F.occMs[n]=acc.occMs;F.mov[n]=mov;F.live[n]=live;n++;
    for(const k in acc)acc[k]=0;
  };
  w.__pa={F,acc,big,get n(){return n;},reset(){n=0;cur=-1;big.length=0;for(const k in acc)acc[k]=0;},
    /** Walking time so far (ms of frames whose hero moved). */
    walkMs(){let t=0;for(let i=1;i<n;i++)if(F.mov[i])t+=F.ts[i]-F.ts[i-1];return t;}};
  const raf=w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame=function(cb){return raf(ts=>{
    if(ts!==cur){flush();cur=ts;}
    const t0=performance.now();try{cb(ts);}finally{acc.js+=performance.now()-t0;}
  });};
  // The Phaser.Game as it boots (the bundle sets window.Phaser; Game.boot is bound when the game is made).
  let P;
  Object.defineProperty(w,'Phaser',{configurable:true,get(){return P;},set(v){P=v;
    try{const boot=v.Game.prototype.boot;v.Game.prototype.boot=function(){w.__paGame=this;return boot.apply(this,arguments);};}catch{}}});
  const measure=(name,t0,ms)=>{try{performance.measure(name,{start:t0,end:t0+ms});}catch{}};
  w.__paMeasure=measure;
  for(const C of [w.WebGLRenderingContext,w.WebGL2RenderingContext]){
    if(!C)continue;const p=C.prototype;
    const upload=name=>{const o=p[name];p[name]=function(...a){
      const t0=performance.now();const r=o.apply(this,a);const ms=performance.now()-t0;
      // texImage2D(t,l,if,w,h,b,f,ty,px) | (t,l,if,f,ty,src); texSubImage2D(t,l,x,y,w,h,f,ty,px) | (t,l,x,y,f,ty,src).
      const sub=name==='texSubImage2D';let wd=0,ht=0;
      if(a.length>=9){wd=sub?a[4]:a[3];ht=sub?a[5]:a[4];}
      else{const src=a[sub?6:5];wd=src?.naturalWidth||src?.videoWidth||src?.displayWidth||src?.width||0;ht=src?.naturalHeight||src?.videoHeight||src?.displayHeight||src?.height||0;}
      const bytes=(wd||0)*(ht||0)*4;
      acc.up++;acc.upB+=bytes;acc.upMs+=ms;
      if(ms>=2||bytes>=1<<20){big.push({t:Math.round(t0),w:wd,h:ht,ms:Math.round(ms*10)/10,fn:name,src:(a[sub?6:5]?.src??'').split('/').pop()});measure(`lab:${name} ${wd}x${ht}`,t0,ms);}
      return r;};};
    upload('texImage2D');upload('texSubImage2D');
    const count=(name,key)=>{const o=p[name];p[name]=function(...a){acc[key]++;return o.apply(this,a);};};
    count('createTexture','tex');count('createFramebuffer','fb');
    for(const name of ['compileShader','linkProgram']){const o=p[name];p[name]=function(...a){
      const t0=performance.now();const r=o.apply(this,a);const ms=performance.now()-t0;acc.comp++;acc.compMs+=ms;if(ms>=2)measure(`lab:${name}`,t0,ms);return r;};}
    // The sync point of a compile/link (the driver finishes the work when asked for the status).
    for(const name of ['getProgramParameter','getShaderParameter']){const o=p[name];p[name]=function(...a){
      const t0=performance.now();const r=o.apply(this,a);const ms=performance.now()-t0;acc.compMs+=ms;if(ms>=2)measure(`lab:${name}`,t0,ms);return r;};}
  }
};
/** On the live scene: the city layer's chunk build/drop, the relief bake and the occlusion fade, timed. */
const HOOK_CITY=()=>{
  const w=window,g=w.__paGame,s=g?.scene?.scenes?.[0];if(!s)return 'no-scene';
  w.__paScene=s;const c=s.city;if(!c)return 'no-city';
  if(c.__pa)return 'ok';
  const acc=w.__pa.acc,m=w.__paMeasure;
  const b=c.buildChunk,d=c.dropChunk,o=c.applyOcclusion;
  c.buildChunk=function(...a){const t0=performance.now();try{return b.apply(this,a);}finally{const ms=performance.now()-t0;acc.build++;acc.buildMs+=ms;m('lab:buildChunk',t0,ms);}};
  c.dropChunk=function(...a){acc.drop++;return d.apply(this,a);};
  if(o)c.applyOcclusion=function(...a){const t0=performance.now();try{return o.apply(this,a);}finally{acc.occMs+=performance.now()-t0;}};
  const r=c.relief;
  if(r){const k=r.bake;r.bake=function(...a){const t0=performance.now();try{return k.apply(this,a);}finally{const ms=performance.now()-t0;acc.bakeMs+=ms;m('lab:relief.bake',t0,ms);}};}
  c.__pa=true;return 'ok';
};

// ---------- trace analysis ----------
let TraceMap,originalPositionFor;
try{({TraceMap,originalPositionFor}=require(join(here,'..','node_modules','@jridgewell','trace-mapping')));}catch{}
const maps=new Map();
function mapFrame(cf){
  const file=cf.url&&/\/assets\/[^/?#]+\.js/.exec(cf.url)?.[0];
  if(!file||!TraceMap)return undefined;
  if(!maps.has(file)){const p=join(dist,file+'.map');maps.set(file,existsSync(p)?new TraceMap(readFileSync(p,'utf8')):null);}
  const m=maps.get(file);if(!m)return undefined;
  const o=originalPositionFor(m,{line:cf.lineNumber+1,column:Math.max(0,cf.columnNumber)});
  // Sources come absolute (…/src/client/x.ts) or relative: kept from src/ or from the package (node_modules/<pkg>/…).
  return o.source?{source:o.source.replace(/\\/g,'/').replace(/^.*?\/node_modules\//,'node_modules/').replace(/^.*?\/(src\/)/,'$1').replace(/^(\.\.\/)+/,''),line:o.line,name:o.name}:undefined;
}
const frameLabel=new Map();
function labelOf(node){
  const cf=node.callFrame,key=`${cf.url}|${cf.lineNumber}|${cf.columnNumber}|${cf.functionName}`;
  let l=frameLabel.get(key);
  if(!l){
    const m=mapFrame(cf);
    const fn=m?.name||cf.functionName||'(anônima)';
    l=m?{fn,src:m.source,line:m.line,label:`${fn} ${m.source.replace(/^.*node_modules\//,'')}:${m.line}`}
      :{fn,src:cf.url?cf.url.replace(/^https?:\/\/[^/]+/,''):'',line:cf.lineNumber+1,label:cf.url?`${fn} ${cf.url.replace(/^https?:\/\/[^/]+/,'')}`:fn};
    frameLabel.set(key,l);
  }
  return l;
}
const GC=/^(MinorGC|MajorGC|V8\.GC|BlinkGC|ThreadState::|CppGC|GCEvent)/;
const LAYOUT=/^(Layout|UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|InvalidateLayout|UpdateLayerTree|PrePaint|Paint|Layerize|Commit|HitTest|IntersectionObserverController)/;
function analyze(events){
  // The page's main thread: the CrRendererMain with the most work.
  const names=new Map();for(const e of events)if(e.ph==='M'&&e.name==='thread_name')names.set(`${e.pid}:${e.tid}`,e.args?.name);
  const work=new Map();
  for(const e of events)if(e.ph==='X'&&e.name==='RunTask'&&names.get(`${e.pid}:${e.tid}`)==='CrRendererMain'){const k=`${e.pid}:${e.tid}`;work.set(k,(work.get(k)??0)+(e.dur??0));}
  const main=[...work.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!main)return {error:'no CrRendererMain'};
  const [pid,tid]=main.split(':').map(Number);
  const mine=events.filter(e=>e.pid===pid&&e.tid===tid&&e.ph==='X'&&e.dur!==undefined).sort((a,b)=>a.ts-b.ts||b.dur-a.dur);
  const tasks=mine.filter(e=>e.name==='RunTask');
  const long=tasks.filter(e=>e.dur>50000);
  // Self time by event name inside a long task (a stack sweep over the nested X events).
  const selfByName=(t)=>{
    let lo=0,hi=mine.length;while(lo<hi){const m=(lo+hi)>>1;if(mine[m].ts<t.ts)lo=m+1;else hi=m;}
    const out={},stack=[];
    for(let i=lo;i<mine.length&&mine[i].ts<t.ts+t.dur;i++){const e=mine[i];if(e.ts+e.dur>t.ts+t.dur)continue;
      while(stack.length&&stack.at(-1).ts+stack.at(-1).dur<=e.ts)stack.pop();
      if(stack.length){const p=stack.at(-1);out[p.name]=(out[p.name]??0)-e.dur;}
      out[e.name]=(out[e.name]??0)+e.dur;stack.push(e);
    }
    return out;
  };
  // The lab's own user timing marks (async b/e pairs on blink.user_timing).
  const marks=[],open=new Map();
  for(const e of events){
    if(e.pid!==pid||!String(e.cat).includes('blink.user_timing')||!String(e.name).startsWith('lab:'))continue;
    const k=`${e.name}|${e.id??e.id2?.local}`;
    if(e.ph==='b')open.set(k,e.ts);else if(e.ph==='e'&&open.has(k)){marks.push({name:e.name,ts:open.get(k),dur:e.ts-open.get(k)});open.delete(k);}
    else if(e.ph==='X')marks.push({name:e.name,ts:e.ts,dur:e.dur});
  }
  // The main thread's CPU profile: samples with their time and stack.
  const profiles=new Map();
  for(const e of events){
    if(e.pid!==pid)continue;
    if(e.name==='Profile')profiles.set(e.id,{tid:e.tid,start:e.args?.data?.startTime??e.ts,nodes:new Map(),samples:[],deltas:[]});
    else if(e.name==='ProfileChunk'){
      const p=profiles.get(e.id),d=e.args?.data;if(!p||!d)continue;
      for(const n of d.cpuProfile?.nodes??[])p.nodes.set(n.id,n);
      for(const s of d.cpuProfile?.samples??[])p.samples.push(s);for(const t of d.timeDeltas??[])p.deltas.push(t);
    }
  }
  const prof=[...profiles.values()].find(p=>p.tid===tid)??[...profiles.values()].sort((a,b)=>b.samples.length-a.samples.length)[0];
  const samples=[];
  if(prof){
    for(const n of prof.nodes.values())for(const c of n.children??[]){const k=prof.nodes.get(c);if(k&&k.parent===undefined)k.parent=n.id;}
    let t=prof.start;
    for(let i=0;i<prof.samples.length;i++){t+=prof.deltas[i]??0;samples.push({t,id:prof.samples[i]});}
    samples.sort((a,b)=>a.t-b.t);
    for(let i=0;i<samples.length;i++)samples[i].w=Math.min(10000,Math.max(0,(samples[i+1]?.t??samples[i].t)-samples[i].t));
  }
  const stackOf=id=>{const out=[];let n=prof.nodes.get(id);while(n){out.push(n);n=n.parent!==undefined?prof.nodes.get(n.parent):undefined;}return out;};
  const IDLE=new Set(['(idle)','(program)','(garbage collector)','(root)']);
  const ownSrc=s=>/^src\//.test(s);
  const profileOf=(from,to)=>{
    const leaf={},own={},file={};
    if(!prof)return {leaf,own,file};
    let lo=0,hi=samples.length;while(lo<hi){const m=(lo+hi)>>1;if(samples[m].t<from)lo=m+1;else hi=m;}
    for(let i=lo;i<samples.length&&samples[i].t<=to;i++){
      const s=samples[i],stack=stackOf(s.id);if(!stack.length)continue;
      const tl=stack[0].callFrame.functionName;
      const L=IDLE.has(tl)?{label:tl}:labelOf(stack[0]);
      leaf[L.label]=(leaf[L.label]??0)+s.w;
      const seen=new Set(),seenFile=new Set();
      for(const n of stack){if(IDLE.has(n.callFrame.functionName))continue;const l=labelOf(n);
        if(!ownSrc(l.src))continue;
        if(!seen.has(l.label)){seen.add(l.label);own[l.label]=(own[l.label]??0)+s.w;}
        if(!seenFile.has(l.src)){seenFile.add(l.src);file[l.src]=(file[l.src]??0)+s.w;}}
    }
    return {leaf,own,file};
  };
  const top=(o,k=6)=>Object.entries(o).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([n,v])=>[n,round(v/1000)]);
  const bucket=self=>{const b={gc:0,layoutPaint:0,script:0,other:0};
    for(const [n,v] of Object.entries(self)){if(v<=0)continue;if(GC.test(n))b.gc+=v;else if(LAYOUT.test(n))b.layoutPaint+=v;
      else if(/FunctionCall|EvaluateScript|V8\.|v8\.|RunMicrotasks|FireAnimationFrame|TimerFire|EventDispatch|XHR|ParseHTML|Script|Compile/.test(n))b.script+=v;else b.other+=v;}
    for(const k in b)b[k]=round(b[k]/1000);return b;};
  const t0=tasks[0]?.ts??0;
  const longList=long.map(t=>{
    const self=selfByName(t),p=profileOf(t.ts,t.ts+t.dur);
    const lab={};for(const m of marks)if(m.ts<t.ts+t.dur&&m.ts+m.dur>t.ts){const k=m.name.replace(/ \d+x\d+$/,'');lab[k]=(lab[k]??0)+m.dur;}
    return {atS:round((t.ts-t0)/1e6,2),ms:round(t.dur/1000),kinds:bucket(self),events:top(self,5),lab:top(lab,4),leaf:top(p.leaf,6),own:top(p.own,8),files:top(p.file,5)};
  });
  const sum=(list,key)=>{const o={};for(const t of list)for(const [n,v] of t[key])o[n]=(o[n]??0)+v;return Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([n,v])=>[n,round(v)]);};
  const kinds={gc:0,layoutPaint:0,script:0,other:0};for(const t of longList)for(const k in kinds)kinds[k]+=t.kinds[k];for(const k in kinds)kinds[k]=round(kinds[k]);
  // GC and layout over the whole pass (main thread).
  const gc={minor:{n:0,ms:0,maxMs:0},major:{n:0,ms:0,maxMs:0}};
  const minorName=mine.some(e=>e.name==='MinorGC')?'MinorGC':'V8.GC_SCAVENGER',majorName=mine.some(e=>e.name==='MajorGC')?'MajorGC':'V8.GC_MARK_COMPACTOR';
  for(const e of mine){const g=e.name===minorName?gc.minor:e.name===majorName?gc.major:undefined;if(!g)continue;g.n++;g.ms+=e.dur/1000;g.maxMs=Math.max(g.maxMs,e.dur/1000);}
  for(const g of Object.values(gc)){g.ms=round(g.ms);g.maxMs=round(g.maxMs);}
  const layout={};for(const e of mine)if(/^(Layout|UpdateLayoutTree)$/.test(e.name)){const o=layout[e.name]??={n:0,ms:0,maxMs:0};o.n++;o.ms+=e.dur/1000;o.maxMs=Math.max(o.maxMs,e.dur/1000);}
  for(const o of Object.values(layout)){o.ms=round(o.ms);o.maxMs=round(o.maxMs);}
  const whole=profileOf(-Infinity,Infinity);
  const labMarks={};for(const m of marks){const k=m.name.replace(/ \d+x\d+$/,'');const o=labMarks[k]??={n:0,ms:0,maxMs:0};o.n++;o.ms+=m.dur/1000;o.maxMs=Math.max(o.maxMs,m.dur/1000);}
  for(const o of Object.values(labMarks)){o.ms=round(o.ms);o.maxMs=round(o.maxMs);}
  return {mainThread:main,profileSamples:samples.length,tasks:tasks.length,
    longTasks:{count:long.length,totalMs:round(long.reduce((a,t)=>a+t.dur,0)/1000),kindsMs:kinds,
      topEventsMs:sum(longList,'events'),topLeafMs:sum(longList,'leaf'),topOwnMs:sum(longList,'own'),topFilesMs:sum(longList,'files'),labMs:sum(longList,'lab')},
    gc,layout,labMarks,wholePass:{ownMs:top(whole.own,20),filesMs:top(whole.file,15),leafMs:top(whole.leaf,15)},list:longList};
}

// ---------- the run ----------
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href).then(m=>m.chromium?m:m.default);
let worker,site,browser,report;
const cleanup=async()=>{try{await browser?.close();}catch{}try{await site?.stop();}catch{}try{await worker?.stop();}catch{}releaseSlot();};
for(const sig of ['SIGINT','SIGTERM'])process.prependListener(sig,()=>{void cleanup().finally(()=>process.exit(130));});
try{
  if(!existsSync(join(dist,'multiplayer.json')))throw new Error(`${dist}/multiplayer.json não existe: build antes (--sourcemap)`);
  mkdirSync(OUT,{recursive:true});
  worker=await startLocalWorker({port:WORKER_PORT,logPath:join(tmpdir(),`perf-andar-worker-${WORKER_PORT}.log`)});
  site=await serve(dist,PORT,worker.endpoint);
  log('site',site.url,'worker',worker.endpoint,'dpr',DPR,'cpu',CPU,'trace',TRACE);
  await claimSlot();
  browser=await chromium.launch({args:process.platform==='win32'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:[]});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:DPR});
  await ctx.addInitScript(([economy])=>{try{
    if(economy==='off')localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));
    else if(economy==='on')localStorage.setItem('viagem:economia:v1',JSON.stringify({on:true,auto:false,declined:false}));
    localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}},[ECONOMY]);
  await ctx.addInitScript(RECORDER);
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>{errors.push(String(e).slice(0,200));log('pageerror',String(e).slice(0,200));});
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(site.url+'/',{waitUntil:'load',timeout:90000});
  await page.waitForSelector('.class-card',{state:'attached',timeout:60000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Lab';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card').click();document.getElementById('confirm').click();});
  await page.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:180000,polling:500});
  log('match drawn');
  await page.waitForFunction(()=>{const s=window.__paGame?.scene?.scenes?.[0];return s?.city&&s.hooks?.net?.run?.phase==='combat';},null,{timeout:120000,polling:500});
  const hooked=await page.evaluate(HOOK_CITY);if(hooked!=='ok')throw new Error('hook '+hooked);
  // Settle at full speed (art arriving, the albedo, the first chunks), then the phone's CPU.
  await sleep(6000);
  if(CPU>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:CPU});
  await sleep(3000);
  const setup=await page.evaluate(()=>{const s=window.__paScene,a=s.city.asset,net=s.hooks.net,c=document.querySelector('canvas');
    return {p0:{x:net.predicted.x,y:net.predicted.y},bounds:{x0:a.origin.x,y0:a.origin.y,x1:a.origin.x+a.width*a.cell,y1:a.origin.y+a.height*a.cell},cell:a.cell,
      canvas:{w:c.width,h:c.height,cssW:c.clientWidth,cssH:c.clientHeight},dpr:devicePixelRatio,live:s.city.live.size,chunks:s.city.index.chunks.length,
      economy:!!s.economyOn,relief:s.city.reliefStats?.(),zoom:s.cameras.main.zoom};});
  log('setup',JSON.stringify(setup));
  // The route: a staircase of LEG-unit legs from the spawn toward the map's centre (new areas all the way), clamped.
  const LEG=Number(arg('leg','18'));
  const {p0,bounds}=setup,cx=(bounds.x0+bounds.x1)/2,cy=(bounds.y0+bounds.y1)/2;
  const sx=p0.x<=cx?1:-1,sy=p0.y<=cy?1:-1,clamp=(v,a,b)=>Math.max(a+8,Math.min(b-8,v));
  const plan=[];{let x=p0.x,y=p0.y;for(let i=0;i<16;i++){if(i%2===0)x+=sx*LEG;else y+=sy*LEG;plan.push({x:round(clamp(x,bounds.x0,bounds.x1),2),y:round(clamp(y,bounds.y0,bounds.y1),2)});}}
  const GO=([t])=>{const s=window.__paScene;
    for(const [dx,dy] of [[0,0],[2,0],[-2,0],[0,2],[0,-2],[3,3],[-3,-3],[3,-3],[-3,3],[5,0],[0,5],[-5,0],[0,-5],[7,7],[-7,-7]]){
      const p={x:t.x+dx,y:t.y+dy};s.goTo(p,{far:true});if(s.route?.length)return p;}
    return null;};
  const STATE=()=>{const s=window.__paScene,net=s.hooks.net,me=net.players.get(net.id);
    const fp=net.feed?.players?.get?.(net.id);
    return {x:net.predicted.x,y:net.predicted.y,route:s.route?.length??0,phase:net.run?.phase,hp:me?.hp??0,downed:!!fp?.downed,out:!!(fp?.eliminated||me?.spectator),connected:!!net.connected,paused:!!s.paused,walkMs:window.__pa.walkMs(),n:window.__pa.n};};
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));

  async function pass(name,targets,{loop=false}={}){
    await page.evaluate(()=>{window.__pa.reset();performance.clearMeasures();});
    const m0=await metrics();
    let traceFile;
    if(TRACE)await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',traceConfig:{recordMode:'recordAsMuchAsPossible',
      includedCategories:['devtools.timeline','disabled-by-default-devtools.timeline','v8.execute','disabled-by-default-v8.gc','gpu','toplevel',
        'blink.user_timing','disabled-by-default-v8.cpu_profiler','v8']}});
    const t0=Date.now(),visited=[];let i=0,goal=null,lastMove=Date.now(),last=null,waits=0,reissues=0;
    const next=async()=>{
      while(i<targets.length){goal=await page.evaluate(GO,[targets[i]]);if(goal)return true;log(name,'unreachable',JSON.stringify(targets[i]));i++;}
      if(loop&&targets.length>1){targets=[...targets].reverse();i=1;return next();}
      return false;};
    let st=await page.evaluate(STATE);
    if(st.phase==='combat')await next();
    while(Date.now()-t0<SECONDS*3000){
      await sleep(400);
      st=await page.evaluate(STATE);
      if(st.walkMs>=SECONDS*1000)break;
      if(st.phase!=='combat'||!st.hp||st.downed||st.out||!st.connected){waits++;goal=null;if(waits%25===1)log(name,'waiting',JSON.stringify(st));continue;}
      if(!goal){if(!await next())break;continue;}
      const moved=!last||Math.hypot(st.x-last.x,st.y-last.y)>.05;if(moved)lastMove=Date.now();last=st;
      const d=Math.hypot(st.x-goal.x,st.y-goal.y);
      if(d<1.2||!st.route){visited.push(targets[i]);i++;if(!await next())break;}
      else if(Date.now()-lastMove>3000){reissues++;if(reissues%10===1)log(name,'stuck',JSON.stringify({st,goal}));goal=await page.evaluate(GO,[targets[i]]);lastMove=Date.now();if(!goal){i++;await next();}}
    }
    const wall=(Date.now()-t0)/1000;
    const scene=await page.evaluate(()=>{const net=window.__paScene.hooks.net;return {enemies:[...net.feed.enemies.values()].filter(e=>e.hp>0).length,domNodes:document.getElementsByTagName('*').length,round:net.run?.round??net.run?.roundIndex};});
    let analysis;
    if(TRACE){
      const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));
      await cdp.send('Tracing.end');const {stream}=await done;
      traceFile=join(OUT,`${LABEL}-${name}.trace.json.gz`);
      const gz=createGzip(),file=createWriteStream(traceFile);gz.pipe(file);
      const parts=[];
      for(;;){const r=await cdp.send('IO.read',{handle:stream,size:8<<20});const chunk=r.base64Encoded?Buffer.from(r.data,'base64').toString('utf8'):r.data;
        if(chunk){parts.push(chunk);gz.write(chunk);}if(r.eof)break;}
      await cdp.send('IO.close',{handle:stream});gz.end();await new Promise(r=>file.on('close',r));
      let events;
      try{const json=JSON.parse(parts.join(''));events=Array.isArray(json)?json:json.traceEvents;}
      catch(e){log(name,'trace parse failed',String(e).slice(0,120));events=[];}
      parts.length=0;
      log(name,'trace events',events.length,'→',traceFile);
      analysis=events.length?analyze(events):{error:'trace not parsed'};
    }
    const m1=await metrics();
    const rec=await page.evaluate(()=>{const {F,big}=window.__pa,n=window.__pa.n,o={};for(const k in F)o[k]=Array.from(F[k].subarray(0,n));return {F:o,n,big:[...big]};});
    const F=rec.F,frames=[],walk=[];
    for(let k=0;k+1<rec.n;k++){
      const f={dt:F.ts[k+1]-F.ts[k],k,mov:F.mov[k]||F.mov[k+1],js:F.js[k],up:F.up[k],upKB:F.upKB[k],upMs:F.upMs[k],tex:F.tex[k],fb:F.fb[k],comp:F.comp[k],compMs:F.compMs[k],
        build:F.build[k],buildMs:F.buildMs[k],bakeMs:F.bakeMs[k],drop:F.drop[k],occMs:F.occMs[k],live:F.live[k]};
      frames.push(f);if(f.mov)walk.push(f);
    }
    const stats=list=>{const d=list.map(f=>f.dt),ms=d.reduce((a,b)=>a+b,0);
      const over50=list.filter(f=>f.dt>50),over100=list.filter(f=>f.dt>100);
      return {frames:list.length,seconds:round(ms/1000),fps:round(list.length/(ms/1000)),p50:round(pct(d,.5)),p95:round(pct(d,.95)),p99:round(pct(d,.99)),max:round(Math.max(0,...d)),
        over50:over50.length,over100:over100.length,travadasPorMin:round(over50.length/(ms/60000),1),
        // What the stalled frames had in their gap (the lab's counters).
        over50With:{chunkBuild:over50.filter(f=>f.build).length,upload1ms:over50.filter(f=>!f.build&&f.upMs>=1).length,shaderCompile:over50.filter(f=>!f.build&&f.comp).length,
          none:over50.filter(f=>!f.build&&f.upMs<1&&!f.comp).length},
        jsMsP50:round(pct(list.map(f=>f.js),.5)),jsMsP95:round(pct(list.map(f=>f.js),.95)),occMsP50:round(pct(list.map(f=>f.occMs),.5),2),occMsP95:round(pct(list.map(f=>f.occMs),.95),2)};};
    const builds=frames.filter(f=>f.build),built=builds.reduce((a,f)=>a+f.build,0);
    const chunks={framesWithBuild:builds.length,chunksBuilt:built,chunksDropped:frames.reduce((a,f)=>a+f.drop,0),
      buildMsTotal:round(builds.reduce((a,f)=>a+f.buildMs,0)),bakeMsTotal:round(builds.reduce((a,f)=>a+f.bakeMs,0)),
      buildMsPerChunkP50:round(pct(builds.map(f=>f.buildMs/f.build),.5)),buildMsPerFrameMax:round(Math.max(0,...builds.map(f=>f.buildMs))),
      maxChunksInOneFrame:Math.max(0,...builds.map(f=>f.build)),
      stallsPerChunkBuilt:round(walk.filter(f=>f.dt>50).length/Math.max(1,built),2),
      dtWhenBuilding:{p50:round(pct(builds.map(f=>f.dt),.5)),p95:round(pct(builds.map(f=>f.dt),.95)),max:round(Math.max(0,...builds.map(f=>f.dt)))},
      dtWithoutBuild:{p50:round(pct(frames.filter(f=>!f.build).map(f=>f.dt),.5)),p95:round(pct(frames.filter(f=>!f.build).map(f=>f.dt),.95)),over50:frames.filter(f=>!f.build&&f.dt>50).length}};
    const uploads={count:frames.reduce((a,f)=>a+f.up,0),MB:round(frames.reduce((a,f)=>a+f.upKB,0)/1024,1),ms:round(frames.reduce((a,f)=>a+f.upMs,0)),
      texturesCreated:frames.reduce((a,f)=>a+f.tex,0),framebuffersCreated:frames.reduce((a,f)=>a+f.fb,0),shaderCompiles:frames.reduce((a,f)=>a+f.comp,0),compileMs:round(frames.reduce((a,f)=>a+f.compMs,0)),
      big:rec.big.sort((a,b)=>b.ms-a.ms).slice(0,12)};
    const d=k=>m1[k]-m0[k];
    const worst=[...walk].sort((a,b)=>b.dt-a.dt).slice(0,12).map(f=>({dt:round(f.dt),js:round(f.js),build:f.build,buildMs:round(f.buildMs),bakeMs:round(f.bakeMs),upMs:round(f.upMs),upKB:Math.round(f.upKB),comp:f.comp,compMs:round(f.compMs),drop:f.drop,occMs:round(f.occMs,2)}));
    const out={pass:name,wallS:round(wall),atEnd:scene,waitsOutOfCombat:waits,reissues,targetsReached:visited.length,walking:stats(walk),all:stats(frames),chunks,uploads,worstWalkingFrames:worst,
      heapMB:{start:round(m0.JSHeapUsedSize/2**20),end:round(m1.JSHeapUsedSize/2**20)},
      cdp:{layouts:d('LayoutCount'),layoutMs:round(d('LayoutDuration')*1000),styleRecalcs:d('RecalcStyleCount'),styleMs:round(d('RecalcStyleDuration')*1000),
        scriptMs:round(d('ScriptDuration')*1000),taskMs:round(d('TaskDuration')*1000)},
      trace:traceFile,analysis};
    log(name,JSON.stringify({walking:out.walking,chunks}));
    return {out,visited};
  }
  const first=await pass('novo',plan);
  // Seen areas: the same path back and forth (the reached targets, reversed, down to the spawn).
  const back=[...first.visited].reverse().slice(1).concat([p0]);
  const second=await pass('visto',back.length>1?back:[...first.visited,p0].reverse(),{loop:true});
  const end=await page.evaluate(()=>({economy:!!window.__paScene.economyOn,relief:window.__paScene.city.reliefStats?.(),live:window.__paScene.city.live.size}));
  if(CPU>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  report={label:LABEL,build:readFileSync(join(dist,'version.json'),'utf8').trim(),dpr:DPR,cpu:CPU,seconds:SECONDS,economySetting:ECONOMY,trace:TRACE,setup,route:plan,end,errors,
    passes:{novo:first.out,visto:second.out}};
}finally{await cleanup();}
const file=join(OUT,`${LABEL}-summary.json`);
writeFileSync(file,JSON.stringify(report,null,1));
log('summary →',file);
console.log(JSON.stringify(report,(k,v)=>k==='list'?v.slice(0,20):v,1));
process.exit(0);
