#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 3: prints of the chefão's arrival in the real game (this branch's vite dev
 * server + the local rooms Worker, wrangler dev). A solo match; {t:'lab',chefao:true} calls him; three shots: the camera
 * on him with his name (the hold), the camera back on the hero, the fight with the boss bar on top.
 *
 *   node evidence/NEW-20261023-ORQ-boss-fim-onda-1/prints-cena.mjs <out-dir> --escala 2|3 [--celular]
 *        [--vite http://127.0.0.1:4201/] [--salas http://127.0.0.1:8788]
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,mkdirSync} from 'node:fs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'.'),K=Number(arg('escala',2)),PHONE=process.argv.includes('--celular');
const VITE=arg('vite','http://127.0.0.1:4201/'),SALAS=arg('salas','http://127.0.0.1:8788');
const tag=`${PHONE?'celular':'pc'}-${K}x`;mkdirSync(OUT,{recursive:true});
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E1 boss-onda-1 prints ${tag}`});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext(PHONE?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'}
    :{viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  await ctx.route('**/multiplayer.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({endpoint:SALAS})}));
  const page=await ctx.newPage();const errors=[];globalThis.__page=page;globalThis.__errors=errors;
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
  // His art first (the {t:'elenco'} list names him): in a real run he comes minutes in, long after it loaded.
  await page.waitForFunction(()=>{const s=window.__perfScene,ids=['o-grande-credor','dj-do-fim-do-mundo','mapinguari-do-shopping','boitata-de-sacolinha'];
    const id=(s.hooks.net.elenco??[]).find(i=>ids.includes(i));return !!id&&s.textures.exists(`art:enemy:${id}:idle`);},null,{timeout:120000});
  await sleep(1500);
  await page.evaluate(()=>window.__perfScene.hooks.net.socket.send(JSON.stringify({t:'lab',chefao:true})));
  await page.waitForFunction(()=>{const c=window.__perfScene.hooks.net.run?.cena;if(c)window.__cena=c;return !!c;},null,{polling:20,timeout:20000});
  const who=await page.evaluate(()=>window.__cena.who);
  const probe=()=>page.evaluate(()=>{const s=window.__perfScene,c=window.__cena,cam=s.cameras.main,at=s.project({x:c.x,y:c.y}),me=s.project(s.position);
    let b;s.horde.enemies.forEach(a=>{if(a.boss)b={id:a.id,kind:a.kind,art:a.art,vis:a.image.visible,alpha:a.image.alpha,x:Math.round(a.image.x),y:Math.round(a.image.y),sx:+a.image.scaleX.toFixed(2),dh:Math.round(a.image.displayHeight),tex:a.image.texture.key,w:a.image.width,h:a.image.height,culled:a.culled};});
    const f=s.hooks.cena?.frame(performance.now());
    return {weight:f?.weight,ms:f&&Math.round(f.ms),cam:{x:Math.round(cam.midPoint.x),y:Math.round(cam.midPoint.y)},bossPx:{x:Math.round(at.x),y:Math.round(at.y)},heroPx:{x:Math.round(me.x),y:Math.round(me.y)},actor:b,heroDh:Math.round(s.actor.displayHeight)};});

  // The shot while the camera holds on him with his name (the page is slow under swiftshader: wait for that moment).
  await page.waitForFunction(()=>{const f=window.__perfScene.hooks.cena?.frame(performance.now());return f&&f.title&&f.ms>900;},null,{polling:20,timeout:10000}).catch(()=>{});
  await page.screenshot({path:join(OUT,`${tag}-1-chegada.png`)});console.log('probe',JSON.stringify(await probe()));
  console.log('diag:',JSON.stringify(await page.evaluate(()=>{const s=window.__perfScene,net=s.hooks.net,c=window.__cena,now=net.run?.cena;
    const boss=[...net.feed.enemies.values()].find(e=>e.boss);const me=s.position;
    const cam=s.cameras.main,at=s.project({x:c.x,y:c.y});
    const actor=s.horde?.enemies?.items?.find?.(a=>a.id===c.enemy);
    return {stillCena:!!now,cena:{x:c.x,y:c.y,enemy:c.enemy},boss:boss&&{id:boss.id,kind:boss.kind,x:boss.x,y:boss.y,hp:boss.hp},me:{x:me.x,y:me.y},
      camCenter:{x:cam.midPoint.x,y:cam.midPoint.y},bossPx:at,feedCount:net.feed.enemies.size};})));
  await page.waitForFunction(()=>!window.__perfScene.hooks.cena?.frame(performance.now()),null,{polling:50,timeout:10000}).catch(()=>{});
  await sleep(300);await page.screenshot({path:join(OUT,`${tag}-2-volta.png`)});
  // The hero next to him (a lab move), so the fight's shot shows both: his size against the hero's.
  const near=()=>page.evaluate(()=>{const net=window.__perfScene.hooks.net,b=[...net.feed.enemies.values()].find(e=>e.boss);if(b)for(const [dx,dy] of [[4,5],[0,0],[6,0],[0,6],[-5,4],[3,-4]])net.socket.send(JSON.stringify({t:'lab',to:{x:b.x+dx,y:b.y+dy}}));});
  await near();await sleep(1200);await near();await sleep(1200);console.log('probe-luta',JSON.stringify(await probe()));await page.screenshot({path:join(OUT,`${tag}-3-luta.png`)});
  console.log(tag,'chefão:',who,'erros da página:',errors.length,errors.slice(0,4).join(' | '));
}catch(e){
  console.log('falhou:',e.message.split('\n')[0],'erros:',globalThis.__errors?.slice(0,6));
  const st=await globalThis.__page?.evaluate(()=>{const s=document.querySelector('dialog.explore-shell');const sc=window.__perfScene;return {url:location.href,shell:!!s,loading:!!s?.querySelector('.explore-loading:not([hidden])'),loadingText:s?.querySelector('.explore-loading')?.textContent,actor:!!sc?.actor,phase:sc?.hooks?.net?.run?.phase,buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim().slice(0,24)).slice(0,12)};}).catch(e=>String(e));
  console.log('estado:',JSON.stringify(st));
  await globalThis.__page?.screenshot({path:join(OUT,`${tag}-erro.png`)}).catch(()=>{});process.exitCode=2;}
finally{await browser?.close();release?.();}
