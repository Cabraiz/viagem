#!/usr/bin/env node
/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1, etapa 8: videos of the 3× chefão with everything in (push, clock held, the
 * arena in the dark). Starts the local rooms Worker (:8788) and this branch's vite (:4201), runs video-cena.mjs on the
 * PC and the phone, 1 and 2 players, into videos/final, stops both.   node evidence/NEW-20261023-ORQ-boss-fim-onda-1/videos-arena.mjs [pc-1j celular-1j pc-2j celular-2j]
 */
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DIR='evidence/NEW-20261023-ORQ-boss-fim-onda-1';
process.env.MULTIPLAYER_PERSIST??='D:/Gits/viagem-tmp/wrangler-8788';process.env.MULTIPLAYER_LOG??=`${DIR}/videos/final/worker.log`;
const {startLocalWorker}=await import(pathToFileURL('scripts/local-worker.mjs').href);
let worker,vite;
try{
  worker=await startLocalWorker();console.log('worker',worker.endpoint);
  vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4201','--strictPort'],{stdio:'ignore'});
  for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:4201/')).ok)break;}catch{}await sleep(1000);}
  console.log('vite ok');
  const only=process.argv.slice(2);
  for(const [name,extra] of [['pc-1j',[]],['celular-1j',['--celular']],['pc-2j',['--dois']],['celular-2j',['--celular','--dois']]]){
    if(only.length&&!only.includes(name))continue;
    const r=spawnSync(process.execPath,[`${DIR}/video-cena.mjs`,`${DIR}/videos/final/${name}`,'--segundos','30',...extra],{stdio:'inherit',timeout:40*60e3});
    console.log('vídeo',name,'saiu',r.status);
  }
}finally{
  if(vite){vite.kill();if(process.platform==='win32')spawnSync('taskkill',['/pid',String(vite.pid),'/t','/f']);}
  await worker?.stop?.();console.log('parado');
}
