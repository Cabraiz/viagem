#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-sons-ia-ace-step, etapa 4: the proof of the TangoFlux sounds in the real game on the PC. Plays a
 * solo match (walks to the nearest enemies, so it shoots, hits, kills and steps on the snow) with a tap on every
 * AudioNode connected to the context's destination, recorded by a MediaRecorder; Playwright records the page's video and
 * ffmpeg muxes both into <out>.webm (and <out>.mp4). Also prints every /audio/sfx/ file fetched, its size and the total,
 * and decodes one webm and one m4a in the page.
 *
 *   node scripts/prova-sons-jogo.mjs <out-prefix> [--dist dist] [--url https://viagem.cyou/] [--segundos 30]
 *   --dist <dir>: this branch's build served at the production origin (the rooms worker only accepts it).
 */
import {pathToFileURL} from 'node:url';import {join,resolve,extname} from 'node:path';import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';import {execFileSync,spawnSync} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'prova-sons'),URL_=arg('url','https://viagem.cyou/'),SECS=Number(arg('segundos',30)),DIST=arg('dist');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
const VIDEO=`${OUT}-video`;mkdirSync(VIDEO,{recursive:true});
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E1 sons-ia prova'});
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
  const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block',recordVideo:{dir:VIDEO,size:{width:1280,height:720}}});
  await ctx.addInitScript(()=>{
    try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}
    // Every node that reaches the speakers also feeds a MediaStreamDestination of its context, recorded from the first one.
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(dest,...rest){
      const out=connect.call(this,dest,...rest);
      if(dest instanceof AudioDestinationNode){
        const c=dest.context;
        if(!c.__tap){
          c.__tap=c.createMediaStreamDestination();
          const rec=new MediaRecorder(c.__tap.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000});
          const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.start(1000);
          window.__rec={rec,chunks,wall:Date.now()};
        }
        connect.call(this,c.__tap);
      }
      return out;
    };
  });
  const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.webm':'audio/webm','.m4a':'audio/mp4','.wasm':'application/wasm'};
  if(DIST){
    await ctx.route('https://viagem.cyou/**',async route=>{
      const u=new URL(route.request().url());let f=resolve(DIST,'.'+decodeURIComponent(u.pathname));if(u.pathname.endsWith('/'))f=resolve(f,'index.html');
      try{const body=await readFile(f);await route.fulfill({status:200,body,headers:{'content-type':TYPES[extname(f)]??'application/octet-stream','cache-control':'no-store'}});}
      catch{await route.fulfill({status:404,body:'not found'});}
    });
  }
  const page=await ctx.newPage();const born=Date.now();const errors=[];globalThis.__page=page;globalThis.__errors=errors;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const sfx=new Map();
  page.on('response',async r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/audio/sfx/'))return;
    try{const b=await r.body();sfx.set(u.pathname.slice(11),{status:r.status(),bytes:b.length});}catch{sfx.set(u.pathname.slice(11),{status:r.status(),bytes:0});}});
  await page.goto(URL_+(URL_.includes('?')?'&':'?')+'perf=1',{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  // Real clicks (not element.click()): the engine unlocks on the first user gesture.
  await page.locator('#nickname').fill('Tia Cleide');await page.locator('#confirm').click();
  if(!await page.evaluate(()=>document.getElementById('confirmation')?.open)){await page.locator('#nickname').fill('Tia Cleide');await page.locator('#confirm').click();}
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  await page.locator('#enter-island').click();
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:90000});
  const clear=async()=>{for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}};
  await clear();
  console.log('partida aberta em',((Date.now()-born)/1000).toFixed(1),'s; gravador de áudio:',await page.evaluate(()=>!!window.__rec));
  // Walk at the nearest live enemy, a click 220 px that way; stand within 4 u so the hero fights; turn when stuck.
  const aim=()=>page.evaluate(()=>{const s=window.__perfScene,cam=s.cameras.main,net=s.hooks.net,p=s.position;let best,bd=1e9;
    for(const e of net?.feed.enemies.values()??[]){if(e.hp<=0)continue;const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<bd){bd=d;best=e;}}
    const a=s.project(p);const hx=(a.x-cam.worldView.x)*cam.zoom,hy=(a.y-cam.worldView.y)*cam.zoom;
    if(!best)return {hx,hy};const b=s.project(best);const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    return {x:hx+dx/l*220,y:hy+dy/l*220,hx,hy,d:bd};});
  const t0=Date.now();let stuck=0,last=1e9,i=0;
  while(Date.now()-t0<SECS*1000){
    const t=await aim();
    if(t.d===undefined){await page.mouse.click(t.hx+(i%2?200:-200),t.hy+(i%3?120:-120));await sleep(900);}
    else if(t.d<4){await page.mouse.click(t.hx,t.hy+2);await sleep(1000);}
    else{const turn=[0,0,50,-50,90,-90][Math.floor(stuck/2)%6]*Math.PI/180,vx=t.x-t.hx,vy=t.y-t.hy;
      await page.mouse.click(t.hx+vx*Math.cos(turn)-vy*Math.sin(turn),t.hy+vx*Math.sin(turn)+vy*Math.cos(turn));await sleep(700);
      stuck=t.d>last-.3?stuck+1:0;last=t.d;}
    if(++i%8===0){await clear();console.log(Math.round((Date.now()-t0)/1000)+'s','inimigo mais perto',t.d?.toFixed(1)??'-','u');}
  }
  await page.screenshot({path:`${OUT}-tela.png`});
  // Decode one file of each format in the page (Chromium: Opus in WebM; AAC in MP4 only on builds with the codec).
  const decode=await page.evaluate(async()=>{const c=new OfflineAudioContext(1,48000,48000),r={};
    for(const f of ['tiro-pistola.webm','tiro-pistola.m4a']){try{const b=await c.decodeAudioData(await (await fetch('/audio/sfx/'+f)).arrayBuffer());r[f]=`${b.duration.toFixed(3)} s`;}catch(e){r[f]='falhou: '+(e?.message||e);}}
    return r;});
  const rec=await page.evaluate(()=>new Promise(res=>{const R=window.__rec;if(!R)return res(null);
    R.rec.onstop=async()=>{const b=new Blob(R.chunks,{type:'audio/webm'});const buf=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode(...buf.subarray(i,i+0x8000));res({wall:R.wall,b64:btoa(s)});};
    R.rec.stop();}));
  const video=page.video();await ctx.close();
  const vpath=await video.path();
  console.log('decode no navegador:',JSON.stringify(decode));
  const rows=[...sfx].sort((a,b)=>b[1].bytes-a[1].bytes);let total=0;for(const [,v] of rows)total+=v.bytes;
  writeFileSync(`${OUT}-sfx.json`,JSON.stringify({total,files:Object.fromEntries(rows)},null,1));
  console.log(`sfx baixados: ${rows.length} arquivos, ${(total/1024).toFixed(1)} KB`);
  for(const [f,v] of rows)console.log(`  ${f} ${v.status} ${(v.bytes/1024).toFixed(1)} KB`);
  if(!rec){console.log('sem áudio: nenhum nó chegou ao destino (o motor não destravou?)');process.exitCode=3;}
  else{
    writeFileSync(`${OUT}-audio.webm`,Buffer.from(rec.b64,'base64'));
    const off=((rec.wall-born)/1000).toFixed(3);
    console.log('áudio começa em',off,'s do vídeo');
    execFileSync('ffmpeg',['-y','-v','error','-i',vpath,'-itsoffset',off,'-i',`${OUT}-audio.webm`,'-map','0:v','-map','1:a','-c:v','copy','-c:a','copy',`${OUT}.webm`]);
    execFileSync('ffmpeg',['-y','-v','error','-i',`${OUT}.webm`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','26','-preset','veryfast','-c:a','aac','-b:a','128k',`${OUT}.mp4`]);
    // Not silence: ffmpeg's volumedetect on the recorded track (it prints to stderr).
    const vol=spawnSync('ffmpeg',['-hide_banner','-i',`${OUT}-audio.webm`,'-af','volumedetect','-f','null','-'],{encoding:'utf8'}).stderr;
    console.log('volume da trilha:',(vol.match(/(mean|max)_volume: [-\d.]+ dB/g)??['?']).join(', '));
    console.log('vídeo com som:',`${OUT}.mp4`);
  }
  console.log('erros da página:',errors.length,errors.slice(0,4).join(' | '));
}catch(e){console.log('falhou:',e.message.split('\n')[0],'erros da página:',globalThis.__errors?.slice(0,6));await globalThis.__page?.screenshot({path:`${OUT}-erro.png`}).catch(()=>{});process.exitCode=2;}
finally{await browser?.close();release?.();}
