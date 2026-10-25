#!/usr/bin/env node
/**
 * Card NEW-20261025-ORQ-torre-limite-rebocar-sem-arma: every print of the card in one heavy slot.
 *  1. Towers (etapa 3/4): the city sandbox (?sandbox=cidade&mapa=real) with the real hero, each kit's tower (torres=1&kit=X:
 *     its obra + the "pôr torre" ghost) and the ready ones (torres=lista&tipos=X), phone size.
 *  2. The match (etapas 1 e 2), phone size, recorded: the start (empty hands), the hero walks to the Uno's rope end, the
 *     action button turns "Rebocar", a tap takes the rope and he walks away pulling the car.
 *
 *   node evidence/NEW-20261025-ORQ-torre-limite-rebocar-sem-arma/prints.mjs <out-dir> [--so torres|partida]
 * Needs `npx vite build` first (dist/ served by scripts/serve.mjs). Ports: worker 8790, site 4204 (Executor-4). One
 * browser slot (vaga.mjs). Run from the worktree root, inside the heavy slot (pesado.mjs).
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,mkdirSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'prints'),ONLY=arg('so','');
mkdirSync(OUT,{recursive:true});
const {startLocalWorker}=await import(pathToFileURL(resolve('scripts/local-worker.mjs')).href);
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
const KINDS=['vigia-do-predio','vigias-armados','atiradores-do-telhado','ninho-de-metralhadora','guarnicao-do-predio','ninho-do-sniper',
  'equipe-antimaterial','rojao-de-festa','morteiro','lanca-foguetes','obuseiro','holofote','arame-e-sirene','antiaerea-quadrupla','posto-de-radar'];
const PHONE={width:412,height:915};
let worker,site,browser,release;const log=[];const say=(...a)=>{const l=a.join(' ');log.push(l);console.log(l);};
try{
  site=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore',windowsHide:true,env:{...process.env,PORT:'4204'}});
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:4204/')).ok)break;}catch{}await sleep(1000);}
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E4 torre-limite prints'});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  if(ONLY!=='partida'){
    const ctx=await browser.newContext({viewport:PHONE,deviceScaleFactor:1,serviceWorkers:'block',isMobile:true,hasTouch:true});
    const page=await ctx.newPage();
    for(const kind of KINDS){
      for(const [name,q] of [['obra-fantasma',`torres=1&kit=${kind}`],['pronta',`torres=lista&tipos=${kind}`]]){
        await page.goto(`http://127.0.0.1:4204/?sandbox=cidade&mapa=real&hero=100,124&${q}`,{waitUntil:'load',timeout:120000});
        await page.waitForFunction(()=>!!window.__cidade,null,{timeout:120000}).catch(()=>say(kind,name,'sem __cidade'));
        await sleep(2500);
        await page.screenshot({path:join(OUT,`torre-${kind}-${name}.png`),timeout:15000}).catch(()=>say(kind,name,'print falhou'));
      }
      say('torre',kind,'ok');
    }
    await page.close();await ctx.close();
  }
  if(ONLY!=='torres'){
    worker=await startLocalWorker({port:8790,logPath:join(OUT,'worker.log')});
    say('worker',worker.endpoint);
    const ctx=await browser.newContext({viewport:PHONE,deviceScaleFactor:1,serviceWorkers:'block',isMobile:true,hasTouch:true,recordVideo:{dir:OUT,size:PHONE}});
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
    await sleep(1500);
    const state=()=>page.evaluate(()=>{const s=window.__perfScene,net=s.hooks.net,v=net?.feed.last,p=s.position,me=v?.players.find(q=>q.id===net.id);
      const car=v?.objective?.car,btn=document.getElementById('coop-attack');
      const h=car?.heading??0,d=1.3+1.6,tip=car?{x:car.x+Math.cos(h)*d,y:car.y+Math.sin(h)*d}:undefined;
      return {weapons:me?.weapons?.map(w=>w.id)??[],hand:me?.hand,car:car?{x:car.x,y:car.y,heading:h,rope:car.rope,me:car.rope===net.id}:undefined,tip,
        dTip:tip?Math.hypot(tip.x-p.x,tip.y-p.y):undefined,word:btn?.querySelector('.skillbtn-word')?.textContent,tow:btn?.dataset.tow};});
    const s0=await state();
    say('início:',JSON.stringify({armas:s0.weapons,mao:s0.hand,botao:s0.word}));
    await page.screenshot({path:join(OUT,'inicio-sem-arma.png'),timeout:15000});
    if(!s0.car)say('sem o Uno nesta partida: pulo a corda');
    else{
      // Walk to the rope's end: clicks 160 CSS px toward it, until within 1 u.
      const aim=(to)=>page.evaluate(to=>{const s=window.__perfScene,cam=s.cameras.main,p=s.position;const a=s.project(p),b=s.project(to);
        const hx=(a.x-cam.worldView.x)*cam.zoom,hy=(a.y-cam.worldView.y)*cam.zoom,dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1,k=Math.min(160,l*cam.zoom);
        return {x:hx+dx/l*k,y:hy+dy/l*k};},to);
      for(let i=0;i<60;i++){const s=await state();if(s.dTip<1)break;const t=await aim(s.tip);await page.mouse.click(t.x,t.y);await sleep(400);}
      await sleep(800);
      const s1=await state();
      say('na ponta:',JSON.stringify({d:s1.dTip?.toFixed(2),botao:s1.word,tow:s1.tow}));
      await page.screenshot({path:join(OUT,'ponta-rebocar.png'),timeout:15000});
      await page.locator('#coop-attack').tap().catch(()=>page.locator('#coop-attack').click());
      await sleep(600);
      const s2=await state();
      say('depois do toque:',JSON.stringify({corda:s2.car?.me,botao:s2.word,tow:s2.tow}));
      // Walk away from the bumper along the nose: hold the pointer ahead for ~5 s.
      const ahead={x:s2.car.x+Math.cos(s2.car.heading)*12,y:s2.car.y+Math.sin(s2.car.heading)*12};
      const x0=s2.car.x,y0=s2.car.y;
      for(let i=0;i<14;i++){const t=await aim(ahead);await page.mouse.click(t.x,t.y);await sleep(400);if(i===8)await page.screenshot({path:join(OUT,'puxando.png'),timeout:15000});}
      const s3=await state();
      say('puxando:',JSON.stringify({corda:s3.car?.me,andou:Math.hypot(s3.car.x-x0,s3.car.y-y0).toFixed(2),botao:s3.word}));
    }
    await sleep(800);
    say('erros:',errors.length,errors.slice(0,3).join(' | '));
    await page.close();await ctx.close();
    const vid=readdirSync(OUT).find(f=>f.startsWith('page@')&&f.endsWith('.webm'));if(vid)renameSync(join(OUT,vid),join(OUT,'corda-celular.webm'));
  }
}finally{
  writeFileSync(join(OUT,'log.txt'),log.join('\n')+'\n');
  await browser?.close().catch(()=>{});release?.();
  site?.kill();await worker?.stop().catch(()=>{});
}
