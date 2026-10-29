// GIF do celular (card NEW-20261029-ORQ-missao-proteger-uno-tempo): o jogo de verdade (vite + Worker local), 390×844.
// 1. o relógio do chaveiro correndo; 2. bichos batem no Uno e o relógio mostra "Batida no Uno: +N s";
// 3. o lab {t:'lab',clock} encurta a espera e o chaveiro chega (acelerado) até "O chaveiro chegou! Segurem N s".
// Receita do gif-uno.mjs do E6 (BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima).
//   node gif-missao.mjs <site> <worker> <saída-sem-extensão>
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const sharp=createRequire('D:/Gits/viagem/package.json')('sharp');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [SITE,WORKER,OUT]=process.argv.slice(2);
const W=390,H=844,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const frames=[];
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 GIF missão'});
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

  // The clock chip, the "+N s" tag and the arrival band, as the HUD shows them.
  const hud=()=>page.evaluate(()=>{
    const q=s=>document.querySelector(s),vis=e=>!!e&&!e.hidden&&e.getClientRects().length>0;
    const s=window.__island.scene,car=s.chaveiro?.carPose?.(),net=s.hooks.net;
    return {eta:q('.rh-round-eta')?.textContent??'',tag:vis(q('.rh-camp-relogio-mais'))?q('.rh-camp-relogio-mais').textContent:vis(q('.rh-relogio-motivo'))?q('.rh-relogio-motivo').textContent:'',
      chegou:vis(q('.rh-chaveiro-chegou'))?q('.rh-chaveiro-chegou').textContent:'',car:car?{x:car.x,y:car.y}:undefined,hero:{...net.predicted}};
  });
  const shot=async label=>frames.push({buf:await page.screenshot(),label});
  const lab=m=>page.evaluate(m=>window.__island.scene.hooks.net.socket.send(JSON.stringify({t:'lab',...m})),m);
  let h=await hud();if(!h.car)throw new Error('sem carro na partida');
  const car=h.car;
  // The hero a step off the car, in its light: the wave's FOCO_UNO bodies go for the Uno (lab-spawned bodies have no foco
  // and only hunt the hero, so the wave is the real one) and the car stays on screen.
  const posto={x:car.x+3,y:car.y+1.5};
  await lab({to:posto});await sleep(1500);
  // Minerva's minute first (the critters go home then): the chaveiro's clock starts when it ends.
  for(let t0=Date.now();Date.now()-t0<60000&&!/Chaveiro chega/.test((h=await hud()).eta);)await sleep(500);
  console.log('relógio',h.eta,'carro',car,'herói',h.hero);

  // 1. The clock runs.
  for(let t0=Date.now();Date.now()-t0<2500;)await shot('relógio do chaveiro: 5:00 de defesa');
  await page.screenshot({path:`${OUT}-relogio-cel.png`});
  // 2. The first wave (5 to 15 s after Minerva) goes for the Uno: each hit adds time, the chip says how much.
  let seenTag=0,best='';
  for(let t0=Date.now(),n=0;Date.now()-t0<60000;n++){
    h=await hud();
    if(h.tag){if(!seenTag){seenTag=Date.now();await page.screenshot({path:`${OUT}-batida-cel.png`});}best=h.tag;}
    // Before the first hit 1 frame in 2 (the walk to the car), then every frame.
    if(h.tag||n%2===0)await shot(h.tag?`bicho bate no Uno: ${h.tag.replace(/^.*: /,'')} no relógio`:'bichos indo para o Uno');else await sleep(200);
    if(seenTag&&Date.now()-seenTag>5000)break;
    // Keep the hero on his post (the hunters push him around), so the camera keeps the car.
    if(n%10===9)await lab({to:posto});
  }
  console.log('tag',best||'(não apareceu)','relógio',h.eta);
  await lab({wipe:true});await sleep(800);
  // 3. The chaveiro arrives: the lab cuts the wait to 2 s, he rides the last stretch (frames 1 in 3, sped up).
  await lab({clock:2});
  let arrived=0;
  for(let t0=Date.now(),n=0;Date.now()-t0<60000;n++){
    // The wave keeps coming: clear it every ~2 s, or its hits push the 2 s back again and it fells the idle hero.
    if(n%8===7)await lab({wipe:true});
    h=await hud();
    if(h.chegou){if(!arrived){arrived=Date.now();await page.screenshot({path:`${OUT}-chegou-cel.png`});}}
    if(h.chegou?n%2===0:n%4===0)await shot(h.chegou?'o chaveiro chegou e abre o Uno':'chaveiro chegando (acelerado)');
    else await sleep(250);
    if(arrived&&Date.now()-arrived>6000)break;
  }
  console.log('chegou',!!arrived,h.chegou,'relógio',h.eta);
}finally{await browser.close();release();}
const dir=OUT+'.quadros';fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
for(const [i,f] of frames.entries()){
  const lab=Buffer.from(`<svg width="${W}" height="28"><rect width="${W}" height="28" fill="#000" opacity=".65"/><text x="8" y="19" font-family="Arial" font-size="15" fill="#fff">${f.label}</text></svg>`);
  await sharp(f.buf).composite([{input:lab,left:0,top:H-28}]).png().toFile(`${dir}/${String(i).padStart(4,'0')}.png`);
}
const {execFileSync}=await import('node:child_process');
// 1 frame in 4 at 2.5 fps and 40 colours: the snow moves in every frame, so a full GIF weighs ~19 MB; this one ~4 MB.
execFileSync('ffmpeg',['-y','-loglevel','error','-framerate','6','-i',`${dir}/%04d.png`,'-vf',"select='not(mod(n\\,4))',setpts=N/2.5/TB,split[a][b];[a]palettegen=max_colors=40:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",'-r','2.5','-loop','0',`${OUT}.gif`]);
console.log(`${OUT}.gif`,frames.length,'quadros');
