// morto-anda-pelo-mapa proof: a local room + 2 bots, the local player bleeds out (lab down), then the ghost walks:
// phone 390x844 drags the stick (CDP touch), PC 1280x720 holds WASD and clicks the ground; ‹ › pins a friend, the thumbs
// let go again. Frames for the GIF in <out>/frames; CDP counts what the page sends to the room while out.
// Usage: node prova-fantasma.mjs <outDir> [pc]   (vite :4207, wrangler :8807)
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import('file:///D:/Gits/viagem-tools/node_modules/playwright/index.mjs');
const out=process.argv[2],pc=process.argv[3]==='pc';mkdirSync(`${out}/frames`,{recursive:true});
const web='http://127.0.0.1:4207',rooms='http://127.0.0.1:8807';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const report={errors:[],console:[],sent:[],steps:[],states:{}};
const created=await fetch(rooms+'/rooms',{method:'POST',headers:{Origin:web}});if(created.status!==201)throw new Error('room '+created.status);
const {code}=await created.json();log('room',code);
const browser=await chromium.launch({args:['--force-device-scale-factor=1']});
let frame=0;
try{
  const ctx=await browser.newContext(pc?{viewport:{width:1280,height:720},deviceScaleFactor:1}:{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
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
  const t0=Date.now();
  while(Date.now()-t0<150000){
    const st=await page.evaluate(()=>{const s=window.__net.feed.players.get(window.__net.id);return {down:!!s?.downed,out:!!s?.eliminated,phase:window.__net.run?.phase};});
    if(st.out||st.phase!=='combat')break;
    if(!st.down)await page.evaluate(()=>window.__net.socket.send(JSON.stringify({t:'lab',down:true,round:window.__net.run.round})));
    await wait(2000);
  }
  await page.waitForSelector('.spect:not([hidden])',{timeout:10000});
  await wait(2500);
  counting=true;
  const state=()=>page.evaluate(()=>{const s=window.__island?.scene,g=s?.ghosting?.(),w=s?.watching?.(),cam=s?.cameras?.main,f=s?.ghostFig;
    return {ghost:g&&{x:+g.at.x.toFixed(2),y:+g.at.y.toFixed(2),choices:g.choices},watching:w?.name??null,body:s&&{x:+s.position.x.toFixed(2),y:+s.position.y.toFixed(2)},
      bar:document.querySelector('.spect-quem')&&getComputedStyle(document.querySelector('.spect-quem'),'::before').content+' '+document.querySelector('.spect-nome').textContent,
      fig:f&&{vis:f.visible,a:+f.alpha.toFixed(2),scr:cam&&[Math.round((f.x-cam.worldView.x)*cam.zoom),Math.round((f.y-cam.worldView.y)*cam.zoom)]},
      stick:(e=>e&&getComputedStyle(e).visibility)(document.querySelector('.explore-stick')),
      bars:(r=>r&&[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)])(document.querySelector('.spect')?.getBoundingClientRect()),
      stickBox:(r=>r&&[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)])(document.querySelector('.explore-stick')?.getBoundingClientRect())};});
  const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`});report.steps.push(name);report.states[name]=await state();log('shot',name,JSON.stringify(report.states[name]));};
  // The GIF's frames: the page's own screencast (JPEG, ~15 fps), written as they come.
  cdp.on('Page.screencastFrame',e=>{writeFileSync(`${out}/frames/${String(frame++).padStart(4,'0')}.jpg`,Buffer.from(e.data,'base64'));cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:80,everyNthFrame:2});
  const film=wait;
  const press=sel=>pc?page.click(sel):page.tap(sel);
  // Phone: a finger on the stick, dragged toward (dx, dy) and held; PC: the keys held.
  const stickAt=async()=>{const r=await page.locator('.explore-stick').boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
  const walk=async(dir,ms)=>{
    if(pc){const keys={up:'w',down:'s',left:'a',right:'d'}[dir];await page.keyboard.down(keys);await film(ms);await page.keyboard.up(keys);return;}
    const c=await stickAt(),v={up:[0,-40],down:[0,40],left:[-40,0],right:[40,0]}[dir];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:c.x,y:c.y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x+v[0]/2,y:c.y+v[1]/2,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x+v[0],y:c.y+v[1],id:1}]});
    await film(ms);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await shot('01-caiu-fantasma');await film(600);
  await walk('up',1800);await walk('right',1500);
  await shot('02-andou');
  if(pc){
    // A click on the ground: the ghost flies there (screen 3/4 right, 1/3 down).
    await page.mouse.click(960,240);await film(2200);await shot('03-clique');
  }else{await walk('left',1200);await shot('03-andou-mais');}
  await press('.spect-seta[data-dir="1"]');await film(1500);await shot('04-seguindo-amigo');
  await walk('down',1500);await shot('05-solto-de-novo');
  if(!pc){await page.setViewportSize({width:844,height:390});await wait(1500);await shot('06-deitado');await walk('right',1500);await shot('07-deitado-andou');}
  await cdp.send('Page.stopScreencast');
  counting=false;
}finally{
  writeFileSync(`${out}/relatorio.json`,JSON.stringify(report,null,1));
  await browser.close();
}
const kinds=report.sent.reduce((m,t)=>(m[t]=(m[t]??0)+1,m),{});
console.log(JSON.stringify({errors:report.errors,consoleErrors:report.console.slice(0,5),sentWhileOut:kinds,frames:frame},null,1));
