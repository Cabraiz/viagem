#!/usr/bin/env node
/**
 * GIF and prints of a solo match on GitHub Actions, from the PC with no vite, Worker or browser here
 * (NEW-20261025-ORQ-cicd-gif-prints). The recording is scripts/gravar-partida.mjs, run by .github/workflows/gif.yml.
 *
 *   node tools/gif-ci.mjs <branch|sha> [parado|andando|uno|empurra|todos] [--tela celular|pc|ambas] [--segundos 20]
 *        [--modo normal|chaveiro] [--saida <dir>] [--timeout 40] [--workflow-ref main]
 *       records what is ON GITHUB for that branch (push it first): dispatches gif.yml, waits, downloads the artifact to
 *       evidence/ci-gif/<branch>/<sha7>-<roteiro>-<stamp>/ (default) and prints the summary and the paths to Read
 *       (quadros.png: 8 frames of the GIF; Read shows a GIF's first frame only). Exit 0 ok, 1 the recording failed, 2 infra.
 *   node tools/gif-ci.mjs site [--sha <sha>] [--quadro D:/Gits/viagem-board]
 *       the print of viagem.cyou that gif.yml takes after each "Publish viagem" (workflow_run): downloads the newest one
 *       (or that sha's) to <quadro>/evidence/site/<sha12>/ and adds its line to <quadro>/site-prints.md (once per sha).
 *
 * Token: `git credential fill` inside the process, never printed or saved (as the board's tools/vigia-prints.mjs):
 * dispatching a workflow and downloading an artifact need one. Without it nothing is sent; the GitHub page
 * (Actions → GIF → Run workflow) does the same by hand. Nothing here publishes: gif.yml only reads a build.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const REPO=process.env.CI_REPO??'Cabraiz/viagem';
const API='https://api.github.com',WORKFLOW='gif.yml';
export const ROTEIROS=['parado','andando','uno','empurra','todos'],TELAS=['celular','pc','ambas'],MODOS=['normal','chaveiro'];
export class InfraError extends Error {}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const say=m=>console.error(m);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tests/tools/gif-ci.test.ts)
// ---------------------------------------------------------------------------------------------------------------

const VALUE_FLAGS=new Set(['tela','segundos','modo','saida','timeout','workflow-ref','sha','quadro']);
/** argv → {cmd: 'gif'|'site', target, roteiro, flags}; throws on a bad value. */
export function parseArgs(argv){
  const flags={},pos=[];
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')){pos.push(a);continue;}
    const name=a.slice(2);
    if(!VALUE_FLAGS.has(name))throw new Error(`opção desconhecida: ${a}`);
    flags[name]=argv[++i];
    if(flags[name]===undefined)throw new Error(`${a} sem valor`);
  }
  if(pos[0]==='site')return {cmd:'site',flags};
  const [target,roteiro='parado']=pos;
  if(!target)throw new Error('uso: node tools/gif-ci.mjs <branch|sha> [parado|andando|uno|todos] [--tela celular|pc|ambas] [--segundos 20]');
  if(!ROTEIROS.includes(roteiro))throw new Error(`roteiro: ${ROTEIROS.join(', ')}; veio ${roteiro}`);
  if(flags.tela!==undefined&&!TELAS.includes(flags.tela))throw new Error(`--tela: ${TELAS.join(', ')}; veio ${flags.tela}`);
  if(flags.modo!==undefined&&!MODOS.includes(flags.modo))throw new Error(`--modo: ${MODOS.join(', ')}; veio ${flags.modo}`);
  const s=Number(flags.segundos??20);
  if(!(Number.isInteger(s)&&s>=3&&s<=120))throw new Error(`--segundos: 3 a 120, veio ${flags.segundos}`);
  return {cmd:'gif',target,roteiro,flags};
}
/** A request id that is unique on the PC and fits a run name: <yyyymmddhhmmss>-<4 hex>. */
export const pedidoId=(now=new Date(),rand=Math.random)=>`${now.toISOString().replace(/\D/g,'').slice(0,14)}-${Math.floor(rand()*0x10000).toString(16).padStart(4,'0')}`;
/** The workflow_dispatch body: gif.yml at `workflowRef` records the commit `sha`. Inputs are strings. */
export function dispatchBody({workflowRef='main',sha,roteiro,tela='celular',segundos=20,modo='normal',pedido}){
  return {ref:workflowRef,inputs:{ref:sha,roteiro,tela,segundos:String(segundos),modo,pedido}};
}
/** The run of a request: gif.yml's run-name carries the id ("GIF <pedido> …"). */
export const runOfPedido=(runs,pedido)=>runs.find(r=>String(r.display_title??'').split(/\s+/).includes(pedido));
/** The site print run of a sha (run-name "Site <sha>"), else the newest completed one. */
export function siteRun(runs,sha){
  const done=runs.filter(r=>r.status==='completed'&&/^Site\s/.test(r.display_title??'')).sort((a,b)=>b.run_number-a.run_number);
  return sha?done.find(r=>r.display_title.split(/\s+/)[1]?.startsWith(sha)||sha.startsWith(r.display_title.split(/\s+/)[1]??'-')):done[0];
}
/** The board's line for a site print: date, build, verdict, the summary's lines, the run. */
export function siteLine({sha12,conclusion,resumo,url,at}){
  const lines=resumo.split('\n').map(l=>l.trim()).filter(Boolean).filter(l=>!l.startsWith('Partida solo em'));
  return `- ${at.slice(0,16).replace('T',' ')}Z \`${sha12}\` ${conclusion==='success'?'ok':'FALHOU'}: ${lines.join(' · ')||'(sem resumo)'} (${url})`;
}
/** Folder-safe branch name. */
export const safe=s=>s.replace(/[^\w.-]+/g,'-').replace(/^-+|-+$/g,'');

// ---------------------------------------------------------------------------------------------------------------
// GitHub (token from git's credential helper, in memory only)
// ---------------------------------------------------------------------------------------------------------------

function token(){
  try{
    const out=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
    return /^password=(.+)$/m.exec(out)?.[1]?.trim()||undefined;
  }catch{return undefined;}
}
function client(tok){
  const headers={Authorization:`Bearer ${tok}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'viagem-gif-ci'};
  const call=async(method,p,body)=>{
    const r=await fetch(p.startsWith('http')?p:`${API}${p}`,{method,headers:{...headers,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new InfraError(`GitHub ${method} ${p}: HTTP ${r.status} ${(await r.text()).slice(0,200)}`);
    return r.status===204?null:r.json();
  };
  return {
    get:p=>call('GET',p),post:(p,b)=>call('POST',p,b),
    /** An artifact's zip, unpacked into `dir` (the system tar reads zips on Windows 10+ and Linux runners). */
    async download(art,dir){
      const r=await fetch(art.archive_download_url,{headers:{Authorization:`Bearer ${tok}`,'User-Agent':'viagem-gif-ci'},signal:AbortSignal.timeout(600000)});
      if(!r.ok)throw new InfraError(`artefato ${art.name}: HTTP ${r.status}`);
      fs.mkdirSync(dir,{recursive:true});
      const zip=path.join(dir,'artefato.zip');fs.writeFileSync(zip,Buffer.from(await r.arrayBuffer()));
      try{execFileSync(process.platform==='win32'?'C:/Windows/System32/tar.exe':'tar',['-xf',zip,'-C',dir],{timeout:120000,windowsHide:true});}
      finally{fs.rmSync(zip,{force:true});}
    },
  };
}
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000}).trim();
/** The commit GitHub has for `target`: a full sha as is, else the branch on origin (the local one may be ahead). */
function remoteSha(target){
  if(/^[0-9a-f]{40}$/.test(target))return target;
  const line=git('ls-remote','origin',`refs/heads/${target}`);
  const sha=line.split(/\s+/)[0];
  if(!/^[0-9a-f]{40}$/.test(sha??''))throw new InfraError(`${target} não está no GitHub (git push origin ${target} antes)`);
  try{const local=git('rev-parse','--verify',`refs/heads/${target}^{commit}`);if(local!==sha)say(`aviso: o ${target} local (${local.slice(0,7)}) não é o do GitHub (${sha.slice(0,7)}); gravo o do GitHub`);}catch{}
  return sha;
}

async function cmdGif(o,gh){
  const sha=remoteSha(o.target),pedido=pedidoId(),f=o.flags;
  const body=dispatchBody({workflowRef:f['workflow-ref']??'main',sha,roteiro:o.roteiro,tela:f.tela??'celular',segundos:Number(f.segundos??20),modo:f.modo??'normal',pedido});
  await gh.post(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,body);
  say(`pedido ${pedido}: ${o.roteiro} ${body.inputs.tela} ${body.inputs.segundos} s de ${o.target}@${sha.slice(0,7)} (gif.yml em ${body.ref})`);
  const start=Date.now(),timeoutMs=Number(f.timeout??40)*60000;let run,status='';
  for(;;){
    if(!run){const {workflow_runs:runs=[]}=await gh.get(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`);run=runOfPedido(runs,pedido);}
    else run=await gh.get(`/repos/${REPO}/actions/runs/${run.id}`);
    if(run&&run.status!==status){status=run.status;say(`run ${run.html_url}: ${status}`);}
    if(run?.status==='completed')break;
    if(!run&&Date.now()-start>5*60000)throw new InfraError(`nenhum run do pedido ${pedido} em 5 min (gif.yml existe em ${body.ref}?)`);
    if(Date.now()-start>timeoutMs)throw new InfraError(`passou de ${timeoutMs/60000} min esperando ${run?.html_url??pedido}`);
    await sleep(20000);
  }
  const {artifacts=[]}=await gh.get(`/repos/${REPO}/actions/runs/${run.id}/artifacts`);
  const art=artifacts.find(a=>a.name===`gif-${pedido}`&&!a.expired);
  if(!art){console.log(`${run.conclusion}: sem artefato (${run.html_url})`);return run.conclusion==='success'?2:1;}
  const dir=path.resolve(f.saida??path.join('evidence','ci-gif',safe(o.target),`${sha.slice(0,7)}-${o.roteiro}-${pedido.slice(0,12)}`));
  await gh.download(art,dir);
  const resumo=fs.existsSync(path.join(dir,'resumo.md'))?fs.readFileSync(path.join(dir,'resumo.md'),'utf8').trim():'(sem resumo.md)';
  console.log(resumo);
  for(const sub of fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()))
    for(const file of ['quadros.png','meio.png','partida.gif'])if(fs.existsSync(path.join(dir,sub.name,file)))console.log(`  ${path.join(dir,sub.name,file).replaceAll('\\','/')}`);
  console.log(run.html_url);
  return run.conclusion==='success'?0:1;
}

async function cmdSite(o,gh){
  const quadro=o.flags.quadro??process.env.VIAGEM_BOARD??'D:/Gits/viagem-board';
  const {workflow_runs:runs=[]}=await gh.get(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_run&per_page=20`);
  const run=siteRun(runs,o.flags.sha);
  if(!run)throw new InfraError(`nenhum print do site${o.flags.sha?` do ${o.flags.sha}`:''} terminado ainda`);
  const sha12=run.display_title.split(/\s+/)[1].slice(0,12);
  const {artifacts=[]}=await gh.get(`/repos/${REPO}/actions/runs/${run.id}/artifacts`);
  const art=artifacts.find(a=>a.name===`site-${sha12}`&&!a.expired);
  const dir=path.join(quadro,'evidence','site',sha12);
  let resumo='';
  if(art){await gh.download(art,dir);try{resumo=fs.readFileSync(path.join(dir,'resumo.md'),'utf8');}catch{}}
  const line=siteLine({sha12,conclusion:run.conclusion,resumo:resumo||(art?'':'sem artefato'),url:run.html_url,at:run.updated_at});
  const board=path.join(quadro,'site-prints.md');
  const had=fs.existsSync(board)?fs.readFileSync(board,'utf8'):'# Print do site depois de cada deploy (tools/gif-ci.mjs site)\n\n';
  if(!had.includes(`\`${sha12}\``))fs.writeFileSync(board,had.replace(/\n*$/,'\n')+line+'\n');
  console.log(line);
  if(art)for(const f of fs.readdirSync(dir,{recursive:true}).map(String).filter(f=>/\.(png)$/.test(f)))console.log(`  ${path.join(dir,f).replaceAll('\\','/')}`);
  return run.conclusion==='success'?0:1;
}

export async function main(argv){
  let o;
  try{o=parseArgs(argv);}catch(e){console.error(e.message);return 2;}
  const tok=token();
  if(!tok){console.error('sem token do GitHub (git credential fill): nada foi pedido. À mão: GitHub → Actions → GIF → Run workflow.');return 2;}
  try{return await (o.cmd==='site'?cmdSite:cmdGif)(o,client(tok));}
  catch(e){console.error(`${e instanceof InfraError?'infra':'erro'}: ${String(e.message??e).split('\n')[0]}`);return 2;}
}

const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(entry===import.meta.url)process.exitCode=await main(process.argv.slice(2));
