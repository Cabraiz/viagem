#!/usr/bin/env node
/**
 * Card BUG-20261024-ORQ-som-passos-fora-do-eixo: the proof of the footsteps in the real game. A solo match where the hero
 * walks (keyboard) the 8 directions in turn; records the page's video with the sound (a tap on every node reaching the
 * speakers, as prova-sons-jogo.mjs) and, every frame, the pose the hero shows; every buffer the page starts is logged with
 * its file. Then it measures, for each foot contact drawn (pose 0 and the middle pose of a run16/walk16 sheet), the time
 * to the step's crunch (the take's loudest 5 ms window after the play's offset), and the steps per contact.
 *
 *   node scripts/prova-passos.mjs <out-prefix> [--dist dist] [--url https://viagem.cyou/] [--segundos 24]
 *   node scripts/prova-passos.mjs <out-prefix> --medir <log.json>   (the measure again, from a recorded log)
 *   --gpu swiftshader: software WebGL (a d3d11 tab here froze its frames after ~10 s, main as well).
 *   --dist <dir>: this branch's build served at the production origin (the rooms worker only accepts it).
 * A step is heard at its play + the scheduling lead + the take's crunch + the context's output latency.
 */
import {pathToFileURL} from 'node:url';import {join,resolve,extname} from 'node:path';import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'prova-passos'),URL_=arg('url','https://viagem.cyou/'),SECS=Number(arg('segundos',24)),DIST=arg('dist');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
/** Contacts drawn (the hero's 16-pose sheet entering pose 0 or 8) against the steps heard. */
function measure(log){
  const contacts=[];let prev;
  for(const p of log.poses){
    const m=/^sprite16:[^:]+:(run|walk|push):(\w+)/.exec(p.key),base=p.key.replace(/:cidade:\d+$/,'');
    if(m&&prev&&prev.base===base&&p.frame!==prev.frame){
      const crossed=[0,8].some(c=>{const a=prev.frame,b=p.frame;return b>a?a<c&&c<=b:(c>a||c<=b);});
      if(crossed)contacts.push({t:p.t,dir:m[2],motion:m[1],frame:p.frame});
    }
    prev={...p,base};
  }
  const steps=log.plays.filter(p=>p.name.startsWith('passo-neve')).map(p=>({...p,heard:p.t+(p.lead+p.crunch+(p.latency??0))*1000}));
  const rows=contacts.map(c=>{let best;for(const s of steps){const d=s.heard-c.t;if(Math.abs(d)<=200&&(!best||Math.abs(d)<Math.abs(best.d)))best={d,s};}return {...c,d:best?.d,take:best?.s.name};});
  const ad=rows.filter(r=>r.d!==undefined).map(r=>Math.abs(r.d)).sort((a,b)=>a-b);
  const q=f=>ad.length?Math.round(ad[Math.min(ad.length-1,Math.floor(f*ad.length))]):null;
  const gaps=steps.slice(1).map((s,i)=>s.t-steps[i].t).filter(g=>g<400).sort((a,b)=>a-b);
  const byDir={};for(const r of rows){const b=byDir[r.dir]??={contatos:0,com_passo:0,soma:0};b.contatos++;if(r.d!==undefined){b.com_passo++;b.soma+=Math.abs(r.d);}}
  for(const b of Object.values(byDir)){b.erro_medio_ms=b.com_passo?Math.round(b.soma/b.com_passo):null;delete b.soma;}
  return {summary:{contatos_desenhados:contacts.length,passos_tocados:steps.length,contatos_com_passo_200ms:ad.length,
    erro_ms_mediana:q(.5),erro_ms_p90:q(.9),contatos_com_passo_40ms:ad.filter(d=>d<=40).length,
    intervalo_ms_min_max:gaps.length?[Math.round(gaps[0]),Math.round(gaps.at(-1))]:null,
    estalo_apos_play_ms:steps.length?[Math.round(Math.min(...steps.map(s=>s.crunch*1000))),Math.round(Math.max(...steps.map(s=>s.crunch*1000)))]:null,
    latencia_ms:log.latency==null?null:Math.round(log.latency*1000),byDir},rows};
}
const again=arg('medir');
if(again){const m=measure(JSON.parse(await readFile(again,'utf8')));writeFileSync(`${OUT}-medida.json`,JSON.stringify(m,null,1));console.log(JSON.stringify(m.summary,null,1));process.exit(0);}
const VIDEO=`${OUT}-video`;mkdirSync(VIDEO,{recursive:true});
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E6 prova passos'});
  browser=await chromium.launch({args:['--enable-gpu',`--use-angle=${arg('gpu','d3d11')}`,'--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block',recordVideo:{dir:VIDEO,size:{width:1280,height:720}}});
  await ctx.addInitScript(()=>{
    try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(dest,...rest){
      const out=connect.call(this,dest,...rest);
      if(dest instanceof AudioDestinationNode){
        const c=dest.context;
        if(!c.__tap){
          c.__tap=c.createMediaStreamDestination();
          const rec=new MediaRecorder(c.__tap.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000});
          const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.start(1000);
          window.__rec={rec,chunks,wall:Date.now(),ctx:c};
        }
        connect.call(this,c.__tap);
      }
      return out;
    };
    // Which file each decoded buffer came from, and every start: when (the context's clock and the page's), the offset.
    const files=new WeakMap(),names=new WeakMap();
    const ab=Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer=function(){const url=this.url;return ab.call(this).then(b=>{files.set(b,url);return b;});};
    const decode=BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData=function(data,...rest){const url=files.get(data);
      return decode.call(this,data,...rest).then(b=>{if(url)names.set(b,url.split('/').pop());return b;});};
    const crunch=new WeakMap();
    const loudest=b=>{let c=crunch.get(b);if(c!==undefined)return c;const x=b.getChannelData(0),w=Math.round(b.sampleRate*.005);let best=-1,at=0;
      for(let i=0;i+w<=x.length;i+=w){let s=0;for(let j=i;j<i+w;j++)s+=x[j]*x[j];if(s>best){best=s;at=i;}}c=at/b.sampleRate;crunch.set(b,c);return c;};
    const plays=window.__plays=[];
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when=0,offset=0,...rest){
      const b=this.buffer,name=b&&names.get(b);
      if(name&&/^(passo-neve|chefe-passo)/.test(name)){
        const c=this.context,lead=Math.max(0,when-c.currentTime),rate=this.playbackRate?.value??1;
        plays.push({t:performance.now(),name,lead,offset,crunch:(loudest(b)-offset)/rate,latency:((c.baseLatency??0)+(c.outputLatency??0))});
      }
      return start.call(this,when,offset,...rest);
    };
  });
  const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.webm':'audio/webm','.m4a':'audio/mp4','.wasm':'application/wasm'};
  if(DIST){
    await ctx.route('https://viagem.cyou/**',async route=>{
      const u=new URL(route.request().url());let f=resolve(DIST,'.'+decodeURIComponent(u.pathname));if(u.pathname.endsWith('/'))f=resolve(f,'index.html');
      // Only the code from the build (html, js, css): art and sounds come from production as in the run before (a
      // match served whole from disk froze its frames after ~10 s on main as well, card som-passos-fora-do-eixo).
      if(!['.html','.js','.mjs','.css'].includes(extname(f)))return route.continue();
      try{const body=await readFile(f);await route.fulfill({status:200,body,headers:{'content-type':TYPES[extname(f)]??'application/octet-stream','cache-control':'no-store'}});}
      catch{await route.continue();}
    });
  }
  const page=await ctx.newPage();const born=Date.now();const errors=[];globalThis.__page=page;globalThis.__errors=errors;
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push('falhou '+r.url()+' '+r.failure()?.errorText));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('websocket',w=>w.on('close',()=>errors.push('ws fechou '+w.url())));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(URL_+(URL_.includes('?')?'&':'?')+'perf=1',{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));const c=document.getElementById('confirm');c.click();const n2=document.getElementById('nickname');n2.value='Tia Cleide';n2.dispatchEvent(new Event('input',{bubbles:true}));c.click();});
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:90000});
  const clear=async()=>{for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}};
  await clear();
  // A click unlocks the engine (a gesture); then every frame logs the hero's pose.
  const box=await page.evaluate(()=>{const s=window.__perfScene,cam=s.cameras.main,a=s.project(s.position);return {x:(a.x-cam.worldView.x)*cam.zoom,y:(a.y-cam.worldView.y)*cam.zoom};});
  await page.mouse.click(box.x,box.y+2);await sleep(300);
  await page.evaluate(()=>{const poses=window.__poses=[];const loop=()=>{requestAnimationFrame(loop);try{const s=window.__perfScene,a=s?.actor;
    if(a){const g=s.sprites?.gait?.(a);poses.push({t:performance.now(),key:a.texture.key,frame:Number(a.frame.name),x:s.position?.x,y:s.position?.y,...(g?{cycles:g.cycles,contacts:g.contacts}:{})});}}catch(e){window.__poseError=String(e);}};requestAnimationFrame(loop);});
  console.log('partida aberta em',((Date.now()-born)/1000).toFixed(1),'s; gravador:',await page.evaluate(()=>!!window.__rec));
  const DIRS=[['KeyW'],['KeyW','KeyD'],['KeyD'],['KeyS','KeyD'],['KeyS'],['KeyS','KeyA'],['KeyA'],['KeyW','KeyA']];
  const t0=Date.now();let i=0;
  while(Date.now()-t0<SECS*1000){
    const keys=DIRS[i++%DIRS.length];
    for(const k of keys)await page.keyboard.down(k);
    await sleep(1800);
    for(const k of keys)await page.keyboard.up(k);
    await sleep(500);
    if(i%4===0)await clear();
  }
  const log=await page.evaluate(()=>({poseError:window.__poseError,poses:window.__poses,plays:window.__plays,latency:window.__rec?((window.__rec.ctx.baseLatency??0)+(window.__rec.ctx.outputLatency??0)):null}));
  const rec=await page.evaluate(()=>new Promise(res=>{const R=window.__rec;if(!R)return res(null);
    R.rec.onstop=async()=>{const b=new Blob(R.chunks,{type:'audio/webm'});const buf=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode(...buf.subarray(i,i+0x8000));res({wall:R.wall,b64:btoa(s)});};
    R.rec.stop();}));
  const video=page.video();await ctx.close();
  const vpath=await video.path();
  writeFileSync(`${OUT}-log.json`,JSON.stringify(log));
  const {summary,rows}=measure(log);
  writeFileSync(`${OUT}-medida.json`,JSON.stringify({summary,rows},null,1));
  console.log('medida:',JSON.stringify(summary,null,1));
  if(rec){
    writeFileSync(`${OUT}-audio.webm`,Buffer.from(rec.b64,'base64'));
    const off=((rec.wall-born)/1000).toFixed(3);
    execFileSync('ffmpeg',['-y','-v','error','-i',vpath,'-itsoffset',off,'-i',`${OUT}-audio.webm`,'-map','0:v','-map','1:a','-c:v','libx264','-pix_fmt','yuv420p','-crf','26','-preset','veryfast','-c:a','aac','-b:a','128k',`${OUT}.mp4`]);
    console.log('vídeo com som:',`${OUT}.mp4`);
  }else{console.log('sem áudio');process.exitCode=3;}
  console.log('erros da página:',errors.length,errors.slice(0,4).join(' | '));
}catch(e){console.log('falhou:',e.message.split('\n')[0],'erros da página:',globalThis.__errors?.slice(0,6));await globalThis.__page?.screenshot({path:`${OUT}-erro.png`}).catch(()=>{});process.exitCode=2;}
finally{await browser?.close();release?.();}
