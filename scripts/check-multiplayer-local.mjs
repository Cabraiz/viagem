// npm run test:multiplayer:local — the rooms Worker under `wrangler dev`, on Linux, macOS and Windows.
// 1. scripts/check-multiplayer.mjs --lab: six raw protocol clients (join, seventh, old version, isolation, drop and
//    resume, forged input and pick, run end through the simulation, rematch);
// 2. the VGM-045 bots' smoke scenario: six real CoopClients with 150 ms of lag for 40 s of combat and a drop
//    (MULTIPLAYER_BOTS=0 skips it). Whole runs: npm run bots -- all.
// Port: MULTIPLAYER_PORT (default 8788). Everything started here is stopped here (scripts/local-worker.mjs).
import {spawn} from 'node:child_process';
import {startLocalWorker} from './local-worker.mjs';

function run(args){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,['--experimental-strip-types',...args],{windowsHide:true,shell:false,stdio:'inherit'});
    child.once('exit',code=>resolve(code??1));
  });
}
const worker=await startLocalWorker();
try{
  let code=await run(['scripts/check-multiplayer.mjs',worker.endpoint,'http://127.0.0.1:4187','--lab']);
  if(!code&&process.env.MULTIPLAYER_BOTS!=='0')code=await run(['scripts/bots/run.ts','smoke','--endpoint',worker.endpoint]);
  if(code)process.exitCode=code;
}finally{await worker.stop();}
