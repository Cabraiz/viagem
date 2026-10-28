// Sonda do carregamento: menu → SELECIONAR → nome → BORA → Jogar sozinho → __partidaPronta, com a linha do tempo
// dos estados da tela (a cada 200 ms) e os bytes baixados. Frio = perfil novo; quente = 2ª página no mesmo perfil.
//   node sonda.mjs <url> <retrato|paisagem|pc> <saida-prefixo> [--cpu 4] [--rodadas frio,quente] [--prints]
import {chromium} from 'file:///C:/nvm4w/nodejs/node_modules/playwright/index.mjs';
import {writeFileSync} from 'node:fs';
const [url,tela,out]=process.argv.slice(2);
const arg=(n,f)=>{const i=process.argv.indexOf(`--${n}`);return i>0?process.argv[i+1]:f;};
const CPU=Number(arg('cpu',1)),RODADAS=String(arg('rodadas','frio,quente')).split(','),PRINTS=process.argv.includes('--prints');
const VP={retrato:{width:390,height:844,touch:true},paisagem:{width:844,height:390,touch:true},pc:{width:1280,height:720,touch:false}}[tela];
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const ctx=await browser.newContext({viewport:{width:VP.width,height:VP.height},deviceScaleFactor:1,hasTouch:VP.touch,isMobile:VP.touch});
const resultado={url,tela,cpu:CPU,rodadas:{}};
const estado=()=>{
  const q=s=>document.querySelector(s);
  const vis=e=>!!e&&!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const load=q('.explore-loading'),wait=q('.coop-wait'),ready=q('.coop-wait-ready'),prog=q('.carga');
  return JSON.stringify({
    botao:q('#enter-island .escolha-rotulo')?.textContent,
    popup:!!q('#confirmation')?.open,
    shell:!!q('dialog.explore-shell')?.open,
    capa:vis(load)?load.textContent:'',
    carga:vis(prog)?prog.textContent.replace(/\s+/g,' ').trim():'',
    sala:vis(wait)?`${wait.dataset.phase}|${ready?.textContent}|p0=${wait.dataset.preloadP0}`:'',
    pronta:!!window.__partidaPronta,
  });
};
async function rodada(nome,page){
  if(CPU>1){const c=await ctx.newCDPSession(page);await c.send('Emulation.setCPUThrottlingRate',{rate:CPU});}
  const t0=Date.now();
  await page.goto(url,{waitUntil:'load',timeout:120000});
  await page.waitForSelector('#confirm',{timeout:60000});
  const menu=Date.now()-t0;
  await page.evaluate(()=>{const n=document.getElementById('nickname');n.value='Sonda';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.class-card')?.click();const c=document.getElementById('confirm');c.click();if(!document.getElementById('confirmation').open)c.click();});
  await page.waitForSelector('#enter-island',{state:'visible',timeout:20000});
  await page.waitForTimeout(800);
  const tClick=Date.now();
  await page.evaluate(()=>document.getElementById('enter-island').click());
  const linha=[];let ultimo='',fim;
  const printsEm=new Set([1500,5000,10000]);
  while(Date.now()-tClick<240000){
    const e=await page.evaluate(estado).catch(()=>ultimo);
    const ms=Date.now()-tClick;
    if(e!==ultimo){linha.push({ms,...JSON.parse(e)});ultimo=e;console.log(nome,ms,e);}
    if(PRINTS)for(const p of printsEm)if(ms>=p){printsEm.delete(p);await page.screenshot({path:`${out}-${nome}-${p}ms.png`});}
    if(JSON.parse(e).pronta){fim=ms;break;}
    await page.waitForTimeout(200);
  }
  const rede=await page.evaluate(t=>{const base=performance.timeOrigin;const r=performance.getEntriesByType('resource');
    const depois=r.filter(x=>base+x.startTime>=t);
    return {n:depois.length,bytes:depois.reduce((s,x)=>s+(x.transferSize||0),0),corpo:depois.reduce((s,x)=>s+(x.encodedBodySize||0),0),
      ultimo:Math.round(Math.max(0,...depois.map(x=>base+x.responseEnd-t)))};},tClick);
  resultado.rodadas[nome]={menu,pronta:fim??null,rede,linha};
  console.log(nome,'PRONTA',fim,'menu',menu,JSON.stringify(rede));
}
try{
  for(const r of RODADAS){const page=await ctx.newPage();await rodada(r,page);if(PRINTS)await page.screenshot({path:`${out}-${r}-pronta.png`});await page.close();}
}finally{writeFileSync(`${out}.json`,JSON.stringify(resultado,null,1));await browser.close();}
