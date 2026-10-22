// danca-sem-fallback evidence: the built menu on vite preview, a fresh browser context (clean cache) per screen, a 4G-ish
// network (so the dance takes a moment), screenshots at the first menu frame and 3 s later, and a 100 ms probe that the
// still portrait (#portrait img) is never visible while there is no dance.
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const OUT=process.argv[2],PORT=4223;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(PORT),'--strictPort','--outDir',resolve('dist')],{stdio:'ignore',windowsHide:true});
const base=`http://127.0.0.1:${PORT}`,log={};
let browser;
try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/version.json')).ok)break;}catch{}await sleep(250);}
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  for(const [name,opts] of [['pc',{viewport:{width:1280,height:800},deviceScaleFactor:1}],['celular',{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true}]]){
    const ctx=await browser.newContext(opts),p=await ctx.newPage(),cdp=await ctx.newCDPSession(p);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    // ~4G: 12 Mbit/s down, 60 ms.
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:60,downloadThroughput:1.5e6,uploadThroughput:7.5e5});
    const samples=[];
    await p.addInitScript(()=>{window.__probe=[];const t0=performance.now();const tick=()=>{const f=document.getElementById('portrait');
      if(f){const img=f.querySelector('img'),canvas=f.querySelector('canvas.menu-dance');
        window.__probe.push({t:Math.round(performance.now()-t0),pending:f.classList.contains('dance-pending'),dancing:f.classList.contains('dancing'),
          imgVisible:!!img&&getComputedStyle(img).visibility!=='hidden'&&img.complete&&img.naturalWidth>0,canvas:!!canvas});}
      if(performance.now()-t0<12000)setTimeout(tick,100);};setTimeout(tick,0);});
    await p.goto(base+'/',{waitUntil:'commit',timeout:60000});
    await p.waitForSelector('#portrait',{state:'attached',timeout:60000});
    await p.waitForSelector('.criacao .portrait-caption',{state:'visible',timeout:60000});
    await p.screenshot({path:join(OUT,`danca-${name}-inicio.png`)});
    await sleep(3000);
    await p.screenshot({path:join(OUT,`danca-${name}-3s.png`)});
    await sleep(6000);
    await p.screenshot({path:join(OUT,`danca-${name}-9s.png`)});
    const probe=await p.evaluate(()=>window.__probe);
    const box=await p.evaluate(()=>{const c=document.querySelector('#portrait canvas.menu-dance'),f=document.getElementById('portrait');
      const r=c?.getBoundingClientRect(),fr=f.getBoundingClientRect();return {canvas:r&&{w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)},frame:{w:Math.round(fr.width),h:Math.round(fr.height)}};});
    log[name]={box,firstDanceMs:probe.find(x=>x.dancing)?.t??null,portraitEverVisible:probe.filter(x=>x.imgVisible).length,samples:probe.length,
      pendingAtStart:probe[0]?.pending??null};
    await ctx.close();
  }
}finally{
  try{await browser?.close();}catch{}
  try{preview.kill();}catch{}
  writeFileSync(join(OUT,'danca-print.json'),JSON.stringify(log,null,1));
  console.log(JSON.stringify(log));
}
