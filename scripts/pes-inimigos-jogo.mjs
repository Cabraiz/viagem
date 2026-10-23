#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: records, in the real game (a solo match, the hero standing still so the
 * camera does not move), every enemy drawn with imported art, per rendered frame: world point, screen point, the
 * sheet frame shown and its scale. scripts/desliza-inimigos.mjs turns it into the slide of the planted foot per enemy.
 * Also takes a burst of screenshots around the hero for the GIF.
 *
 *   node scripts/pes-inimigos-jogo.mjs <out-prefix> [--url https://viagem.cyou/] [--segundos 8] [--fotos 60]
 *   --video: also a real-time video of the whole page (<out>-video/), the log's start printed in seconds;
 *   --tela 390x844: a phone viewport (touch, mobile) instead of 1280x720 (card inimigos-animacao-2x-lenta).
 *   --acordar: walk only once the Minuto de Minerva is over (the first wave awake);
 *   --andando: the log starts at the wake-up and runs while the hero walks to them;
 *   --ficar: no walk, no wait: the log starts as the match opens (card inimigos-animacao-auditoria: the whole wake-up).
 */
import {pathToFileURL} from 'node:url';import {join} from 'node:path';import {existsSync,writeFileSync} from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=process.argv[2],URL_=arg('url','https://viagem.cyou/'),SECS=Number(arg('segundos',8)),SHOTS=Number(arg('fotos',60)),WAIT=Number(arg('espera',25));
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E6 monstros-sem-deslizar'});
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const [VW,VH]=arg('tela','1280x720').split('x').map(Number),phone=VW<VH||VW<900;
  const ctx=await browser.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:1,serviceWorkers:'block',isMobile:phone,hasTouch:phone,
    ...(process.argv.includes('--video')?{recordVideo:{dir:`${OUT}-video`,size:{width:VW,height:VH}}}:{})});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  // --dist <dir>: the site under test served from a local build at the production origin (the rooms worker only
  // accepts https://viagem.cyou), so the page plays a real match on the real worker with this branch's client.
  const DIST=arg('dist');
  if(DIST){
    const {readFile}=await import('node:fs/promises');const {extname,resolve}=await import('node:path');
    const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wasm':'application/wasm'};
    await ctx.route('https://viagem.cyou/**',async route=>{
      const u=new URL(route.request().url());let f=resolve(DIST,'.'+decodeURIComponent(u.pathname));if(u.pathname.endsWith('/'))f=resolve(f,'index.html');
      try{const body=await readFile(f);await route.fulfill({status:200,body,headers:{'content-type':TYPES[extname(f)]??'application/octet-stream','cache-control':'no-store'}});}
      catch{await route.fulfill({status:404,body:'not found'});}
    });
  }
  const page=await ctx.newPage();const born=Date.now();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});globalThis.__page=page;globalThis.__errors=errors;
  await page.goto(URL_+(URL_.includes('?')?'&':'?')+'perf=1',{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));const c=document.getElementById('confirm');c.click();const n2=document.getElementById('nickname');n2.value='Tia Cleide';n2.dispatchEvent(new Event('input',{bubbles:true}));c.click();});
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:90000});
  const clear=async()=>{for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}};
  await clear();
  // Walk towards the nest the HUD points at (--tecla, screen up by default) until enemies show, then stand still.
  const count=()=>page.evaluate(()=>{const h=window.__perfScene.horde;if(!h)return 0;let n=0;for(const [,e] of h.enemies.entries)if(!e.item.culled&&e.item.image.visible)n++;return n;});
  // The nearest live enemy of the feed, as a screen direction from the hero: a click 220 px that way walks there.
  const aim=()=>page.evaluate(()=>{const s=window.__perfScene,cam=s.cameras.main,net=s.hooks.net,p=s.position;let best,bd=1e9;
    for(const e of net?.feed.enemies.values()??[]){if(e.hp<=0)continue;const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<bd){bd=d;best=e;}}
    if(!best)return undefined;const a=s.project(p),b=s.project(best);const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    const hx=(a.x-cam.worldView.x)*cam.zoom,hy=(a.y-cam.worldView.y)*cam.zoom;return {x:hx+dx/l*220,y:hy+dy/l*220,hx,hy,d:bd};});
  const startLog=()=>page.evaluate(secs=>{window.__auditLog=new Promise(res=>{
    const s=window.__perfScene,h=s.horde,cam=s.cameras.main,rows=[];const t0=performance.now();
    const tick=()=>{
      const t=performance.now()-t0;
      for(const [id,e] of h.enemies.entries){const a=e.item;if(a.culled||!a.image.visible)continue;const im=a.image;
        rows.push([Math.round(t*10)/10,id,a.art,a.kind,+a.x.toFixed(4),+a.y.toFixed(4),+((im.x-cam.worldView.x)*cam.zoom).toFixed(2),+((im.y-cam.worldView.y)*cam.zoom).toFixed(2),im.texture.key,Number(im.frame.name),+(im.scaleY*cam.zoom).toFixed(4),a.moving?1:0,a.elite?1:0]);}
      if(t<secs*1000)requestAnimationFrame(tick);else res({zoom:cam.zoom,view:s.view,rows});
    };requestAnimationFrame(tick);
  });},SECS);
  const STAY=process.argv.includes('--ficar');
  // --acordar: wait out the Minuto de Minerva (the monsters asleep) before walking to them.
  if(process.argv.includes('--acordar')){await page.waitForFunction(()=>document.querySelector('.rh-minerva')?.hidden===false,null,{timeout:60000,polling:500});await page.waitForFunction(()=>{const m=document.querySelector('.rh-minerva');return m&&m.hidden;},null,{timeout:150000,polling:500});await sleep(1500);console.log('monstros acordados');}
  // --andando: the log runs from here on, while the hero walks to the enemies (they swing, chase, die).
  const LOGGING=process.argv.includes('--andando');if(LOGGING)await startLog();
  let stuck=0,last=1e9;for(let i=0;i<(STAY?0:90);i++){const t=await aim();if(!t){await sleep(1000);continue;}if(t.d<Number(arg('perto',5)))break;if(i%5===0)console.log('alvo a',t.d.toFixed(1),'u');
    // Stuck against a wall (the distance did not drop): turn the click by ±50°, ±90° around the hero.
    const turn=[0,0,50,-50,90,-90][Math.floor(stuck/2)%6]*Math.PI/180,cx=640,cy=360;
    const hx=t.x-(t.x-cx)*0,vx=t.x-t.hx,vy=t.y-t.hy,x=t.hx+vx*Math.cos(turn)-vy*Math.sin(turn),y=t.hy+vx*Math.sin(turn)+vy*Math.cos(turn);
    await page.mouse.click(x,y);await sleep(700);stuck=t.d>last-.3?stuck+1:0;last=t.d;}
  // Stand: a click on the hero himself.
  {const h=await page.evaluate(()=>{const s=window.__perfScene,cam=s.cameras.main,a=s.project(s.position);return {x:(a.x-cam.worldView.x)*cam.zoom,y:(a.y-cam.worldView.y)*cam.zoom};});await page.mouse.click(h.x,h.y+2);}
  await sleep(1500);console.log('andou; inimigos na tela',await count());
  const t0=Date.now();
  while(!STAY&&Date.now()-t0<WAIT*1000){
    const n=await page.evaluate(()=>{const h=window.__perfScene.horde;if(!h)return 0;let n=0;for(const [,e] of h.enemies.entries)if(!e.item.culled&&e.item.image.visible)n++;return n;});
    if(n>=6)break;if((Date.now()-t0)%10000<1100)console.log('inimigos na tela',n,Math.round((Date.now()-t0)/1000)+'s');await sleep(1000);await clear();
  }
  await page.screenshot({path:`${OUT}-tela.png`});
  console.log('log começa em',((Date.now()-born)/1000).toFixed(2),'s do vídeo');
  if(!LOGGING)await startLog();
  const log=await page.evaluate(()=>window.__auditLog);
  writeFileSync(`${OUT}.json`,JSON.stringify(log));
  console.log('linhas',log.rows.length,'zoom',log.zoom,'view',log.view);
  // Burst of screenshots around the hero for the GIF.
  const hero=await page.evaluate(()=>{const s=window.__perfScene,cam=s.cameras.main,a=s.actor;return {x:(a.x-cam.worldView.x)*cam.zoom,y:(a.y-cam.worldView.y)*cam.zoom};});
  const W=Math.min(640,VW),H=Math.min(400,VH),clip={x:Math.max(0,Math.min(VW-W,Math.round(hero.x-W/2))),y:Math.max(0,Math.min(VH-H,Math.round(hero.y-H/2))),width:W,height:H};
  const stamps=[];const s0=Date.now();
  for(let i=0;i<SHOTS;i++){await page.screenshot({path:`${OUT}-f${String(i).padStart(3,'0')}.png`,clip});stamps.push(Date.now()-s0);}
  writeFileSync(`${OUT}-fotos.json`,JSON.stringify({clip,stamps}));
  console.log('fotos',SHOTS,'em',stamps.at(-1),'ms; erros:',errors.length,errors.slice(0,3).join(' | '));
}catch(e){console.log('falhou:',e.message.split('\n')[0],'erros da página:',globalThis.__errors?.slice(0,6));await globalThis.__page?.screenshot({path:`${OUT}-erro.png`}).catch(()=>{});process.exitCode=2;}finally{await browser?.close();release?.();}
