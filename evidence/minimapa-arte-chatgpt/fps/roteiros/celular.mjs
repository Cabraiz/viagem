// BUG-20261025-ORQ-celular-travando: one solo match on a built site, phone 390x844, CPU throttle, per-second phase tags
// (inicio / onda / chefao / perfil aberto), frame intervals, long animation frames with script attribution, heap, nodes,
// texture bytes. Plain run only (no profiler: see profiler-artefato-pior-quadro).
//   node celular.mjs --web http://127.0.0.1:4207 --rooms http://127.0.0.1:8797 --label x --dir out [--cpu 4] [--seconds 240] [--gpu]
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2);
const opt=(n,f)=>{const i=args.indexOf(`--${n}`);return i>=0?args[i+1]:f;};
const web=opt('web','http://127.0.0.1:4207'),rooms=opt('rooms'),cpu=Number(opt('cpu','4')),bots=Number(opt('bots','4'));
const seconds=Number(opt('seconds','240')),label=opt('label','x'),dir=opt('dir','.'),gpu=args.includes('--gpu'),idle=args.includes('--idle');
const vw=Number(opt('w','393')),vh=Number(opt('h','873')),dpr=Number(opt('dpr','3'));
mkdirSync(dir,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.error(new Date().toISOString().slice(11,19),label,...a);
const pct=(l,q)=>{if(!l.length)return 0;const s=[...l].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const r1=(n,d=1)=>Math.round(n*10**d)/10**d;

const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=(pw.chromium??pw.default.chromium);

const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E7 celular ${label}`});
let browser;
const done=async()=>{try{await browser?.close();}catch{}release();};
process.on('SIGINT',async()=>{await done();process.exit(130);});
try{
  browser=await chromium.launch({args:gpu?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:vw,height:vh},isMobile:true,hasTouch:true,deviceScaleFactor:dpr});
  await ctx.addInitScript(n=>{try{
    localStorage.setItem('viagem:solo-bots:v1',String(n));
    localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));
    localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));
  }catch{}
    const W=window.__w={f:[],up:[],texBytes:0,texCount:0,peakTexBytes:0,loaf:[],lt:[]};let drew=0;
    const sizes=new WeakMap(),bound=new WeakMap();
    const dim=a=>{const s=a[a.length-1];if(a.length>=9)return [a[3],a[4]];if(s&&typeof s==='object')return [s.naturalWidth||s.videoWidth||s.displayWidth||s.width||0,s.naturalHeight||s.videoHeight||s.displayHeight||s.height||0];return [0,0];};
    for(const P of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
      for(const m of ['drawElements','drawArrays']){const o=P[m];P[m]=function(...a){drew++;return o.apply(this,a);};}
      const ob=P.bindTexture;P.bindTexture=function(t,tex){if(t===this.TEXTURE_2D)bound.set(this,tex);return ob.call(this,t,tex);};
      const od=P.deleteTexture;P.deleteTexture=function(tex){const b=sizes.get(tex);if(b){W.texBytes-=b;W.texCount--;sizes.delete(tex);}return od.call(this,tex);};
      for(const m of ['texImage2D','compressedTexImage2D','texSubImage2D']){const o=P[m];P[m]=function(...a){
        const t0=performance.now();const r=o.apply(this,a);const ms=performance.now()-t0;
        const [w,h]=m==='texSubImage2D'?(a.length>=9?[a[4],a[5]]:dim(a)):m==='compressedTexImage2D'?[a[3],a[4]]:dim(a);
        if(a[1]===0&&m!=='texSubImage2D'){const tex=bound.get(this);if(tex){const prev=sizes.get(tex)??0;const b=w*h*4;sizes.set(tex,b);W.texBytes+=b-prev;if(!prev)W.texCount++;W.peakTexBytes=Math.max(W.peakTexBytes,W.texBytes);}}
        const src=a[a.length-1];const u=src&&typeof src==='object'?(W.bmpUrl?.get(src)||src.currentSrc||src.src||src.constructor?.name||''):'';
        W.up.push({t:t0,ms,w,h,src:String(u).replace(location.origin,'').slice(0,120)});return r;};}
    }
    const blobUrl=new WeakMap(),bmpUrl=new WeakMap();
    const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){this.__u=String(u);this.addEventListener('load',()=>{try{if(this.response instanceof Blob)blobUrl.set(this.response,this.__u);}catch{}});return xo.call(this,m,u,...r);};
    const of=window.fetch;window.fetch=function(i,...r){const u=String(i?.url??i);return of.call(this,i,...r).then(res=>{const b=res.blob.bind(res);res.blob=()=>b().then(x=>{blobUrl.set(x,u);return x;});return res;});};
    const cib=window.createImageBitmap;window.createImageBitmap=function(src,...r){const u=src instanceof Blob?blobUrl.get(src):(src?.currentSrc||src?.src);return cib.call(this,src,...r).then(b=>{if(u)bmpUrl.set(b,u);return b;});};
    W.bmpUrl=bmpUrl;
    const tick=t=>{if(drew){W.f.push(t);drew=0;}requestAnimationFrame(tick);};requestAnimationFrame(tick);
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())W.loaf.push({t:e.startTime,ms:e.duration,block:e.blockingDuration,render:e.renderStart?e.startTime+e.duration-e.renderStart:0,style:e.styleAndLayoutStart?e.startTime+e.duration-e.styleAndLayoutStart:0,
      scripts:(e.scripts||[]).map(s=>({ms:s.duration,inv:s.invoker,src:(s.sourceURL||'').replace(location.origin,'')+':'+s.sourceCharPosition,fn:s.sourceFunctionName,layout:s.forcedStyleAndLayoutDuration}))});}).observe({type:'long-animation-frame',buffered:true});}catch{}
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())W.lt.push({t:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
  },bots);
  if(args.includes('--layout'))await ctx.addInitScript(()=>{
    // Forced layout finder: every layout read that takes > 0.3 ms, by its caller (stack).
    const L=window.__layout={};const stackOf=()=>{const s=(new Error().stack||'').split('\n').slice(3,6).map(x=>x.trim().replace(/^at /,'').replace(location.origin,'').replace(/\?[^:)]*/,''));return s.join(' < ');};
    const time=(name,fn)=>function(...a){const t=performance.now();const r=fn.apply(this,a);const ms=performance.now()-t;if(ms>.05){const k=name+' | '+stackOf();const e=L[k]??={n:0,ms:0};e.n++;e.ms+=ms;}return r;};
    for(const [P,m] of [[Element.prototype,'getBoundingClientRect'],[Element.prototype,'getClientRects'],[window,'getComputedStyle']])P[m]=time(m,P[m]);
    for(const [P,props] of [[HTMLElement.prototype,['offsetWidth','offsetHeight','offsetTop','offsetLeft']],[Element.prototype,['clientWidth','clientHeight','scrollWidth','scrollHeight','scrollTop']]])
      for(const k of props){const d=Object.getOwnPropertyDescriptor(P,k);if(d?.get)Object.defineProperty(P,k,{...d,get:time(k,d.get)});}
  });
  if(rooms)await ctx.route('**/multiplayer.json',async r=>{const res=await r.fetch();const j=await res.json();j.endpoint=rooms;await r.fulfill({json:j});});
  const block=opt('block');if(block){const re=new RegExp(block);await ctx.route(u=>re.test(u.pathname),r=>r.abort());}
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);log('pageerror',e.message);});
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if(cpu>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  const t0=Date.now();
  await page.goto(web+'/',{waitUntil:'load',timeout:120000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:120000});
  const tMenu=Date.now()-t0;
  for(let i=0;i<10;i++){
    const open=await page.evaluate(()=>{const d=document.getElementById('confirmation');if(d?.open)return true;
      const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('confirm').click();return false;});
    if(open)break;await wait(1000);
  }
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  const tClick=Date.now();let tPlay;
  await page.evaluate(()=>document.getElementById('enter-island').click());
  for(const deadline=Date.now()+180000;Date.now()<deadline;){
    const ok=await page.evaluate(()=>{const s=document.querySelector('dialog.explore-shell');const l=s?.querySelector('.explore-layout');
      return !!s?.querySelector('canvas')&&!!l&&![...l.children].some(e=>/coop-wait/.test(e.className)&&e.getBoundingClientRect().width>0);});
    if(ok&&Date.now()-tClick>1000){tPlay=Date.now()-tClick;break;}
    await wait(250);
  }
  log('menu',tMenu,'play',tPlay);
  await page.evaluate(()=>{const W=window.__w;W.f.length=0;W.up.length=0;W.loaf.length=0;W.lt.length=0;W.w0=performance.now();});
  const wantProfile=args.includes('--profile');
  if(wantProfile){await wait(3000);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');}
  const wantTrace=args.includes('--trace');
  if(wantTrace){await wait(3000);await browser.startTracing(page,{path:join(dir,`${label}.trace.json`),screenshots:false,categories:['devtools.timeline','disabled-by-default-devtools.timeline','disabled-by-default-devtools.timeline.stack','disabled-by-default-devtools.timeline.invalidationTracking','toplevel']});}
  const samples=[];const tw=Date.now();let m0=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const keys=['KeyD','KeyS','KeyA','KeyW'];let k=0,held;
  for(let s=0;s<seconds;s++){
    if(!idle&&s%6===0){if(held)await page.keyboard.up(held);held=keys[k++%4];await page.keyboard.down(held);}
    await wait(1000);
    const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const tag=await page.evaluate(()=>{const vis=sel=>[...document.querySelectorAll(sel)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';}).length;
      const dlg=[...document.querySelectorAll('dialog[open]')].map(d=>d.className.toString().split(' ')[0]).filter(c=>c!=='explore-shell');
      return {t:performance.now(),round:document.querySelector('.rh-round-label')?.textContent?.trim()??'',boss:vis('.rh-boss')>0,perfis:vis('.rh-perfil'),dlg:dlg.join(','),
        overlays:[...document.querySelectorAll('.explore-shell [class]')].filter(e=>/levelup|offer|pause|result/.test(e.className)&&e.getBoundingClientRect().width>0).length};});
    samples.push({...tag,task:(m.TaskDuration-m0.TaskDuration)*1000,script:(m.ScriptDuration-m0.ScriptDuration)*1000,style:(m.RecalcStyleDuration-m0.RecalcStyleDuration)*1000,layout:(m.LayoutDuration-m0.LayoutDuration)*1000,
      heap:m.JSHeapUsedSize/2**20,nodes:m.Nodes,listeners:m.JSEventListeners});
    m0=m;
    if(s%30===29)log('s',s+1,JSON.stringify(samples.at(-1)));
  }
  if(held)await page.keyboard.up(held);
  const span=(Date.now()-tw)/1000;
  if(wantTrace)await browser.stopTracing();
  if(wantProfile){const {profile}=await cdp.send('Profiler.stop');writeFileSync(join(dir,`${label}.cpuprofile`),JSON.stringify(profile));}
  const W=await page.evaluate(()=>window.__w);
  await page.screenshot({path:join(dir,`${label}.png`)});
  if(args.includes('--menu')){
    // The menu after the match (content-visibility while the shell is open): close the shell as the result's "menu" does.
    await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
    await wait(1500);await page.screenshot({path:join(dir,`${label}-menu.png`)});
  }
  // Phase of each second: perfil (a profile card on screen) > chefao > onda N / inicio (first 20 s).
  const phaseOf=s=>s.perfis>0?'perfil':s.boss?'chefao':s.overlays>0?'janela':(s.t-W.w0<20000?'inicio':'jogo');
  const f=W.f,frames=[];for(let i=1;i<f.length;i++)frames.push({t:f[i],ms:f[i]-f[i-1]});
  const sampleAt=t=>samples.find(s=>s.t>=t)??samples.at(-1);
  const phases={};
  for(const s of samples){const p=phaseOf(s);const e=phases[p]??={secs:0,task:0,script:0,style:0,layout:0,frames:[],loaf:[]};e.secs++;e.task+=s.task;e.script+=s.script;e.style+=s.style;e.layout+=s.layout;}
  for(const fr of frames){const p=phaseOf(sampleAt(fr.t));phases[p]?.frames.push(fr.ms);}
  for(const l of W.loaf){const p=phaseOf(sampleAt(l.t));phases[p]?.loaf.push(l);}
  const sumPhase=e=>({secs:e.secs,busyShare:r1(e.task/(e.secs*1000),2),scriptMsPerS:r1(e.script/e.secs),styleMsPerS:r1(e.style/e.secs),layoutMsPerS:r1(e.layout/e.secs),
    fps:r1(e.frames.length/e.secs),frameMs:{p50:r1(pct(e.frames,.5)),p95:r1(pct(e.frames,.95)),p99:r1(pct(e.frames,.99)),max:r1(Math.max(0,...e.frames))},
    over50:e.frames.filter(x=>x>50).length,over100:e.frames.filter(x=>x>100).length,over250:e.frames.filter(x=>x>250).length,loaf:e.loaf.length,loafMs:r1(e.loaf.reduce((a,l)=>a+l.ms,0))});
  // Scripts inside long animation frames, grouped by function/source.
  const byScript={};for(const l of W.loaf)for(const s of l.scripts){const key=`${s.inv} | ${s.fn||'?'} | ${s.src}`;const e=byScript[key]??={n:0,ms:0,layout:0};e.n++;e.ms+=s.ms;e.layout+=s.layout||0;}
  const topScripts=Object.entries(byScript).sort((a,b)=>b[1].ms-a[1].ms).slice(0,25).map(([k,e])=>({k,n:e.n,ms:r1(e.ms),layout:r1(e.layout)}));
  const loafSplit={n:W.loaf.length,ms:r1(W.loaf.reduce((a,l)=>a+l.ms,0)),scriptMs:r1(W.loaf.reduce((a,l)=>a+l.scripts.reduce((b,s)=>b+s.ms,0),0)),renderMs:r1(W.loaf.reduce((a,l)=>a+l.render,0)),styleLayoutMs:r1(W.loaf.reduce((a,l)=>a+l.style,0))};
  const upGroups={};for(const u of W.up){const k=(u.src.match(/^\/art\/(?:lite\/)?[^/]+(?:\/[^/.]+)?/)?.[0]??(u.src||'(canvas)'));const e=upGroups[k]??={n:0,ms:0,mb:0};e.n++;e.ms+=u.ms;e.mb+=u.w*u.h*4/2**20;}
  const all=frames.map(x=>x.ms);
  const canvas=await page.evaluate(()=>{const c=document.querySelector('dialog.explore-shell canvas');return c?{w:c.width,h:c.height,cssW:c.clientWidth,cssH:c.clientHeight}:null;});
  const report={label,web,cpu,bots,gpu,idle,viewport:`${vw}x${vh}@${dpr}`,canvas,seconds:r1(span),timeToMenuMs:tMenu,timeToPlayMs:tPlay,
    all:{fps:r1(all.length/span),frameMs:{p50:r1(pct(all,.5)),p95:r1(pct(all,.95)),p99:r1(pct(all,.99)),max:r1(Math.max(0,...all))},over50:all.filter(x=>x>50).length,over100:all.filter(x=>x>100).length,over250:all.filter(x=>x>250).length,
      busyShare:r1(samples.reduce((a,s)=>a+s.task,0)/(span*1000),2),longTasks:W.lt.length,longTaskMs:r1(W.lt.reduce((a,l)=>a+l.ms,0))},
    phases:Object.fromEntries(Object.entries(phases).map(([k,e])=>[k,sumPhase(e)])),loafSplit,topScripts,
    uploads:{n:W.up.length,ms:r1(W.up.reduce((a,u)=>a+u.ms,0)),over8ms:W.up.filter(u=>u.ms>8).length,byGroup:Object.fromEntries(Object.entries(upGroups).sort((a,b)=>b[1].ms-a[1].ms).slice(0,40).map(([k,e])=>[k,{n:e.n,ms:r1(e.ms),mb:r1(e.mb)}]))},
    gpuTexMB:{now:r1(W.texBytes/2**20),peak:r1(W.peakTexBytes/2**20),textures:W.texCount},
    heapMB:{min:r1(Math.min(...samples.map(s=>s.heap))),max:r1(Math.max(...samples.map(s=>s.heap))),last:r1(samples.at(-1).heap)},nodes:{min:Math.min(...samples.map(s=>s.nodes)),max:Math.max(...samples.map(s=>s.nodes))},
    rounds:[...new Set(samples.map(s=>s.round))],errors};
  if(args.includes('--layout')){const L=await page.evaluate(()=>window.__layout);report.layoutReads=Object.entries(L).sort((a,b)=>b[1].ms-a[1].ms).slice(0,30).map(([k,e])=>({ms:r1(e.ms),n:e.n,k}));}
  writeFileSync(join(dir,`${label}.json`),JSON.stringify(report,null,1));
  writeFileSync(join(dir,`${label}.samples.json`),JSON.stringify({samples,loaf:W.loaf,frames:all,up:W.up.map(u=>({t:u.t,ms:u.ms,w:u.w,h:u.h,src:u.src}))}));
  log('all',JSON.stringify(report.all));
  for(const [k,v] of Object.entries(report.phases))log(k,JSON.stringify(v));
}catch(e){log('FAIL',e.stack);process.exitCode=1;}finally{await done();}
