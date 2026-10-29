// Prints do card hud-nao-pula: partida solo local de 0 a 60 s, sem andar, abrindo e fechando a engrenagem aos 30 s.
// TAP=1 (padrão): toques de dedo (page.tap); TAP=0: page.click (ponteiro de mouse, o que a auditoria fez).
// node hud-nao-pula-prints.mjs <dist> <saida> [telas: 390x844,844x390]
import {pathToFileURL} from 'node:url';
import {join,extname,normalize} from 'node:path';
import {existsSync,mkdirSync,writeFileSync,createReadStream,statSync} from 'node:fs';
import {createServer} from 'node:http';
const WT='D:/Gits/viagem-wt/hud-deitado',[DIST,OUT,TELAS='390x844,844x390']=process.argv.slice(2),PORT=Number(process.env.PORTA??4233),WPORT=8833;
const TAP=process.env.TAP!=='0';
mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const {startLocalWorker}=await import(pathToFileURL(join(WT,'scripts/local-worker.mjs')).href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
let worker,server,browser,release;
const state=page=>page.evaluate(()=>{
  const r=s=>{const e=document.querySelector(s);if(!e||e.hidden||!e.getClientRects().length)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};
  return {hud:document.querySelector('.rh')?.dataset.hud,input:document.querySelector('dialog.explore-shell')?.dataset.input,
    minimap:r('.rh-minimap'),top:r('.rh-top'),team:r('.rh-team'),camera:r('.explore-camera'),stick:r('.explore-stick'),phase:window.__perfScene?.hooks?.net?.run?.phase};
});
async function enter(page){
  await page.goto(`http://127.0.0.1:${PORT}/?perf=1`,{waitUntil:'commit',timeout:60000});
  page.on('pageerror',e=>console.log('pageerror',e.message.slice(0,200)));
  await page.waitForSelector('#confirm',{state:'attached',timeout:240000});await sleep(1500);
  // DOM clicks (no pointer events): the menu does not decide the input kind.
  for(let i=0;i<10;i++){
    await page.evaluate(()=>{const n=document.getElementById('nickname');if(n){n.value='Tia Cleide';n.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('confirm').click();});
    await sleep(800);
    if(await page.evaluate(()=>document.getElementById('confirmation')?.open))break;
  }
  await page.waitForFunction(()=>document.getElementById('confirmation')?.open,null,{timeout:10000});
  await page.evaluate(()=>document.getElementById('enter-island').click());
  await page.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])')&&window.__perfScene?.actor;},null,{timeout:240000});
}
const press=(page,selector)=>TAP?page.tap(selector,{timeout:5000}):page.click(selector,{timeout:5000});
try{
  worker=await startLocalWorker({port:WPORT,logPath:join(OUT,'worker.log')});
  server=createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';const f=normalize(join(DIST,p));
    let st;try{st=statSync(f);}catch{res.writeHead(404).end();return;}if(st.isDirectory()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'}[extname(f)]??'application/octet-stream','Content-Length':st.size,'Cache-Control':'no-cache'});createReadStream(f).pipe(res);});
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E2 hud-nao-pula'});
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-proxy-server']});
  const log={};
  for(const tela of TELAS.split(',')){
    const [width,height]=tela.split('x').map(Number);
    const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','0');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
    await ctx.route('**/multiplayer.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({endpoint:`http://127.0.0.1:${WPORT}`,protocol:41})}));
    const page=await ctx.newPage();
    await enter(page);
    const t0=Date.now(),at=async s=>{const w=t0+s*1000-Date.now();if(w>0)await sleep(w);};
    for(const s of [0,8,20,30,40,60]){
      await at(s);
      if(s===30){
        // The audit's step 7: the gear, then back to the game.
        await press(page,'.explore-config');await sleep(1200);
        await page.screenshot({path:join(OUT,`${tela}-30s-engrenagem.png`)});
        await press(page,'.explore-settings-close').catch(async()=>{await page.keyboard.press('Escape');});
        await sleep(800);
      }
      const file=join(OUT,`${tela}-${String(s).padStart(2,'0')}s.png`);await page.screenshot({path:file,timeout:20000});
      log[`${tela}-${s}s`]=await state(page);console.log(tela,s,JSON.stringify(log[`${tela}-${s}s`]));
    }
    await ctx.close();
  }
  writeFileSync(join(OUT,'estado.json'),JSON.stringify(log,null,1));
}finally{
  await browser?.close().catch(()=>{});release?.();server?.close?.();await worker?.stop?.();
}
