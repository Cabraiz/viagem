// Local rooms Worker (`wrangler dev`) for the multiplayer checks and the bots, on Linux, macOS and Windows.
// - Port: MULTIPLAYER_PORT (default 8788); state: MULTIPLAYER_PERSIST (default <tmp>/viagem-wrangler-<port>, wiped first);
//   log: MULTIPLAYER_LOG (default multiplayer-local-runtime.log). ALLOW_LOCAL is on (local origins, /lab).
// - Stopping without taskkill: on POSIX wrangler runs in its own process group and the whole group gets SIGTERM
//   (SIGKILL after 5 s); on Windows child.kill() ends wrangler and libuv's job object takes its workerd with it.
// - Ctrl+C / SIGTERM / SIGHUP on the caller: on POSIX wrangler sits in its own group and would not get the terminal's
//   signal, so the caller's signal stops it here (port freed) and the process exits with 128 + the signal number.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const localPort=()=>{const port=Number(process.env.MULTIPLAYER_PORT??8788);if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`MULTIPLAYER_PORT inválida: ${process.env.MULTIPLAYER_PORT}`);return port;};

async function free(port){
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',e=>reject(new Error(`Porta ${port} ocupada (${e.code}). Escolha outra com MULTIPLAYER_PORT.`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
}

/** Starts `wrangler dev` and waits for /health. Returns {endpoint, stop(), logPath}. */
export async function startLocalWorker({port=localPort(),persist=process.env.MULTIPLAYER_PERSIST??join(tmpdir(),`viagem-wrangler-${port}`),logPath=process.env.MULTIPLAYER_LOG??'multiplayer-local-runtime.log',vars={}}={}){
  await free(port);
  try{rmSync(persist,{recursive:true,force:true});}catch{}
  const log=createWriteStream(logPath);
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--config','multiplayer/wrangler.jsonc','--port',String(port),'--ip','127.0.0.1','--persist-to',persist,'--var','ALLOW_LOCAL:true'];
  for(const [k,v] of Object.entries(vars))args.push('--var',`${k}:${v}`);
  const posix=process.platform!=='win32';
  const server=spawn(process.execPath,args,{windowsHide:true,shell:false,detached:posix,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none'}});
  server.stdout.pipe(log);server.stderr.pipe(log);
  let exited=false;const gone=new Promise(r=>server.once('exit',()=>{exited=true;r();}));
  const signal=sig=>{try{if(posix)process.kill(-server.pid,sig);else server.kill(sig);}catch{}};
  let stopping;
  const stop=()=>stopping??=(async()=>{
    for(const [sig,handler] of handlers)process.off(sig,handler);
    if(!exited){signal('SIGTERM');await Promise.race([gone,sleep(5000)]);}
    if(!exited&&posix){signal('SIGKILL');await Promise.race([gone,sleep(2000)]);}
    // Children of the group that outlived wrangler (POSIX): the group signal reaches them even after wrangler is gone.
    if(posix)try{process.kill(-server.pid,'SIGKILL');}catch{}
    await new Promise(r=>log.end(r));
  })();
  const SIGNALS={SIGINT:2,SIGTERM:15,SIGHUP:1};
  const handlers=Object.entries(SIGNALS).map(([sig,n])=>[sig,()=>{void stop().finally(()=>process.exit(128+n));}]);
  for(const [sig,handler] of handlers)process.on(sig,handler);
  const endpoint=`http://127.0.0.1:${port}`;
  try{
    let ready=false;
    for(let i=0;i<60&&!exited;i++){try{ready=(await fetch(`${endpoint}/health`,{signal:AbortSignal.timeout(500)})).ok;}catch{}if(ready)break;await sleep(1000);}
    if(!ready)throw new Error(`O Worker local não respondeu em ${endpoint}. Veja ${logPath}.`);
  }catch(e){await stop();throw e;}
  return {endpoint,stop,logPath};
}
