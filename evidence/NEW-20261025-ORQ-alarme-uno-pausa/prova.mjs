import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire('D:/Gits/viagem-tools/package.json');
const {chromium}=require('playwright');
const [,,bundle,pub,outDir]=process.argv;
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
try{
  const page=await browser.newPage({deviceScaleFactor:1});
  await page.route('http://prova.test/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>alarme</title>'});
    if(path==='/alarm.js')return route.fulfill({contentType:'text/javascript',body:readFileSync(bundle)});
    return route.fulfill({contentType:path.endsWith('.webm')?'audio/webm':'audio/mp4',body:readFileSync(pub+path)});
  });
  await page.goto('http://prova.test/');
  await page.addScriptTag({url:'http://prova.test/alarm.js'});
  const result=await page.evaluate(async()=>{
    const ctx=new AudioContext();await ctx.resume();
    const bus=ctx.createGain(),analyser=ctx.createAnalyser();analyser.fftSize=1024;
    bus.connect(analyser);analyser.connect(ctx.destination);
    const rec=ctx.createMediaStreamDestination();bus.connect(rec);
    const loop=new Alarm.AlarmLoop({unlocked:true,context:ctx,effectsOutput:bus},{format:'webm'});
    loop.update(true,0,false);
    while(!loop.src)await new Promise(r=>setTimeout(r,20)),loop.update(true,0,false);
    const t0=ctx.currentTime,buf=new Float32Array(analyser.fftSize),log=[];
    const chunks=[],mr=new MediaRecorder(rec.stream,{mimeType:'audio/webm'});mr.ondataavailable=e=>chunks.push(e.data);mr.start();
    while(ctx.currentTime-t0<17){
      loop.update(true,0,false);analyser.getFloatTimeDomainData(buf);
      let q=0;for(const v of buf)q+=v*v;log.push([+(ctx.currentTime-t0).toFixed(3),Math.sqrt(q/buf.length)]);
      await new Promise(r=>setTimeout(r,50));
    }
    loop.update(false,0,false);mr.stop();await new Promise(r=>mr.onstop=r);
    const blob=new Blob(chunks,{type:'audio/webm'}),bytes=new Uint8Array(await blob.arrayBuffer());
    let bin='';for(const b of bytes)bin+=String.fromCharCode(b);
    return {file:loop.fileBuffer?{s:loop.file.duration,ch:loop.file.numberOfChannels}:null,looped:loop.src===undefined?null:true,
      bufferS:(loop.fileBuffer??loop.buffer).duration,rate:ctx.sampleRate,log,webm:btoa(bin)};
  });
  writeFileSync(outDir+'/alarme-pausa.webm',Buffer.from(result.webm,'base64'));
  const {webm,...rest}=result;writeFileSync(outDir+'/alarme-pausa-log.json',JSON.stringify(rest,null,1));
  // Runs of sound/silence (RMS threshold 0.005).
  const runs=[];for(const [t,r] of rest.log){const on=r>.005;if(!runs.length||runs.at(-1).on!==on)runs.push({on,from:t,to:t});else runs.at(-1).to=t;}
  console.log(JSON.stringify({file:rest.file,bufferS:rest.bufferS,rate:rest.rate}));
  for(const r of runs)console.log(`${r.on?'SOM     ':'SILÊNCIO'} ${r.from.toFixed(2)}–${r.to.toFixed(2)} s`);
}finally{await browser.close();}
