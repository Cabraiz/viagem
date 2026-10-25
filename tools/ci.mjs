#!/usr/bin/env node
/**
 * GitHub Actions from the PC without `gh` (NEW-20261014-ORQ-ci-github-shards-e-bench, D-049 items 1 and 5).
 *
 * Executor commands (git push + the public REST API, unauthenticated unless GITHUB_TOKEN is set):
 *   node tools/ci.mjs test <branch> [--push] [--json] [--smoke] [--timeout 20]
 *       waits for the CI run (.github/workflows/ci.yml) of the branch head sha; exit 0 green, 1 red, 2 infra.
 *       --json prints only {ok,failedFiles,url,sha,minutes}. --smoke adds `smoke: {prod, upgrade}` (the jobs' `smoke-prod`
 *       / `smoke-upgrade` annotations, smokeSummary; upgrade only on fila/**, null elsewhere) — the queue's `--smoke ci`.
 *   node tools/ci.mjs bench <branch> [--seeds 1-16] [--players 1] [--world cidade] [--target 2/8]
 *       [--objective chaveiro] [--mode ninhos] [--combat manual] [--cap-min 25] [--no-towers] [--timeout 120]
 *       [--out <file.json>] [--json]
 *       commits .bench.json on top of the branch head WITHOUT touching the working tree (plumbing, temporary index),
 *       pushes it to refs/heads/bench/<branch>-<stamp>, waits for .github/workflows/bench.yml, prints the aggregated
 *       table (annotation `bench-summary`) and deletes the temporary ref (always, best effort). --out writes the JSON
 *       summary (benchJson: the local file's config + summary, each run without its long lists), --json prints it
 *       instead of the table. tools/bench-ci.mjs is this command. Exit 0 pass (or no target), 1 fail, 2 infra.
 *   node tools/ci.mjs timings <branch>   rewrites tests/.timings.json from the last green CI run's `ci-timings`.
 * Workflow-side commands (used by the YAML): shard, report, bench-plan, annotate-run, gate, annotate-summary, annotate-json,
 * smoke-note.
 *
 * API budget (60 requests/hour per IP without a token, shared by every executor on the PC):
 *  - every GET goes through a disk cache shared by all executors (CI_CACHE_DIR, default
 *    D:/Gits/viagem-board/.ci-cache): a body younger than FRESH_MS is reused without any request, an older one is
 *    revalidated with If-None-Match (a 304 does not count against the limit);
 *  - polls are at least MIN_POLL_S apart (bench: 60 s by default);
 *  - a 403/429 with X-RateLimit-Remaining 0 (or a response that leaves 0) records the reset time in the cache dir and
 *    every executor sleeps until then instead of retrying.
 * Results travel as check-run annotations (`::notice title=<name>::<data>`, chunked) because artifacts need a token.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const REPO=process.env.CI_REPO??'Cabraiz/viagem';
export const API='https://api.github.com';
export const SHARDS=6;
export const FRESH_MS=25_000;
export const MIN_POLL_S=30;
/** Annotation message chunk (chars) and chunks per step (GitHub keeps 10 notices per step). */
export const CHUNK=3000,MAX_CHUNKS=10;
/** Process start + type stripping, counted on top of each file's measured time when balancing shards. */
export const FILE_OVERHEAD_MS=300;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export class InfraError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tests/tools/ci.test.ts)
// ---------------------------------------------------------------------------------------------------------------

const BOOL_FLAGS=new Set(['json','push','no-towers','smoke']);
/** argv → {cmd, args (positional), flags}; `--x v` takes a value unless x is a boolean flag; `--x=v` works too. */
export function parseArgs(argv){
  const out={cmd:argv[0],args:[],flags:{}};
  for(let i=1;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')){out.args.push(a);continue;}
    const eq=a.indexOf('='),name=eq>0?a.slice(2,eq):a.slice(2);
    if(eq>0)out.flags[name]=a.slice(eq+1);
    else if(BOOL_FLAGS.has(name))out.flags[name]=true;
    else{
      if(i+1>=argv.length||argv[i+1].startsWith('--'))throw new Error(`--${name} needs a value`);
      out.flags[name]=argv[++i];
    }
  }
  return out;
}
/** "1-16", "3", "1-4,9" → sorted unique integers (same grammar as bench-city-run parseSeeds). */
export function parseRange(spec){
  const out=new Set();
  for(const part of String(spec).split(',').map(s=>s.trim()).filter(Boolean)){
    const m=/^(\d+)(?:-(\d+))?$/.exec(part);
    if(!m)throw new Error(`bad list: ${spec}`);
    const a=Number(m[1]),b=m[2]===undefined?a:Number(m[2]);
    for(let s=Math.min(a,b);s<=Math.max(a,b);s++)out.add(s);
  }
  if(!out.size)throw new Error(`empty list: ${spec}`);
  return [...out].sort((a,b)=>a-b);
}
/** "2/8" → {k:2,n:8} (at least 2 wins per 8 runs, scaled to the runs of each team size); "2" → {k:2,n:null}. */
export function parseTarget(spec){
  if(spec===undefined||spec===null||spec==='')return null;
  const m=/^(\d+)(?:\/(\d+))?$/.exec(String(spec).trim());
  if(!m||(m[2]!==undefined&&Number(m[2])<1))throw new Error(`bad target: ${spec} (k/n or k)`);
  return {k:Number(m[1]),n:m[2]===undefined?null:Number(m[2])};
}
export const neededWins=(target,total)=>target.n===null?target.k:Math.ceil(target.k*total/target.n-1e-9);
/**
 * Early stop. outcomes: [{players,win}] of the finished runs; totals: {players: runs planned}. Per team size the
 * result can no longer flip when wins ≥ need (pass) or wins + runs left < need (fail). Overall: any fail → 'fail',
 * every size passed → 'pass', else null (keep running).
 */
export function earlyDecision(outcomes,totals,target){
  const groups={};
  for(const [p,total] of Object.entries(totals)){
    const mine=outcomes.filter(o=>String(o.players)===String(p)),wins=mine.filter(o=>o.win).length,need=neededWins(target,total);
    const left=total-mine.length;
    groups[p]={wins,done:mine.length,total,need,state:wins>=need?'pass':wins+left<need?'fail':null};
  }
  const states=Object.values(groups).map(g=>g.state);
  return {decision:states.includes('fail')?'fail':states.length&&states.every(s=>s==='pass')?'pass':null,groups};
}
/** Workflow command escaping (actions/toolkit): data and property values. */
export const escapeData=s=>String(s).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
export const escapeProperty=s=>escapeData(s).replace(/:/g,'%3A').replace(/,/g,'%2C');
export function chunkText(text,size=CHUNK){
  const out=[];
  for(let i=0;i<text.length;i+=size)out.push(text.slice(i,i+size));
  return out.length?out:[''];
}
/** `::notice title=<title>[ i/n]::<chunk>` lines (a single chunk keeps the bare title); at most max chunks. */
export function noticeLines(title,text,{size=CHUNK,max=MAX_CHUNKS}={}){
  let chunks=chunkText(text,size);
  if(chunks.length>max)chunks=[...chunks.slice(0,max-1),`…truncated (${text.length} chars; full text in the job log/artifact)`];
  return chunks.map((c,i)=>`::notice title=${escapeProperty(chunks.length===1?title:`${title} ${i+1}/${chunks.length}`)}::${escapeData(c)}`);
}
/** Joins the chunks of one titled annotation (`title` or `title i/n`) from a list of API annotations; null if none. */
export function joinAnnotations(list,title){
  const parts=[];
  for(const a of list??[]){
    const t=a.title??'';
    if(t===title)parts.push({i:1,msg:a.message});
    else if(t.startsWith(title+' ')){const m=/^(\d+)\/(\d+)$/.exec(t.slice(title.length+1));if(m)parts.push({i:Number(m[1]),msg:a.message});}
  }
  if(!parts.length)return null;
  return parts.sort((a,b)=>a.i-b.i).map(p=>p.msg??'').join('');
}
/** Test files (posix, relative to root) under tests/ ending in .test.ts, sorted. */
export function listTests(root=ROOT){
  return fs.readdirSync(path.join(root,'tests'),{recursive:true}).map(f=>String(f).replace(/\\/g,'/'))
    .filter(f=>f.endsWith('.test.ts')).map(f=>`tests/${f}`).sort();
}
/** Longest-processing-time greedy: heaviest file first into the lightest shard (deterministic). */
export function shardFiles(files,timings,n){
  const known=files.map(f=>timings[f]).filter(Number.isFinite).sort((a,b)=>a-b);
  const fallback=known.length?known[Math.floor(known.length/2)]:1000;
  const weight=f=>(Number.isFinite(timings[f])?timings[f]:fallback)+FILE_OVERHEAD_MS;
  const shards=Array.from({length:n},()=>({files:[],ms:0}));
  for(const f of [...files].sort((a,b)=>weight(b)-weight(a)||(a<b?-1:1))){
    const s=shards.reduce((best,x)=>x.ms<best.ms?x:best);
    s.files.push(f);s.ms+=weight(f);
  }
  return shards.map(s=>({files:s.files.sort(),ms:Math.round(s.ms)}));
}
/** A shard's annotation lines from the reporter's JSON (null: the reporter wrote nothing) and the node exit code. */
export function reportLines(report,shard,exitCode){
  const failed=[...(report?.failed??[])];
  if(exitCode!==0&&!failed.length)failed.push(`(shard ${shard}: exit ${exitCode}, no failing file reported)`);
  const lines=failed.length?noticeLines('ci-failed',JSON.stringify(failed)):noticeLines('ci-ok',JSON.stringify({shard,files:Object.keys(report?.durations??{}).length}));
  if(report?.durations)lines.push(...noticeLines(`ci-timings ${String(shard).replace('/','-')}`,JSON.stringify(report.durations)));
  return lines;
}
/** .bench.json or dispatch inputs → normalized params (throws on a bad value). */
export function benchParams(raw){
  const world=raw.world||'cidade';
  if(world!=='cidade')throw new Error(`world ${world}: only 'cidade' has a run bench (scripts/bench-city-run.ts)`);
  const objective=raw.objective||null;
  if(objective!==null&&objective!=='chaveiro')throw new Error(`objective ${objective}: only 'chaveiro'`);
  // D-051: the manual combat (the attack button, the arsenal, crates, inventory); absent = the automatic weapons.
  const combat=raw.combat||null;
  if(combat!==null&&combat!=='manual')throw new Error(`combat ${combat}: only 'manual'`);
  // balanco-ninhos: the nests ride with the chaveiro only (bench-city-run refuses --mode without it).
  const mode=raw.mode||null;
  if(mode!==null&&mode!=='ninhos')throw new Error(`mode ${mode}: only 'ninhos'`);
  if(mode!==null&&objective!=='chaveiro')throw new Error('mode ninhos needs objective chaveiro');
  const players=Array.isArray(raw.players)?raw.players.map(Number):parseRange(raw.players??'1');
  if(players.some(p=>p<1||p>6))throw new Error('players must be 1..6');
  const capMin=raw.capMin??raw.cap_min;
  const p={world,seeds:Array.isArray(raw.seeds)?raw.seeds.map(Number):parseRange(raw.seeds??'1-16'),players,objective,combat,mode,
    capMin:capMin===undefined||capMin===''||capMin===null?null:Number(capMin),towers:raw.towers!==false&&raw.towers!=='false',
    target:raw.target||null,branch:raw.branch||null,sha:raw.sha||null,base:raw.base||null};
  if(p.capMin!==null&&!(p.capMin>0))throw new Error('capMin must be > 0');
  parseTarget(p.target);
  return p;
}
/** Hash of what changes the result (not branch/sha/base/target): the "before" artifact is keyed by base sha + this. */
// `combat` and `mode` join only when set, so every earlier bench keeps the hash (and the "before" artifact) it had.
export const paramsHash=p=>createHash('sha256').update(JSON.stringify({world:p.world,seeds:p.seeds,players:p.players,objective:p.objective,capMin:p.capMin,towers:p.towers,
  ...(p.combat==='manual'?{combat:'manual'}:{}),...(p.mode?{mode:p.mode}:{})})).digest('hex').slice(0,12);
export const benchMatrix=p=>({include:p.seeds.flatMap(seed=>p.players.map(players=>({seed,players})))});
export const benchArgs=p=>[...(p.objective?['--objective',p.objective]:[]),...(p.mode?['--mode',p.mode]:[]),...(p.combat?['--combat',p.combat]:[]),...(p.capMin!==null?['--cap-min',String(p.capMin)]:[]),...(p.towers?[]:['--no-towers'])].join(' ');
/** Run-job name in bench.yml (`run <seed>-<players>p`) → {seed,players}; null for other jobs. */
export function runJobKey(name){
  const m=/^run (\d+)-(\d+)p$/.exec(name??'');
  return m?{seed:Number(m[1]),players:Number(m[2])}:null;
}
/** The fields of a run the JSON summary keeps (the rest — rounds, forge, perf… — stays in the run artifacts). */
export const RUN_FIELDS=['key','seed','players','classes','outcome','cause','roundReached','diedRound','ticks','simMinutes','wallHpEnd','wallMaxHp','digest'];
export const compactRun=r=>Object.fromEntries(RUN_FIELDS.filter(k=>r?.[k]!==undefined).map(k=>[k,r[k]]));
/**
 * The bench's JSON summary, the local file's shape (scripts/bench-city-run.ts OutFile: card, version, config, summary,
 * runs) with each run compacted (compactRun), plus `ci` (where it ran). Travels in annotations: no token on the PC.
 */
export function benchJson(merged,ci={}){
  const {runs=[],...rest}=merged??{};
  return {...rest,runs:runs.map(compactRun),runsCompact:true,ci};
}

/**
 * One smoke's result for the queue (`--smoke ci`, annotation `smoke-<kind>` + smoke-<kind>.json): exit 0 ok, 1 the
 * game broke, 2 infrastructure (scripts/smoke-prod.mjs), and at most 10 lines — its verdict lines (`smoke …`), else the
 * end of the log. No exit (the smoke step never ran): a failed build is the game's (1), anything else the machine's (2);
 * `skipped` (no base to upgrade from) is a pass that says so.
 */
export function smokeSummary(kind,log,{exit='',build='',skipped=''}={}){
  const lines=String(log??'').split(/\r?\n/).map(l=>l.trimEnd()).filter(l=>l.trim());
  const verdict=lines.filter(l=>/^smoke\b/.test(l));
  let code=exit===''||exit===null||exit===undefined?null:Number(exit),linhas=(verdict.length?verdict:lines.slice(-3)).slice(-10);
  if(skipped){code=0;linhas=[`smoke ${kind}: pulado · ${skipped}`];}
  else if(code===null){code=build==='failure'?1:2;linhas=[build==='failure'?'npm run build falhou':`o smoke ${kind} não rodou (um passo antes dele falhou: ${build||'?'})`,...linhas].slice(0,10);}
  return {kind,exit:code,ok:code===0,infra:code===2,skipped:!!skipped,linhas:linhas.map(l=>l.slice(0,300))};
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub API client: shared disk cache + ETag + rate-limit sleep (tested with a fake fetch)
// ---------------------------------------------------------------------------------------------------------------

export function defaultCacheDir(){
  if(process.env.CI_CACHE_DIR)return process.env.CI_CACHE_DIR;
  return fs.existsSync('D:/Gits/viagem-board')?'D:/Gits/viagem-board/.ci-cache':path.join(os.tmpdir(),'viagem-ci-cache');
}
const realSleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeJson(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(data));
  try{fs.renameSync(tmp,file);}catch{try{fs.rmSync(tmp,{force:true});}catch{}}
}
export function createApi({fetch=globalThis.fetch,token=process.env.GITHUB_TOKEN,cacheDir=defaultCacheDir(),now=Date.now,sleep=realSleep,log=m=>console.error(m),freshMs=FRESH_MS}={}){
  const limitFile=path.join(cacheDir,'_ratelimit.json');
  const headers=extra=>({Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'viagem-ci',
    ...(token?{Authorization:`Bearer ${token}`}:{}),...extra});
  async function waitLimit(){
    const st=readJson(limitFile);
    if(st&&st.resetAt>now()){
      log(`GitHub rate limit used up: sleeping until ${new Date(st.resetAt).toLocaleTimeString()} (no request until then)`);
      await sleep(st.resetAt-now()+1000);
    }
  }
  function noteLimit(res){
    const left=res.headers.get('x-ratelimit-remaining'),reset=Number(res.headers.get('x-ratelimit-reset'));
    if(left==='0'&&reset>0)writeJson(limitFile,{resetAt:reset*1000});
    return left==='0';
  }
  async function request(method,url,extra={}){
    for(let attempt=0;attempt<3;attempt++){
      await waitLimit();
      const res=await fetch(url,{method,headers:headers(extra)});
      const empty=noteLimit(res);
      if((res.status===403||res.status===429)&&(empty||res.headers.get('retry-after'))){
        const after=Number(res.headers.get('retry-after'));
        if(!empty&&after>0){log(`GitHub asked to retry after ${after}s`);await sleep(after*1000);}
        else if(!(Number(res.headers.get('x-ratelimit-reset'))>0)){log('GitHub rate limit without a reset time: sleeping 60 s');await sleep(60_000);}
        continue;// else the next waitLimit sleeps until the reset
      }
      return res;
    }
    throw new InfraError(`GitHub API ${method} ${url}: still rate limited after waiting`);
  }
  /** GET with the shared cache. Returns {status, body}; 404 → {status:404, body:null}; other errors throw InfraError. */
  async function get(p){
    const url=p.startsWith('http')?p:`${API}${p}`;
    const file=path.join(cacheDir,`${createHash('sha256').update(url).digest('hex').slice(0,32)}.json`);
    const cached=readJson(file);
    if(cached&&now()-cached.at<freshMs)return {status:200,body:cached.body,cached:'fresh'};
    const res=await request('GET',url,cached?.etag?{'If-None-Match':cached.etag}:{});
    if(res.status===304&&cached){writeJson(file,{...cached,at:now()});return {status:200,body:cached.body,cached:'304'};}
    if(res.status===404)return {status:404,body:null};
    if(!res.ok)throw new InfraError(`GitHub API GET ${url}: HTTP ${res.status}`);
    const body=await res.json();
    writeJson(file,{url,etag:res.headers.get('etag'),at:now(),body});
    return {status:200,body};
  }
  async function post(p){
    const res=await request('POST',`${API}${p}`);
    if(!res.ok)throw new InfraError(`GitHub API POST ${p}: HTTP ${res.status}`);
    return res.status;
  }
  return {get,post};
}

// ---------------------------------------------------------------------------------------------------------------
// Shared run helpers
// ---------------------------------------------------------------------------------------------------------------

const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const say=m=>console.error(m);
const minutesOf=run=>Math.round((Date.parse(run.updated_at)-Date.parse(run.run_started_at??run.created_at))/6000)/10;

/** Waits for the newest run of `workflow` on `sha`; returns the completed run. */
async function waitRun(api,workflow,sha,{pollS,timeoutMin,appearMin=4}){
  const start=Date.now();let lastStatus='';
  for(;;){
    const {body}=await api.get(`/repos/${REPO}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=5`);
    const run=(body?.workflow_runs??[]).sort((a,b)=>b.run_number-a.run_number)[0];
    const waited=(Date.now()-start)/60000;
    if(!run&&waited>appearMin)throw new InfraError(`no ${workflow} run for ${sha.slice(0,8)} after ${appearMin} min (pushed? the workflow on that commit?)`);
    if(run){
      if(run.status!==lastStatus){say(`${workflow} run ${run.html_url}: ${run.status}`);lastStatus=run.status;}
      if(run.status==='completed')return run;
    }
    if(waited>timeoutMin)throw new InfraError(`timeout after ${timeoutMin} min waiting for ${workflow} on ${sha.slice(0,8)}`);
    await realSleep(pollS*1000);
  }
}
async function jobsOf(api,run){
  const {body}=await api.get(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
  return body?.jobs??[];
}
async function annotationsOf(api,jobId){
  const {body}=await api.get(`/repos/${REPO}/check-runs/${jobId}/annotations?per_page=100`);
  return body??[];
}
const pollOf=(flags,def)=>Math.max(MIN_POLL_S,Number(flags.poll??def));

// ---------------------------------------------------------------------------------------------------------------
// Executor commands
// ---------------------------------------------------------------------------------------------------------------

async function cmdTest(o,api=createApi()){
  const branch=o.args[0];
  if(!branch)throw new Error('usage: test <branch> [--push] [--json]');
  if(o.flags.push)git('push','origin',`refs/heads/${branch}:refs/heads/${branch}`);
  const sha=git('rev-parse','--verify',`${branch}^{commit}`);
  const run=await waitRun(api,'ci.yml',sha,{pollS:pollOf(o.flags,MIN_POLL_S),timeoutMin:Number(o.flags.timeout??20)});
  if(run.conclusion==='cancelled'||run.conclusion==='skipped')throw new InfraError(`CI run ${run.html_url} was ${run.conclusion} (a newer push to the branch?)`);
  const ok=run.conclusion==='success',failedFiles=new Set();
  if(!ok){
    for(const job of await jobsOf(api,run)){
      if(job.conclusion!=='failure')continue;
      const list=job.name.startsWith('test')?JSON.parse(joinAnnotations(await annotationsOf(api,job.id),'ci-failed')??'null'):null;
      if(Array.isArray(list))list.forEach(f=>failedFiles.add(f));
      else failedFiles.add(`job:${job.name}`);
    }
  }
  const result={ok,failedFiles:[...failedFiles].sort(),url:run.html_url,sha,minutes:minutesOf(run)};
  if(o.flags.smoke)result.smoke=await smokesOf(api,run,branch);
  if(o.flags.json)console.log(JSON.stringify(result));
  else console.log(`${ok?'CI green':'CI red'} in ${result.minutes} min: ${result.url}${ok?'':`\nfailed: ${result.failedFiles.join(' ')}`}`);
  return ok?0:1;
}

/**
 * The smokes of a ci.yml run (`--smoke`): job `build` → smoke-prod, job `smoke-upgrade` (fila/** only) → smoke-upgrade.
 * A job that left no annotation (cancelled, or it died before its note step) is the machine's: exit 2, its conclusion.
 */
export const SMOKE_JOBS={prod:'build',upgrade:'smoke-upgrade'};
async function smokesOf(api,run,branch){
  const jobs=await jobsOf(api,run),out={};
  for(const [kind,name] of Object.entries(SMOKE_JOBS)){
    const job=jobs.find(j=>j.name===name);
    if(!job){out[kind]=kind==='upgrade'&&!branch.startsWith('fila/')?null:smokeSummary(kind,'',{build:`job ${name} ausente`});continue;}
    const text=joinAnnotations(await annotationsOf(api,job.id),`smoke-${kind}`);
    let s=null;try{s=text?JSON.parse(text):null;}catch{/* a broken note: the machine's */}
    out[kind]=s??smokeSummary(kind,'',{build:`job ${name} ${job.conclusion??job.status} sem resumo`});
  }
  return out;
}

/** Commits .bench.json on top of `sha` without touching the working tree or the real index. */
export function benchCommit(sha,json,message){
  const blob=execFileSync('git',['hash-object','-w','--stdin'],{cwd:ROOT,input:json,encoding:'utf8'}).trim();
  const index=path.join(os.tmpdir(),`viagem-bench-index-${process.pid}`);
  const env={...process.env,GIT_INDEX_FILE:index};
  try{
    execFileSync('git',['read-tree',sha],{cwd:ROOT,env});
    execFileSync('git',['update-index','--add','--cacheinfo',`100644,${blob},.bench.json`],{cwd:ROOT,env});
    const tree=execFileSync('git',['write-tree'],{cwd:ROOT,env,encoding:'utf8'}).trim();
    return execFileSync('git',['commit-tree',tree,'-p',sha,'-m',message],{cwd:ROOT,encoding:'utf8'}).trim();
  }finally{fs.rmSync(index,{force:true});}
}
async function cmdBench(o,api=createApi()){
  const branch=o.args[0];
  if(!branch)throw new Error('usage: bench <branch> --seeds 1-16 --players 1 [--world cidade] [--target 2/8]');
  const f=o.flags,sha=git('rev-parse','--verify',`${branch}^{commit}`);
  let base=null;try{base=git('merge-base',sha,'origin/main');}catch{}
  const params=benchParams({world:f.world,seeds:f.seeds??'1-16',players:f.players??'1',objective:f.objective,mode:f.mode,combat:f.combat,capMin:f['cap-min'],
    towers:!f['no-towers'],target:f.target,branch,sha,base});
  const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
  const ref=`bench/${branch.replace(/[^\w./-]/g,'-')}-${stamp}`;
  const commit=benchCommit(sha,JSON.stringify(params,null,1)+'\n',`bench: ${branch} seeds ${f.seeds??'1-16'} players ${f.players??'1'}${params.target?` target ${params.target}`:''}`);
  git('push','origin',`${commit}:refs/heads/${ref}`);
  say(`pushed ${ref} (${params.seeds.length * params.players.length} runs, hash ${paramsHash(params)}, base ${base?.slice(0,8)??'-'})`);
  let deleted=false;
  const cleanup=()=>{if(deleted)return;deleted=true;try{git('push','origin','--delete',`refs/heads/${ref}`);say(`deleted ${ref}`);}catch(e){say(`could not delete ${ref}: ${e.message.split('\n')[0]}`);}};
  const onSig=()=>{cleanup();process.exit(130);};
  process.once('SIGINT',onSig);
  try{
    const run=await waitRun(api,'bench.yml',commit,{pollS:pollOf(f,60),timeoutMin:Number(f.timeout??120)});
    const agg=(await jobsOf(api,run)).find(j=>j.name==='aggregate');
    const notes=agg?await annotationsOf(api,agg.id):[];
    const summary=joinAnnotations(notes,'bench-summary'),verdict=JSON.parse(joinAnnotations(notes,'bench-verdict')??'null');
    if(!summary)throw new InfraError(`no bench-summary in ${run.html_url} (aggregate ${agg?.conclusion??'missing'})`);
    if(f.out||f.json){
      // The JSON summary (annotate-json: bench-json = the file without runs, bench-json-runs = the compact runs).
      const head=JSON.parse(joinAnnotations(notes,'bench-json')??'null'),runs=JSON.parse(joinAnnotations(notes,'bench-json-runs')??'null');
      if(!head)throw new InfraError(`no bench-json in ${run.html_url} (a bench.yml older than annotate-json?)`);
      const file={...head,runs:runs??[],ci:{...head.ci,url:run.html_url,branch,sha,params:paramsHash(params)}};
      if(f.out){fs.mkdirSync(path.dirname(path.resolve(f.out)),{recursive:true});fs.writeFileSync(path.resolve(f.out),JSON.stringify(file,null,1)+'\n');say(`written: ${path.resolve(f.out)}`);}
      if(f.json){console.log(JSON.stringify(file));return verdict?.decision==='fail'?1:0;}
    }
    console.log(summary);
    console.log(run.html_url);
    return verdict?.decision==='fail'?1:0;
  }finally{cleanup();process.off('SIGINT',onSig);}
}
async function cmdTimings(o,api=createApi()){
  const branch=o.args[0]??'HEAD',sha=git('rev-parse','--verify',`${branch}^{commit}`);
  const run=await waitRun(api,'ci.yml',sha,{pollS:MIN_POLL_S,timeoutMin:20});
  const file=path.join(ROOT,'tests/.timings.json'),cur=readJson(file)??{files:{}};
  let n=0;
  for(const job of await jobsOf(api,run)){
    if(!job.name.startsWith('test'))continue;
    const notes=await annotationsOf(api,job.id),title=notes.map(a=>a.title??'').find(t=>t.startsWith('ci-timings '))?.replace(/ \d+\/\d+$/,'');
    const d=title?JSON.parse(joinAnnotations(notes,title)??'{}'):{};
    for(const [k,v] of Object.entries(d)){cur.files[k]=Math.round(v);n++;}
  }
  const files=Object.fromEntries(Object.entries(cur.files).filter(([k])=>fs.existsSync(path.join(ROOT,k))).sort(([a],[b])=>a<b?-1:1));
  fs.writeFileSync(file,JSON.stringify({source:`ci run ${run.html_url}`,files},null,1)+'\n');
  console.log(`tests/.timings.json: ${n} file time(s) from ${run.html_url}`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Workflow-side commands
// ---------------------------------------------------------------------------------------------------------------

function output(pairs){
  const lines=Object.entries(pairs).map(([k,v])=>`${k}=${v}`).join('\n')+'\n';
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,lines);else process.stdout.write(lines);
}
function cmdShard(o){
  const [i,n=SHARDS]=String(o.args[0]??'').split('/').map(Number);
  if(!(i>=1&&i<=n))throw new Error('usage: shard <i>/<n>');
  const timings=readJson(path.join(ROOT,'tests/.timings.json'))?.files??{};
  console.log(shardFiles(listTests(),timings,n)[i-1].files.join('\n'));
  return 0;
}
function cmdReport(o){
  const report=readJson(o.args[0]),shard=o.flags.shard??'?',code=Number(o.flags.exit??0);
  for(const l of reportLines(report,shard,code))console.log(l);
  return 0;
}
function cmdBenchPlan(){
  const input=process.env.BENCH_INPUTS?JSON.parse(process.env.BENCH_INPUTS):null;
  const raw=input&&Object.keys(input).length?input:readJson(path.join(ROOT,'.bench.json'));
  if(!raw)throw new Error('no .bench.json and no dispatch inputs');
  const p=benchParams(raw);
  // A bench/** push is .bench.json on top of the benched commit (tools/ci.mjs bench): the code is its parent.
  const sha=p.sha??(input?process.env.GITHUB_SHA:git('rev-parse','HEAD^'));
  const total=p.seeds.length*p.players.length;
  if(total>256)throw new Error(`${total} runs: a matrix holds 256 jobs`);
  const totals=Object.fromEntries(p.players.map(n=>[n,p.seeds.length]));
  output({matrix:JSON.stringify(benchMatrix(p)),hash:paramsHash(p),sha,base:p.base&&p.base!==sha?p.base:'',target:p.target??'',
    args:benchArgs(p),totals:JSON.stringify(totals)});
  console.log(`::notice title=bench-plan::${escapeData(JSON.stringify({...p,sha,total,hash:paramsHash(p)}))}`);
  return 0;
}
function cmdAnnotateRun(o){
  const file=readJson(o.args[0]);
  for(const r of file?.runs??[]){
    console.log(`::notice title=bench-outcome::${escapeData(JSON.stringify({seed:r.seed,players:r.players,outcome:r.outcome,cause:r.cause,win:r.outcome==='victory',digest:r.digest??null}))}`);
    const {forge,...rest}=r,full=JSON.stringify({...rest,forge:{count:forge?.count,byRecipe:forge?.byRecipe}});
    const text=full.length<=CHUNK*(MAX_CHUNKS-1)?full:JSON.stringify({key:r.key,seed:r.seed,players:r.players,outcome:r.outcome,cause:r.cause,roundReached:r.roundReached,simMinutes:r.simMinutes,digest:r.digest,perf:r.perf,truncated:true});
    for(const l of noticeLines(`bench-run ${r.seed}-${r.players}`,text,{max:MAX_CHUNKS-1}))console.log(l);
  }
  return 0;
}
/** Inside bench.yml (built-in GITHUB_TOKEN): watches the run's own seed jobs until the target is decided. */
async function cmdGate(o){
  const target=parseTarget(process.env.BENCH_TARGET),totals=JSON.parse(process.env.BENCH_TOTALS??'{}');
  if(!target){output({decision:''});return 0;}
  const api=createApi({cacheDir:path.join(os.tmpdir(),'ci-cache'),freshMs:0});
  const runId=process.env.GITHUB_RUN_ID,seen=new Map(),total=Object.values(totals).reduce((a,b)=>a+b,0);
  for(;;){
    const {body}=await api.get(`/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100&filter=latest`);
    const runs=(body?.jobs??[]).filter(j=>runJobKey(j.name));
    for(const j of runs){
      if(j.status!=='completed'||seen.has(j.id))continue;
      const {body:notes}=await api.get(`/repos/${process.env.GITHUB_REPOSITORY}/check-runs/${j.id}/annotations?per_page=100`);
      const out=JSON.parse(joinAnnotations(notes??[],'bench-outcome')??'null');
      seen.set(j.id,out?{players:out.players,win:out.win}:null);
    }
    const outcomes=[...seen.values()].filter(Boolean),d=earlyDecision(outcomes,totals,target);
    if(d.decision||seen.size>=total){
      const left=total-seen.size;
      console.log(`::notice title=bench-early::${escapeData(JSON.stringify({decision:d.decision,left,groups:d.groups}))}`);
      output({decision:d.decision??'',cancel:d.decision&&left>0?'true':'false'});
      return 0;
    }
    await realSleep(Number(o.flags.poll??20)*1000);
  }
}
/** Aggregate job: summary text (from --merge) → bench-summary chunks + bench-verdict; outputs complete=true|false. */
function cmdAnnotateSummary(o){
  const text=fs.readFileSync(o.args[0],'utf8'),merged=readJson(o.args[1]);
  const target=parseTarget(process.env.BENCH_TARGET),totals=JSON.parse(process.env.BENCH_TOTALS??'{}');
  const runs=merged?.runs??[],total=Object.values(totals).reduce((a,b)=>a+b,0);
  const d=target?earlyDecision(runs.map(r=>({players:r.players,win:r.outcome==='victory'})),totals,target):{decision:null,groups:{}};
  const verdict=target?`target ${process.env.BENCH_TARGET}: ${d.decision??'undecided'} | ${Object.entries(d.groups).map(([p,g])=>`${p}p ${g.wins}/${g.done} wins of ${g.total} (need ${g.need})`).join(' | ')}`:'target: none';
  const full=`${text.trimEnd()}\n${runs.length<total?`(${total-runs.length} of ${total} runs not played: early stop or failed jobs)\n`:''}${verdict}\n`;
  fs.writeFileSync(o.args[0],full);
  for(const l of noticeLines('bench-summary',full))console.log(l);
  console.log(`::notice title=bench-verdict::${escapeData(JSON.stringify({decision:d.decision,runs:runs.length,total,groups:d.groups}))}`);
  output({complete:String(runs.length===total&&total>0)});
  return 0;
}

/**
 * Aggregate job: merged/bench-result.json → `bench-json` (the file without its runs) and `bench-json-runs` (the compact
 * runs). Each title is printed by its own step (GitHub keeps 10 notices per step): `annotate-json <file> head|runs`.
 */
function cmdAnnotateJson(o){
  const merged=readJson(o.args[0]);
  if(!merged){console.log('::warning::annotate-json: no merged bench file');return 0;}
  const {runs,...head}=benchJson(merged,{run:process.env.GITHUB_RUN_ID??null});
  const part=o.args[1]??'head';
  for(const l of noticeLines(part==='runs'?'bench-json-runs':'bench-json',JSON.stringify(part==='runs'?runs:head)))console.log(l);
  return 0;
}
/**
 * ci.yml, after a smoke step (`if: always()`): `smoke-note <prod|upgrade> <log> [--exit <code>] [--build <outcome>]
 * [--skipped <why>]` writes smoke-<kind>.json next to the log and the `smoke-<kind>` annotation (smokeSummary). Exit 0.
 */
function cmdSmokeNote(o){
  const [kind,log]=o.args;
  if(!kind||!log)throw new Error('usage: smoke-note <prod|upgrade> <log> [--exit n] [--build outcome] [--skipped why]');
  let text='';try{text=fs.readFileSync(log,'utf8');}catch{/* the smoke never ran */}
  const s=smokeSummary(kind,text,{exit:o.flags.exit??'',build:o.flags.build??'',skipped:o.flags.skipped??''});
  const full={...s,sha:process.env.GITHUB_SHA??null,run:process.env.GITHUB_RUN_ID??null};
  fs.mkdirSync(path.dirname(path.resolve(log)),{recursive:true});
  fs.writeFileSync(path.join(path.dirname(path.resolve(log)),`smoke-${kind}.json`),JSON.stringify(full,null,1)+'\n');
  for(const l of noticeLines(`smoke-${kind}`,JSON.stringify(s)))console.log(l);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`**smoke ${kind}: ${s.ok?'OK':s.infra?'INFRA':'FALHOU'}** (exit ${s.exit})\n\n${s.linhas.map(l=>`- ${l}`).join('\n')}\n`);
  return 0;
}

const COMMANDS={test:cmdTest,bench:cmdBench,timings:cmdTimings,shard:cmdShard,report:cmdReport,'bench-plan':cmdBenchPlan,
  'annotate-run':cmdAnnotateRun,gate:cmdGate,'annotate-summary':cmdAnnotateSummary,'annotate-json':cmdAnnotateJson,'smoke-note':cmdSmokeNote};

export async function main(argv){
  let o;
  try{o=parseArgs(argv);}catch(e){console.error(e.message);return 2;}
  const fn=COMMANDS[o.cmd];
  if(!fn){console.error(`usage: node tools/ci.mjs <${Object.keys(COMMANDS).join('|')}> …`);return 2;}
  try{return await fn(o);}
  catch(e){
    const infra=e instanceof InfraError||e?.status!==undefined;
    if(o.flags.json&&o.cmd==='test')console.log(JSON.stringify({ok:false,failedFiles:[],url:null,sha:null,minutes:null,error:e.message}));
    console.error(`${infra?'infra':'error'}: ${e.message}`);
    return 2;
  }
}

const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(entry===import.meta.url)process.exitCode=await main(process.argv.slice(2));
