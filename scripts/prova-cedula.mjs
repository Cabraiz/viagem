// Proof GIF frames for NEW-20261024-ORQ-tirar-drops-cedula-girando, run from the repo root (its wrangler + sim): a local
// rooms Worker with LAB_HORDE (critters on the hero, heroes standing), a DEV build (window.__island) served statically,
// one Chromium in swiftshader; the hero wipes the horde ({t:'lab',wipe:true}), the cédulas appear 1 s later and spin,
// then lab moves put the hero beside each one (the short magnet takes it). CDP screencast frames + frames.json.
//   npx vite build --mode development --outDir <dist>
//   node scripts/prova-cedula.mjs --dist <dist> --saida <dir> [--cel] [--port 8805] [--web-port 4215]
// Needs the heavy slot (board tools/pesado.mjs) and a browser slot (locks/browser-1|2) taken by the caller.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const DIST=arg('dist'),OUT=arg('saida'),CEL=process.argv.includes('--cel'),PORT=Number(arg('port','8805')),WEB_PORT=Number(arg('web-port','4215'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
mkdirSync(OUT,{recursive:true});
const {startLocalWorker}=await import(pathToFileURL(join(process.cwd(),'scripts/local-worker.mjs')).href);

let worker,browser,web;
try{
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-cedula-${PORT}`),logPath:join(tmpdir(),`viagem-cedula-worker-${PORT}.log`),
    vars:{LAB_HORDE:'14',LAB_SEED:'4242'}});
  web=spawn('python',['-m','http.server',String(WEB_PORT),'--bind','127.0.0.1','--directory',DIST],{stdio:'ignore',windowsHide:true});
  await sleep(1500);
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const vp=CEL?{width:390,height:844}:{width:1280,height:720};
  const ctx=await browser.newContext({viewport:vp,deviceScaleFactor:CEL?2:1,...(CEL?{isMobile:true,hasTouch:true}:{})});
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
  await sleep(6000);
  // The level-up pause (D-050) holds the room: "Levar os indicados" whenever its window shows.
  const takeOffer=()=>p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/Levar os indicados/.test(x.textContent??''));b?.click();return !!b;});
  const send=m=>p.evaluate(m=>{const s=window.__island.scene.hooks.net.socket;if(s?.readyState===1)s.send(JSON.stringify(m));},m);
  const state=()=>p.evaluate(()=>{const net=window.__island.scene.hooks.net,view=net.feed.peek();
    const me=net.predicted;let near=0;for(const e of view.enemies)if(e.hp>0&&Math.hypot(e.x-me.x,e.y-me.y)<12)near++;
    const notes=view.pickups.filter(x=>x.kind==='grana').map(x=>({x:x.x,y:x.y,value:x.value}));
    return {me:{x:me.x,y:me.y},near,notes,grana:net.camp?.grana??null};});
  // Wait for a crowd around the hero (on screen: within 12 u). A level-up pause (D-050) holds the room and the lab horde:
  // take the offer whenever its window shows.
  for(let i=0;i<120;i++){
    await takeOffer();
    const s=await state();if(s.near>=6)break;await sleep(500);
  }
  console.log('before',JSON.stringify(await state()));
  // Screencast: every frame with its timestamp.
  const cdp=await ctx.newCDPSession(p);const frames=[];
  cdp.on('Page.screencastFrame',async f=>{frames.push({t:f.metadata.timestamp,data:f.data});try{await cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId});}catch{}});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:80,everyNthFrame:1,...(CEL?{maxWidth:780,maxHeight:1688}:{maxWidth:1280,maxHeight:720})});
  await sleep(600);
  const t0=Date.now()/1000;
  await send({t:'lab',wipe:true});
  const marks=[{what:'wipe',t:t0}];
  // The kills' XP may open another pause: the cédulas come 1 s of play after it closes.
  let mid;for(let i=0;i<80;i++){await takeOffer();mid=await state();if(mid.notes.length)break;await sleep(250);}
  await sleep(1600);mid=await state();console.log('after 2.6 s',JSON.stringify(mid));
  // Walk over the notes (lab moves), collecting them.
  // Beside each note (out of the magnet's 1.6 u: it spins on screen), then onto it (the magnet takes it).
  const marksWalk=[];
  for(const n of mid.notes.slice(0,4)){
    await takeOffer();await send({t:"lab",to:{x:n.x+3.5,y:n.y}});marksWalk.push({what:'beside',t:Date.now()/1000});await sleep(1400);
    await send({t:"lab",to:{x:n.x+.8,y:n.y}});marksWalk.push({what:'take',t:Date.now()/1000});await sleep(900);
  }
  marks.push(...marksWalk);
  await sleep(1200);
  await cdp.send('Page.stopScreencast');
  const end=await state();console.log('end',JSON.stringify(end));
  frames.forEach((f,i)=>writeFileSync(join(OUT,`f${String(i).padStart(4,'0')}.jpg`),Buffer.from(f.data,'base64')));
  writeFileSync(join(OUT,'frames.json'),JSON.stringify({marks,times:frames.map(f=>f.t),mid,end,errors},null,1));
  console.log('frames',frames.length,'errors',errors.length,errors.slice(0,3));
}finally{
  try{await browser?.close();}catch{}
  try{web?.kill();}catch{}
  try{await worker?.stop();}catch{}
}
