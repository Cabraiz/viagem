// GIF do celular (card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima): o jogo de verdade (vite + Worker local), 390×844,
// o herói anda pelo joystick (toque de verdade, CDP) e encosta na lataria do Uno por TRÁS e pela FRENTE na tela, depois
// fica parado ao lado enquanto os bichos cercam o carro. Quadros em volta do carro (~10/s), mais prints da tela inteira.
//   node gif-uno.mjs <site> <worker> <saída-sem-extensão> <rótulo>
//   ex.: node gif-uno.mjs http://127.0.0.1:4206 http://127.0.0.1:8806 C:/.../depois depois
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [SITE,WORKER,OUT,LABEL='']=process.argv.slice(2);
const W=390,H=844,SIDE=300,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const frames=[];
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E6 GIF Uno ${LABEL}`});
const browser=await chromium.launch(process.env.NOGPU?{}:{args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
  const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:WORKER,protocol:3}}));
  const page=await ctx.newPage();
  page.on('pageerror',e=>console.log('[pageerror]',String(e).slice(0,200)));
  await page.goto(`${SITE}/`,{waitUntil:'domcontentloaded',timeout:300000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:300000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('confirm').click();});
  await sleep(1500);const bora=page.getByRole('button',{name:/BORA/i});if(await bora.count()){await bora.first().click({timeout:8000}).catch(()=>{});await sleep(2000);}
  if(await page.evaluate(()=>document.getElementById('confirmation')?.open))await page.evaluate(()=>document.getElementById('enter-island').click());
  console.log('menu ok');await page.waitForFunction(()=>window.__island&&window.__partidaPronta,null,{timeout:400000});console.log('partida ok');
  await sleep(3000);
  for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}

  // The car, the hero and the screen: world units and CSS px.
  const state=()=>page.evaluate(()=>{
    const s=window.__island.scene,cam=s.cameras.main,net=s.hooks.net,car=s.chaveiro?.carPose?.();
    const scr=p=>{const q=s.project(p);return {x:(q.x-cam.worldView.x)*cam.zoom,y:(q.y-cam.worldView.y)*cam.zoom};};
    if(!car)return undefined;
    // The world direction that goes up the screen (behind, in the draw order): of the 4 axes, the one with the least y.
    const dirs=[[1,0],[0,1],[-1,0],[0,-1],[.7071,.7071],[-.7071,.7071],[.7071,-.7071],[-.7071,-.7071]].map(([x,y])=>({x,y,sy:scr({x:car.x+x,y:car.y+y}).y}));
    dirs.sort((a,b)=>a.sy-b.sy);
    const enemies=[...net.feed.enemies.values()].filter(e=>e.hp>0&&Math.hypot(e.x-car.x,e.y-car.y)<3.5).length;
    return {car,hero:{...net.predicted},carPx:scr(car),heroPx:scr(net.predicted),up:{x:dirs[0].x,y:dirs[0].y},enemies};
  });
  const cdp=await ctx.newCDPSession(page);
  const stick=await page.evaluate(()=>{const r=document.querySelector('.explore-stick').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,r:r.width*.27};});
  let touching=false;
  const touch=async(dx,dy)=>{
    const p=[{x:stick.x+dx,y:stick.y+dy,id:1,radiusX:4,radiusY:4,force:1}];
    if(!touching){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p[0],x:stick.x,y:stick.y}]});touching=true;}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:p});
  };
  const lift=async()=>{if(touching){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});touching=false;}};
  /** Pushes the stick toward a world point (screen direction from the hero), `ms` long; `shoot` captures frames meanwhile. */
  const shot=async label=>{
    const st=await state();if(!st)return;
    const clip={x:Math.max(0,Math.min(W-SIDE,Math.round(st.carPx.x-SIDE/2))),y:Math.max(0,Math.min(H-SIDE,Math.round(st.carPx.y-SIDE*.6))),width:SIDE,height:SIDE};
    frames.push({buf:await page.screenshot({clip}),label});
  };
  const walkTo=async(target,ms,label,until)=>{
    const t0=Date.now();
    while(Date.now()-t0<ms){
      const st=await state();if(!st)break;
      const q=await page.evaluate(t=>{const s=window.__island.scene,cam=s.cameras.main,p=s.project(t);return {x:(p.x-cam.worldView.x)*cam.zoom,y:(p.y-cam.worldView.y)*cam.zoom};},target(st));
      const dx=q.x-st.heroPx.x,dy=q.y-st.heroPx.y,d=Math.hypot(dx,dy);
      if(until&&until(st,d)){await lift();return st;}
      await touch(dx/d*stick.r*1.2,dy/d*stick.r*1.2);
      if(label)await shot(label);else await sleep(60);
    }
    await lift();return state();
  };
  // The local Worker's lab command (ALLOW_LOCAL): {t:'lab',to} moves the hero, {t:'lab',spawn,kind} adds a critter.
  const lab=m=>page.evaluate(m=>window.__island.scene.hooks.net.socket.send(JSON.stringify({t:'lab',...m})),m);
  let st0=await state();if(!st0)throw new Error('sem carro na partida');
  for(let i=0;i<16&&Math.hypot(st0.hero.x-st0.car.x,st0.hero.y-st0.car.y)>6;i++){
    const a=i/16*Math.PI*2;await lab({to:{x:st0.car.x+Math.cos(a)*3.2,y:st0.car.y+Math.sin(a)*3.2}});await sleep(700);st0=await state();
  }
  await sleep(1500);
  console.log('carro',st0.car,'herói',st0.hero,'cima',st0.up);
  // 1. Behind: round to the screen-up side of the car (2.6 u off its centre), then press into it for 3 s.
  const side=(st,k)=>({x:st.car.x+st.up.x*k,y:st.car.y+st.up.y*k});
  const around=async k=>{
    const st=await state(),h=st.hero,a=Math.atan2(h.y-st.car.y,h.x-st.car.x),b=Math.atan2(st.up.y*k,st.up.x*k);
    // Walk an arc of points 3 u out so the hero never cuts through (or pushes) the car on the way.
    for(let i=1;i<=6;i++){const t=a+(((b-a+Math.PI*3)%(Math.PI*2))-Math.PI)*i/6;await walkTo(s=>({x:s.car.x+Math.cos(t)*3.2,y:s.car.y+Math.sin(t)*3.2}),2500,undefined,(_s,d)=>d<10);}
    await walkTo(s=>side(s,k*2.4),2500,undefined,(_s,d)=>d<6);
  };
  await around(1);
  await page.screenshot({path:`${OUT}-atras-cel.png`});
  await walkTo(s=>({x:s.car.x+s.up.x*.3,y:s.car.y+s.up.y*.3}),3000,`${LABEL}: herói atrás do Uno`);
  await page.screenshot({path:`${OUT}-atras-encostado-cel.png`});
  // 2. In front: round to the screen-down side, press into it for 3 s.
  await around(-1);
  await walkTo(s=>({x:s.car.x-s.up.x*.3,y:s.car.y-s.up.y*.3}),3000,`${LABEL}: herói na frente do Uno`);
  await page.screenshot({path:`${OUT}-frente-encostado-cel.png`});
  // 3. Standing off to the side: the critters come to the car (up to 60 s), then 4 s of them on it.
  await walkTo(s=>({x:s.car.x-s.up.y*3.5,y:s.car.y+s.up.x*3.5}),3000,undefined,(_s,d)=>d<6);
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;await lab({spawn:{x:st0.car.x+Math.cos(a)*5,y:st0.car.y+Math.sin(a)*5},kind:i%3?'bebado':'tio-pave'});}
  const t0=Date.now();let st=await state();
  while(st&&st.enemies<5&&Date.now()-t0<60000){await sleep(500);st=await state();}
  console.log('bichos perto do carro',st?.enemies,'em',Math.round((Date.now()-t0)/1000),'s');
  const t1=Date.now();while(Date.now()-t1<4000)await shot(`${LABEL}: bichos no Uno`);
  await page.screenshot({path:`${OUT}-bichos-cel.png`});
}finally{await browser.close();release();}
const dir=OUT+'.quadros';fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
for(const [i,f] of frames.entries()){
  const lab=Buffer.from(`<svg width="${SIDE}" height="24"><rect width="${SIDE}" height="24" fill="#000" opacity=".6"/><text x="6" y="17" font-family="Arial" font-size="14" fill="#fff">${f.label}</text></svg>`);
  await sharp(f.buf).composite([{input:lab,left:0,top:0}]).png().toFile(`${dir}/${String(i).padStart(4,'0')}.png`);
}
const {execFileSync}=await import('node:child_process');
execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','10','-i',`${dir}/%04d.png`,'-vf','split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse','-loop','0',`${OUT}.gif`]);
console.log(`${OUT}.gif`,frames.length,'quadros');
