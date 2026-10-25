// Driver: per run a fresh rooms Worker (8797, from that version's worktree) and a static server of its build (4207), then celular.mjs.
//   node run.mjs <out dir> <run>[ <run>…]   run = name:extra-args-with-commas  (name ∈ antes|depois|<dist dir name>)
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createWriteStream,rmSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {spawn,execSync} from 'node:child_process';
// minimapa-arte-chatgpt: builds and Worker state outside the Claude temp (cleaned every hour).
const S='D:/Gits/viagem-wt/minimapa-fps';
const WT={antes:'D:/Gits/viagem-wt/minimapa-antes',depois:'D:/Gits/viagem-wt/minimapa-arte-chatgpt'};
const [out,...runs]=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.ktx2':'image/ktx2','.mp3':'audio/mpeg','.ogg':'audio/ogg','.webm':'audio/webm'};
function serve(root){
  root=resolve(root);
  const srv=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url||'/','http://x').pathname);const f=resolve(root,'.'+(p==='/'?'/index.html':p));
    if(!f.startsWith(root+sep)){res.writeHead(403).end();return;}const data=await readFile(f);res.writeHead(200,{'Content-Type':mime[extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);}
    catch{res.writeHead(404).end('Not found');}});
  return new Promise(r=>srv.listen(4207,'127.0.0.1',()=>r(srv)));
}
async function worker(wt,label){
  const persist=`${S}/wr-${label}`;try{rmSync(persist,{recursive:true,force:true});}catch{}
  const log=createWriteStream(`${S}/wr-${label}.log`);
  const c=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','multiplayer/wrangler.jsonc','--port','8797','--ip','127.0.0.1','--persist-to',persist,'--var','ALLOW_LOCAL:true','--var','LAB_SEED:7'],
    {cwd:wt,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',BROWSER:'none'}});
  c.stdout.pipe(log);c.stderr.pipe(log);
  const stop=async()=>{try{execSync(`taskkill /T /F /PID ${c.pid}`,{stdio:'ignore'});}catch{}await sleep(2000);};
  for(let i=0;i<300;i++){try{if((await fetch('http://127.0.0.1:8797/health',{signal:AbortSignal.timeout(2000)})).ok)return stop;}catch{}await sleep(1000);}
  await stop();throw new Error('worker did not start');
}
const seen={};
for(const run of runs){
  const [name,extraS='']=run.split(':'),extra=extraS?extraS.split(','):[];
  const base=`${name}${extra.length?'-'+extra.join('').replace(/[^a-z0-9]/gi,'').slice(0,30):''}`,n=seen[base]=(seen[base]??0)+1,label=`${base}-${n}`;
  const srv=await serve(join(S,`dist-${name}`));let stop;
  try{
    stop=await worker(WT[name],label);
    for(let i=0;i<3;i++){const t=Date.now();const r=await fetch('http://127.0.0.1:8797/rooms',{method:'POST',headers:{Origin:'http://127.0.0.1:4207'},body:'{"solo":true}'});console.error(label,'warm',r.status,Date.now()-t,'ms');if(Date.now()-t<3000)break;}
    await sleep(3000);
    await new Promise(r=>{const c=spawn(process.execPath,[new URL('./celular.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),'--web','http://127.0.0.1:4207','--rooms','http://127.0.0.1:8797','--label',label,'--dir',out,...extra],{stdio:['ignore','ignore','inherit']});c.on('exit',r);});
  }catch(e){console.error(label,String(e));}
  finally{await stop?.();srv.closeAllConnections?.();await new Promise(r=>srv.close(r));}
}
console.error('done');
