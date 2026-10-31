// Proof for NEW-20261031-ORQ-itens-so-de-monstro-ultra-raro, run from the repo root (its wrangler + sim): a local rooms
// Worker with LAB_HORDE (critters on the hero), a DEV build (window.__island) served statically, one Chromium (390×844,
// swiftshader). 1) the start: the crates on screen (only the hero's near one, the pistola) → inicio.png;
// 2) the hero wipes the horde ({t:'lab',wipe:true}) and the kill crates fall where the monsters died: CDP screencast frames
// + frames.json. For step 2 run it with KILL_CRATE_CHANCE forced to 1 (a local edit, never committed).
//   npx vite build --mode development --outDir <dist>
//   node scripts/prova-caixa-abate.mjs --dist <dist> --saida <dir> [--port 8806] [--web-port 4216] [--horda 6]
// Needs the heavy slot (board tools/pesado.mjs) and a browser slot (locks/browser-1|2) taken by the caller.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const DIST=arg('dist'),OUT=arg('saida'),PORT=Number(arg('port','8806')),WEB_PORT=Number(arg('web-port','4216')),HORDA=arg('horda','6');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
mkdirSync(OUT,{recursive:true});
const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts/local-worker.mjs')).href);

let worker,browser,web;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-abate-${PORT}`),logPath:join(tmpdir(),`viagem-abate-worker-${PORT}.log`),
    vars:{LAB_HORDE:HORDA,LAB_SEED:'4242'}});
  web=spawn('python',['-m','http.server',String(WEB_PORT),'--bind','127.0.0.1','--directory',DIST],{stdio:'ignore',windowsHide:true});
  await sleep(1500);
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));}catch{}});
  const p=await ctx.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,300)));
  await p.goto(`http://127.0.0.1:${WEB_PORT}/`,{waitUntil:'load',timeout:120000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(()=>{const n=document.getElementById('nickname');n.value='Prova';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card[data-hero]:not([data-bloqueado])').click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:300000,polling:1000});
  await sleep(4000);
  const takeOffer=()=>p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/Levar os indicados/.test(x.textContent??''));b?.click();return !!b;});
  const send=m=>p.evaluate(m=>{const s=window.__island.scene.hooks.net.socket;if(s?.readyState===1)s.send(JSON.stringify(m));},m);
  const state=()=>p.evaluate(()=>{const net=window.__island.scene.hooks.net,view=net.feed.peek(),me=net.predicted;
    let near=0;for(const e of view.enemies)if(e.hp>0&&Math.hypot(e.x-me.x,e.y-me.y)<12)near++;
    const chests=view.pickups.filter(x=>x.kind==='chest').map(x=>({id:x.id,x:+x.x.toFixed(1),y:+x.y.toFixed(1),value:x.value,resource:x.resource,d:+Math.hypot(x.x-me.x,x.y-me.y).toFixed(1)}));
    return {me:{x:+me.x.toFixed(1),y:+me.y.toFixed(1)},near,chests};});
  const inicio=await state();console.log('inicio',JSON.stringify(inicio));
  await p.screenshot({path:join(OUT,'inicio.png')});
  for(let i=0;i<120;i++){await takeOffer();const s=await state();if(s.near>=4)break;await sleep(500);}
  console.log('antes',JSON.stringify(await state()));
  const cdp=await ctx.newCDPSession(p);const frames=[];
  cdp.on('Page.screencastFrame',async f=>{frames.push({t:f.metadata.timestamp,data:f.data});try{await cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId});}catch{}});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:80,everyNthFrame:1,maxWidth:390,maxHeight:844});
  await sleep(600);
  const marks=[{what:'wipe',t:Date.now()/1000}];
  await send({t:'lab',wipe:true});
  for(let i=0;i<12;i++){await takeOffer();await sleep(250);}
  await sleep(2500);
  await cdp.send('Page.stopScreencast');
  const depois=await state();console.log('depois',JSON.stringify(depois));
  await p.screenshot({path:join(OUT,'depois.png')});
  frames.forEach((f,i)=>writeFileSync(join(OUT,`f${String(i).padStart(4,'0')}.jpg`),Buffer.from(f.data,'base64')));
  writeFileSync(join(OUT,'frames.json'),JSON.stringify({marks,times:frames.map(f=>f.t),inicio,depois,errors},null,1));
  console.log('frames',frames.length,'errors',errors.length,errors.slice(0,3));
}finally{
  try{await browser?.close();}catch{}
  try{web?.kill();}catch{}
  try{await worker?.stop();}catch{}
}
