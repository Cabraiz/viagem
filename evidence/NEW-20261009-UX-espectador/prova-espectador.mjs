// UX-espectador proof: a local room + 2 bots, the local player bleeds out (lab down, 30 s), then the torcida bar:
// prints at 390x844 and 844x390, ‹ › cycling, the chinelo in flight, the leave confirmation; CDP counts what the page
// sends to the room while out (no move input may leave). Usage: node prova-espectador.mjs <outDir> [pc]
// pc: 1280x720 mouse (no portrait/landscape turn).
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const out=process.argv[2],pc=process.argv[3]==='pc';mkdirSync(out,{recursive:true});
const web='http://127.0.0.1:4202',rooms='http://127.0.0.1:8802';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const report={errors:[],console:[],sent:[],steps:[]};
const created=await fetch(rooms+'/rooms',{method:'POST',headers:{Origin:web}});if(created.status!==201)throw new Error('room '+created.status);
const {code}=await created.json();log('room',code);
const browser=await chromium.launch({args:['--force-device-scale-factor=1']});
try{
  const ctx=await browser.newContext(pc?{viewport:{width:1280,height:720},deviceScaleFactor:1}:{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const press=sel=>pc?page.click(sel):page.tap(sel);
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  const page=await ctx.newPage();
  page.on('pageerror',e=>{report.errors.push(e.message);log('pageerror',e.message);});
  page.on('console',m=>{if(m.type()==='error')report.console.push(m.text());});
  const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');
  let counting=false;
  cdp.on('Network.webSocketFrameSent',e=>{if(!counting)return;const f=e.response;
    let t='?';if(f.opcode===1){try{const m=JSON.parse(f.payloadData);t=m.t??('sem-t:'+f.payloadData.slice(0,80));}catch{t='text?';}}else t='binary';report.sent.push(t);});
  await page.goto(web+'/');
  const joined=await page.evaluate(async([code,rooms])=>{
    const {CoopClient}=await import('/src/client/net/client.ts');const {classes}=await import('/src/rules/classes.ts');
    const c=new CoopClient(rooms,code,'Tia Cleide','cidadao-comum');window.__net=c;
    const {loadCityManifest}=await import('/src/client/net/city-asset-loader.ts');c.cityManifest=loadCityManifest;c.cityRef=await loadCityManifest();
    try{await c.join();}catch(e){return String(e.message);}
    const {openExploration}=await import('/src/client/explore.ts');const {mountWaitingRoom}=await import('/src/client/lobby.ts');
    void openExploration(classes.find(k=>k.id==='cidadao-comum'),'Tia Cleide',c);
    const layout=document.querySelector('dialog.explore-shell .explore-layout');if(layout)mountWaitingRoom(layout,c);
    return 'ok';
  },[code,rooms]);
  if(joined!=='ok')throw new Error(joined);
  await page.waitForFunction(()=>window.__island?.scene?.sys?.isActive?.(),null,{timeout:120000});
  for(let i=0;i<2;i++){await page.evaluate(()=>window.__net.addBot());await wait(500);}
  await page.waitForFunction(()=>window.__net.run?.members?.length===3,null,{timeout:20000});
  await page.evaluate(()=>window.__net.ready(true));
  await page.waitForFunction(()=>window.__net.run?.phase==='combat',null,{timeout:60000});
  log('combat');await wait(4000);
  // Down until out: a bot may pick us up, so knock again while standing (max 150 s).
  const t0=Date.now();
  while(Date.now()-t0<150000){
    const st=await page.evaluate(()=>{const s=window.__net.feed.players.get(window.__net.id);return {down:!!s?.downed,out:!!s?.eliminated,phase:window.__net.run?.phase};});
    if(st.out||st.phase!=='combat')break;
    if(!st.down)await page.evaluate(()=>window.__net.socket.send(JSON.stringify({t:'lab',down:true,round:window.__net.run.round})));
    await wait(2000);
  }
  const phase=await page.evaluate(()=>window.__net.run?.phase);log('out? phase',phase);
  await page.waitForSelector('.spect:not([hidden])',{timeout:10000});
  await wait(3500); // the "Você tá fora" banner settles
  counting=true;
  const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`});report.steps.push(name);log('shot',name);};
  const who=()=>page.evaluate(()=>({bar:document.querySelector('.spect-nome')?.textContent,watching:window.__island?.scene?.watching?.()?.id,
    arrows:!document.querySelector('.spect-seta')?.disabled,alvo:window.__island?.scene?.watchedScreen?.(),tela:[innerWidth,innerHeight],stick:getComputedStyle(document.querySelector('.explore-stick')).visibility,
    banner:document.querySelector('.rh-revive, .rh-banner')?.textContent??null,
    canvas:(c=>c&&[c.width,c.height,c.clientWidth,c.clientHeight])(document.querySelector('dialog.explore-shell canvas')),cam:(c=>c&&[c.width,c.height])(window.__island?.scene?.cameras?.main),
    feet:window.__island?.scene?.allyFeet?.length,img:(s=>{const o=s?.remoteActors?.get(s.watchId)?.image;if(!o)return null;const cam=s.cameras.main;return {vis:o.visible,a:o.alpha,depth:o.depth,key:o.texture.key,frame:o.frame?.name,w:o.displayWidth,h:o.displayHeight,scr:[(o.x-cam.worldView.x)*cam.zoom,(o.y-cam.worldView.y)*cam.zoom],active:o.active,parent:!!o.displayList,heroDepth:s.actor?.depth};})(window.__island?.scene),sc:(g=>g&&{parent:g.scale.parent?.className,pr:(r=>[r.width,r.height])(g.scale.parent.getBoundingClientRect()),ps:[g.scale.parentSize.width,g.scale.parentSize.height],gs:[g.scale.gameSize.width,g.scale.gameSize.height],loop:g.loop.running,hidden:document.hidden})(window.__island?.scene?.game),others:[...window.__net.players.values()].filter(p=>p.id!==window.__net.id).map(p=>({id:p.id,online:p.online,spect:p.spectator,hp:p.hp}))}));
  report.before=await who();await shot('01-retrato-barra');
  await press('.spect-seta[data-dir="1"]');await wait(900);report.afterNext=await who();await shot('02-retrato-proximo');
  await press('.spect-seta[data-dir="-1"]');await wait(900);report.afterPrev=await who();
  await press('.spect-chinelo');await wait(330);await shot('03-retrato-chinelo-voando');
  await wait(500);await shot('04-retrato-chinelo-caiu');
  await press('.spect-sair');await wait(200);await shot('05-retrato-sair-confirma');
  report.leaveText=await page.evaluate(()=>document.querySelector('.spect-sair-texto')?.textContent);
  await wait(3300);report.leaveReset=await page.evaluate(()=>document.querySelector('.spect-sair-texto')?.textContent);
  if(!pc){await page.setViewportSize({width:844,height:390});await wait(1500);} // the phone turned mid-match
    await shot('06-paisagem-barra');
  await press('.spect-seta[data-dir="1"]');await wait(900);report.landNext=await who();
  await press('.spect-chinelo');await wait(330);await shot('07-paisagem-chinelo-voando');
  await wait(1200);
  counting=false;
  // The confirmed leave: two taps close the shell and the room drops us.
  await press('.spect-sair');await wait(150);await press('.spect-sair');await wait(1500);
  report.afterLeave=await page.evaluate(()=>({shell:!!document.querySelector('dialog.explore-shell'),socket:window.__net.socket?.readyState}));
  await shot('08-depois-de-sair');
}finally{
  writeFileSync(`${out}/relatorio.json`,JSON.stringify(report,null,1));
  await browser.close();
}
const kinds=report.sent.reduce((m,t)=>(m[t]=(m[t]??0)+1,m),{});
console.log(JSON.stringify({errors:report.errors,consoleErrors:report.console.length,sentWhileOut:kinds,before:report.before,afterNext:report.afterNext,afterPrev:report.afterPrev,landNext:report.landNext,leave:[report.leaveText,report.leaveReset],afterLeave:report.afterLeave},null,1));
