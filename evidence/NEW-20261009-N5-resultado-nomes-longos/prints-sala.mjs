// NEW-20261009-N5-resultado-nomes-longos, etapa 2: a local room (wrangler dev, LAB_SEED 328: the bots are "Concurseira",
// "Caça-Promoção", "Passageira do Busão", "Concurseira 2", "Caça-Promoção 2") played alone with 5 bots by a long nickname.
// Prints of the wait, the combat (team strip) and the result (and a tap on a card) at 390×844 and 844×390, text 100/125 %.
//   node evidence/NEW-20261009-N5-resultado-nomes-longos/prints-sala.mjs [--web http://127.0.0.1:4350] [--port 8802]
// Needs the vite dev server running and a browser slot (board locks/browser-N), taken here.
import {mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {startLocalWorker} from '../../scripts/local-worker.mjs';

const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const WEB=arg('web','http://127.0.0.1:4350'),PORT=Number(arg('port','8802')),OUT=dirname(fileURLToPath(import.meta.url));
const NICK='Maria Aparecida dos Santos';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const VIEWS=[[390,844,'100'],[390,844,'125'],[844,390,'100'],[844,390,'125']];
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
let worker,browser,release;const log=[];
try{
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E5 N5 prints sala local'});
  worker=await startLocalWorker({port:PORT,persist:join(tmpdir(),`viagem-n5-${PORT}`),logPath:join(tmpdir(),`viagem-n5-worker-${PORT}.log`),vars:{LAB_SEED:'328'}});
  const {chromium}=await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await ctx.route('**/multiplayer.json',r=>r.fulfill({json:{endpoint:worker.endpoint,protocol:3}}));
  await ctx.addInitScript(()=>{try{localStorage.setItem('viagem:solo-bots:v1','5');localStorage.setItem('viagem:economia:v1',JSON.stringify({on:false,auto:false,declined:true}));localStorage.setItem('viagem:dicas',JSON.stringify(['rescue','walk','chip','xp','gather']));}catch{}});
  const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  const shot=async(fase,extra='')=>{
    for(const [w,h,t] of VIEWS){
      await p.setViewportSize({width:w,height:h});
      await p.evaluate(t=>{if(t==='125')document.documentElement.dataset.texto='125';else delete document.documentElement.dataset.texto;},t);
      await sleep(600);const file=`${fase}${extra}-${w}x${h}-${t}.jpg`;await p.screenshot({path:join(OUT,file),type:'jpeg',quality:80});log.push(file);
    }
  };
  const names=()=>p.evaluate(()=>({
    faixa:[...document.querySelectorAll('.rh-member-name')].map(e=>e.textContent),
    espera:[...document.querySelectorAll('.coop-wait :is(li,.coop-wait-name,[class*=name])')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,12),
    resultado:[...document.querySelectorAll('.rh-rcard-name')].map(e=>e.textContent)}));
  await p.goto(`${WEB}/`,{waitUntil:'load',timeout:180000});
  await p.waitForSelector('#confirm',{state:'attached',timeout:180000});await sleep(1500);
  await p.evaluate(n=>{const i=document.getElementById('nickname');i.value=n;i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card')?.click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();},NICK);
  await p.waitForSelector('#enter-island',{state:'visible',timeout:30000});
  await p.evaluate(()=>document.getElementById('enter-island').click());
  // The wait: the room's waiting panel, while the city loads and the bots take their seats.
  const waitVis=()=>p.evaluate(()=>{const e=document.querySelector('dialog.explore-shell .coop-wait');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]');});
  for(const end=Date.now()+90000;Date.now()<end&&!(await waitVis());)await sleep(250);
  if(await waitVis()){await sleep(1500);log.push({espera:await names()});await shot('espera');}else log.push('espera: o painel não apareceu');
  await p.waitForFunction(()=>{const s=document.querySelector('dialog.explore-shell');return s&&!s.querySelector('.explore-loading:not([hidden])')&&!s.querySelector('.coop-wait:not([hidden])');},null,{timeout:240000});
  await sleep(4000);
  for(let i=0;i<4;i++){const b=p.getByRole('button',{name:/^Pular/});if(await b.count()&&await b.first().isVisible()){await b.first().click().catch(()=>{});await sleep(400);}else break;}
  await p.waitForFunction(()=>window.__island?.scene?.hooks?.net?.socket,null,{timeout:60000});
  // Combat: the team strip with the five bots. Lab end needs the combat phase.
  for(const end=Date.now()+120000;Date.now()<end;await sleep(1000)){if(await p.evaluate(()=>document.querySelectorAll('.rh-member-name').length>=5))break;}
  await sleep(3000);log.push({combate:await names()});await shot('combate');
  await p.setViewportSize({width:390,height:844});
  for(const end=Date.now()+60000;Date.now()<end;await sleep(2000)){
    await p.evaluate(()=>window.__island.scene.hooks.net.socket.send(JSON.stringify({t:'lab',end:true})));
    if(await p.waitForSelector('.rh-result:not([hidden])',{state:'visible',timeout:2000}).then(()=>true,()=>false))break;
  }
  await sleep(4000);log.push({resultado:await names()});await shot('resultado');
  // A tap on the shamed player's card (or the first) shows its folded prizes.
  await p.evaluate(()=>{const c=document.querySelector('.rh-rcard:has(.rh-award-folded)')??document.querySelector('.rh-rcard');c?.click();});
  await sleep(800);log.push({aberto:await p.evaluate(()=>[...document.querySelectorAll('.rh-rcard.is-open .rh-rcard-name')].map(e=>e.textContent))});
  await shot('resultado','-toque');
  log.push({errors});
}finally{
  writeFileSync(join(OUT,'prints-sala.json'),JSON.stringify(log,null,1));
  await browser?.close().catch(()=>{});await worker?.stop().catch(()=>{});release?.();
}
console.log(JSON.stringify(log,null,1));
