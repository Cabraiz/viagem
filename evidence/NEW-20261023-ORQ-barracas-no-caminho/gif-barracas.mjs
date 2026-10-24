#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-barracas-no-caminho, etapa 5: the barracas in the real game (local rooms Worker + this branch's
 * build), one solo match recorded, cut into three GIFs:
 *  1. passar-devagar: the hero walks across a barraca of a map row (the speed in and out of it is logged);
 *  2. pegar-colocar: Coletar by it, then the kit:barraca from the backpack and Construir near the Uno;
 *  3. fila-batendo: critters (lab spawn) on the far side of a row, the hero behind it: they stop and bash it.
 * The lab jump ({t:'lab',to}) puts the hero by the row (no ten-minute walk); everything else is the player's own taps.
 *
 *   node evidence/NEW-20261023-ORQ-barracas-no-caminho/gif-barracas.mjs <out-dir> [--celular]
 * Needs `npx vite build` first (dist/ served by scripts/serve.mjs). Ports: worker 8792, site 4202 (Executor-2). The heavy
 * slot (it runs a site, a Worker and a browser) and one browser slot. Run from the worktree root. ffmpeg on the PATH.
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,mkdirSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT=resolve(process.argv[2]??'gif-barracas'),PHONE=process.argv.includes('--celular'),TAG=PHONE?'celular':'pc';
mkdirSync(OUT,{recursive:true});
const {startLocalWorker}=await import(pathToFileURL(resolve('scripts/local-worker.mjs')).href);
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
let worker,site,browser,release;const log=[];const say=(...a)=>{const l=a.join(' ');log.push(l);console.log(l);};
const cuts=[];let t0=0;const now=()=>(Date.now()-t0)/1000;
try{
  worker=await startLocalWorker({port:8792,logPath:join(OUT,'worker.log')});
  say('worker',worker.endpoint);
  site=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore',windowsHide:true,env:{...process.env,PORT:'4202'}});
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:4202/')).ok)break;}catch{}await sleep(1000);}
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E2 gif barracas'});
  // swiftshader: with d3d11 the compositor froze mid-match (memory smoke-d3d11).
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  const size=PHONE?{width:412,height:915}:{width:1280,height:720};
  const ctx=await browser.newContext({viewport:size,deviceScaleFactor:1,serviceWorkers:'block',...(PHONE?{isMobile:true,hasTouch:true}:{}),recordVideo:{dir:OUT,size}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  const page=await ctx.newPage();t0=Date.now();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4202/?perf=1',{waitUntil:'load',timeout:180000});
  await page.waitForSelector('#confirm',{state:'attached',timeout:180000});
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));const c=document.getElementById('confirm');c.click();const n2=document.getElementById('nickname');n2.value='Tia Cleide';n2.dispatchEvent(new Event('input',{bubbles:true}));c.click();});
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:30000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:180000});
  for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}
  await page.waitForFunction(()=>window.__perfScene.hooks.net?.run?.phase==='combat',null,{timeout:120000});
  say('partida aberta',now().toFixed(1),'s');

  /** The hero, the car, the barracas and the critters in this client's last frame. */
  const world=()=>page.evaluate(()=>{const s=window.__perfScene,v=s.hooks.net?.feed.last,p=s.position;
    const st=v?.structures??[];
    return {me:{x:p.x,y:p.y},car:st.find(x=>x.kind==='quadradao'),barracas:st.filter(x=>x.kind==='barraca'&&x.hp>0).map(x=>({id:x.id,x:x.x,y:x.y,hp:x.hp})),
      enemies:(v?.enemies??[]).length,kit:(s.hooks.net.feed.players?.get?.(s.hooks.net.id)?.weapons??v?.players?.find(q=>q.id===s.hooks.net.id)?.weapons??[]).findIndex(w=>w.id==='kit:barraca')};});
  const lab=msg=>page.evaluate(m=>{const n=window.__perfScene.hooks.net;n.socket.send(JSON.stringify({t:'lab',round:n.run.round,...m}));},msg);
  /** A click LEAD px from the hero toward `to` (the game's tap-to-walk). */
  const clickToward=(to,lead=160)=>page.evaluate(([to,lead])=>{const s=window.__perfScene,cam=s.cameras.main,p=s.position,a=s.project(p),b=s.project(to);
    const hx=(a.x-cam.worldView.x)*cam.zoom,hy=(a.y-cam.worldView.y)*cam.zoom,dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    return {x:hx+dx/l*lead,y:hy+dy/l*lead};},[to,lead]).then(c=>page.mouse.click(c.x,c.y));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const walkTo=async(to,near=1,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const w=await world();if(dist(w.me,to)<=near)return true;await clickToward(to);await sleep(350);}return false;};

  // A row barraca near the Uno and the row's direction (its neighbours), the side toward the car.
  let w=await world();
  if(!w.car||!w.barracas.length)throw new Error('sem Uno ou sem barracas no frame');
  const rowOf=b=>w.barracas.filter(o=>o.id!==b.id&&dist(o,b)<2.4);
  const b=[...w.barracas].filter(x=>rowOf(x).length).sort((x,y)=>dist(x,w.car)-dist(y,w.car))[0]??w.barracas[0];
  const n=rowOf(b)[0];const along=n?{x:(n.x-b.x)/dist(n,b),y:(n.y-b.y)/dist(n,b)}:{x:1,y:0};
  let perp={x:-along.y,y:along.x};
  if((w.car.x-b.x)*perp.x+(w.car.y-b.y)*perp.y<0)perp={x:-perp.x,y:-perp.y};
  const side=k=>({x:b.x+perp.x*k,y:b.y+perp.y*k});
  say(`barraca ${b.id} a ${dist(b,w.car).toFixed(1)} u do Uno; fileira ${rowOf(b).length+1}+; lado do Uno = +perp`);

  // 1. passar-devagar: from the far side to the Uno's side, through the barraca; speed in 0.25 s steps.
  await lab({to:side(-3.5)});await sleep(1500);
  let c0=now();const speeds=[];let last=(await world()).me,lt=Date.now();
  for(let i=0;i<40;i++){
    await clickToward(side(4));await sleep(250);
    const me=(await world()).me,dt=(Date.now()-lt)/1000,inside=dist(me,b)<1.4;
    speeds.push({inside,v:dist(me,last)/dt});last=me;lt=Date.now();
    if(dist(me,side(4))<1)break;
  }
  const mean=xs=>xs.length?xs.reduce((a,v)=>a+v,0)/xs.length:0;
  say(`passar: fora ${mean(speeds.filter(s=>!s.inside&&s.v>.2).map(s=>s.v)).toFixed(2)} u/s, dentro ${mean(speeds.filter(s=>s.inside).map(s=>s.v)).toFixed(2)} u/s`);
  cuts.push({name:'passar-devagar',from:c0,to:now()+.5});

  // 2. pegar-colocar: Coletar by the barraca, then the kit from the backpack and Construir near the Uno.
  await sleep(800);c0=now();
  await walkTo(side(1.6),.8);
  const col=page.locator('.rh-tralha-coletar');
  await col.waitFor({state:'visible',timeout:8000}).catch(()=>say('Coletar não apareceu'));
  await col.dispatchEvent('pointerdown').catch(()=>{});
  await sleep(2400);
  w=await world();say(`coleta: kit no slot ${w.kit}; ${w.barracas.some(x=>x.id===b.id)?'a barraca AINDA está lá':'a barraca saiu do mapa'}`);
  const drop={x:w.car.x+(b.x-w.car.x)/dist(b,w.car)*6,y:w.car.y+(b.y-w.car.y)/dist(b,w.car)*6};
  await walkTo(drop,1,15000);
  if(w.kit>=0){
    await page.locator(`.rh-inv-slot[data-slot="${w.kit}"]`).click().catch(()=>say('slot do kit não clicou'));await sleep(900);
    const build=page.getByRole('button',{name:/^Construir/});
    await build.first().dispatchEvent('pointerdown').catch(()=>say('Construir não achado'));
    await build.first().dispatchEvent('pointerup').catch(()=>{});
    await sleep(1800);
    const after=await world();
    say(`colocar: barracas a ≤ 9 u do Uno ${after.barracas.filter(x=>dist(x,after.car)<=9).length}; kit ${after.kit>=0?'ainda na mochila':'gasto'}`);
  }
  await page.screenshot({path:join(OUT,`colocou-${TAG}.png`),timeout:10000}).catch(()=>say('print falhou'));
  cuts.push({name:'pegar-colocar',from:c0,to:now()+.5});

  // 3. fila-batendo: another row barraca; the hero behind it (Uno side), critters on the far side.
  w=await world();
  const b2=[...w.barracas].filter(x=>rowOf(x).length&&x.id!==b.id).sort((x,y)=>dist(x,w.car)-dist(y,w.car))[0]??b;
  const n2=w.barracas.find(o=>o.id!==b2.id&&dist(o,b2)<2.4);const al2=n2?{x:(n2.x-b2.x)/dist(n2,b2),y:(n2.y-b2.y)/dist(n2,b2)}:along;
  let p2={x:-al2.y,y:al2.x};if((w.car.x-b2.x)*p2.x+(w.car.y-b2.y)*p2.y<0)p2={x:-p2.x,y:-p2.y};
  await lab({to:{x:b2.x+p2.x*3,y:b2.y+p2.y*3}});await sleep(1200);c0=now();
  for(let i=0;i<6;i++)await lab({spawn:{x:b2.x-p2.x*(5+i%2)+al2.x*(i-2.5)*.9,y:b2.y-p2.y*(5+i%2)+al2.y*(i-2.5)*.9},kind:i%3?'bebado':'tio-pave'});
  const hp0=w.barracas.filter(x=>dist(x,b2)<6).reduce((a,x)=>a+x.hp,0);
  for(let i=0;i<12;i++){await sleep(1000);}
  const w3=await world();
  say(`fila: vida das barracas perto ${hp0} → ${w3.barracas.filter(x=>dist(x,b2)<6).reduce((a,x)=>a+x.hp,0)}; bichos no frame ${w3.enemies}`);
  cuts.push({name:'fila-batendo',from:c0,to:now()});
  say('erros:',errors.length,errors.slice(0,3).join(' | '));
  await page.close();await ctx.close();
  const vid=readdirSync(OUT).find(f=>f.startsWith('page@')&&f.endsWith('.webm'));
  if(vid){
    const full=join(OUT,`barracas-${TAG}.webm`);renameSync(join(OUT,vid),full);
    for(const c of cuts){
      const gif=join(OUT,`${c.name}-${TAG}.gif`),width=PHONE?360:640;
      execFileSync('ffmpeg',['-y','-loglevel','error','-ss',c.from.toFixed(2),'-t',(c.to-c.from).toFixed(2),'-i',full,'-vf',
        `fps=12,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`,gif]);
      say(`gif ${gif} (${(c.to-c.from).toFixed(1)} s)`);
    }
  }
}finally{
  writeFileSync(join(OUT,`log-${TAG}.txt`),log.join('\n')+'\n');
  await browser?.close().catch(()=>{});release?.();
  site?.kill();await worker?.stop().catch(()=>{});
}
