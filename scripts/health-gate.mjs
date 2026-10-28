#!/usr/bin/env node
/**
 * pages.yml's gate before it publishes the site (NEW-20261017-ORQ-fila-deploy-seguro): the live rooms Worker must
 * speak the site's room protocol (public/multiplayer.json) AND serve the site's maps (public/maps/*.manifest.json,
 * version and hash, as /health tells them). Either side out of step refuses the phones: a Worker ahead of the site
 * (lote 13, map v2 → v3 published ~20 min before the site) or a site ahead of the Worker (a map-only lote whose Worker
 * deploy was skipped: rooms busy, --skip-if-busy, or no token). Plain node, no dependencies (the job has no npm ci).
 * And the build (NEW-20261025-ORQ-health-gate-build-sha): /health's build (the commit deploy-rooms.mjs published) must
 * be this site's HEAD, or an older commit after which nothing the Worker bundles changed (scripts/worker-files.mjs).
 * Lote 23 changed the sim with the same protocol and maps; the Worker stayed on lote 22 and the site went up. Not
 * "always HEAD": a site-only lote does not redeploy the Worker (pages.yml has no token), so it would never publish.
 * The job needs the history (checkout fetch-depth 0) to diff the Worker's build against HEAD.
 *
 *   node scripts/health-gate.mjs <health url> [--tries 6] [--wait 10]     exit 0 = publish, 1 = do not
 */
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {workerFiles,workerChanges} from './worker-files.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));

/** What the site being published expects of the Worker: its protocol and every map manifest it ships. */
export function expected(root=ROOT){
  const protocol=JSON.parse(readFileSync(join(root,'public/multiplayer.json'),'utf8')).protocol;
  const maps={};
  for(const f of readdirSync(join(root,'public/maps')).filter(n=>n.endsWith('.manifest.json')).sort()){
    const m=JSON.parse(readFileSync(join(root,'public/maps',f),'utf8'));
    maps[m.id]={version:m.version,hash:m.hash};
  }
  return {protocol,maps};
}

/** The live /health answer against `want`: {ok, problems} (problems in pt-BR, one per mismatch). */
export function gate(health,want){
  const problems=[];
  if(!health||typeof health!=='object')return {ok:false,problems:['o /health não respondeu um JSON']};
  if(health.protocol!==want.protocol)problems.push(`protocolo: o Worker fala ${health.protocol}, o site ${want.protocol}`);
  const live=health.maps&&typeof health.maps==='object'?health.maps:undefined;
  for(const [id,m] of Object.entries(want.maps)){
    const w=live?.[id];
    if(!w)problems.push(`mapa ${id}: o Worker não informa (${live?'ausente no /health':'/health sem maps: Worker anterior a esta checagem'})`);
    else if(w.version!==m.version||w.hash!==m.hash)problems.push(`mapa ${id}: o Worker serve v${w.version} (${String(w.hash).slice(0,8)}), o site v${m.version} (${String(m.hash).slice(0,8)})`);
  }
  return {ok:problems.length===0,problems};
}

/**
 * The Worker's build against this site's `head`: [] when it is HEAD, or an older commit after which nothing the Worker
 * bundles changed; otherwise the problem. `changedSince(sha)` lists the Worker files changed from sha to HEAD, or null
 * when sha is not in this history. A "-sujo" build (deployed from a dirty tree) is judged by its commit.
 */
export function buildProblems(build,head,changedSince){
  if(typeof build!=='string'||!/^[0-9a-f]{7,40}(-sujo)?$/.test(build))
    return [`build: o Worker não diz de que commit veio (${build??'sem build'}); publique as salas com npm run deploy:rooms`];
  const sha=build.replace(/-sujo$/,'');
  if(head.startsWith(sha))return [];
  const files=changedSince(sha);
  if(files===null)return [`build: o Worker é do commit ${sha}, que não está no histórico deste site (${head.slice(0,12)})`];
  if(files.length)return [`build: o Worker é do commit ${sha}, o site ${head.slice(0,12)}, e desde então mudou o que o Worker empacota (${files.slice(0,4).join(', ')}${files.length>4?`, … ${files.length} arquivos`:''})`];
  return [];
}

/** HEAD and changedSince over the git checkout at `root` (memoized: the gate asks a few times). */
export function gitHistory(root=ROOT){
  const git=(...a)=>{const r=spawnSync('git',a,{cwd:root,encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
  const head=git('rev-parse','HEAD')??'',files=workerFiles(root),memo=new Map();
  const changedSince=(sha)=>{
    if(!memo.has(sha)){
      const full=git('rev-parse','--verify','--quiet',`${sha}^{commit}`);
      const diff=full&&git('diff','--name-only','--no-renames',full,head);
      memo.set(sha,diff===null||!full?null:workerChanges(diff.split('\n').filter(Boolean),files));
    }
    return memo.get(sha);
  };
  return {head,changedSince};
}

async function main(argv){
  const url=argv[0],opt=(k,d)=>{const i=argv.indexOf(`--${k}`);return i>=0?Number(argv[i+1]):d;};
  if(!url){console.error('uso: node scripts/health-gate.mjs <health url> [--tries 6] [--wait 10]');return 1;}
  const want=expected(),tries=opt('tries',6),wait=opt('wait',10),hist=gitHistory();
  if(!hist.head){console.log('::error::sem git aqui: o portão precisa do histórico (checkout com fetch-depth 0)');return 1;}
  let last={ok:false,problems:['sem resposta']};
  // A fresh deploy takes a few seconds to reach every edge: asked a few times before failing.
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{'Cache-Control':'no-cache'}});
      if(r.ok){
        const health=await r.json(),g=gate(health,want),b=buildProblems(health?.build,hist.head,hist.changedSince);
        last={ok:g.ok&&!b.length,problems:[...g.problems,...b],build:health?.build};
      }else last={ok:false,problems:[`o /health respondeu ${r.status}`]};
    }catch(e){last={ok:false,problems:[`o /health não respondeu (${String(e?.message??e).slice(0,120)})`]};}
    if(last.ok){
      if(String(last.build).endsWith('-sujo'))console.log(`::warning::o Worker foi publicado de uma árvore com mudanças não commitadas (${last.build})`);
      console.log(`Worker no ar casa com o site: protocolo ${want.protocol}, ${Object.entries(want.maps).map(([id,m])=>`${id} v${m.version}`).join(', ')}, build ${last.build}`);
      return 0;
    }
    if(i<tries-1)await new Promise(res=>setTimeout(res,wait*1000));
  }
  for(const p of last.problems)console.log(`::error::${p}`);
  console.log('::error::O Worker no ar não casa com este site. Publique as salas (com token: rode este workflow de novo quando as salas esvaziarem; sem token: npm run deploy:rooms no PC) e rode o workflow de novo.');
  return 1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main(process.argv.slice(2));
