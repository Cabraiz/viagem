// D-049 item 3 (NEW-20261014-ORQ-fila-integracao-e-testes-afetados): the integration queue. Replaces the manual
// locks/integracao: executors queue what is ready, one batch merges it all, gives the protocol one number, runs the suite
// once, sends back what conflicts or breaks it (a conflict only in public/art/manifest.json is regenerated instead:
// resolveIndexConflict), publishes the Worker once (the Orquestrador's step, D-029) and pushes once.
//
//   node tools/fila.mjs pronto <card> --branch vgm/x [--worker] [--protocol] [--prio P0|P1|P2] [--dono Executor-N]
//   node tools/fila.mjs lista
//   node tools/fila.mjs lote [--suite local|ci|"<command>"]      (the Orquestrador, or his cron)
//   node tools/fila.mjs publicar <lote>                          (after `npm run deploy:rooms` when the lote needs it:
//                                                                 a --worker entry, or a map/protocol change, CONTRACT_PATHS)
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
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync,rmdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JUNCTIONS,removeWorktreeSafe} from './wt-rm.mjs';

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
  // The main checkout, also when the tool runs from a worktree (D:/Gits/viagem-wt/x): the parent of git's common dir.
  const repo=resolve(o.repo??mainCheckout(SELF_ROOT));
  return {...o,repo,board:resolve(o.board??join(repo,'..','viagem-board')),wt:resolve(o.wt??join(repo,'..','viagem-wt')),
    remote:o.remote??'origin',base:o.base??'main',protocolFile:o['protocol-file']??'src/protocol/protocol4.ts',
    protocolJson:o['protocol-json']??'public/multiplayer.json',modules:!o.flags.has('no-modules'),suite:o.suite??'local'};
}

// ---------- helpers ----------
const sh=(cwd,cmd,args,opts={})=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20,...opts}).trim();
const git=(cwd,...args)=>sh(cwd,'git',args);
const tryGit=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});return {ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const readJson=(p)=>JSON.parse(readFileSync(p,'utf8'));
/** Atomic: a reader (a running lote, `lista`) never sees half a file. */
const writeJson=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const tmp=`${p}.${process.pid}.tmp`;writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');renameSync(tmp,p);};
/** The main checkout of the repository `dir` belongs to (the parent of its common .git dir). */
export function mainCheckout(dir){
  const r=spawnSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:dir,encoding:'utf8'});
  return r.status===0?dirname(r.stdout.trim()):dir;
}
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
  const jf=join(checkout,protocolJson),raw=readFileSync(jf,'utf8'),cfg=JSON.parse(raw);cfg.protocol=next;
  writeFileSync(jf,JSON.stringify(cfg)+(raw.endsWith('\n')?'\n':''));
  return next;
}

/**
 * Failing test files from a node:test TAP stream: each top-level "not ok N - <name>" is followed by its YAML block, whose
 * `location: '<path>:<line>:<col>'` names the file (a file that fails to load has its own path as the name). Paths come
 * back repo-relative from their `tests/` part, with forward slashes.
 */
/**
 * The smoke's output for a lot's reason: its verdict lines (`smoke <modo>: …`, the upgrade's notes), else the start of
 * it. The traces come first and pushed the verdict out of a 400-character cut (review of vgm/smoke-renderer).
 */
export function smokeGist(text){
  const all=String(text??'').trim(),verdict=all.split(/\r?\n/).filter(l=>/^smoke\b/.test(l));
  return (verdict.length?verdict.join(' / '):all).slice(0,600);
}

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

// ---------- what the Worker matches with the client (NEW-20261017-ORQ-fila-deploy-seguro) ----------
/**
 * Paths whose change makes the live Worker refuse the live site (or the other way round): the maps' manifests
 * (version + hash, map-select readMapRef), the asset bytes behind them, the room protocol and its number in the site's
 * multiplayer.json. A lote that touches one needs the Worker even with no --worker entry, and the queue warns that the
 * live site is out of step with the new Worker until pages.yml publishes it (~20 min; lote 13, map v2 → v3). The order
 * stays deploy:rooms first, then publicar (fila-deploy-ordem): pages.yml has no Cloudflare token, so the Worker goes up
 * only by hand, and pages.yml's gate (scripts/health-gate.mjs) holds the site until the live Worker matches it.
 */
export const CONTRACT_PATHS=[/^public\/maps\/[^/]+\.json$/,/^src\/protocol\//,/^public\/multiplayer\.json$/];
export const contractFiles=(changed)=>changed.filter(f=>CONTRACT_PATHS.some(re=>re.test(f)));
const outOfStep=(contrato)=>`ATENÇÃO: o lote muda o que o Worker casa com o cliente (${contrato.slice(0,4).join(', ')}${contrato.length>4?', …':''}): `
  +'depois do deploy:rooms, o site no ar fica fora de passo por ~20 min, até o pages.yml publicar (o health-gate dele segura o site até o Worker casar)';

// ---------- the art index (NEW-20261017-ORQ-fila-manifest-auto) ----------
/** The importer's index of every art group: derived from the group manifests, so a conflict in it alone is not real. */
export const INDEX_FILE='public/art/manifest.json';
/** The batch checkout's own writeIndex over its own group manifests (scripts/art-v2), as a child: the tool loads none of it. */
const REGEN_INDEX=`import {pathToFileURL} from 'node:url';
const at=f=>pathToFileURL(process.cwd()+'/scripts/art-v2/'+f).href;
const {writeIndex}=await import(at('convert.mjs')),{GROUPS}=await import(at('spec.mjs'));
await writeIndex(GROUPS,{outRoot:process.cwd()});`;
/**
 * A merge stopped with a conflict only in INDEX_FILE: the index is written again from the group manifests on disk
 * (the merge already joined them) with the importer's writeIndex, `node scripts/art-lite.mjs --check` must pass (every
 * lite copy and liteCell matches), and the merge is committed. {ok:false, why} leaves the merge for the caller to abort.
 */
export function resolveIndexConflict(dir){
  const node=(args)=>spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8',maxBuffer:64<<20});
  // The error's own line when there is one (a stack's last lines say nothing), else the end of the output.
  const tail=(r)=>{const lines=`${r.stderr??''}${r.stdout??''}`.trim().split(/\r?\n/).filter(l=>l.trim());
    return (lines.find(l=>/\b\w*Error\b/.test(l))??lines.slice(-2).join(' / ')).trim().slice(0,400);};
  const regen=node(['--input-type=module','-e',REGEN_INDEX]);
  if(regen.status!==0)return {ok:false,why:`${INDEX_FILE}: writeIndex falhou (${tail(regen)})`};
  const check=node(['scripts/art-lite.mjs','--check']);
  if(check.status!==0)return {ok:false,why:`${INDEX_FILE} regerado, mas art-lite --check falhou (${tail(check)})`};
  const add=tryGit(dir,'add','--',INDEX_FILE);
  const commit=add.ok?tryGit(dir,'commit','-q','--no-edit'):add;
  return commit.ok?{ok:true}:{ok:false,why:`${INDEX_FILE}: commit do merge falhou (${commit.err.slice(0,200)})`};
}

// ---------- worktrees (the shared node_modules are junctions: always removed before the worktree, see ESCALA.md) ----------
// The links made in a batch worktree: tools/wt-rm.mjs's JUNCTIONS (imported), the same ones it drops.
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
  // tools/wt-rm.mjs: the junctions dropped and CHECKED gone, nothing else pointing outside, only then the remove (the
  // shared node_modules were emptied four times by a plain `git worktree remove`). It throws instead of removing.
  removeWorktreeSafe(dir,{repo:opt.repo});
  // The batch branch goes with its worktree, and from the remote when --suite ci pushed it.
  if(branch){tryGit(opt.repo,'branch','-D',branch);if(opt.suite==='ci'&&branch.startsWith('fila/'))tryGit(opt.repo,'push','-q',opt.remote,'--delete',branch);}
}

// ---------- the suite ----------
/** The environment of a node --test of its own: without NODE_TEST_CONTEXT (set when the queue runs under a test runner, its
 * tests), a nested node --test reports to that parent and exits 0 on a red file. */
const ownTestRun=()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;return env;};
/** {ok, failedFiles, url?} for the checkout; `files` limits the run (the culprit search). */
function runSuite(opt,dir,branch,files){
  if(opt.suite==='local'){
    // A failing file a branch adds does not exist on the base or on an earlier step: it cannot fail there.
    const present=files?.length?files.filter(f=>existsSync(join(dir,f))):null;
    if(present&&!present.length)return {ok:true,failedFiles:[]};
    const tap=join(dir,'.fila-tap.txt'),targets=present??['tests/**/*.test.ts'];
    const r=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-concurrency=4','--test-reporter=tap',`--test-reporter-destination=${tap}`,...targets],{cwd:dir,stdio:'ignore',env:ownTestRun()});
    const text=existsSync(tap)?readFileSync(tap,'utf8'):'';rmSync(tap,{force:true});
    return {ok:r.status===0,failedFiles:r.status===0?[]:failedFilesFromTap(text)};
  }
  if(opt.suite==='ci'&&!files){
    // E7's tools/ci.mjs: the branch must be on the remote (its push runs ci.yml on fila/**); exit 0 green, 1 red,
    // 2 = network/API/no run in time → the local suite. Without the tool yet, local too.
    const ci=join(dir,'tools','ci.mjs');
    if(!existsSync(ci)){log('tools/ci.mjs ainda não existe: suíte local');return runSuite({...opt,suite:'local'},dir,branch,files);}
    git(dir,'push','-f',opt.remote,`${branch}:${branch}`);
    const r=spawnSync(process.execPath,[ci,'test',branch,'--json'],{cwd:dir,encoding:'utf8'});
    if(r.status===2||r.status===null){log(`tools/ci.mjs sem resposta (exit ${r.status}): suíte local`);return runSuite({...opt,suite:'local'},dir,branch,files);}
    try{const j=JSON.parse((r.stdout??'').trim());return {ok:r.status===0&&!!j.ok,failedFiles:j.failedFiles??[],url:j.url};}
    catch{return {ok:false,failedFiles:[],error:`tools/ci.mjs (exit ${r.status}): ${(r.stderr||r.stdout||'').slice(0,400)}`};}
  }
  // A shell command (also the culprit runs of --suite ci, which are local and short).
  const cmd=opt.suite==='ci'?null:opt.suite;
  if(!cmd)return runSuite({...opt,suite:'local'},dir,branch,files);
  const r=spawnSync(cmd,{cwd:dir,shell:true,encoding:'utf8',env:{...process.env,FILA_FILES:(files??[]).join(',')}});
  const m=/FILA-FAILED: (\[.*\])/.exec(r.stdout??'');
  return {ok:r.status===0,failedFiles:m?JSON.parse(m[1]):[]};
}

// ---------- the production smoke ----------
const sleep=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
/**
 * `npm run build` and E8's scripts/smoke-prod.mjs in the batch checkout (exit 0 ok, 1 broken, 2 infrastructure), holding
 * one of the PC's two headless-browser slots (board locks/browser-1|2, ESCALA.md). `--smoke "<cmd>"` replaces it (tests),
 * `--smoke off` skips it; a checkout without the script yet skips it with a log line.
 */
function runSmoke(opt,dir,prev){
  if(opt.smoke==='off')return {ok:true,skipped:true};
  if(opt.smoke){
    const r=spawnSync(opt.smoke,{cwd:dir,shell:true,encoding:'utf8'});
    return r.status===0?{ok:true}:{ok:false,motivo:`${opt.smoke} saiu com ${r.status}: ${(r.stdout+r.stderr).trim().slice(0,300)}`};
  }
  const script=join(dir,'scripts','smoke-prod.mjs');
  if(!existsSync(script)){log('smoke de produção: scripts/smoke-prod.mjs ainda não existe na main; pulado');return {ok:true,skipped:true};}
  let slot;
  // The folder itself first: without it every mkdir of a slot fails and reads as "taken" forever.
  mkdirSync(join(opt.board,'locks'),{recursive:true});
  for(let waited=0;!slot;waited+=5000){
    for(const n of [1,2]){try{mkdirSync(join(opt.board,'locks',`browser-${n}`));slot=join(opt.board,'locks',`browser-${n}`);break;}catch{/* taken */}}
    if(slot)break;
    if(waited>=10*60_000)return {ok:false,motivo:'nenhuma vaga de navegador em 10 min (locks/browser-1 e 2)'};
    if(waited===0)log('smoke: esperando uma vaga de navegador (locks/browser-1|2)…');
    sleep(5000);
  }
  try{
    writeFileSync(join(slot,'owner.txt'),`fila ${new Date().toISOString()}`);
    const out=join(opt.board,'fila','smoke');mkdirSync(out,{recursive:true});
    // One command string (no argument array with shell:true: node's DEP0190).
    const build=(cwd)=>spawnSync('npm run build',{cwd,encoding:'utf8',shell:true});
    const b=build(dir);
    if(b.status!==0)return {ok:false,motivo:`npm run build saiu com ${b.status}: ${(b.stderr||b.stdout||'').trim().slice(-300)}`};
    log('smoke de produção…');
    const s=spawnSync(process.execPath,[script,out],{cwd:dir,encoding:'utf8'});
    if(s.status!==0)return {ok:false,motivo:`${s.status===2?'infraestrutura do smoke':'smoke falhou'} (exit ${s.status}): ${smokeGist(s.stdout+s.stderr)}`,out};
    // The returning player (BUG-20261014-ORQ-mapa-cache-velho): the base built, then the batch on the same browser profile.
    if(prev){
      log('smoke de upgrade (a main de antes do lote → o lote)…');
      const pb=build(prev);
      if(pb.status!==0)return {ok:false,motivo:`npm run build da base saiu com ${pb.status}: ${(pb.stderr||pb.stdout||'').trim().slice(-300)}`,out};
      const u=spawnSync(process.execPath,[script,out,'--upgrade-from',prev],{cwd:dir,encoding:'utf8'});
      if(u.status!==0)return {ok:false,motivo:`${u.status===2?'infraestrutura do smoke de upgrade':'smoke de upgrade falhou'} (exit ${u.status}): ${smokeGist(u.stdout+u.stderr)}`,out};
    }
    return {ok:true,out};
  }finally{rmdirSyncSafe(slot);}
}
/** Whether the batch checkout's smoke script has the upgrade mode (--upgrade-from). */
const hasUpgradeSmoke=(dir)=>{const p=join(dir,'scripts','smoke-prod.mjs');return existsSync(p)&&readFileSync(p,'utf8').includes('upgrade-from');};

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
  const folha=printsSheet(opt.board,opt.branch,sha);
  if(folha!=='ok')log(`aviso: ${opt.branch}@${sha.slice(0,7)} ${folha} (prints.yml + tools/vigia-prints.mjs; por enquanto só avisa)`);
  return entry;
}

/**
 * The CI print sheet of this commit (NEW-20261020-ORQ-prints-no-ci): 'ok', or why not. The board's vigia-prints unpacks
 * each Prints run's artifact in evidence/prints-ci/<branch>/<sha7>/folha.json.
 */
export function printsSheet(board,branch,sha){
  const file=join(board,'evidence','prints-ci',...branch.split('/'),sha.slice(0,7),'folha.json');
  if(!existsSync(file))return 'sem folha de prints do CI';
  try{const f=readJson(file);return f.ok?'ok':`folha de prints FALHOU: ${(f.fails??[]).join(' | ').slice(0,300)}`;}
  catch(e){return `folha de prints ilegível (${e.message})`;}
}

function queued(opt){
  const dir=join(opt.board,'fila');
  if(!existsSync(dir))return [];
  const out=[];
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.json'))){
    try{out.push(readJson(join(dir,f)));}catch(e){log(`ignorado ${f}: ${e.message}`);}
  }
  return out;
}

/**
 * The answer to the owner, and the entry out of the queue — only when it is still the one the lote took: a `pronto`
 * of a newer SHA in the meantime stays queued (its answer comes from the next lote).
 */
function answer(opt,entry,result){
  writeJson(join(opt.board,'fila','resultados',`${entry.card}.json`),{...entry,...result,em:new Date().toISOString()});
  const q=join(opt.board,'fila',`${entry.card}.json`);
  let now;try{now=readJson(q);}catch{now=undefined;}
  if(now&&now.sha===entry.sha)rmSync(q,{force:true});
  else if(now)log(`${entry.card}: há um pronto mais novo (${String(now.sha).slice(0,7)}) na fila; ele fica`);
}

function lote(opt){
  const lockDir=join(opt.board,'fila','.lote');
  mkdirSync(join(opt.board,'fila'),{recursive:true});
  try{mkdirSync(lockDir);}catch{
    let open='?';try{open=readFileSync(join(lockDir,'lote.txt'),'utf8').trim();}catch{/* no id */}
    throw new Error(`há um lote aberto (${open}): node tools/fila.mjs publicar ${open} ou cancelar ${open}`);
  }
  const id=stamp(),entries=ordered(queued(opt));
  writeFileSync(join(lockDir,'lote.txt'),id);
  const made=[],wt=(name,branch,at)=>{const dir=addWorktree(opt,name,branch,at);made.push({dir,branch});return dir;};
  const drop=(dir,branch)=>{removeWorktree(opt,dir,branch);const k=made.findIndex(m=>m.dir===dir);if(k>=0)made.splice(k,1);};
  let kept=false;
  try{
    if(!entries.length){log('fila vazia');return {lote:id,integrados:[],devolvidos:[],suites:0};}
    git(opt.repo,'fetch','-q',opt.remote);
    const base=git(opt.repo,'rev-parse',`${opt.remote}/${opt.base}`);
    const devolvidos=[],sendBack=(e,why)=>{devolvidos.push({card:e.card,...why});answer(opt,e,{status:'devolvido',lote:id,...why});log(`devolvido: ${e.card} — ${why.motivo}`);};
    /** The base + `list` merged in order (+ the bump when one of them changes the protocol), in a fresh worktree. */
    const build=(name,branch,list,commit)=>{
      const dir=wt(name,branch,base),merged=[];
      for(const e of list){
        const r=tryGit(dir,'merge','--no-ff','--no-edit','-m',`fila ${id}: ${e.card}`,e.sha);
        if(!r.ok){
          const files=tryGit(dir,'diff','--name-only','--diff-filter=U').out.split('\n').filter(Boolean);
          // Only the art index in conflict (it did in almost every lote): regenerated from the group manifests, checked.
          const index=files.length===1&&files[0]===INDEX_FILE?resolveIndexConflict(dir):undefined;
          if(index?.ok){log(`${e.card}: conflito só em ${INDEX_FILE}, regerado (writeIndex + art-lite --check)`);merged.push({e,index:true});continue;}
          tryGit(dir,'merge','--abort');merged.push({e,conflict:files,...(index?{nota:index.why}:{})});continue;
        }
        merged.push({e});
      }
      const ok=merged.filter(m=>!m.conflict).map(m=>m.e),withProtocol=ok.filter(e=>e.protocol);
      let protocol;
      if(withProtocol.length){
        protocol=bumpProtocol(dir,opt.protocolFile,opt.protocolJson,withProtocol.map(e=>e.card),id);
        if(commit)git(dir,'commit','-q','-am',`fila ${id}: protocolo ${protocol} (${withProtocol.map(e=>e.card).join(', ')})`);
      }
      return {dir,merged,ok,protocol};
    };
    let candidates=[];
    for(const e of entries){
      const now=tryGit(opt.repo,'rev-parse',e.branch);
      if(!now.ok||now.out!==e.sha)sendBack(e,{motivo:'branch mudou depois do pronto (rode pronto de novo)',agora:now.out||null});
      else candidates.push(e);
    }
    let suites=0,result;
    while(candidates.length){
      const batch=build(`fila-${id}`,`fila/${id}`,candidates,true);
      for(const m of batch.merged)if(m.conflict)sendBack(m.e,{motivo:'conflito',arquivos:m.conflict,base:base.slice(0,7),...(m.nota?{nota:m.nota}:{})});
      if(!batch.ok.length){drop(batch.dir,`fila/${id}`);break;}
      suites++;log(`suíte do lote (${batch.ok.map(e=>e.card).join(', ')})…`);
      const s=runSuite(opt,batch.dir,`fila/${id}`);
      if(s.ok){result={...batch,branch:`fila/${id}`,suite:s};break;}
      log(`suíte falhou: ${s.failedFiles.join(', ')||s.error||'(sem lista de arquivos)'}`);
      drop(batch.dir,`fila/${id}`);
      const local={...opt,suite:opt.suite==='ci'?'local':opt.suite};
      // No list (a CI or machine failure, a killed run): nobody is to blame; everything stays queued.
      if(s.error||!s.failedFiles.length){
        log(`lote ${id} abortado: a suíte não disse quais testes falharam (${s.error??'sem lista'}); as entradas continuam na fila`);
        return {lote:id,abortado:'sem lista de falhas',integrados:[],devolvidos,suites};
      }
      // The main itself red in those files: not the branches' fault.
      const bare=wt(`fila-${id}-base`,`fila/${id}-base`,base);
      const baseRed=!runSuite(local,bare,`fila/${id}-base`,s.failedFiles).ok;
      drop(bare,`fila/${id}-base`);
      if(baseRed){
        log(`lote ${id} abortado: a ${opt.base} já falha em ${s.failedFiles.join(', ')}; as entradas continuam na fila`);
        return {lote:id,abortado:`a ${opt.base} falha`,falhas:s.failedFiles,integrados:[],devolvidos,suites};
      }
      // The culprit: the batch rebuilt one branch at a time (with the bump), running only the failing files; the first
      // branch whose addition makes them fail goes back, the rest gets another suite.
      let culprit;
      for(let k=1;k<=batch.ok.length&&!culprit;k++){
        const step=build(`fila-${id}-c`,`fila/${id}-c`,batch.ok.slice(0,k),false);
        if(!runSuite(local,step.dir,`fila/${id}-c`,s.failedFiles).ok)culprit=batch.ok[k-1];
        drop(step.dir,`fila/${id}-c`);
      }
      if(!culprit){
        log(`lote ${id} abortado: a falha não se repete ao refazer o lote passo a passo (instável?); as entradas continuam na fila`);
        return {lote:id,abortado:'falha não reproduzida',falhas:s.failedFiles,integrados:[],devolvidos,suites};
      }
      sendBack(culprit,{motivo:'a suíte falha com a branch (junto das anteriores do lote)',falhas:s.failedFiles,url:s.url??null});
      candidates=batch.ok.filter(e=>e!==culprit);
    }
    if(!result){log(`lote ${id}: nada integrado (${suites} suíte(s))`);return {lote:id,integrados:[],devolvidos,suites};}
    // The production build, opened in a browser (the 14/10 outage: the source suite never loads the bundle).
    // The base (the main before this lote) checked out for the upgrade smoke, when the script has that mode.
    const prev=!opt.smoke&&hasUpgradeSmoke(result.dir)?wt(`fila-${id}-anterior`,`fila/${id}-anterior`,base):undefined;
    const smoke=runSmoke(opt,result.dir,prev);
    if(prev)drop(prev,`fila/${id}-anterior`);
    if(!smoke.ok){
      log(`lote ${id} abortado: o smoke de produção falhou (${smoke.motivo}); as entradas continuam na fila`);
      return {lote:id,abortado:'smoke',smoke,integrados:[],devolvidos,suites};
    }
    const sha=git(result.dir,'rev-parse','HEAD');
    const contrato=contractFiles(git(result.dir,'diff','--name-only',base,sha).split('\n').filter(Boolean));
    const needsWorker=result.ok.some(e=>e.worker)||contrato.length>0;
    const state={lote:id,branch:result.branch,dir:result.dir,base,sha,protocol:result.protocol??null,needsWorker,contrato,suites,
      integrados:result.ok,devolvidos,url:result.suite.url??null,smoke:smoke.skipped?'sem smoke':'ok',estado:needsWorker?'aguardando-worker':'pronto-para-push'};
    writeJson(join(opt.board,'fila','lotes',`${id}.json`),state);
    kept=true;made.length=0;// the batch worktree and the lock now belong to the lote state (publicar/cancelar)
    log(`lote ${id} verde em ${suites} suíte(s): ${sha.slice(0,7)}${state.protocol?`, protocolo ${state.protocol}`:''}`);
    if(!needsWorker)return publicar({...opt,_:['publicar',id]});
    // Executors never deploy the Worker (D-029): the queue stops before the push and calls the Orquestrador.
    log(`Worker pendente: SHA ${sha.slice(0,7)} (lote ${id}). Orquestrador: npm --prefix "${result.dir.replace(/\\/g,'/')}" run deploy:rooms`);
    log(`depois, com FILA_ORQ=1: node tools/fila.mjs publicar ${id}`);
    if(contrato.length)log(outOfStep(contrato));
    return state;
  }finally{
    // A crash or an early return: no worktree is left with live junctions, and the lock goes unless a lote state holds it.
    for(const m of [...made].reverse()){try{removeWorktree(opt,m.dir,m.branch);}catch(e){log(`ATENÇÃO: ${e.message}`);}}
    if(!kept)rmdirSyncSafe(lockDir);
  }
}

function rmdirSyncSafe(dir){try{for(const f of readdirSync(dir))rmSync(join(dir,f),{force:true});rmdirSync(dir);}catch{/* already gone */}}

function publicar(opt){
  const id=opt._[1],p=join(opt.board,'fila','lotes',`${id}.json`);
  if(!existsSync(p))throw new Error(`lote ${id} não existe`);
  const state=readJson(p);
  if(state.estado!=='aguardando-worker'&&state.estado!=='pronto-para-push')throw new Error(`lote ${id} está ${state.estado}: não publico`);
  // A lote that needs the Worker is pushed only by the Orquestrador, after his deploy (executors never run wrangler).
  if(state.needsWorker&&process.env.FILA_ORQ!=='1')throw new Error(`Worker pendente: SHA ${state.sha.slice(0,7)} (lote ${id}) — só o Orquestrador publica este lote, depois do deploy:rooms (FILA_ORQ=1)`);
  git(opt.repo,'fetch','-q',opt.remote);
  const remoteBase=git(opt.repo,'rev-parse',`${opt.remote}/${opt.base}`);
  if(remoteBase!==state.base)throw new Error(`a ${opt.base} andou (${state.base.slice(0,7)} → ${remoteBase.slice(0,7)}) depois do lote: `
    +(state.needsWorker?`o Worker publicado é o DESTE lote e o site ainda é o anterior — rode já "cancelar ${id}", depois "lote", e publique o Worker a partir do lote novo`
      :`rode "cancelar ${id}" e depois "lote" de novo`));
  git(opt.repo,'push',opt.remote,`${state.sha}:refs/heads/${opt.base}`);
  // The main checkout follows by fast-forward only, when it is on the base branch and clean.
  const cur=tryGit(opt.repo,'rev-parse','--abbrev-ref','HEAD').out,clean=tryGit(opt.repo,'status','--porcelain').out==='';
  if(cur===opt.base&&clean&&tryGit(opt.repo,'merge','--ff-only',state.sha).ok){/* followed */}
  else log(`o checkout ${opt.repo} não acompanhou (${cur!==opt.base?`está em ${cur}`:clean?'ff recusado':'tem mudanças'}): faça git -C ${opt.repo.replace(/\\/g,'/')} merge --ff-only ${opt.remote}/${opt.base}`);
  for(const e of state.integrados){
    answer(opt,e,{status:'integrado',lote:id,sha:state.sha,protocolo:state.protocol});
    mkdirSync(join(opt.board,'integrated'),{recursive:true});writeFileSync(join(opt.board,'integrated',e.card),'');
  }
  removeWorktree(opt,state.dir,state.branch);
  writeJson(p,{...state,estado:'publicado',em:new Date().toISOString()});
  rmdirSyncSafe(join(opt.board,'fila','.lote'));
  log(`publicado ${state.sha.slice(0,7)}: ${state.integrados.map(e=>e.card).join(', ')}`);
  if(state.contrato?.length)log(`${outOfStep(state.contrato)}; confira o site em ~25 min`);
  for(const d of state.devolvidos)log(`avise ${d.card}: ${d.motivo}`);
  return {...state,estado:'publicado'};
}

function cancelar(opt){
  const id=opt._[1],p=join(opt.board,'fila','lotes',`${id}.json`);
  if(existsSync(p)){
    const state=readJson(p);removeWorktree(opt,state.dir,state.branch);
    // The integrated-to-be go back to the queue as they were, unless their owner queued a newer SHA meanwhile.
    for(const e of state.integrados){const q=join(opt.board,'fila',`${e.card}.json`);if(!existsSync(q))writeJson(q,e);}
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
