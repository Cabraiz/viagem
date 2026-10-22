// BUG-20261022-ORQ-disco-cheio-guarda: on 22/10 the D: drive filled up (680 MB free, 110 worktrees in viagem-wt) and an
// executor could not create its worktree. This module is the guard shared by tools/fila.mjs, tools/wt-novo.mjs and
// tools/wt-limpa.mjs:
//   - the free space of the drive (`discoLivre`); below MIN_LIVRE_GB nothing new starts (`exigeEspaco`) and the
//     Orquestrador gets a note in his inbox; above AVISO_USO of use he gets a warning (`avisaUso`);
//   - which worktrees can go (`candidatas`): the branch already in origin/main, no tracked change, nothing touched for a
//     while, not a card still queued or in progress, not an open lote's;
//   - before one goes, its untracked final evidence (PNG/GIF/MD, no raw frames) is copied to the board (`salvaEvidencias`).
// Removal itself is always tools/wt-rm.mjs's removeWorktreeSafe (the shared node_modules junctions).
// A simulated drive for tests: VIAGEM_DISCO="<free GB>,<total GB>" (or the `disco` option).
import {spawnSync} from 'node:child_process';
import {appendFileSync,copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,statSync,statfsSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';

export const MIN_LIVRE_GB=25;
export const AVISO_USO=0.85;
const GB=1024**3;
/** How often the same note goes to the Orquestrador again (one per lote/worktree attempt would flood his inbox). */
const REPETE_MS={recusa:30*60_000,aviso:6*60*60_000};

const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:64<<20});return {ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const norm=(p)=>resolve(p).replace(/[\\/]+$/,'').replace(/\\/g,'/').toLowerCase();
/** `git status --porcelain -uall -z` entries [{xy, path}] (untrimmed: the leading space of " M" matters); null when git fails. */
export function statusZ(dir,...paths){
  const r=spawnSync('git',['--no-optional-locks','status','--porcelain','-uall','-z',...(paths.length?['--',...paths]:[])],{cwd:dir,encoding:'utf8',maxBuffer:64<<20});
  if(r.status!==0)return null;
  const out=[],parts=(r.stdout??'').split('\0');
  for(let i=0;i<parts.length;i++){const e=parts[i];if(e.length<4)continue;const xy=e.slice(0,2);out.push({xy,path:e.slice(3).replace(/\\/g,'/')});if(xy[0]==='R'||xy[0]==='C')i++;}
  return out;
}
const fmt=(b)=>`${(b/GB).toFixed(1)} GB`;

/** {livre, total, uso} in bytes (uso 0..1) of the drive holding `path`; VIAGEM_DISCO / `fake` simulate it. */
export function discoLivre(path,fake=process.env.VIAGEM_DISCO){
  if(fake){
    const [l,t]=String(fake).split(',').map(Number);
    if(!(l>=0&&t>0))throw new Error(`VIAGEM_DISCO inválido: "${fake}" (use "<livre GB>,<total GB>")`);
    return {livre:l*GB,total:t*GB,uso:1-l/t};
  }
  let p=resolve(path);while(!existsSync(p)&&dirname(p)!==p)p=dirname(p);
  const s=statfsSync(p),livre=Number(s.bavail)*Number(s.bsize),total=Number(s.blocks)*Number(s.bsize);
  return {livre,total,uso:total?1-livre/total:0};
}

/**
 * A note in the Orquestrador's inbox (board/caixa/ORQ.md, the format of ~/.claude/hooks/caixa.mjs), at most once per
 * REPETE_MS[tipo] for the same kind. Returns whether it was written.
 */
export function recadoOrq(board,tipo,texto,{agora=Date.now()}={}){
  const dir=join(board,'caixa'),marca=join(dir,`.disco-${tipo}`);
  mkdirSync(dir,{recursive:true});
  try{if(agora-Number(readFileSync(marca,'utf8'))<(REPETE_MS[tipo]??0))return false;}catch{/* first time */}
  appendFileSync(join(dir,'ORQ.md'),`\n### ${new Date(agora).toISOString().slice(0,16)}Z · disco → ORQ\n${texto.trim()}\n`);
  writeFileSync(marca,String(agora));
  return true;
}

/** Warns the Orquestrador when the drive is above AVISO_USO; returns the warning line or ''. */
export function avisaUso(board,path,{fake}={}){
  const d=discoLivre(path,fake);
  if(d.uso<AVISO_USO)return '';
  const linha=`[aviso] disco ${driveOf(path)} com ${(d.uso*100).toFixed(0)}% de uso (${fmt(d.livre)} livres de ${fmt(d.total)}): `
    +`rode node tools/wt-limpa.mjs --integradas --mais-velhas 2h (--dry só lista).`;
  recadoOrq(board,'aviso',linha);
  return linha;
}

/** Throws when the drive has less than MIN_LIVRE_GB free, after a note to the Orquestrador; else warns above 85%. */
export function exigeEspaco(board,path,oQue,{fake,minGb=MIN_LIVRE_GB}={}){
  const d=discoLivre(path,fake);
  if(d.livre<minGb*GB){
    const linha=`[P0] disco ${driveOf(path)} com ${fmt(d.livre)} livres (mínimo ${minGb} GB): recusei ${oQue}. `
      +`Libere com node tools/wt-limpa.mjs --integradas --mais-velhas 2h.`;
    recadoOrq(board,'recusa',linha);
    throw new Error(linha);
  }
  avisaUso(board,path,{fake});
  return d;
}
const driveOf=(p)=>/^[a-z]:/i.test(resolve(p))?resolve(p).slice(0,2).toUpperCase():resolve(p);

// ---------- which worktrees ----------
/** git worktree list --porcelain of `repo`: [{path, head, branch?, locked, main}] (the first one is the main checkout). */
export function worktrees(repo){
  const r=git(repo,'worktree','list','--porcelain');
  if(!r.ok)throw new Error(`git worktree list falhou: ${r.err}`);
  return r.out.split(/\r?\n\r?\n/).filter(Boolean).map((b,i)=>({path:/^worktree (.+)$/m.exec(b)?.[1],head:/^HEAD ([0-9a-f]+)$/m.exec(b)?.[1],
    branch:/^branch refs\/heads\/(.+)$/m.exec(b)?.[1],locked:/^locked\b/m.test(b),prunable:/^prunable\b/m.test(b),main:i===0})).filter(w=>w.path);
}

/**
 * What protects a worktree, read from the board: the branches queued in fila/*.json, the open lote (fila/.lote) and the
 * text of every claim whose card is not in integrated/ (a card in progress: its owner.txt/status.md name the branch or
 * the folder).
 */
export function protecoes(board){
  const fila=join(board,'fila'),filaBranches=new Set(),claims=[];
  if(existsSync(fila))for(const f of readdirSync(fila).filter(f=>f.endsWith('.json'))){
    try{const e=JSON.parse(readFileSync(join(fila,f),'utf8'));if(e.branch)filaBranches.add(e.branch);}catch{/* half-written: the next run */}
  }
  let loteAberto=null;try{loteAberto=readFileSync(join(fila,'.lote','lote.txt'),'utf8').trim()||'?';}catch{if(existsSync(join(fila,'.lote')))loteAberto='?';}
  const cdir=join(board,'claims');
  if(existsSync(cdir))for(const id of readdirSync(cdir)){
    if(existsSync(join(board,'integrated',id)))continue;
    let texto='';
    try{for(const f of readdirSync(join(cdir,id)))try{texto+=readFileSync(join(cdir,id,f),'utf8')+'\n';}catch{/* a folder */}}catch{continue;}
    claims.push({id,texto:texto.replace(/\\/g,'/').toLowerCase()});
  }
  return {filaBranches,loteAberto,claims};
}

/** The claim (card in progress) a worktree belongs to: its branch or folder named in the claim, or the card id ending in the folder name. */
export function claimDe(w,claims){
  const nome=basename(w.path).toLowerCase(),pasta=norm(w.path),branch=w.branch?.toLowerCase();
  return claims.find(c=>(branch&&new RegExp(`(^|[^\\w/-])${branch.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')}($|[^\\w/-])`).test(c.texto))
    ||c.texto.includes(pasta)||c.texto.includes(`viagem-wt/${nome}`)||c.id.toLowerCase().endsWith(nome))?.id;
}

/**
 * The newest change in a worktree: the HEAD file (a checkout), the time written in the last line of its reflog (a commit,
 * a merge, a reset) and every modified or untracked (not ignored) file. Not the mtimes of the index (any `git status`
 * rewrites it) nor of logs/HEAD (a `git reflog expire`/`gc` rewrites them all: 22/10 04:27Z, every worktree "fresh").
 */
export function ultimaMudanca(dir){
  let t=0;const see=(p)=>{try{t=Math.max(t,statSync(p).mtimeMs);}catch{/* gone */}};
  const gd=git(dir,'rev-parse','--path-format=absolute','--git-dir');
  if(gd.ok){
    see(join(gd.out,'HEAD'));
    try{
      const last=readFileSync(join(gd.out,'logs','HEAD'),'utf8').trimEnd().split('\n').pop()??'';
      const s=/> (\d+) [+-]\d{4}\t/.exec(last);if(s)t=Math.max(t,Number(s[1])*1000);
    }catch{/* no reflog */}
  }
  for(const e of statusZ(dir)??[])see(join(dir,e.path));
  return t;
}

/**
 * The verdict on one worktree `w` (from `worktrees`): {path, branch, head, pode, motivo}. `pode` only when the HEAD is in
 * `alvo` (a ref or SHA), there is no tracked change and no untracked file outside evidence/, nothing changed for
 * `idadeMs`, and the board (`prot`, from `protecoes`) protects it not.
 */
export function avalia(w,prot,{alvo,idadeMs=2*60*60_000,agora=Date.now(),repo}={}){
  const v={path:w.path,branch:w.branch??null,head:w.head,pode:false,motivo:''},nome=basename(w.path);
  if(w.main){v.motivo='checkout principal';return v;}
  if(w.prunable){v.motivo='pasta sumiu (git worktree prune)';return v;}
  if(w.locked){v.motivo='travada (git worktree lock)';return v;}
  // A batch checkout of tools/fila.mjs (fila-<lote>[-base|-c|-anterior]): kept while its lote is open; left over by a
  // crashed or killed lote it is machine-made, so its HEAD need not be in the main.
  const lote=/^fila-(\d{8}-\d{6})(-|$)/.exec(nome)?.[1];
  if(lote&&prot.loteAberto&&(prot.loteAberto==='?'||prot.loteAberto===lote)){v.motivo=`lote aberto (${prot.loteAberto})`;return v;}
  if(w.branch&&prot.filaBranches.has(w.branch)){v.motivo='na fila';return v;}
  const claim=claimDe(w,prot.claims);
  if(claim){v.motivo=`card em andamento (claims/${claim})`;return v;}
  if(!lote&&(!w.head||!git(repo??w.path,'merge-base','--is-ancestor',w.head,alvo).ok)){v.motivo=`fora da ${alvo}`;return v;}
  const ents=statusZ(w.path);
  if(!ents){v.motivo='git status falhou';return v;}
  const rastreadas=ents.filter(e=>e.xy!=='??');
  const soltos=ents.filter(e=>e.xy==='??'&&!e.path.startsWith('evidence/'));
  if(rastreadas.length){v.motivo=`mudança rastreada (${rastreadas.length} arquivo(s))`;return v;}
  if(soltos.length){v.motivo=`${soltos.length} arquivo(s) não rastreado(s) fora de evidence/ (${soltos[0].path}…)`;return v;}
  const idade=agora-ultimaMudanca(w.path);
  if(idade<idadeMs){v.motivo=`mexida há ${Math.round(idade/60_000)} min`;return v;}
  v.pode=true;v.motivo=lote?`sobra do lote ${lote}, parada há ${(idade/3_600_000).toFixed(1)} h`:idadeMs?`integrada, parada há ${(idade/3_600_000).toFixed(1)} h`:'integrada';
  return v;
}

/** Every worktree of `repo` but the main checkout, judged against `<remote>/<base>` (see `avalia`). */
export function candidatas(repo,board,{remote='origin',base='main',idadeMs,agora,fetch=true}={}){
  if(fetch)git(repo,'fetch','-q',remote);
  const prot=protecoes(board);
  return worktrees(repo).filter(w=>!w.main).map(w=>avalia(w,prot,{alvo:`${remote}/${base}`,idadeMs,agora,repo}));
}

// ---------- evidence ----------
const FINAL=/\.(png|gif|md)$/i,BRUTO=/(^|\/)(frames?|quadros?|brutos?|raw)(\/|$)|(frame|quadro)[-_]?\d+\.png$/i;

/** The card a branch belongs to: fila/resultados/*.json and claims/* name it; else the worktree's folder name. */
export function cardDe(board,branch,pasta){
  const res=join(board,'fila','resultados');
  if(branch&&existsSync(res))for(const f of readdirSync(res).filter(f=>f.endsWith('.json'))){
    try{const e=JSON.parse(readFileSync(join(res,f),'utf8'));if(e.branch===branch)return e.card;}catch{/* next */}
  }
  const cdir=join(board,'claims');
  if(branch&&existsSync(cdir))for(const id of readdirSync(cdir)){
    try{if(readFileSync(join(cdir,id,'owner.txt'),'utf8').includes(branch))return id;}catch{/* none */}
  }
  return basename(pasta);
}

/**
 * Copies the worktree's untracked final evidence (evidence/**: PNG, GIF, MD; no raw frames) to board/evidence/<card>/,
 * keeping the path under evidence/. Committed evidence is already in git. Returns the files copied.
 */
export function salvaEvidencias(dir,board,card){
  const st=statusZ(dir,'evidence');
  if(!st)return [];
  const copiados=[];
  for(const {xy,path:rel} of st){
    if(xy!=='??')continue;
    if(!FINAL.test(rel)||BRUTO.test(rel))continue;
    const dest=join(board,'evidence',card,rel.replace(/^evidence\//,''));
    try{if(existsSync(dest)&&statSync(dest).size===statSync(join(dir,rel)).size)continue;}catch{continue;}
    mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(dir,rel),dest);copiados.push(rel);
  }
  return copiados;
}

export {fmt as formataGb};
