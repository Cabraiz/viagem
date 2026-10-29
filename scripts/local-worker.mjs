// Local rooms Worker (`wrangler dev`) for the multiplayer checks and the bots, on Linux, macOS and Windows.
// - Port: MULTIPLAYER_PORT (default 8788); state: MULTIPLAYER_PERSIST (default <tmp>/viagem-wrangler-<port>, wiped first);
//   log: MULTIPLAYER_LOG (default multiplayer-local-runtime.log). ALLOW_LOCAL is on (local origins, /lab).
// - Waiting: up to LOCAL_WORKER_WAIT_S (default 240 s) for /health, 2 s per try; with the HD busy wrangler takes 60–90 s
//   to answer (NEW-20261029-ORQ-smoke-worker-espera-mais). Every 30 s it prints the log's last line (is it stuck or slow?);
//   wrangler exiting fails at once. Its cache (WRANGLER_CACHE_DIR) goes to <tmp> too, off the HD, unless set.
// - Stopping without taskkill: on POSIX wrangler runs in its own process group and the whole group gets SIGTERM
//   (SIGKILL after 5 s); on Windows child.kill() ends wrangler and libuv's job object takes its workerd with it.
// - Ctrl+C / SIGTERM / SIGHUP on the caller: on POSIX wrangler sits in its own group and would not get the terminal's
//   signal, so the caller's signal stops it here (port freed) and the process exits with 128 + the signal number.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const localPort=()=>{const port=Number(process.env.MULTIPLAYER_PORT??8788);if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`MULTIPLAYER_PORT inválida: ${process.env.MULTIPLAYER_PORT}`);return port;};
/** Seconds to wait for /health: LOCAL_WORKER_WAIT_S, default 240. */
export const waitSeconds=(env=process.env)=>{const s=Number(env.LOCAL_WORKER_WAIT_S??240);if(!(s>0))throw new Error(`LOCAL_WORKER_WAIT_S inválida: ${env.LOCAL_WORKER_WAIT_S}`);return s;};

async function free(port){
  await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',e=>reject(new Error(`Porta ${port} ocupada (${e.code}). Escolha outra com MULTIPLAYER_PORT.`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
}

/** Where wrangler is: the log's last non-empty line without colors (e.g. "Starting local server..."). */
export function wranglerPhase(text){
  const lines=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  return lines.at(-1)?.slice(0,200)??'(log vazio)';
}
const phaseOf=logPath=>{try{return wranglerPhase(readFileSync(logPath,'utf8'));}catch{return '(sem log)';}};

/** True when `${endpoint}/health` answers ok within `timeoutMs`. */
export async function healthOk(endpoint,timeoutMs=2000){
  try{return (await fetch(`${endpoint}/health`,{signal:AbortSignal.timeout(timeoutMs)})).ok;}catch{return false;}
}

/**
 * Tries `probe` every `intervalMs` until it passes ('ready'), `exited()` turns true ('exited') or `waitMs` runs out
 * ('timeout'); every `reportMs` calls report(seconds waited). Clock and sleep come in for the tests.
 */
export async function waitForHealth({probe,exited=()=>false,waitMs,intervalMs=1000,reportMs=30000,report=()=>{},now=Date.now,pause=sleep}){
  const start=now();let next=start+reportMs;
  for(;;){
    if(exited())return 'exited';
    if(await probe())return 'ready';
    if(exited())return 'exited';
    const t=now();
    if(t-start>=waitMs)return 'timeout';
    if(t>=next){report(Math.round((t-start)/1000));while(next<=t)next+=reportMs;}
    await pause(intervalMs);
  }
}

/** Starts `wrangler dev` and waits for /health. Returns {endpoint, stop(), logPath}. `label` names it in the progress lines. */
export async function startLocalWorker({port=localPort(),persist=process.env.MULTIPLAYER_PERSIST??join(tmpdir(),`viagem-wrangler-${port}`),logPath=process.env.MULTIPLAYER_LOG??'multiplayer-local-runtime.log',vars={},label='Worker local'}={}){
  const waitS=waitSeconds();
  await free(port);
  try{rmSync(persist,{recursive:true,force:true});}catch{}
  const log=createWriteStream(logPath);
  const args=['node_modules/wrangler/bin/wrangler.js','dev','--config','multiplayer/wrangler.jsonc','--port',String(port),'--ip','127.0.0.1','--persist-to',persist,'--var','ALLOW_LOCAL:true'];
  for(const [k,v] of Object.entries(vars))args.push('--var',`${k}:${v}`);
  const posix=process.platform!=='win32';
  const env={...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none',WRANGLER_CACHE_DIR:process.env.WRANGLER_CACHE_DIR??join(tmpdir(),'viagem-wrangler-cache')};
  const server=spawn(process.execPath,args,{windowsHide:true,shell:false,detached:posix,stdio:['ignore','pipe','pipe'],env});
  server.stdout.pipe(log);server.stderr.pipe(log);
  let exited=false,exitCode;const gone=new Promise(r=>server.once('exit',(code,sig)=>{exited=true;exitCode=code??sig;r();}));
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
    const result=await waitForHealth({probe:()=>healthOk(endpoint),exited:()=>exited,waitMs:waitS*1000,
      report:s=>console.log(`${label} em ${endpoint} ainda subindo (${s} s de ${waitS} s): ${phaseOf(logPath)}`)});
    if(result==='exited')throw new Error(`O wrangler saiu (${exitCode}) antes de responder em ${endpoint}. Veja ${logPath}: ${phaseOf(logPath)}`);
    if(result==='timeout')throw new Error(`O Worker local não respondeu em ${endpoint} em ${waitS} s (LOCAL_WORKER_WAIT_S). Veja ${logPath}, parou em: ${phaseOf(logPath)}`);
  }catch(e){await stop();throw e;}
  return {endpoint,stop,logPath};
}
