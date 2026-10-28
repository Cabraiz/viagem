// Etapa 2 do card NEW-20261023-ORQ-barracas-no-caminho: 2 prints de perto das feirinhas numa partida de verdade (Worker
// de salas local do worktree + vite do worktree). Lab wipe (sem bichos), o herói pula pelo lab para o lado de uma feirinha
// e a câmera mostra as barracas. Print 1 em 1280×720, print 2 (outra feirinha) em 390×844.
// node prints-perto.mjs <vite url> <saída dir>   → <saída>/perto-1-1280x720.png, <saída>/perto-2-390x844.png, perto.json
import {pathToFileURL} from 'node:url';import fs from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const WT='D:/Gits/viagem-wt/barracas-no-caminho';
const {startLocalWorker}=await import(pathToFileURL(`${WT}/scripts/local-worker.mjs`).href);
const require=createRequire('D:/Gits/viagem-tools/package.json');const {chromium}=require('playwright');
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const [VITE,OUT_ARG]=process.argv.slice(2);const OUT=resolve(OUT_ARG);fs.mkdirSync(OUT,{recursive:true});
process.chdir(WT);
const release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 prints feirinhas'});
const worker=await startLocalWorker({port:8795,logPath:`${OUT}/worker.log`});
let browser;const errors=[],report=[];
const SHOTS=[{w:1280,h:720,mobile:false,file:'perto-1-1280x720.png'},{w:390,h:844,mobile:true,file:'perto-2-390x844.png'}];
try{
  browser=await chromium.launch({args:process.env.SOFT?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const proto=JSON.parse(fs.readFileSync(`${WT}/public/multiplayer.json`,'utf8')).protocol;
  for(const [k,shot] of SHOTS.entries()){
    const ctx=await browser.newContext({deviceScaleFactor:1,viewport:{width:shot.w,height:shot.h},isMobile:shot.mobile,hasTouch:shot.mobile});
    await ctx.route('**/multiplayer.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({endpoint:worker.endpoint,protocol:proto})}));
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
    await p.goto(VITE,{waitUntil:'load',timeout:400000});
    await p.waitForSelector('.class-card',{state:'attached',timeout:120000});
    await p.evaluate(c=>{const n=document.getElementById('nickname');n.value='Bolinha';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(`.class-card[data-hero="${c}"]`).click();const b=document.getElementById('confirm');b.click();if(!document.getElementById('confirmation').open)b.click();},'clt-cansado');
    await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});await p.evaluate(()=>document.getElementById('enter-island').click());
    try{await p.waitForFunction(()=>window.__partidaPronta===true,null,{timeout:240000});}catch(e){await p.screenshot({path:`${OUT}/falhou-${k}.png`});throw e;}
    const send=m=>p.evaluate(m=>{window.__island.scene.hooks.net.socket.send(JSON.stringify(m));},m);
    const offers=async()=>{for(let i=0;i<6;i++){const open=await p.evaluate(()=>{const b=[...document.querySelectorAll('button.rh-ofc-skip')].find(x=>x.getBoundingClientRect().width>0&&!x.disabled);if(!b)return false;b.click();return true;});if(!open)break;await p.waitForTimeout(400);}};
    for(let i=0;i<3;i++){await send({t:'lab',wipe:true});await p.waitForTimeout(500);}
    await offers();
    const barracas=await p.evaluate(()=>(window.__hud?.view?.structures??[]).filter(s=>s.kind==='barraca').map(s=>({id:s.id,x:s.x,y:s.y})));
    // The feirinhas: barracas within 12 u of each other.
    const groups=[];for(const b of barracas){const g=groups.find(g=>g.some(o=>Math.hypot(o.x-b.x,o.y-b.y)<12));if(g)g.push(b);else groups.push([b]);}
    if(groups.length<2)throw new Error(`só ${groups.length} feirinha(s) na view: ${JSON.stringify(barracas)}`);
    const g=groups[k],cx=g.reduce((a,b)=>a+b.x,0)/g.length,cy=g.reduce((a,b)=>a+b.y,0)/g.length;
    // Stand ~3.5 u off the row (the first walkable of a few spots), facing it.
    let at;
    for(const [dx,dy] of [[0,3.5],[3.5,0],[0,-3.5],[-3.5,0],[2.5,2.5],[-2.5,2.5],[0,5],[5,0]]){
      const before=await p.evaluate(()=>{const q=window.__island.scene.hooks.net.predicted;return {x:q.x,y:q.y};});
      await send({t:'lab',to:{x:cx+dx,y:cy+dy}});await p.waitForTimeout(1200);
      const now=await p.evaluate(()=>{const q=window.__island.scene.hooks.net.predicted;return {x:q.x,y:q.y};});
      if(Math.hypot(now.x-before.x,now.y-before.y)>1){at=now;break;}
    }
    if(!at)throw new Error(`não pulou para perto da feirinha em ${cx.toFixed(1)},${cy.toFixed(1)}`);
    for(let i=0;i<2;i++){await send({t:'lab',wipe:true});await p.waitForTimeout(400);}
    await offers();await p.waitForTimeout(2500);
    await p.screenshot({path:`${OUT}/${shot.file}`});
    report.push({shot:shot.file,feirinha:{x:+cx.toFixed(1),y:+cy.toFixed(1),barracas:g.length},heroi:at,feirinhasNaView:groups.length,barracasNaView:barracas.length});
    await ctx.close();
  }
}finally{
  fs.writeFileSync(`${OUT}/perto.json`,JSON.stringify({report,errors},null,1));
  await browser?.close();await worker.stop();release();
}
console.log(JSON.stringify({report,errors},null,1));
