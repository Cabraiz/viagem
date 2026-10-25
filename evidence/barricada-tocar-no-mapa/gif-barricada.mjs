// GIF do card NEW-20261025-ORQ-barricada-tocar-no-mapa (E4): partida de verdade no celular 412×915 (Worker de salas local
// do worktree + vite do worktree). Duas barricadas dadas pelo lab, sem bichos. O dedo: toca no item da barricada → toca no
// mapa longe do herói → segura e arrasta (gira) → solta (constrói); depois um toque curto em outro lugar (sem girar) e um
// toque em cima de um prédio/da barricada (fantasma vermelho, não constrói). O herói não anda.
// node gif-barricada.mjs <vite url> <saída dir>   → <saída>/gesto-celular.gif, <saída>/gesto.json e quadros em <saída>/quadros/
import {pathToFileURL} from 'node:url';import fs from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const WT='D:/Gits/viagem-wt/barricada-tocar-no-mapa';
const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const {startLocalWorker}=await import(pathToFileURL(`${WT}/scripts/local-worker.mjs`).href);
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [VITE,OUT_ARG]=process.argv.slice(2);const OUT=resolve(OUT_ARG),DIR=`${OUT}/quadros`;
fs.rmSync(DIR,{recursive:true,force:true});fs.mkdirSync(DIR,{recursive:true});
process.chdir(WT);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E4 gif barricada-tocar-no-mapa'});
const worker=await startLocalWorker({port:8807,logPath:`${OUT}/worker.log`});
let browser;const errors=[],report=[];let frame=0;const captions=[];
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
  try{await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:Number(process.env.ESPERA??240000)});}catch(e){await p.screenshot({path:`${OUT}/falhou.png`});throw e;}
  const send=m=>p.evaluate(m=>{window.__island.scene.hooks.net.socket.send(JSON.stringify(m));},m);
  const me=()=>p.evaluate(()=>{const n=window.__island.scene.hooks.net,q=n.predicted;return {x:Math.round(q.x*100)/100,y:Math.round(q.y*100)/100};});
  const bars=()=>p.evaluate(()=>(window.__hud?.view?.structures??[]).filter(s=>s.kind==='barricada'&&s.owner!=='mapa'&&s.c!==undefined).map(s=>({id:s.id,c:s.c,r:s.r,rot:s.rot??0,x:s.x,y:s.y})));
  const allBars=()=>p.evaluate(()=>(window.__hud?.view?.structures??[]).filter(s=>s.kind==='barricada').map(s=>s.id));
  const screenOf=(x,y)=>p.evaluate(([x,y])=>window.__island.scene.locate({x,y}).screen,[x,y]);
  const offers=async()=>{for(let i=0;i<6;i++){const open=await p.evaluate(()=>{const b=[...document.querySelectorAll('button.rh-ofc-skip')].find(x=>x.getBoundingClientRect().width>0&&!x.disabled);if(!b)return false;b.click();return true;});if(!open)break;await p.waitForTimeout(400);}};
  const say=()=>p.evaluate(()=>[...document.querySelectorAll('.rh-obra-aviso')].filter(e=>!e.hidden).map(e=>e.textContent).join(' | '));
  const shot=async cap=>{await p.screenshot({path:`${DIR}/${String(frame++).padStart(4,'0')}.png`});captions.push(cap);};
  const film=async(ms,cap)=>{const n=Math.max(1,Math.round(ms/130));for(let i=0;i<n;i++){await shot(cap);await p.waitForTimeout(30);}};
  for(let i=0;i<3;i++){await send({t:'lab',wipe:true});await p.waitForTimeout(500);}
  await offers();
  await send({t:'lab',give:'pistola'});await p.waitForTimeout(500);
  await send({t:'lab',give:'kit:barricada'});await p.waitForTimeout(300);await send({t:'lab',give:'kit:barricada'});await p.waitForTimeout(800);
  const hero0=await me();report.push({step:'início',hero:hero0,barricadasDoMapa:(await allBars()).length});
  await film(700,'2 barricadas na mochila');
  // 1) Toca no item da barricada.
  const slot=await p.evaluate(()=>{const b=[...document.querySelectorAll('.rh-inv-slot')].find(x=>x.dataset.kind==='kit'&&x.getBoundingClientRect().width>0);if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  if(!slot)throw new Error('sem slot de kit na mochila');
  await touch('touchStart',slot.x,slot.y);await p.waitForTimeout(80);await touch('touchEnd');await p.waitForTimeout(300);
  report.push({step:'item tocado',aviso:await say()});
  await film(900,'toca no item: "toque no mapa"');
  // The ghost's look as the scene draws it ('ok' | 'bloqueado'; null: none) and the world point under a screen point.
  const look=()=>p.evaluate(()=>window.__island.scene.fortify?.ghost?.look??null);
  const worldAt=(x,y)=>p.evaluate(([x,y])=>window.__island.scene.worldAt(x,y),[x,y]);
  const heroAt=await screenOf(hero0.x,hero0.y);
  const spots=[[0,-170],[0,170],[-120,-110],[120,-110],[-120,140],[120,140],[-140,0],[140,0],[60,-220],[-60,220]];
  // A press that comes out yellow (else let go at once, unfilmed: a red tap builds nothing).
  const pressOk=async(x,y)=>{await touch('touchStart',x,y);await p.waitForTimeout(200);if(await look()==='ok')return true;await touch('touchEnd');await p.waitForTimeout(250);return false;};
  // 2) Toca no mapa longe do herói, segura e arrasta para girar, solta.
  let built1;
  for(const [sx,sy] of spots){
    const at={x:heroAt.x+sx,y:heroAt.y+sy};if(at.y<130||at.y>690||at.x<20||at.x>392)continue;
    const before=(await bars()).length;
    if(!await pressOk(at.x,at.y))continue;
    const w=await worldAt(at.x,at.y),dist=Math.hypot(w.x-hero0.x,w.y-hero0.y);
    await film(600,`toca no mapa a ${dist.toFixed(1)} u: fantasma ali`);
    // Drag toward world +y (the other axis): the ghost turns, stays where the finger landed.
    const to=await screenOf(w.x,w.y+1.6);
    for(let s=1;s<=8;s++){await touch('touchMove',at.x+(to.x-at.x)*s/8,at.y+(to.y-at.y)*s/8);await shot('segura e arrasta: gira');await p.waitForTimeout(40);}
    const lookTurned=await look();
    await film(500,'segura e arrasta: gira');
    await touch('touchEnd');await p.waitForTimeout(800);
    const now=await bars(),made=now.filter(b=>!before||!now.slice(0,before).some(o=>o.id===b.id));
    report.push({step:`segura e gira a ${dist.toFixed(1)} u`,lookTurned,construiu:now.length>before,aviso:await say(),nova:now.at(-1)});
    await film(900,'solta: constrói (o herói não andou)');
    if(now.length>before){built1=now.at(-1);break;}
  }
  // 3) Toque curto em outro lugar, arrastando no outro eixo de volta ao primeiro giro.
  let built2;
  for(const [sx,sy] of spots.slice().reverse()){
    const at={x:heroAt.x+sx,y:heroAt.y+sy};if(at.y<130||at.y>690||at.x<20||at.x>392)continue;
    const before=(await bars()).length;
    if(!await pressOk(at.x,at.y))continue;
    const w=await worldAt(at.x,at.y),to=await screenOf(w.x+1.6,w.y);
    await film(300,'outro lugar: arrasta no outro eixo');
    for(let s=1;s<=6;s++){await touch('touchMove',at.x+(to.x-at.x)*s/6,at.y+(to.y-at.y)*s/6);await shot('outro lugar: arrasta no outro eixo');await p.waitForTimeout(40);}
    await touch('touchEnd');await p.waitForTimeout(800);
    const now=await bars();
    report.push({step:`segundo a ${Math.hypot(w.x-hero0.x,w.y-hero0.y).toFixed(1)} u`,construiu:now.length>before,aviso:await say(),nova:now.at(-1)});
    await film(800,'solta: constrói');
    if(now.length>before){built2=now.at(-1);break;}
  }
  // 4) Em cima da barricada recém-posta: vermelho, não constrói (diz por quê). The kit may be gone (2 used): give one more.
  await send({t:'lab',give:'kit:barricada'});await p.waitForTimeout(600);
  const slot2=await p.evaluate(()=>{const b=[...document.querySelectorAll('.rh-inv-slot')].find(x=>x.dataset.kind==='kit'&&x.getBoundingClientRect().width>0);if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,hand:b.dataset.hand};});
  if(slot2&&slot2.hand!=='true'){await touch('touchStart',slot2.x,slot2.y);await p.waitForTimeout(80);await touch('touchEnd');await p.waitForTimeout(300);}
  if(built1){
    const at=await screenOf(built1.x,built1.y),before=(await bars()).length;
    await touch('touchStart',at.x,at.y);await film(600,'em cima de outra: vermelho');await touch('touchEnd');await p.waitForTimeout(500);
    report.push({step:'em cima da barricada',construiu:(await bars()).length>before,aviso:await say()});
    await film(900,'solta no vermelho: não constrói, diz por quê');
  }
  report.push({step:'fim',hero:await me(),built1,built2});
  fs.writeFileSync(`${OUT}/gesto.json`,JSON.stringify({report,errors,frames:frame},null,1));
  // The GIF: each frame with its caption on a dark band.
  const W=330,H=733,files=fs.readdirSync(DIR).filter(f=>f.endsWith('.png')).sort();
  const label=t=>Buffer.from(`<svg width="${W}" height="36"><rect width="${W}" height="36" fill="rgba(0,0,0,.7)"/><text x="${W/2}" y="24" font-family="Arial" font-size="16" font-weight="bold" fill="#fff" text-anchor="middle">${t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}</text></svg>`);
  const frames=[];
  for(let i=0;i<files.length;i++)frames.push(await sharp(`${DIR}/${files[i]}`).resize(W,H).composite([{input:label(captions[i]??''),left:0,top:H-36}]).png().toBuffer());
  await sharp(frames,{join:{animated:true}}).gif({delay:Array(frames.length).fill(130),loop:0}).toFile(`${OUT}/gesto-celular.gif`);
}finally{await browser?.close();await worker.stop();release();}
console.log(JSON.stringify(report,null,1),errors);
