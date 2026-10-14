// D-049 item 3 (NEW-20261014-ORQ-fila-integracao-e-testes-afetados): the integration queue. Replaces the manual
// locks/integracao: executors queue what is ready, one batch merges it all, gives the protocol one number, runs the suite
// once, sends back what conflicts or breaks it, publishes the Worker once (the Orquestrador's step, D-029) and pushes once.
//
//   node tools/fila.mjs pronto <card> --branch vgm/x [--worker] [--protocol] [--prio P0|P1|P2] [--dono Executor-N]
//   node tools/fila.mjs lista
//   node tools/fila.mjs lote [--suite local|ci|"<command>"]      (the Orquestrador, or his cron)
//   node tools/fila.mjs publicar <lote>                          (after `npm run deploy:rooms` when the lote needs it)
//   node tools/fila.mjs cancelar <lote>
// Options for tests and the simulation: --repo <main checkout> --board <board dir> --wt <worktree root> --remote origin
// --base main --protocol-file src/protocol/protocol4.ts --protocol-json public/multiplayer.json --no-modules.
//
// Board files: fila/<card>.json (queued), fila/lotes/<lote>.json (a batch), fila/resultados/<card>.json (the answer to
// the owner: integrado + SHA, or devolvido + reason), integrated/<card> (as before). fila/.lote is the batch lock.
// The suite (`--suite`): `local` runs the whole node:test suite here (TAP to a file, the failing files read from it);
// `ci` pushes the batch branch and runs `node tools/ci.mjs test <branch> --json` (E7: {ok, failedFiles, url});
// any other string is a shell command run in the batch checkout (exit 0 = green; it may print `FILA-FAILED: [...]`, and
// gets the files to run in FILA_FILES when the queue looks for the culprit).
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync,rmdirSync,statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PRIO={P0:0,P1:1,P2:2,P3:3};

// ---------- options ----------
function parse(argv){
  const o={_:[],flags:new Set()};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')){o._.push(a);continue;}
    const k=a.slice(2);
    if(['worker','protocol','no-modules','dry'].includes(k))o.flags.add(k);
    else o[k]=argv[++i];
  }
  const repo=resolve(o.repo??SELF_ROOT);
  return {...o,repo,board:resolve(o.board??join(repo,'..','viagem-board')),wt:resolve(o.wt??join(repo,'..','viagem-wt')),
    remote:o.remote??'origin',base:o.base??'main',protocolFile:o['protocol-file']??'src/protocol/protocol4.ts',
    protocolJson:o['protocol-json']??'public/multiplayer.json',modules:!o.flags.has('no-modules'),suite:o.suite??'local'};
}

// ---------- helpers ----------
const sh=(cwd,cmd,args,opts={})=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20,...opts}).trim();
const git=(cwd,...args)=>sh(cwd,'git',args);
const tryGit=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});return {ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const readJson=(p)=>JSON.parse(readFileSync(p,'utf8'));
const writeJson=(p,v)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const stamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'').replace('T','-');
const log=(...a)=>console.log('[fila]',...a);

/** The queued entries, P0 first, then by arrival. */
export function ordered(entries){
  return [...entries].sort((a,b)=>(PRIO[a.prio]??9)-(PRIO[b.prio]??9)||String(a.at).localeCompare(String(b.at))||a.card.localeCompare(b.card));
}

/**
 * One bump for the batch: PROTOCOL_VERSION n → n+1 in the protocol file (with a history line naming the cards) and the
 * same number in the site's multiplayer.json. Returns the new number.
 */
export function bumpProtocol(checkout,protocolFile,protocolJson,cards,lote){
  const pf=join(checkout,protocolFile),text=readFileSync(pf,'utf8'),m=/export const PROTOCOL_VERSION=(\d+);/.exec(text);
  if(!m)throw new Error(`${protocolFile}: no PROTOCOL_VERSION`);
  const next=Number(m[1])+1;
  const line=` * ${next} given by the integration queue (tools/fila.mjs, lote ${lote}) to: ${cards.join(', ')}.\n`;
  const doc=text.replace(/( \* The join handshake refuses other versions)/,`${line}$1`);
  writeFileSync(pf,(doc===text?text:doc).replace(m[0],`export const PROTOCOL_VERSION=${next};`));
  const jf=join(checkout,protocolJson),cfg=readJson(jf);cfg.protocol=next;writeFileSync(jf,JSON.stringify(cfg));
  return next;
}

/**
 * Failing test files from a node:test TAP stream: each top-level "not ok N - <name>" is followed by its YAML block, whose
 * `location: '<path>:<line>:<col>'` names the file (a file that fails to load has its own path as the name). Paths come
 * back repo-relative from their `tests/` part, with forward slashes.
 */
export function failedFilesFromTap(tap){
  const out=new Set(),lines=tap.split(/\r?\n/);
  const rel=(p)=>{const s=p.replace(/\\\\/g,'/').replace(/\\/g,'/').replace(/:\d+:\d+$/,''),i=s.lastIndexOf('/tests/');return i>=0?s.slice(i+1):s.replace(/^\.\//,'');};
  for(let i=0;i<lines.length;i++){
    const m=/^not ok \d+ - (.+?)\s*$/.exec(lines[i]);
    if(!m)continue;
    let file;
    for(let j=i+1;j<lines.length&&/^\s/.test(lines[j]);j++){const l=/^\s+location: '(.+)'\s*$/.exec(lines[j]);if(l){file=rel(l[1]);break;}}
    if(!file&&/\.test\.[cm]?[jt]s$/.test(m[1]))file=rel(m[1]);
    if(file)out.add(file);
  }
  return [...out];
}

// ---------- worktrees (the shared node_modules are junctions: always removed before the worktree, see ESCALA.md) ----------
const JUNCTIONS=['node_modules','backend/node_modules'];
function addWorktree(opt,name,branch,at){
  const dir=join(opt.wt,name);
  git(opt.repo,'worktree','add','-B',branch,dir,at);
  if(opt.modules&&process.platform==='win32')for(const j of JUNCTIONS){
    const src=join(opt.repo,j);if(!existsSync(src)||!existsSync(dirname(join(dir,j))))continue;
    spawnSync('cmd',['/c','mklink','/J',join(dir,j),src],{stdio:'ignore'});
  }
  return dir;
}
function removeWorktree(opt,dir,branch){
  if(!existsSync(dir))return;
  // rmdirSync drops a junction itself, never its target (checked on Windows). If one cannot go, stop: `git worktree
  // remove` would follow it into the shared packages (it emptied them twice in October 2026).
  for(const j of JUNCTIONS){const p=join(dir,j);try{if(existsSync(p))rmdirSync(p);}catch{/* checked just below */}
    if(existsSync(p))throw new Error(`${p} ficou: remova a junção à mão antes de apagar o worktree ${dir}`);}
  tryGit(opt.repo,'worktree','remove','--force',dir);
  if(branch)tryGit(opt.repo,'branch','-D',branch);
}

// ---------- the suite ----------
/** {ok, failedFiles, url?} for the checkout; `files` limits the run (the culprit search). */
function runSuite(opt,dir,branch,files){
  if(opt.suite==='local'){
    const tap=join(dir,'.fila-tap.txt'),targets=files?.length?files:['tests/**/*.test.ts'];
    const r=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-concurrency=4','--test-reporter=tap',`--test-reporter-destination=${tap}`,...targets],{cwd:dir,stdio:'ignore'});
    const text=existsSync(tap)?readFileSync(tap,'utf8'):'';rmSync(tap,{force:true});
    return {ok:r.status===0,failedFiles:r.status===0?[]:failedFilesFromTap(text)};
  }
  if(opt.suite==='ci'&&!files){
    git(dir,'push','-f',opt.remote,`${branch}:${branch}`);
    const r=spawnSync(process.execPath,[join(dir,'tools','ci.mjs'),'test',branch,'--json'],{cwd:dir,encoding:'utf8'});
    try{const j=JSON.parse((r.stdout??'').trim().split('\n').pop());return {ok:!!j.ok,failedFiles:j.failedFiles??[],url:j.url};}
    catch{return {ok:false,failedFiles:[],error:`tools/ci.mjs: ${(r.stderr||r.stdout||'').slice(-400)}`};}
  }
  // A shell command (also the culprit runs of --suite ci, which are local and short).
  const cmd=opt.suite==='ci'?null:opt.suite;
  if(!cmd)return runSuite({...opt,suite:'local'},dir,branch,files);
  const r=spawnSync(cmd,{cwd:dir,shell:true,encoding:'utf8',env:{...process.env,FILA_FILES:(files??[]).join(',')}});
  const m=/FILA-FAILED: (\[.*\])/.exec(r.stdout??'');
  return {ok:r.status===0,failedFiles:m?JSON.parse(m[1]):[]};
}

// ---------- commands ----------
function pronto(opt){
  const [card]=opt._.slice(1);
  if(!card||!opt.branch)throw new Error('uso: pronto <card> --branch <branch> [--worker] [--protocol] [--prio P0] [--dono Executor-N]');
  const sha=git(opt.repo,'rev-parse',opt.branch);
  const entry={card,branch:opt.branch,sha,worker:opt.flags.has('worker')||opt.flags.has('protocol'),protocol:opt.flags.has('protocol'),
    prio:opt.prio??'P1',dono:opt.dono??'',at:new Date().toISOString()};
  writeJson(join(opt.board,'fila',`${card}.json`),entry);
  rmSync(join(opt.board,'fila','resultados',`${card}.json`),{force:true});
  log(`na fila: ${card} ${opt.branch} ${sha.slice(0,7)}${entry.protocol?' (protocolo)':''}${entry.worker?' (Worker)':''}`);
  return entry;
}

function queued(opt){
  const dir=join(opt.board,'fila');
  if(!existsSync(dir))return [];
  return readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>readJson(join(dir,f)));
}

function answer(opt,entry,result){
  writeJson(join(opt.board,'fila','resultados',`${entry.card}.json`),{...entry,...result,em:new Date().toISOString()});
  rmSync(join(opt.board,'fila',`${entry.card}.json`),{force:true});
}

/** Merges `entries` on a fresh batch branch from the remote base; conflicts and moved branches are sent back. */
function mergeBatch(opt,lote,entries,sendBack){
  const branch=`fila/${lote}`,baseRef=`${opt.remote}/${opt.base}`;
  const base=git(opt.repo,'rev-parse',baseRef);
  const dir=addWorktree(opt,`fila-${lote}`,branch,base);
  const merged=[];
  for(const e of entries){
    const now=tryGit(opt.repo,'rev-parse',e.branch);
    if(!now.ok||now.out!==e.sha){sendBack(e,{motivo:'branch mudou depois do pronto (rode pronto de novo)',agora:now.out||null});continue;}
    const r=tryGit(dir,'merge','--no-ff','--no-edit','-m',`fila ${lote}: ${e.card}`,e.sha);
    if(!r.ok){
      const files=tryGit(dir,'diff','--name-only','--diff-filter=U').out.split('\n').filter(Boolean);
      tryGit(dir,'merge','--abort');
      sendBack(e,{motivo:'conflito',arquivos:files,base:base.slice(0,7)});continue;
    }
    merged.push(e);
  }
  return {dir,branch,base,merged};
}

function lote(opt){
  const lockDir=join(opt.board,'fila','.lote');
  mkdirSync(join(opt.board,'fila'),{recursive:true});
  try{mkdirSync(lockDir);}catch{throw new Error(`há um lote aberto (${lockDir}): publicar ou cancelar antes`);}
  const id=stamp(),entries=ordered(queued(opt));
  writeFileSync(join(lockDir,'lote.txt'),id);
  if(!entries.length){rmdirSync(lockDir);log('fila vazia');return {lote:id,integrados:[],devolvidos:[]};}
  git(opt.repo,'fetch','-q',opt.remote);
  const devolvidos=[],sendBack=(e,why)=>{devolvidos.push({card:e.card,...why});answer(opt,e,{status:'devolvido',lote:id,...why});log(`devolvido: ${e.card} — ${why.motivo}`);};
  let candidates=entries,suites=0,result;
  for(let round=0;round<3;round++){
    const batch=mergeBatch(opt,id,candidates,sendBack);
    if(!batch.merged.length){removeWorktree(opt,batch.dir,batch.branch);result=undefined;break;}
    const withProtocol=batch.merged.filter(e=>e.protocol);
    let protocol;
    if(withProtocol.length){
      protocol=bumpProtocol(batch.dir,opt.protocolFile,opt.protocolJson,withProtocol.map(e=>e.card),id);
      git(batch.dir,'commit','-q','-am',`fila ${id}: protocolo ${protocol} (${withProtocol.map(e=>e.card).join(', ')})`);
    }
    suites++;log(`suíte do lote (${batch.merged.map(e=>e.card).join(', ')})…`);
    const s=runSuite(opt,batch.dir,batch.branch);
    if(s.ok){result={...batch,protocol,suite:s};break;}
    log(`suíte falhou: ${s.failedFiles.join(', ')||s.error||'(sem lista)'}`);
    // The culprit: each merged branch alone on the base, running only the failing files.
    const culprits=[];
    if(s.failedFiles.length){
      for(const e of batch.merged){
        const alone=addWorktree(opt,`fila-${id}-teste`,`fila/${id}-teste`,batch.base);
        try{
          const m=tryGit(alone,'merge','--no-ff','--no-edit',e.sha);
          if(m.ok&&!runSuite({...opt,suite:opt.suite==='ci'?'local':opt.suite},alone,`fila/${id}-teste`,s.failedFiles).ok)culprits.push(e);
        }finally{removeWorktree(opt,alone,`fila/${id}-teste`);}
      }
    }
    removeWorktree(opt,batch.dir,batch.branch);
    const blamed=culprits.length?culprits:batch.merged;
    for(const e of blamed)sendBack(e,{motivo:culprits.length?'a suíte falha com a branch':'a suíte falha só com o lote junto (nenhuma sozinha): devolvido para rodar de novo',falhas:s.failedFiles,url:s.url});
    candidates=batch.merged.filter(e=>!blamed.includes(e));
    if(!candidates.length){result=undefined;break;}
  }
  if(!result){rmdirSyncSafe(lockDir);log(`lote ${id}: nada integrado (${suites} suíte(s))`);return {lote:id,integrados:[],devolvidos,suites};}
  const sha=git(result.dir,'rev-parse','HEAD'),needsWorker=result.merged.some(e=>e.worker);
  const state={lote:id,branch:result.branch,dir:result.dir,base:result.base,sha,protocol:result.protocol??null,needsWorker,suites,
    integrados:result.merged,devolvidos,url:result.suite.url??null,estado:needsWorker?'aguardando-worker':'pronto-para-push'};
  writeJson(join(opt.board,'fila','lotes',`${id}.json`),state);
  log(`lote ${id} verde em ${suites} suíte(s): ${sha.slice(0,7)}${state.protocol?`, protocolo ${state.protocol}`:''}`);
  if(needsWorker)log(`Orquestrador: publique o Worker a partir de ${sha.slice(0,7)} (cd ${result.dir} && npm run deploy:rooms) e rode: node tools/fila.mjs publicar ${id}`);
  else return publicar({...opt,_:['publicar',id]});
  return state;
}

function rmdirSyncSafe(dir){try{for(const f of readdirSync(dir))rmSync(join(dir,f),{force:true});rmdirSync(dir);}catch{/* already gone */}}

function publicar(opt){
  const id=opt._[1],p=join(opt.board,'fila','lotes',`${id}.json`);
  if(!existsSync(p))throw new Error(`lote ${id} não existe`);
  const state=readJson(p);
  git(opt.repo,'fetch','-q',opt.remote);
  const remoteBase=git(opt.repo,'rev-parse',`${opt.remote}/${opt.base}`);
  if(remoteBase!==state.base)throw new Error(`a ${opt.base} andou (${state.base.slice(0,7)} → ${remoteBase.slice(0,7)}): cancele e rode o lote de novo`);
  git(opt.repo,'push',opt.remote,`${state.sha}:refs/heads/${opt.base}`);
  // The main checkout follows by fast-forward only, when it is on the base branch and clean.
  const cur=tryGit(opt.repo,'rev-parse','--abbrev-ref','HEAD').out,clean=tryGit(opt.repo,'status','--porcelain').out==='';
  if(cur===opt.base&&clean)tryGit(opt.repo,'merge','--ff-only',state.sha);
  for(const e of state.integrados){
    answer(opt,e,{status:'integrado',lote:id,sha:state.sha,protocolo:state.protocol});
    mkdirSync(join(opt.board,'integrated'),{recursive:true});writeFileSync(join(opt.board,'integrated',e.card),'');
  }
  removeWorktree(opt,state.dir,state.branch);
  writeJson(p,{...state,estado:'publicado',em:new Date().toISOString()});
  rmdirSyncSafe(join(opt.board,'fila','.lote'));
  log(`publicado ${state.sha.slice(0,7)}: ${state.integrados.map(e=>e.card).join(', ')}`);
  for(const d of state.devolvidos)log(`avise ${d.card}: ${d.motivo}`);
  return {...state,estado:'publicado'};
}

function cancelar(opt){
  const id=opt._[1],p=join(opt.board,'fila','lotes',`${id}.json`);
  if(existsSync(p)){
    const state=readJson(p);removeWorktree(opt,state.dir,state.branch);
    // The integrated-to-be go back to the queue as they were.
    for(const e of state.integrados)writeJson(join(opt.board,'fila',`${e.card}.json`),e);
    writeJson(p,{...state,estado:'cancelado'});
  }
  rmdirSyncSafe(join(opt.board,'fila','.lote'));
  log(`lote ${id} cancelado`);
}

export function main(argv){
  const opt=parse(argv),cmd=opt._[0];
  if(cmd==='pronto')return pronto(opt);
  if(cmd==='lista'){for(const e of ordered(queued(opt)))console.log(`${e.prio} ${e.card} ${e.branch} ${e.sha.slice(0,7)}${e.protocol?' protocolo':''}${e.worker?' worker':''} ${e.dono}`);return;}
  if(cmd==='lote')return lote(opt);
  if(cmd==='publicar')return publicar(opt);
  if(cmd==='cancelar')return cancelar(opt);
  throw new Error('comandos: pronto, lista, lote, publicar, cancelar');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(e){console.error(`[fila] ${e.message}`);process.exitCode=1;}
}
