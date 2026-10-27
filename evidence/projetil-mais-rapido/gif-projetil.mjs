// GIF do card NEW-20261025-ORQ-projetil-mais-rapido (E4): partida de verdade no celular 412×915 (Worker de salas local
// do worktree + vite do worktree). Pistola dada pelo lab, sem bichos: toques no Atacar, o tiro voa no olhar. O mesmo roteiro
// roda duas vezes (HERO_SHOT_SLOWDOWN 3 = antes, 2 = depois: o Worker local relê o src a cada start) e o GIF junta os dois
// lado a lado, quadro a quadro.
// node gif-projetil.mjs <vite url> <saída dir> <rótulo>   → <saída>/<rótulo>.json + quadros em <saída>/<rótulo>/
// node gif-projetil.mjs --juntar <saída dir>                → <saída>/antes-depois-celular.gif
import {pathToFileURL} from 'node:url';import fs from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const WT='D:/Gits/viagem-wt/projetil-mais-rapido';
const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const W=310,H=689;

if(process.argv[2]==='--juntar'){
  const OUT=resolve(process.argv[3]);
  const read=l=>fs.readdirSync(`${OUT}/${l}`).filter(f=>f.endsWith('.png')).sort().map(f=>`${OUT}/${l}/${f}`);
  const a=read('antes'),b=read('depois'),n=Math.min(a.length,b.length);
  const label=t=>Buffer.from(`<svg width="${W}" height="40"><rect width="${W}" height="40" fill="rgba(0,0,0,.65)"/><text x="${W/2}" y="27" font-family="Arial" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">${t}</text></svg>`);
  const la=label('ANTES: pistola 1,67 u/s'),lb=label('DEPOIS: 2,5 u/s (1,5×)');
  const frames=[];
  for(let i=0;i<n;i++){
    const [fa,fb]=await Promise.all([a[i],b[i]].map(f=>sharp(f).resize(W,H).png().toBuffer()));
    frames.push(await sharp({create:{width:W*2+6,height:H,channels:3,background:'#000'}})
      .composite([{input:fa,left:0,top:0},{input:fb,left:W+6,top:0},{input:la,left:0,top:0},{input:lb,left:W+6,top:0}]).png().toBuffer());
  }
  await sharp(frames,{join:{animated:true}}).gif({delay:Array(frames.length).fill(120),loop:0}).toFile(`${OUT}/antes-depois-celular.gif`);
  console.log('gif',frames.length,'quadros');
  process.exit(0);
}

const {startLocalWorker}=await import(pathToFileURL(`${WT}/scripts/local-worker.mjs`).href);
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [VITE,OUT_ARG,LABEL]=process.argv.slice(2);const OUT=resolve(OUT_ARG),DIR=`${OUT}/${LABEL}`;
fs.rmSync(DIR,{recursive:true,force:true});fs.mkdirSync(DIR,{recursive:true});
process.chdir(WT);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E4 gif projetil-mais-rapido'});
const worker=await startLocalWorker({port:8807,logPath:`${OUT}/worker-${LABEL}.log`});
let browser;const errors=[],report=[];let frame=0;
try{
  browser=await chromium.launch({args:process.env.SOFT?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({deviceScaleFactor:1,viewport:{width:412,height:915},isMobile:true,hasTouch:true});
  const proto=JSON.parse(fs.readFileSync(`${WT}/public/multiplayer.json`,'utf8')).protocol;
  await ctx.route('**/multiplayer.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({endpoint:worker.endpoint,protocol:proto})}));
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  const cdp=await ctx.newCDPSession(p);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:7}]});
  await p.goto(VITE,{waitUntil:'load',timeout:400000});
  await p.waitForSelector('.class-card',{state:'attached',timeout:90000});
  await p.evaluate(c=>{const n=document.getElementById('nickname');n.value='Bolinha';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(`.class-card[data-hero="${c}"]`).click();const b=document.getElementById('confirm');b.click();if(!document.getElementById('confirmation').open)b.click();},process.env.CLASSE??'clt-cansado');
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});await p.evaluate(()=>document.getElementById('enter-island').click());
  try{await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:Number(process.env.ESPERA??240000)});}catch(e){await p.screenshot({path:`${OUT}/falhou-${LABEL}.png`});throw e;}
  const send=m=>p.evaluate(m=>{window.__island.scene.hooks.net.socket.send(JSON.stringify(m));},m);
  const me=()=>p.evaluate(()=>{const n=window.__island.scene.hooks.net,q=n.players.get(n.id),f=n.feed.players.get(n.id);return {x:q.x,y:q.y,weapons:f?.weapons?.map(w=>w.id),hand:f?.hand};});
  // Level-up offers are skipped (Pular): no Estilingue may change the shot speed mid-film.
  const offers=async()=>{for(let i=0;i<6;i++){const open=await p.evaluate(()=>{const b=[...document.querySelectorAll('button.rh-ofc-skip')].find(x=>x.getBoundingClientRect().width>0&&!x.disabled);if(!b)return false;b.click();return true;});if(!open)break;await p.waitForTimeout(400);}};
  // Fastest shot speed seen on the wire (u/s): the hero's own projectiles in the client feed.
  const speeds=()=>p.evaluate(()=>{const n=window.__island.scene.hooks.net,ps=n.feed?.projectiles;if(!ps)return null;return [...ps.values()].filter(q=>!q.hostile).map(q=>Math.round(Math.hypot(q.vx??0,q.vy??0)*100)/100);});
  const shot=async()=>{await p.screenshot({path:`${DIR}/${String(frame++).padStart(4,'0')}.png`});};
  const film=async ms=>{const n=Math.round(ms/120);for(let i=0;i<n;i++){await offers();await shot();await p.waitForTimeout(40);}};
  const btn=await p.evaluate(()=>{const r=document.getElementById('coop-attack').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  for(let i=0;i<3;i++){await send({t:'lab',wipe:true});await p.waitForTimeout(500);}
  await offers();
  await send({t:'lab',give:'pistola'});await p.waitForTimeout(700);
  report.push({step:'pistola',me:await me()});
  // Aim screen-up once (the body faces it), so both runs shoot the same way over open ground.
  await touch('touchStart',btn.x,btn.y);for(let s=1;s<=4;s++){await touch('touchMove',btn.x,btn.y-s*10);await p.waitForTimeout(30);}
  await p.waitForTimeout(120);await touch('touchEnd');await p.waitForTimeout(2500);
  await offers();await film(500);
  for(let k=0;k<4;k++){
    await offers();
    await touch('touchStart',btn.x,btn.y);await p.waitForTimeout(60);await touch('touchEnd');
    await p.waitForTimeout(150);report.push({step:`tiro ${k+1}`,speeds:await speeds()});
    await film(1700);
  }
  await offers();
  fs.writeFileSync(`${OUT}/${LABEL}.json`,JSON.stringify({report,errors,frames:frame},null,1));
}finally{await browser?.close();await worker.stop();release();}
console.log(LABEL,'frames',frame,errors);
