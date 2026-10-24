#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 4: videos of the chefão's arrival and fight in the real game (this
 * branch's vite dev server + the local rooms Worker). One or two players (two pages of one browser: the 2nd joins the
 * 1st's room by its code); {t:'lab',chefao:true} calls him once his art is in; each page is recorded and the clip from
 * the call on is cut out (ffmpeg); with two players both clips side by side, so both cameras show the same arrival.
 *
 *   node evidence/NEW-20261023-ORQ-boss-fim-onda-1/video-cena.mjs <out-prefix> [--celular] [--dois] [--segundos 24]
 */
import {pathToFileURL} from 'node:url';import {join,resolve,dirname} from 'node:path';import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:d;};
const OUT=resolve(process.argv[2]??'video'),PHONE=process.argv.includes('--celular'),TWO=process.argv.includes('--dois'),SECS=Number(arg('segundos',24));
const VITE=arg('vite','http://127.0.0.1:4201/'),SALAS=arg('salas','http://127.0.0.1:8788');
const VIDEO=`${OUT}-bruto`;mkdirSync(VIDEO,{recursive:true});mkdirSync(dirname(OUT),{recursive:true});
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;let browser,release;const opened=[];
const size=PHONE?{width:390,height:844}:{width:1280,height:720};
const ids=['o-grande-credor','dj-do-fim-do-mundo','mapinguari-do-shopping','boitata-de-sacolinha'];
async function open(name){
  const ctx=await browser.newContext({viewport:size,deviceScaleFactor:1,...(PHONE?{isMobile:true,hasTouch:true}:{}),serviceWorkers:'block',...(PHONE?{}:{recordVideo:{dir:VIDEO,size}})});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));localStorage.removeItem('viagem.chefao.cenas');}catch{}});
  await ctx.route('**/multiplayer.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({endpoint:SALAS})}));
  const page=await ctx.newPage();opened.push(page);const born=Date.now();page.__errors=[];
  page.on('pageerror',e=>page.__errors.push(`${e.message} @ ${(e.stack??'').split('\n').slice(1,4).map(l=>l.trim()).join(' < ')}`));page.on('console',m=>{if(m.type()==='error')page.__errors.push(m.text());});
  await page.goto(`${VITE}?perf=1`,{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(n=>{const i=document.getElementById('nickname');i.value=n;i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('confirm').click();},name);
  // On a loaded PC the first BORA click can land before the menu listens: click again until the play dialog is up.
  const bora=page.getByRole('button',{name:/BORA/i}),dialog=page.getByRole('button',{name:/Jogar sozinho|Jogar com amigos/i}).first();
  for(let i=0;i<12&&!await dialog.isVisible().catch(()=>false);i++){await sleep(2000);if(await bora.count())await bora.first().click({timeout:10000}).catch(()=>{});}
  await sleep(1500);
  return {ctx,page,born};
}
const inMatch=p=>p.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:240000});
const skipTips=async p=>{for(let i=0;i<4;i++){const b=p.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(300);}else break;}};
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:`E1 boss-onda-1 video ${PHONE?'celular':'pc'} ${TWO?2:1}`});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required',...(PHONE?[`--window-size=${size.width},${size.height}`]:[])]});
  const A=await open('Tia Cleide');let B;
  if(!TWO){
    const solo=A.page.getByRole('button',{name:/Jogar sozinho/i});await solo.first().click({timeout:20000});
  }else{
    await A.page.getByRole('button',{name:/Jogar com amigos/i}).first().click({timeout:20000});
    await A.page.locator('#create-room').click({timeout:60000});
    await A.page.waitForFunction(()=>!!window.__perfScene?.hooks?.net?.code,null,{timeout:120000});
    const code=await A.page.evaluate(()=>window.__perfScene.hooks.net.code);
    B=await open('Zé do Pix');
    await B.page.getByRole('button',{name:/Jogar com amigos/i}).first().click({timeout:20000});
    await B.page.locator('#room-code').fill(code,{timeout:60000});
    await B.page.getByRole('button',{name:/Entrar na sala/i}).click({timeout:20000});
    await inMatch(A.page);await inMatch(B.page);
    for(const P of [A,B])await P.page.evaluate(()=>window.__perfScene.hooks.net.ready(true));
  }
  const pages=[A,B].filter(Boolean);
  for(const P of pages){await inMatch(P.page);await P.page.waitForFunction(()=>window.__perfScene.hooks.net.run?.phase==='combat',null,{timeout:240000});await skipTips(P.page);}
  // His art in on every page first (the elenco names him: in a real run he comes minutes in, long after it loaded).
  for(const P of pages)await P.page.waitForFunction(ids=>{const s=window.__perfScene,id=(s.hooks.net.elenco??[]).find(i=>ids.includes(i));return !!id&&s.textures.exists(`art:enemy:${id}:idle`);},ids,{timeout:180000});
  // Phone: Playwright's recorder squeezes the isMobile page into a corner of the frame (grey around), so the phone
  // clip is built from the page's own screencast frames (CDP, no resize; screenshots back to back only reach ~1 q/s).
  const shots=pages.map(()=>[]),sizes=pages.map(()=>new Set());
  const casts=PHONE?await Promise.all(pages.map(async(P,k)=>{const dir=join(VIDEO,`j${k+1}`);mkdirSync(dir,{recursive:true});
    const cdp=await P.ctx.newCDPSession(P.page);
    cdp.on('Page.screencastFrame',f=>{const at=Date.now(),file=join(dir,`${at}.jpg`);writeFileSync(file,Buffer.from(f.data,'base64'));shots[k].push({at,file});
      sizes[k].add(`${f.metadata.deviceWidth}x${f.metadata.deviceHeight}`);cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});});
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,everyNthFrame:1});return cdp;})):[];
  await sleep(2000);
  const called=Date.now();
  await A.page.evaluate(()=>window.__perfScene.hooks.net.socket.send(JSON.stringify({t:'lab',chefao:true})));
  for(const P of pages)await P.page.waitForFunction(()=>!!window.__perfScene.hooks.net.run?.cena||!!window.__perfScene.hooks.cena?.frame(performance.now()),null,{polling:20,timeout:20000});
  const who=await A.page.evaluate(()=>window.__perfScene.hooks.net.run?.cena?.who);
  await sleep(4500);
  // The fight: every hero next to him (lab moves), the attack held (Space on a PC, the button on a phone).
  const near=P=>P.page.evaluate(()=>{const net=window.__perfScene.hooks.net,b=[...net.feed.enemies.values()].find(e=>e.boss);if(b)for(const [dx,dy] of [[2.6,2.2],[2.2,2.6],[3.2,0],[0,3.2]])net.socket.send(JSON.stringify({t:'lab',to:{x:b.x+dx,y:b.y+dy}}));});
  for(const P of pages)await near(P);
  const until=called+SECS*1000;let beat=0;
  while(Date.now()<until){
    for(const P of pages){
      if(PHONE){const b=P.page.locator('#coop-attack');await b.dispatchEvent('pointerdown').catch(()=>{});}
      else await P.page.keyboard.down('Space').catch(()=>{});
    }
    await sleep(1500);
    for(const P of pages){
      if(PHONE)await P.page.locator('#coop-attack').dispatchEvent('pointerup').catch(()=>{});
      else await P.page.keyboard.up('Space').catch(()=>{});
      if(++beat%3===0)await near(P);
    }
  }
  const hp=await A.page.evaluate(()=>{const b=[...window.__perfScene.hooks.net.feed.enemies.values()].find(e=>e.boss);return b?`${Math.round(b.hp)}/${b.maxHp}`:'caiu';});
  await Promise.all(casts.map(c=>c.send('Page.stopScreencast').catch(()=>{})));
  if(PHONE)console.log('quadros do screencast (tela):',sizes.map(s=>[...s].join(',')).join(' | '));
  const clips=[];
  for(const [k,P] of pages.entries()){
    const clip=`${OUT}${pages.length>1?`-j${k+1}`:''}.mp4`;
    if(PHONE){
      const s=shots[k],list=join(VIDEO,`j${k+1}.txt`);
      const fwd=f=>f.replaceAll('\\','/');
      writeFileSync(list,s.map((x,i)=>`file '${fwd(x.file)}'\nduration ${(((s[i+1]?.at??x.at+100)-x.at)/1000).toFixed(3)}`).join('\n')+`\nfile '${fwd(s.at(-1).file)}'\n`);
      execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',list,'-vf','fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-crf','26','-preset','veryfast',clip]);
      await P.ctx.close();clips.push(clip);
      console.log('jogador',k+1,'quadros:',s.length,`(${(s.length/((s.at(-1).at-s[0].at)/1000)).toFixed(1)} q/s)`,'erros da página:',P.page.__errors.length,P.page.__errors.slice(0,3).join(' | '));
      continue;
    }
    // Under load the recorder drops time (its file is shorter than the wall clock): cut counting back from its end.
    const video=P.page.video(),ended=Date.now();await P.ctx.close();const raw=await video.path();
    const dur=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',raw]).toString().trim());
    const from=Math.max(0,Math.min((called-P.born)/1000,dur-(ended-called)/1000)-1.5);
    execFileSync('ffmpeg',['-y','-v','error','-ss',from.toFixed(2),'-i',raw,'-t',String(SECS+1.5),'-c:v','libx264','-pix_fmt','yuv420p','-crf','26','-preset','veryfast',clip]);
    clips.push(clip);console.log('jogador',k+1,'erros da página:',P.page.__errors.length,P.page.__errors.slice(0,3).join(' | '));
  }
  if(clips.length>1)execFileSync('ffmpeg',['-y','-v','error','-i',clips[0],'-i',clips[1],'-filter_complex','hstack=inputs=2','-c:v','libx264','-pix_fmt','yuv420p','-crf','26','-preset','veryfast',`${OUT}.mp4`]);
  console.log('vídeo:',`${OUT}.mp4`,'chefão:',who,'vida no fim:',hp);
}catch(e){console.log('falhou:',e.message.split('\n')[0]);process.exitCode=2;for(const [k,p] of opened.entries())await p.screenshot({path:`${OUT}-falhou-${k+1}.png`}).catch(()=>{});}
finally{await browser?.close();release?.();}
