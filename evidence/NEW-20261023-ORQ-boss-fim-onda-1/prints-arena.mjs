#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 7: the arena in the dark, in the real game. Starts the local rooms Worker
 * (:8788) and this branch's vite (:4201), runs prints-cena.mjs 3× on the PC and on the phone (shots 2-volta and 3-luta
 * show the arena), stops both.   node evidence/NEW-20261023-ORQ-boss-fim-onda-1/prints-arena.mjs
 */
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DIR='evidence/NEW-20261023-ORQ-boss-fim-onda-1';
process.env.MULTIPLAYER_PERSIST??='D:/Gits/viagem-tmp/wrangler-8788';process.env.MULTIPLAYER_LOG??=`${DIR}/prints/arena/worker.log`;
const {startLocalWorker}=await import(pathToFileURL('scripts/local-worker.mjs').href);
let worker,vite;
try{
  worker=await startLocalWorker();console.log('worker',worker.endpoint);
  vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4201','--strictPort'],{stdio:'ignore'});
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:4201/')).ok)break;}catch{}await sleep(1000);}
  console.log('vite ok');
  for(const extra of [[],['--celular']]){
    const r=spawnSync(process.execPath,[`${DIR}/prints-cena.mjs`,`${DIR}/prints/arena`,'--escala','3',...extra],{stdio:'inherit',timeout:15*60e3});
    console.log('prints',extra.join(' ')||'pc','saiu',r.status);
  }
}finally{
  if(vite){vite.kill();if(process.platform==='win32')spawnSync('taskkill',['/pid',String(vite.pid),'/t','/f']);}
  await worker?.stop?.();console.log('parado');
}
