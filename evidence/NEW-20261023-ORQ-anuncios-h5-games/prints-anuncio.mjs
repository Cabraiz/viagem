// NEW-20261023-ORQ-anuncios-h5-games, etapa 2: the test ad (?anuncios=teste, data-adbreak-test="on", no ca-pub yet) on
// the result screen. A local room (wrangler dev) played alone with bots, ended with the lab's {t:'lab',end:true}; then
// "Sair" asks for the interstitial. Prints before, during and after, a video per view, and a log of every adBreak event.
// Views: PC 1280×800, phone 390×844 (portrait) and 844×390 (landscape); plus a run with Google's script blocked (adblock).
//   node evidence/NEW-20261023-ORQ-anuncios-h5-games/prints-anuncio.mjs [--web http://127.0.0.1:4207] [--port 8807] [--only pc,pe,deitado,bloqueado]
// Needs the built client served (scripts/serve.mjs) and a browser slot (board locks/browser-N), taken here.
import {mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {startLocalWorker} from '../../scripts/local-worker.mjs';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const WEB=arg('web','http://127.0.0.1:4207'),PORT=Number(arg('port','8807')),OUT=dirname(fileURLToPath(import.meta.url));
const ONLY=arg('only','pc,pe,deitado,bloqueado').split(',');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const VIEWS=[
  {name:'pc',width:1280,height:800,mobile:false},
  {name:'pe',width:390,height:844,mobile:true},
  {name:'deitado',width:844,height:390,mobile:true},
  {name:'bloqueado',width:390,height:844,mobile:true,block:true},
  // Control: the same flow without ?anuncios=teste (ads off: zero calls).
  {name:'sem',width:1280,height:800,mobile:false,off:true},
].filter(v=>ONLY.includes(v.name));

// Wraps every adBreak placement pushed to window.adsbygoogle (ours or after Google's script swaps push) to log its
// callbacks with a timestamp, so the log says whether Google showed a test ad without a ca-pub.
const SPY=()=>{
  const log=window.__adlog=[];const t=()=>Math.round(performance.now());
  const wrap=obj=>{
    if(!obj||obj.__spied||typeof obj.push!=='function')return;
    const push=obj.push;
    obj.push=function(call){
      if(call&&typeof call==='object'){
        log.push({at:t(),ev:'push',call:call.type?`adBreak ${call.type} ${call.name}`:`adConfig ${JSON.stringify(call)}`});
        for(const k of ['beforeAd','afterAd','adBreakDone','beforeReward','adDismissed','adViewed','onReady']){
          const fn=call[k];if(typeof fn!=='function')continue;
          call[k]=function(...a){log.push({at:t(),ev:k,info:a[0]?JSON.parse(JSON.stringify(a[0])):undefined});return fn.apply(this,a);};
        }
      }
      return push.apply(this,arguments);
    };
    Object.defineProperty(obj,'__spied',{value:true});
  };
  let store;
  Object.defineProperty(window,'adsbygoogle',{configurable:true,get:()=>store,set:v=>{store=v;wrap(v);}});
  setInterval(()=>wrap(store),20);
  // The build has no window.__island: keep the room's sockets to send the lab's end.
  const WS=window.WebSocket;window.__sockets=[];
  window.WebSocket=class extends WS{constructor(...a){super(...a);window.__sockets.push(this);}};
};

const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
let worker,browser,release;const report=[];
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E7 anuncios prints'});
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-ads-${PORT}`),logPath:join(tmpdir(),`viagem-ads-worker-${PORT}.log`)});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  // --gl swiftshader: software WebGL (the d3d11 GPU process hung in the driver on 23/10 and froze every frame).
  const GL=arg('gl','d3d11');
  browser=await chromium.launch({args:[...(GL==='d3d11'?['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--autoplay-policy=no-user-gesture-required']});
  for(const view of VIEWS){
    const r={view:view.name,shots:[],errors:[],net:[]};report.push(r);
    const vidDir=join(tmpdir(),`viagem-ads-video-${view.name}`);mkdirSync(vidDir,{recursive:true});
    const ctx=await browser.newContext({viewport:{width:view.width,height:view.height},deviceScaleFactor:2,isMobile:view.mobile,hasTouch:view.mobile,
      recordVideo:{dir:vidDir,size:{width:view.width,height:view.height}}});
    await ctx.route('**/multiplayer.json',x=>x.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
    if(view.block)await ctx.route(/googlesyndication|doubleclick|googleads|adtrafficquality/,x=>x.abort('blockedbyclient'));
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','3');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
    await ctx.addInitScript(SPY);
    const p=await ctx.newPage();
    p.on('pageerror',e=>r.errors.push(String(e).slice(0,200)));
    p.on('response',res=>{const u=res.url();if(/googlesyndication|doubleclick|googleads|gstatic\.com\/(h5|ads)/.test(u))r.net.push(`${res.status()} ${u.slice(0,140)}`);});
    p.on('requestfailed',q=>{const u=q.url();if(/googlesyndication|doubleclick|googleads/.test(u))r.net.push(`FALHOU ${q.failure()?.errorText} ${u.slice(0,140)}`);});
    const shot=async label=>{const file=`${view.name}-${label}.jpg`;try{await p.screenshot({path:join(OUT,file),type:'jpeg',quality:80,timeout:20000});r.shots.push(file);}catch(e){r.shots.push(`${file}: ${String(e).split(String.fromCharCode(10))[0]}`);}};
    const adlog=()=>p.evaluate(()=>window.__adlog??[]);
    await p.goto(`${WEB}/${view.off?'':'?anuncios=teste'}`,{waitUntil:'load',timeout:180000});
    await p.waitForSelector('#confirm',{state:'attached',timeout:180000});await sleep(1500);
    await p.evaluate(()=>{const i=document.getElementById('nickname');i.value='Teste Anúncio';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card')?.click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
    await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
    // The ad script loads after the menu is ready (load + idle + 3 s): it must already be in <head> before the match.
    await sleep(6000);
    r.scriptNoMenu=await p.evaluate(()=>[...document.querySelectorAll('script[src*="adsbygoogle"]')].map(s=>({src:s.src,test:s.dataset.adbreakTest,freq:s.dataset.adFrequencyHint})));
    await shot('1-menu');
    await p.evaluate(()=>document.getElementById('enter-island').click());
    await p.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])');},null,{timeout:240000});
    await sleep(4000);
    for(let i=0;i<4;i++){const b=p.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}
    await p.waitForFunction(()=>window.__sockets?.some(w=>w.readyState===1),null,{timeout:60000});
    await sleep(3000);
    r.adsDuranteAPartida=(await adlog()).filter(e=>e.ev!=='push'||e.call.startsWith('adBreak')).length;
    await shot('2-partida');
    for(const end=Date.now()+90000;Date.now()<end;await sleep(2000)){
      await p.evaluate(()=>window.__sockets.filter(w=>w.readyState===1).forEach(w=>w.send(JSON.stringify({t:'lab',end:true}))));
      if(await p.waitForSelector('.rh-result:not([hidden])',{state:'visible',timeout:2000}).then(()=>true,()=>false))break;
    }
    await sleep(3000);await shot('3-resultado');
    const before=(await adlog()).length;
    const t0=Date.now();
    // The click and the menu's return timed inside the page (the prints below can lag behind).
    await p.evaluate(()=>{const t=performance.now();window.__sairAt=t;document.querySelector('.rh-result-exit').click();
      const tick=()=>{const s=document.querySelector('dialog.explore-shell');if(!s||!s.open){window.__menuAt=performance.now()-t;return;}requestAnimationFrame(tick);};
      const poll=setInterval(()=>{const s=document.querySelector('dialog.explore-shell');if(!s||!s.open){window.__menuPoll=performance.now()-t;clearInterval(poll);}},25);tick();});
    // During the break: prints at fixed times, until the menu is back.
    const menuBack=()=>p.evaluate(()=>{const s=document.querySelector('dialog.explore-shell');return !s||!s.open;});
    for(const ms of [400,1200,2500,5000,8000,12000,20000,30000]){
      await sleep(Math.max(0,ms-(Date.now()-t0)));
      if(await menuBack()){r.menuVoltouEmMs=r.menuVoltouEmMs??Date.now()-t0;}
      const frames=await p.evaluate(()=>[...document.querySelectorAll('iframe,ins')].filter(e=>{const b=e.getBoundingClientRect();return b.width>50&&b.height>50&&getComputedStyle(e).visibility!=='hidden';}).map(e=>`${e.tagName} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} ${(e.id||e.className||'').toString().slice(0,40)}`));
      r.shots.push({ms,frames,menu:await menuBack()});
      await shot(`4-sair-${String(ms).padStart(5,'0')}ms`);
      if(r.menuVoltouEmMs!==undefined&&ms>=2500&&!frames.length)break;
    }
    for(const end=Date.now()+70000;Date.now()<end&&!(await menuBack());)await sleep(250);
    r.menuVoltouEmMs=r.menuVoltouEmMs??(await menuBack()?Date.now()-t0:'não voltou');
    await sleep(1500);await shot('5-depois');
    r.dom=await p.evaluate(async()=>({
      iframes:[...document.querySelectorAll('iframe')].map(e=>{const b=e.getBoundingClientRect();const cs=getComputedStyle(e);return `${e.id||e.name||'-'} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} vis=${cs.visibility} disp=${cs.display} op=${cs.opacity} z=${cs.zIndex} src=${(e.src||'').slice(0,80)}`;}),
      ins:[...document.querySelectorAll('ins')].map(e=>`${e.className} ${e.getAttribute('data-ad-status')??''} ${getComputedStyle(e).display}`),
      body:document.body.getAttribute('style'),html:document.documentElement.getAttribute('style'),
      tops:[...document.body.children].filter(e=>!['SCRIPT','STYLE','LINK'].includes(e.tagName)).map(e=>`${e.tagName}#${e.id}.${String(e.className).slice(0,30)} ${getComputedStyle(e).position} z=${getComputedStyle(e).zIndex}`).slice(-12),
      raf:await new Promise(res=>{let n=0;const t=performance.now();const f=()=>{n++;if(performance.now()-t<1000)requestAnimationFrame(f);else res(n);};requestAnimationFrame(f);setTimeout(()=>res(`timeout n=${n}`),3000);}),
      visibility:document.visibilityState,
    }));
    r.menuNaPagina=await p.evaluate(()=>({raf:window.__menuAt,poll:window.__menuPoll,sairAt:Math.round(window.__sairAt)}));
    r.adlog=await adlog();
    r.audioHushed=await p.evaluate(()=>window.__audio?.hushed);
    const video=p.video();await ctx.close();
    if(video){const src=await video.path();const dst=join(OUT,`video-${view.name}.webm`);try{copyFileSync(src,dst);rmSync(src);r.video=`video-${view.name}.webm`;}catch(e){r.video=String(e);}}
  }
}finally{
  writeFileSync(join(OUT,'prints-anuncio.json'),JSON.stringify(report,null,1));
  await browser?.close().catch(()=>{});await worker?.stop().catch(()=>{});release?.();
}
console.log(JSON.stringify(report,null,1));
