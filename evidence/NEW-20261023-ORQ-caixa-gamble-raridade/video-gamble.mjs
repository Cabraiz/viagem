#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-caixa-gamble-raridade, etapa 6: the gamble in the real game. A local rooms Worker with
 * LAB_DOURADA=1 (every verde/azul/roxa weapon crate turns dourada) and this branch's vite; a solo match where the hero
 * walks to the nearest WEAPON crate, stands still until it opens, and the caça-níquel shows. Logs, for the record,
 * the verde/azul weapon crates in his frames before and after (they must vanish once he took that colour).
 *
 *   node evidence/NEW-20261023-ORQ-caixa-gamble-raridade/video-gamble.mjs <out-dir> [--celular] [--caixas 2]
 * Needs `npx vite build` first (dist/ served by scripts/serve.mjs). Ports: worker 8790, site 4204 (Executor-4, multiplayer/origins.ts). One browser slot (vaga.mjs). Run from the worktree root.
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,mkdirSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'video-gamble'),PHONE=process.argv.includes('--celular'),WANT=Number(arg('caixas',2));
mkdirSync(OUT,{recursive:true});
const {startLocalWorker}=await import(pathToFileURL(resolve('scripts/local-worker.mjs')).href);
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
let worker,vite,browser,release;const log=[];const say=(...a)=>{const l=a.join(' ');log.push(l);console.log(l);};
try{
  worker=await startLocalWorker({port:8790,logPath:join(OUT,'worker.log'),vars:{LAB_DOURADA:'1'}});
  say('worker',worker.endpoint);
  // This branch's build (npx vite build first): scripts/serve.mjs serves dist/ on PORT.
  vite=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore',windowsHide:true,env:{...process.env,PORT:'4204'}});
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:4204/')).ok)break;}catch{}await sleep(1000);}
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E4 video gamble'});
  // swiftshader: with d3d11 the page's compositor froze mid-match (the recording stood still from ~12 s, memory smoke-d3d11).
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  const size=PHONE?{width:412,height:915}:{width:1280,height:720};
  const ctx=await browser.newContext({viewport:size,deviceScaleFactor:1,serviceWorkers:'block',...(PHONE?{isMobile:true,hasTouch:true}:{}),recordVideo:{dir:OUT,size}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4204/?perf=1',{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));const c=document.getElementById('confirm');c.click();const n2=document.getElementById('nickname');n2.value='Tia Cleide';n2.dispatchEvent(new Event('input',{bubbles:true}));c.click();});
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:180000});
  for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}
  say('partida aberta');
  // The crates in this client's frames: weapon ones (no kit- item) by colour.
  const crates=()=>page.evaluate(()=>{const s=window.__perfScene,net=s.hooks.net,v=net?.feed.last,p=s.position;
    return (v?.pickups??[]).filter(k=>k.kind==='chest').map(k=>({id:k.id,value:k.value,item:k.resource??'',kit:(k.resource??'').startsWith('kit:'),d:Math.hypot(k.x-p.x,k.y-p.y)}));});
  const tally=list=>list.filter(k=>!k.kit).reduce((o,k)=>{o[k.value]=(o[k.value]??0)+1;return o;},{});
  const aim=id=>page.evaluate(id=>{const s=window.__perfScene,cam=s.cameras.main,net=s.hooks.net,v=net?.feed.last,p=s.position;
    const k=(v?.pickups??[]).find(q=>q.id===id);const a=s.project(p);const hx=(a.x-cam.worldView.x)*cam.zoom,hy=(a.y-cam.worldView.y)*cam.zoom;
    if(!k)return {hx,hy};const b=s.project(k);const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;return {x:hx+dx/l*160,y:hy+dy/l*160,hx,hy,d:Math.hypot(k.x-p.x,k.y-p.y)};},id);
  let opened=0;const t0=Date.now();
  while(opened<WANT&&Date.now()-t0<150_000){
    const list=await crates();
    const target=list.filter(k=>!k.kit&&k.value<=3).sort((a,b)=>a.d-b.d)[0];
    if(!target){await page.mouse.click(size.width/2+(opened%2?180:-180),size.height/2-120);await sleep(1200);continue;}
    say(`alvo ${target.item} cor ${target.value} a ${target.d.toFixed(1)} u; armas no meu frame por cor:`,JSON.stringify(tally(list)));
    let reached=false;
    for(let step=0;step<40;step++){
      const t=await aim(target.id);
      if(t.d===undefined)break;
      if(t.d<1.6){reached=true;break;}
      await page.mouse.click(t.x,t.y);await sleep(500);
    }
    if(!reached)continue;
    // Stand still (no clicks) until it opens: the caça-níquel shows on a dourada.
    const shown=await page.waitForFunction(()=>{const el=document.querySelector('.rh-cn');return el&&!el.hidden;},null,{timeout:6000}).then(()=>true).catch(()=>false);
    opened++;
    say(`abriu ${target.item}: caça-níquel ${shown?'apareceu':'NÃO apareceu'}`);
    await page.screenshot({path:join(OUT,`abriu-${opened}.png`),timeout:10000}).catch(()=>say('print falhou'));
    await sleep(2200);
    say('depois, armas no meu frame por cor:',JSON.stringify(tally(await crates())));
  }
  await sleep(1000);
  say('erros:',errors.length,errors.slice(0,3).join(' | '));
  await page.close();await ctx.close();
  const vid=readdirSync(OUT).find(f=>f.startsWith('page@')&&f.endsWith('.webm'));if(vid)renameSync(join(OUT,vid),join(OUT,PHONE?'gamble-celular.webm':'gamble-pc.webm'));
}finally{
  writeFileSync(join(OUT,PHONE?'log-celular.txt':'log-pc.txt'),log.join('\n')+'\n');
  await browser?.close().catch(()=>{});release?.();
  vite?.kill();await worker?.stop().catch(()=>{});
}
