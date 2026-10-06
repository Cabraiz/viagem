import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream} from 'node:fs';
const port=8788;
await new Promise((resolve,reject)=>{const probe=createServer();probe.on('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const log=createWriteStream('multiplayer-local-runtime.log');
const server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','multiplayer/wrangler.jsonc','--port',String(port),'--ip','127.0.0.1'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none'}});
server.stdout.pipe(log);server.stderr.pipe(log);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let ready=false;for(let i=0;i<45;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)})).ok;}catch{}if(ready)break;await sleep(1000);}
  if(!ready)throw new Error('Local worker did not become ready. See multiplayer-local-runtime.log');
  const check=spawn(process.execPath,['scripts/check-multiplayer.mjs',`http://127.0.0.1:${port}`],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});check.stdout.pipe(process.stdout);check.stderr.pipe(process.stderr);const code=await new Promise(r=>check.once('exit',r));if(code)process.exitCode=code;
}finally{
  // Only the isolated fixture tree started above is terminated.
  if(server.pid){const stop=spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});await new Promise(r=>stop.once('exit',r));}
  log.end();
}
