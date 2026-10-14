// The only way to remove a worktree (ESCALA.md; after the shared node_modules were emptied four times, the last on
// 14/10/2026 04:05). Executor worktrees link node_modules and backend/node_modules to the main checkout as directory
// junctions, and `git worktree remove` (with or without --force) on Windows follows a junction and deletes the shared
// packages behind it. So:
//   1. the folder must be a registered worktree of the repository, never the main checkout;
//   2. the known junctions (node_modules, backend/node_modules) are dropped — the link itself, never its target;
//   3. CHECKED: each path must not exist any more (lstat ENOENT), not just "the command returned ok";
//   4. the whole worktree is scanned (links not followed) for any link left pointing outside it: one → abort;
//   5. only then `git worktree remove` (and, with --branch-delete, `git branch -d` of its branch).
//   node tools/wt-rm.mjs <worktree folder> [--branch-delete] [--repo <main checkout>]
// tools/fila.mjs removes its batch worktrees through removeWorktreeSafe.
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readdirSync,readlinkSync,rmdirSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The links the executors make (ESCALA.md §2.2): dropped by the tool; any other link outside the worktree aborts. */
export const JUNCTIONS=['node_modules','backend/node_modules'];
/** Folders never walked when looking for links (git's own data; build output is plain files). */
const SKIP=new Set(['.git']);

const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});return {ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const norm=(p)=>resolve(p).replace(/[\\/]+$/,'').toLowerCase();
const inside=(child,parent)=>{const r=relative(parent,child);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
/** Whether `p` exists in any form (a dangling link counts): lstat, which never follows it. */
const present=(p)=>{try{lstatSync(p);return true;}catch(e){return e.code!=='ENOENT'&&e.code!=='ENOTDIR';}};

/** The main checkout of the repository `dir` belongs to: the parent of git's common dir. */
export function mainCheckoutOf(dir){
  const r=git(dir,'rev-parse','--path-format=absolute','--git-common-dir');
  if(!r.ok)throw new Error(`${dir} não é um checkout git (${r.err||r.out})`);
  return dirname(r.out);
}

/** Every link under `dir` (not followed) whose target lies outside `dir`: [{path, target}]. */
export function linksOutside(dir){
  const out=[],root=resolve(dir);
  const walk=(d)=>{
    let names;try{names=readdirSync(d);}catch{return;}
    for(const n of names){
      if(SKIP.has(n))continue;
      const p=join(d,n);let st;
      try{st=lstatSync(p);}catch{continue;}
      if(st.isSymbolicLink()){
        let t='';try{t=resolve(dirname(p),readlinkSync(p));}catch{t='?';}
        if(t==='?'||!inside(t,root))out.push({path:p,target:t});
      }else if(st.isDirectory())walk(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Removes the worktree `dir` of the repository `repo` (default: the main checkout `dir` belongs to) safely; returns
 * {removed:true, branch?}. Throws (and removes NOTHING further) when a check fails.
 */
export function removeWorktreeSafe(dir,{repo,deleteBranch=false}={}){
  const wt=resolve(dir);
  if(!existsSync(wt))return {removed:false,motivo:'não existe'};
  const main=resolve(repo??mainCheckoutOf(wt));
  if(norm(wt)===norm(main))throw new Error(`${wt} é o checkout principal: nunca`);
  // 1. A registered worktree of this repository (git worktree list --porcelain).
  const list=git(main,'worktree','list','--porcelain');
  if(!list.ok)throw new Error(`git worktree list falhou: ${list.err}`);
  const entries=list.out.split(/\r?\n\r?\n/).map(b=>({path:/^worktree (.+)$/m.exec(b)?.[1],branch:/^branch refs\/heads\/(.+)$/m.exec(b)?.[1]}));
  const me=entries.find(e=>e.path&&norm(e.path)===norm(wt));
  if(!me)throw new Error(`${wt} não é um worktree registrado de ${main}`);
  // 2. Drop the known junctions: rmdirSync removes a junction/symlink itself, never what it points to.
  for(const j of JUNCTIONS){
    const p=join(wt,...j.split('/'));
    if(!present(p))continue;
    let st;try{st=lstatSync(p);}catch{continue;}
    if(!st.isSymbolicLink())continue;// a real folder of its own (rare): git removes it with the worktree
    try{rmdirSync(p);}catch{try{unlinkSync(p);}catch{/* checked below */}}
    // 3. Checked, not trusted: the path must be gone.
    if(present(p))throw new Error(`a junção ${p} continua lá depois do rmdir: NADA foi apagado (remova à mão: cmd /c rmdir "${p}")`);
  }
  // 4. Nothing else may still point outside the worktree (above all into the main checkout's packages).
  const left=linksOutside(wt);
  if(left.length)throw new Error(`links para fora do worktree: ${left.map(l=>`${relative(wt,l.path)} → ${l.target}`).join(', ')}; NADA foi apagado`);
  // 5. Only now. --force: build output and untracked files go too; nothing in it points outside any more.
  const r=git(main,'worktree','remove','--force',wt);
  if(!r.ok)throw new Error(`git worktree remove falhou: ${r.err}`);
  if(deleteBranch&&me.branch){const b=git(main,'branch','-d',me.branch);if(!b.ok)return {removed:true,branch:me.branch,branchKept:b.err};}
  return {removed:true,branch:me.branch};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),dir=args.find(a=>!a.startsWith('--')&&args[args.indexOf(a)-1]!=='--repo');
  const ri=args.indexOf('--repo'),repo=ri>=0?args[ri+1]:undefined;
  if(!dir){console.error('uso: node tools/wt-rm.mjs <worktree> [--branch-delete] [--repo <checkout principal>]');process.exit(2);}
  try{
    const r=removeWorktreeSafe(dir,{repo,deleteBranch:args.includes('--branch-delete')});
    console.log(r.removed?`removido: ${dir}${r.branch?` (branch ${r.branch}${args.includes('--branch-delete')?(r.branchKept?` mantido: ${r.branchKept}`:' apagado'):''})`:''}`:`nada a fazer: ${dir} ${r.motivo}`);
  }catch(e){console.error(`[wt-rm] ABORTADO: ${e.message}`);process.exit(1);}
}
