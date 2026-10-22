// BUG-20261022-ORQ-disco-cheio-guarda: removes the worktrees that are done, so D: never fills up again (22/10: 680 MB
// free, 110 worktrees). A worktree goes only when its HEAD is already in origin/main, it has no tracked change and no
// untracked file outside evidence/, nothing in it changed for --mais-velhas, and the board protects it not: its branch
// queued (fila/*.json), a card in progress naming it (claims/* not in integrated/), an open lote's (fila-*). Its untracked
// final evidence is copied to the board first; the removal is tools/wt-rm.mjs's (the shared node_modules junctions).
//   node tools/wt-limpa.mjs --integradas [--mais-velhas 2h] [--dry] [--repo <main checkout>] [--board <board>]
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {avisaUso,candidatas,cardDe,discoLivre,formataGb,salvaEvidencias} from './wt-guarda.mjs';
import {removeWorktreeSafe,mainCheckoutOf} from './wt-rm.mjs';

/** "2h", "90m", "1d", "45s" → ms. */
export function duracao(s){
  const m=/^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(String(s??'').trim());
  if(!m)throw new Error(`duração inválida: "${s}" (ex.: 2h, 90m, 1d)`);
  return Number(m[1])*{s:1e3,m:60e3,h:3600e3,d:86400e3}[m[2]];
}

/** {removidas:[{path,branch,evidencias}], mantidas:[{path,motivo}], falhas:[{path,erro}], liberado} */
export function limpa({repo,board,idadeMs=2*3600e3,dry=false,remote='origin',base='main',fetch=true,log=console.log}={}){
  const antes=discoLivre(repo).livre,lista=candidatas(repo,board,{remote,base,idadeMs,fetch});
  const out={removidas:[],mantidas:[],falhas:[],liberado:0};
  for(const v of lista){
    if(!v.pode){out.mantidas.push({path:v.path,motivo:v.motivo});if(dry)log(`[dry] mantida ${v.path}: ${v.motivo}`);continue;}
    if(dry){out.removidas.push({path:v.path,branch:v.branch,evidencias:[]});log(`[dry] removeria ${v.path} (${v.branch??'sem branch'}): ${v.motivo}`);continue;}
    try{
      const card=cardDe(board,v.branch,v.path),evid=salvaEvidencias(v.path,board,card);
      removeWorktreeSafe(v.path,{repo,deleteBranch:true});
      out.removidas.push({path:v.path,branch:v.branch,evidencias:evid});
      log(`removida ${v.path} (${v.branch??'sem branch'})${evid.length?`, ${evid.length} prova(s) → evidence/${card}/`:''}`);
    }catch(e){out.falhas.push({path:v.path,erro:e.message});log(`FALHOU ${v.path}: ${e.message}`);}
  }
  if(!dry){spawnSync('git',['worktree','prune'],{cwd:repo});out.liberado=Math.max(0,discoLivre(repo).livre-antes);}
  return out;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=process.argv.slice(2),val=(k)=>{const i=a.indexOf(k);return i>=0?a[i+1]:undefined;};
  if(!a.includes('--integradas')){console.error('uso: node tools/wt-limpa.mjs --integradas [--mais-velhas 2h] [--dry] [--repo <checkout>] [--board <board>]');process.exit(2);}
  try{
    const repo=resolve(val('--repo')??mainCheckoutOf(resolve(dirname(fileURLToPath(import.meta.url)),'..')));
    const board=resolve(val('--board')??join(repo,'..','viagem-board'));
    const r=limpa({repo,board,idadeMs:duracao(val('--mais-velhas')??'2h'),dry:a.includes('--dry')});
    const motivos={};for(const m of r.mantidas){const k=m.motivo.replace(/\(.*$|há \d+ min|\d+/g,'').trim();motivos[k]=(motivos[k]??0)+1;}
    console.log(`\n${a.includes('--dry')?'removeria':'removidas'}: ${r.removidas.length} · mantidas: ${r.mantidas.length} · falhas: ${r.falhas.length}`
      +(a.includes('--dry')?'':` · liberado: ${formataGb(r.liberado)}`));
    for(const [k,n] of Object.entries(motivos).sort((x,y)=>y[1]-x[1]))console.log(`  mantidas por "${k}": ${n}`);
    const d=discoLivre(repo);console.log(`disco: ${formataGb(d.livre)} livres de ${formataGb(d.total)} (${(d.uso*100).toFixed(0)}% de uso)`);
    const aviso=avisaUso(board,repo);if(aviso)console.log(aviso);
    if(r.falhas.length)process.exitCode=1;
  }catch(e){console.error(`[wt-limpa] ${e.message}`);process.exit(1);}
}
