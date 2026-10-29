// node --experimental-strip-types scripts/sonda-caixa-t0.mts <local|prod> <out> [w h]: solo match; prints at ready+0..11 s and when the
// crates' item stickers finished downloading, relative to __partidaPronta.
import {chromium} from 'file:///C:/nvm4w/nodejs/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {arsenalLoads} from 'file:///D:/Gits/viagem-wt/carregamento-config-menu/src/client/render/arsenal-rules.ts';
import {parseArtIndex,setArtIndex} from 'file:///D:/Gits/viagem-wt/carregamento-config-menu/src/client/art/manifest.ts';
const [mode,out,W='390',H='844']=process.argv.slice(2);
setArtIndex(parseArtIndex(JSON.parse(readFileSync('D:/Gits/viagem-wt/carregamento-config-menu/public/art/manifest.json','utf8'))));
const stickers=arsenalLoads().filter(l=>!l.strip).map(l=>l.url.split('?')[0]);
const stickerKeys=arsenalLoads().filter(l=>!l.strip).map(l=>l.key);
const local=mode==='local';
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist',...(local?['--host-resolver-rules=MAP viagem.cyou 127.0.0.1:4302','--ignore-certificate-errors']:[])]});
const ctx=await browser.newContext({viewport:{width:+W,height:+H},deviceScaleFactor:1,hasTouch:+W<900,isMobile:+W<900,ignoreHTTPSErrors:local});
const page=await ctx.newPage();await page.addInitScript(()=>performance.setResourceTimingBufferSize(20000));
{const c=await ctx.newCDPSession(page);await c.send('Emulation.setCPUThrottlingRate',{rate:4});await c.send('Network.enable');await c.send('Network.emulateNetworkConditions',{offline:false,latency:170,downloadThroughput:9e6/8,uploadThroughput:1.5e6/8});}
page.on('pageerror',e=>console.log('pageerror',String(e).slice(0,200)));
await page.goto('https://viagem.cyou/?perf=1',{waitUntil:'load'});
await page.waitForSelector('#confirm',{timeout:120000});
await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Sonda';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card[data-hero]:not([data-bloqueado])')?.click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
await page.waitForSelector('#enter-island',{state:'visible'});await page.waitForTimeout(800);
await page.evaluate(keys=>{document.getElementById('enter-island').click();
  // t=0: the first frame __partidaPronta is up, count the stickers in and point the camera at the nearest crate.
  // As soon as the scene and the crates exist (before the match is ready), the camera goes to the nearest crate, so its
  // ground is baked by t=0; t=0 = the first frame __partidaPronta is up: count the stickers in.
  let alvo;
  const tick=()=>{const sc=window.__perfScene,view=sc?.hooks?.net?.feed?.peek?.();
    if(sc&&view&&!alvo){const me=sc.position;
      const chests=view.pickups.filter(p=>p.kind==='chest').map(p=>({id:p.id,x:p.x,y:p.y,item:p.resource,d:Math.hypot(p.x-me.x,p.y-me.y)})).sort((a,b)=>a.d-b.d);
      if(chests.length){alvo={...chests[0],d:Math.round(chests[0].d*10)/10,crates:chests.length};window.__alvoEm=performance.now();
        const f=sc.follow;f.step=(_p,_dt,vp,z,fr)=>f.snap(sc.project({x:alvo.x,y:alvo.y}),vp,z,fr,undefined);}}
    if(!window.__partidaPronta||!sc){requestAnimationFrame(tick);return;}
    window.__prontaEm=performance.now();
    window.__t0={stickers:keys.filter(k=>sc.textures.exists(k)).length,de:keys.length,alvo,cameraAntesMs:window.__alvoEm&&Math.round(window.__prontaEm-window.__alvoEm)};
  };requestAnimationFrame(tick);},stickerKeys);
await page.waitForFunction(()=>window.__t0,null,{timeout:120000,polling:20});
console.log(mode,'t0',JSON.stringify(await page.evaluate(()=>window.__t0)));
const t0=Date.now();await page.screenshot({path:`${out}-0ms.png`});
// The first frame without the loading cover (the camera's jump to the crate bakes its ground first).
const limpo=await page.waitForFunction(()=>{const e=document.querySelector('.explore-loading');return !e||e.hidden||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden'||getComputedStyle(e).opacity==='0'?performance.now()-window.__prontaEm:false;},null,{timeout:30000,polling:30}).then(h=>h.jsonValue()).catch(()=>null);
await page.screenshot({path:`${out}-limpo.png`});console.log(mode,'sem capa em',Math.round(limpo),'ms');
const shots=[1000,3000,6000];
for(const ms of shots){const w=ms-(Date.now()-t0);if(w>0)await page.waitForTimeout(w);await page.screenshot({path:`${out}-${ms}ms.png`});}
const r=await page.evaluate(list=>{const at=window.__prontaEm;
  const seen=performance.getEntriesByType('resource').filter(e=>list.some(u=>e.name.includes(u)));
  return {n:seen.length,depoisDaPronta:seen.map(e=>Math.round(e.responseEnd-at)).sort((a,b)=>a-b)};},stickers);
console.log(mode,'stickers',stickers.length,'baixados',r.n,'fim rel. pronta (ms): min',r.depoisDaPronta[0],'max',r.depoisDaPronta.at(-1));
writeFileSync(`${out}.json`,JSON.stringify({mode,stickers:stickers.length,t0:await page.evaluate(()=>window.__t0),...r},null,1));
await browser.close();
