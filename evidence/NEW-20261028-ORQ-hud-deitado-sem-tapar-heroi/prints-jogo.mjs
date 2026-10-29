// Prints do card hud-deitado-sem-tapar-heroi numa partida solo local de verdade: worker + build estático do worktree.
// node hud-deitado-jogo.mjs <dist> <saida> [telas: 844x390,640x296,1335x620,390x844]
import {pathToFileURL} from 'node:url';
import {join,extname,normalize} from 'node:path';
import {existsSync,mkdirSync,writeFileSync,createReadStream,statSync} from 'node:fs';
import {createServer} from 'node:http';
const WT='D:/Gits/viagem-wt/hud-deitado',[DIST,OUT,TELAS='844x390,640x296,1335x620,390x844']=process.argv.slice(2),PORT=4232,WPORT=8832;
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const {startLocalWorker}=await import(pathToFileURL(join(WT,'scripts/local-worker.mjs')).href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
let worker,server,browser,release;
const fearOf=page=>page.evaluate(()=>{const s=window.__perfScene,n=s?.hooks?.net;const me=n?.feed?.players?.get(n.id);return {fear:(me?.fear??0)*60,downed:!!me?.downed,pos:s?.position};});
// What covers what: the hero's drawn box and the HUD's rows around it.
const boxes=page=>page.evaluate(()=>{
  const out={hero:window.__perfScene?.heroScreenRect?.(),hud:document.querySelector('.rh')?.dataset.hud};
  const r=e=>{const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};
  for(const s of ['.rh-minerva','.rh-missao','.rh-missao-grande','.rh-medo','.rh-objetivo','.rh-coach','.rh-chaveiro-motivo','.rh-stack','.rh-top','.rh-minimap','.explore-stick','#coop-attack'])
    out[s]=[...document.querySelectorAll(s)].filter(e=>!e.hidden&&e.getClientRects().length&&getComputedStyle(e).display!=='none').map(e=>[e.textContent.trim().slice(0,32),...r(e)]);
  return out;});
async function leave(page){
  for(const keys of [['w'],['d'],['s'],['a'],['w','d'],['s','a']]){
    for(const k of keys)await page.keyboard.down(k);
    const t0=Date.now();let f;
    while(Date.now()-t0<4000){f=await fearOf(page);if(f.fear>0.3)break;await sleep(200);}
    await sleep(600);for(const k of keys)await page.keyboard.up(k);
    if((await fearOf(page)).fear>0)return;
  }
  throw new Error('não saiu de perto do Uno');
}
async function waitFear(page,seconds,max=240000){
  const t0=Date.now();
  for(;;){const f=await fearOf(page);if(f.fear>=seconds)return f;if(Date.now()-t0>max)throw new Error(`fear ${f.fear} < ${seconds}`);await sleep(150);}
}
async function enter(page){
  await page.goto(`http://127.0.0.1:${PORT}/?perf=1`,{waitUntil:'commit',timeout:60000});
  page.on('pageerror',e=>console.log('pageerror',e.message.slice(0,200)));
  await page.waitForSelector('#confirm',{state:'attached',timeout:240000});await sleep(1500);
  for(let i=0;i<10;i++){
    await page.evaluate(()=>{const n=document.getElementById('nickname');if(n){n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('confirm').click();});
    await sleep(800);
    if(await page.evaluate(()=>document.getElementById('confirmation')?.open))break;
  }
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:10000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:240000});
}
const fresh=page=>page.waitForFunction(()=>!window.__perfScene?.catchingUp,null,{timeout:20000}).catch(()=>{}).then(()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))).catch(()=>{});
const shot=async(page,path)=>{await fresh(page);await page.screenshot({path,timeout:20000});const b=await boxes(page);console.log('print',path,JSON.stringify(b));return b;};
const clear=async page=>{for(let i=0;i<4;i++){const b=page.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(300);}else break;}};
async function context(size,mobile){
  const ctx=await browser.newContext({viewport:size,deviceScaleFactor:1,...mobile?{isMobile:true,hasTouch:true}:{}});
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({endpoint:`http://127.0.0.1:${WPORT}`,protocol:41})}));
  return ctx;
}
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.m4a':'audio/mp4','.webm':'audio/webm','.wasm':'application/wasm','.bin':'application/octet-stream'};
try{
  worker=await startLocalWorker({port:WPORT,logPath:join(OUT,'worker.log')});
  console.log('worker',worker.endpoint);
  server=createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';const f=normalize(join(DIST,p));
    let st;try{st=statSync(f);}catch{res.writeHead(404).end();return;}if(st.isDirectory()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':TYPES[extname(f)]??'application/octet-stream','Content-Length':st.size,'Cache-Control':'no-cache'});createReadStream(f).pipe(res);});
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E2 hud-deitado jogo'});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-proxy-server']});
  const log={};
  for(const tela of TELAS.split(',')){
    const [width,height]=tela.split('x').map(Number),ctx=await context({width,height},Math.min(width,height)<=600||process.env.TOQUE==='1'),page=await ctx.newPage();
    await enter(page);await clear(page);await leave(page);
    // WASD is a game key (InputKindWatch → mesa); a phone walks with the stick. A touch pointerdown brings the phone's HUD back.
    if(Math.min(width,height)<=600||process.env.TOQUE==='1'){await page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',bubbles:true})));await sleep(500);}
    console.log(tela,'data-hud',await page.evaluate(()=>document.querySelector('.rh')?.dataset.hud));
    // The dark pressing (fear ≥ .5, 30 s alone): "Volte ao Uno!" big, then the small row; the Minerva's clock still up.
    await waitFear(page,30.6);log[`${tela}-1-faixa`]=await shot(page,join(OUT,`${tela}-1-faixa.png`));
    await waitFear(page,36);log[`${tela}-2-linha`]=await shot(page,join(OUT,`${tela}-2-linha.png`));
    // The last stretch: the hero's own line over the head.
    await waitFear(page,50.4);log[`${tela}-3-fala`]=await shot(page,join(OUT,`${tela}-3-fala.png`));
    await ctx.close();
  }
  writeFileSync(join(OUT,'caixas.json'),JSON.stringify(log,null,1));
}finally{
  await browser?.close().catch(()=>{});release?.();
  server?.close?.();
  await worker?.stop?.();
}
