#!/usr/bin/env node
/**
 * The remote's leftover branches (NEW-20261025-ORQ-cicd-smokes-bench, step 3), run weekly by
 * .github/workflows/limpeza-branches.yml (or by hand):
 *   node tools/limpa-branches.mjs [--apagar] [--out <lista.json>] [--remote origin] [--base main]
 * Reads the remote-tracking refs of a full fetch (refs/remotes/<remote>/…) and picks (escolhe):
 *   vgm/*   already in <remote>/<base> (its head is an ancestor) and no commit for 7 days;
 *   fila/*  batch branches of the queue, older than 24 h (the lote that pushed it is long over);
 *   bench/* temporary refs of tools/ci.mjs bench, older than 24 h (it deletes its own; a killed one leaves it).
 * Anything else (main, other prefixes) is never touched. Without --apagar it only lists. With it, each delete is leased
 * on the head it saw (a push in the meantime keeps the branch). --out writes {apagar, apagadas, falhas, mantidas, …}.
 * Exit 0 (also when some deletes were refused: they are in `falhas`), 2 when git itself failed.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const H=3600_000;
/** Per prefix: the minimum age and whether the base must contain it. */
export const REGRAS={'vgm/':{idadeMs:7*24*H,naBase:true},'fila/':{idadeMs:24*H,naBase:false},'bench/':{idadeMs:24*H,naBase:false}};

/**
 * refs: [{name, sha, at (commit time, ms), naBase (its head is in the base)}] → the ones to delete, each with its reason.
 * The base branch itself never.
 */
export function escolhe(refs,{now=Date.now(),base='main'}={}){
  const out=[];
  for(const r of refs){
    if(r.name===base||r.name==='HEAD')continue;
    const prefix=Object.keys(REGRAS).find(p=>r.name.startsWith(p));
    if(!prefix)continue;
    const regra=REGRAS[prefix],idade=now-r.at;
    if(idade<regra.idadeMs)continue;
    if(regra.naBase&&!r.naBase)continue;
    out.push({name:r.name,sha:r.sha,dias:Math.round(idade/(24*H)*10)/10,motivo:regra.naBase?`na ${base}, parada há ≥ ${regra.idadeMs/(24*H)} dias`:`mais de ${regra.idadeMs/H} h`});
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}

/** `git push --porcelain` output → {ok:[ref], falhas:[{name, why}]} for the deletes asked. */
export function lePush(text){
  const ok=[],falhas=[];
  for(const line of String(text).split(/\r?\n/)){
    const m=/^([-!=*+ ])\t:?refs\/heads\/(\S+)\t(.*)$/.exec(line);
    if(!m)continue;
    if(m[1]==='-')ok.push(m[2]);else falhas.push({name:m[2],why:m[3].trim()});
  }
  return {ok,falhas};
}

function git(args,opts={}){return execFileSync('git',args,{encoding:'utf8',maxBuffer:64<<20,stdio:['ignore','pipe','pipe'],...opts}).trim();}

export function main(argv){
  const flag=(k)=>argv.includes(`--${k}`),val=(k,d)=>{const i=argv.indexOf(`--${k}`);return i>=0?argv[i+1]:d;};
  const remote=val('remote','origin'),base=val('base','main'),out=val('out'),apagar=flag('apagar');
  let refs;
  try{
    const prefix=`refs/remotes/${remote}/`;
    const lines=git(['for-each-ref','--format=%(refname) %(objectname) %(committerdate:unix)',prefix]).split('\n').filter(Boolean);
    refs=lines.map(l=>{const [ref,sha,t]=l.split(' ');return {name:ref.slice(prefix.length),sha,at:Number(t)*1000};});
    for(const r of refs)if(r.name.startsWith('vgm/'))r.naBase=spawnSync('git',['merge-base','--is-ancestor',r.sha,`${remote}/${base}`]).status===0;
  }catch(e){console.error(`limpa-branches: git falhou: ${e.message.split('\n')[0]}`);return 2;}
  const alvo=escolhe(refs,{base});
  const result={em:new Date().toISOString(),apagar,remote,base,regras:REGRAS,total:refs.length,escolhidas:alvo.length,apagadas:[],falhas:[],lista:alvo};
  if(apagar){
    // In chunks: one push per 30 refs, each leased on the head seen here.
    for(let i=0;i<alvo.length;i+=30){
      const part=alvo.slice(i,i+30);
      const r=spawnSync('git',['push','--porcelain',...part.map(b=>`--force-with-lease=refs/heads/${b.name}:${b.sha}`),remote,...part.map(b=>`:refs/heads/${b.name}`)],{encoding:'utf8'});
      const {ok,falhas}=lePush(r.stdout);
      result.apagadas.push(...ok);result.falhas.push(...falhas);
      // Refs the porcelain output did not mention (a push that failed as a whole).
      for(const b of part)if(!ok.includes(b.name)&&!falhas.some(f=>f.name===b.name))result.falhas.push({name:b.name,why:(r.stderr||'sem resposta').split('\n')[0].slice(0,200)});
    }
  }
  result.mantidas=refs.length-result.apagadas.length;
  const head=`limpeza de branches: ${alvo.length} de ${refs.length} escolhida(s)${apagar?`, ${result.apagadas.length} apagada(s), ${result.falhas.length} recusada(s)`:' (só a lista: sem --apagar)'}`;
  console.log(head);
  for(const b of alvo)console.log(`  ${apagar?(result.apagadas.includes(b.name)?'apagada ':'mantida '):''}${b.name} ${b.sha.slice(0,7)} ${b.dias} d · ${b.motivo}`);
  for(const f of result.falhas)console.log(`  recusada ${f.name}: ${f.why}`);
  if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(resolve(out),JSON.stringify(result,null,1)+'\n');}
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`**${head}**\n\n${alvo.map(b=>`- ${b.name} (${b.dias} d, ${b.motivo})`).join('\n')}\n`);
  return 0;
}

const entry=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:'';
if(entry===import.meta.url)process.exitCode=main(process.argv.slice(2));
