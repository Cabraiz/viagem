#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 3: prints of the chefão's arrival in the real game (this branch's vite dev
 * server + the local rooms Worker, wrangler dev). A solo match; {t:'lab',chefao:true} calls him; three shots: the camera
 * on him with his name (the hold), the camera back on the hero, the fight with the boss bar on top.
 *
 *   node evidence/NEW-20261023-ORQ-boss-fim-onda-1/prints-cena.mjs <out-dir> --escala 2|3 [--celular]
 *        [--vite http://127.0.0.1:5173/] [--salas http://127.0.0.1:8787]
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,mkdirSync} from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'.'),K=Number(arg('escala',2)),PHONE=process.argv.includes('--celular');
const VITE=arg('vite','http://127.0.0.1:5173/'),SALAS=arg('salas','http://127.0.0.1:8787');
const tag=`${PHONE?'celular':'pc'}-${K}x`;mkdirSync(OUT,{recursive:true});
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E1 boss-onda-1 prints ${tag}`});
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext(PHONE?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'}
    :{viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  await ctx.route('**/multiplayer.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({endpoint:SALAS})}));
  const page=await ctx.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${VITE}?perf=1&chefaoEscala=${K}`,{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('confirm').click();});
  await sleep(2000);
  const bora=page.getByRole('button',{name:/BORA/i});if(await bora.count()){await bora.first().click();await sleep(2000);}
  const solo=page.getByRole('button',{name:/Jogar sozinho/i});
  if(await solo.count())await solo.first().click();
  else if(await page.evaluate(()=>document.getElementById('confirmation')?.open))await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&window.__perfScene?.actor&&window.__perfScene.hooks.net?.run?.phase==='combat';},null,{timeout:180000});
  for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}
  await sleep(4000);
  await page.evaluate(()=>window.__perfScene.hooks.net.socket.send(JSON.stringify({t:'lab',chefao:true})));
  await page.waitForFunction(()=>!!window.__perfScene.hooks.net.run?.cena,null,{timeout:20000});
  const who=await page.evaluate(()=>window.__perfScene.hooks.net.run.cena.who);
  await sleep(1500);await page.screenshot({path:join(OUT,`${tag}-1-chegada.png`)});
  await sleep(2600);await page.screenshot({path:join(OUT,`${tag}-2-volta.png`)});
  // Walk toward him a little so he and the hero share the screen, then the fight's shot.
  await sleep(3000);await page.screenshot({path:join(OUT,`${tag}-3-luta.png`)});
  console.log(tag,'chefão:',who,'erros da página:',errors.length,errors.slice(0,4).join(' | '));
}catch(e){console.log('falhou:',e.message.split('\n')[0]);process.exitCode=2;}
finally{await browser?.close();release?.();}
