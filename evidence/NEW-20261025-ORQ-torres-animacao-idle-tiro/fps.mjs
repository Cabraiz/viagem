#!/usr/bin/env node
/**
 * Card torres-animacao-idle-tiro: FPS of the 12 firing defenses (sandbox `n=300&torres=12`) animated (anim=1) against
 * the weapons standing still with no fire sheet (anim=0, main before this card), same build, phone screen at DPR 1, the
 * PC's GPU (d3d11). Rounds alternate; each: 10 s warm-up, then the meter (last 240 frames) read every second for 20 s.
 *   npx vite build && node evidence/NEW-20261025-ORQ-torres-animacao-idle-tiro/fps.mjs <out.json> [--rodadas 3]
 * Inside the heavy slot (pesado.mjs) and one browser slot (vaga.mjs). Port 4211.
 */
import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';import {existsSync,writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT=resolve(process.argv[2]??'fps.json'),R=Number(process.argv[process.argv.indexOf('--rodadas')+1])||3,PORT='4211';
const {claimSlot}=await import(pathToFileURL('D:/Gits/viagem/tools/vaga.mjs').href);
const pwDir='D:/Gits/viagem-tools/node_modules/playwright';
const pw=await import(pathToFileURL(join(pwDir,existsSync(join(pwDir,'index.mjs'))?'index.mjs':'index.js')).href);
const chromium=pw.chromium??pw.default.chromium;
let site,browser,release;const runs=[];
try{
  site=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore',windowsHide:true,env:{...process.env,PORT}});
  for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${PORT}/`)).ok)break;}catch{}await sleep(1000);}
  release=await claimSlot({locks:'D:/Gits/viagem-board/locks',prefix:'browser',count:2,label:'E1 torres FPS'});
  browser=await chromium.launch({args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist']});
  for(let r=0;r<R;r++)for(const anim of r%2?[0,1]:[1,0]){
    const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
    await page.goto(`http://127.0.0.1:${PORT}/?sandbox=cidade&mapa=real&n=300&torres=12&anim=${anim}`,{waitUntil:'load',timeout:120000});
    await page.waitForFunction(()=>!!window.__cidade,null,{timeout:120000});
    await sleep(10000);
    const fps=[],worst=[];
    for(let i=0;i<20;i++){await sleep(1000);const m=await page.evaluate(()=>({f:window.__cidade.fps(),w:window.__cidade.worst()}));fps.push(m.f);worst.push(m.w);}
    const v=await page.evaluate(()=>window.__cidade.volleys?.()??null);
    const run={rodada:r+1,anim,fps:+(fps.reduce((s,x)=>s+x,0)/fps.length).toFixed(1),piorQuadroFps:+Math.min(...worst).toFixed(1),rajadas:v?.drawn??0,erros:errors};
    runs.push(run);console.log(JSON.stringify(run));
    await page.close();await ctx.close();
  }
}finally{
  await browser?.close().catch(()=>{});release?.();site?.kill();
  const by=a=>runs.filter(x=>x.anim===a),avg=(l,k)=>+(l.reduce((s,x)=>s+x[k],0)/Math.max(1,l.length)).toFixed(1);
  const summary={animado:{fps:avg(by(1),'fps'),pior:avg(by(1),'piorQuadroFps')},parado:{fps:avg(by(0),'fps'),pior:avg(by(0),'piorQuadroFps')}};
  writeFileSync(OUT,JSON.stringify({summary,runs},null,1)+'\n');console.log('resumo',JSON.stringify(summary));
}
