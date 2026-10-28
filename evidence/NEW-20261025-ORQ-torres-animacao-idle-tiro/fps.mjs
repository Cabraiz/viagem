#!/usr/bin/env node
/**
 * Card torres-animacao-idle-tiro: FPS of the 12 firing defenses (sandbox `n=300&torres=12`) animated (anim=1) against
 * the weapons standing still with no fire sheet (anim=0, main before this card), same build, phone screen at DPR 1, the
 * PC's GPU (d3d11) and the CPU throttled 4× (CDP; at full speed both sit on the 60 fps vsync cap). Rounds alternate;
 * each: 10 s warm-up, then the meter (last 240 frames) read every second for 20 s, the main thread's script and task time
 * per second over those 20 s (CDP Performance) and the textures' bytes (w × h × 4: all, and the towers').
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
    const cdp=await ctx.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const perf=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    await page.goto(`http://127.0.0.1:${PORT}/?sandbox=cidade&mapa=real&n=300&torres=12&anim=${anim}`,{waitUntil:'load',timeout:120000});
    await page.waitForFunction(()=>!!window.__cidade,null,{timeout:120000});
    await sleep(10000);
    const fps=[],worst=[],p0=await perf();
    for(let i=0;i<20;i++){await sleep(1000);const m=await page.evaluate(()=>({f:window.__cidade.fps(),w:window.__cidade.worst()}));fps.push(m.f);worst.push(m.w);}
    const p1=await perf(),secs=p1.Timestamp-p0.Timestamp;
    const v=await page.evaluate(()=>window.__cidade.volleys?.()??null),tex=await page.evaluate(()=>window.__cidade.texBytes?.()??null);
    const run={rodada:r+1,anim,fps:+(fps.reduce((s,x)=>s+x,0)/fps.length).toFixed(1),piorQuadroFps:+Math.min(...worst).toFixed(1),
      scriptMsPorS:+((p1.ScriptDuration-p0.ScriptDuration)*1000/secs).toFixed(1),tarefaMsPorS:+((p1.TaskDuration-p0.TaskDuration)*1000/secs).toFixed(1),
      texMB:tex?+(tex.all/1048576).toFixed(1):null,texTorresMB:tex?+(tex.towers/1048576).toFixed(1):null,rajadas:v?.drawn??0,erros:errors};
    runs.push(run);console.log(JSON.stringify(run));
    await page.close();await ctx.close();
  }
}finally{
  await browser?.close().catch(()=>{});release?.();site?.kill();
  const by=a=>runs.filter(x=>x.anim===a),avg=(l,k)=>+(l.reduce((s,x)=>s+x[k],0)/Math.max(1,l.length)).toFixed(1);
  const sum=l=>({fps:avg(l,'fps'),pior:avg(l,'piorQuadroFps'),scriptMsPorS:avg(l,'scriptMsPorS'),tarefaMsPorS:avg(l,'tarefaMsPorS'),texMB:avg(l,'texMB'),texTorresMB:avg(l,'texTorresMB')});
  const summary={animado:sum(by(1)),parado:sum(by(0))};
  writeFileSync(OUT,JSON.stringify({summary,runs},null,1)+'\n');console.log('resumo',JSON.stringify(summary));
}
