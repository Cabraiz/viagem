// test-changed: imports-only (its path strings are fixtures of a throwaway repo, not dependencies)
// NEW-20261014-E5-wt-rm: tools/wt-rm.mjs on a throwaway repository whose worktree links "node_modules" and
// "backend/node_modules" to a shared folder by real directory junctions (fake packages): the shared files must survive
// every removal, and anything else still pointing outside the worktree must abort it with nothing deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error -- a plain .mjs tool, no types
import {removeWorktreeSafe,linksOutside} from '../../tools/wt-rm.mjs';

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const link=(target:string,path:string)=>symlinkSync(target,path,process.platform==='win32'?'junction':'dir');

function world(){
  const root=mkdtempSync(join(tmpdir(),'wtrm-')),repo=join(root,'viagem'),wt=join(root,'wt','x');
  mkdirSync(repo);mkdirSync(join(root,'wt'));
  git(repo,'init','-q','-b','main');
  for(const [k,v] of [['user.email','wt@test'],['user.name','wt'],['commit.gpgsign','false']])git(repo,'config',k,v);
  mkdirSync(join(repo,'backend'));writeFileSync(join(repo,'backend','.keep'),'');writeFileSync(join(repo,'a.txt'),'a');
  git(repo,'add','-A');git(repo,'commit','-qm','base');
  // The shared packages of the main checkout (gitignored in the real repo; plain folders here).
  for(const d of ['node_modules/pacote','backend/node_modules/libsql'])mkdirSync(join(repo,d),{recursive:true});
  writeFileSync(join(repo,'node_modules/pacote/index.js'),'compartilhado');writeFileSync(join(repo,'backend/node_modules/libsql/index.js'),'compartilhado');
  git(repo,'worktree','add','-q','-b','vgm/x',wt,'main');
  link(join(repo,'node_modules'),join(wt,'node_modules'));link(join(repo,'backend','node_modules'),join(wt,'backend','node_modules'));
  const shared=()=>[readFileSync(join(repo,'node_modules/pacote/index.js'),'utf8'),readFileSync(join(repo,'backend/node_modules/libsql/index.js'),'utf8')];
  return {root,repo,wt,shared,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('the junctions are dropped and checked gone, then the worktree goes; the shared packages are untouched',()=>{
  const w=world();
  try{
    assert.equal(linksOutside(w.wt).length,2,'both junctions seen (links are not followed)');
    const r=removeWorktreeSafe(w.wt,{deleteBranch:true});
    assert.equal(r.removed,true);assert.equal(r.branch,'vgm/x');
    assert.ok(!existsSync(w.wt),'the worktree is gone');
    assert.deepEqual(w.shared(),['compartilhado','compartilhado'],'the shared packages survived');
    assert.equal(git(w.repo,'worktree','list').split('\n').length,1);
    assert.equal(git(w.repo,'branch','--list','vgm/x'),'','--branch-delete');
  }finally{w.cleanup();}
});

test('any other link pointing outside the worktree aborts it: nothing is deleted',()=>{
  const w=world();
  try{
    mkdirSync(join(w.wt,'ferramentas'));link(join(w.repo,'node_modules'),join(w.wt,'ferramentas','pacotes'));
    assert.throws(()=>removeWorktreeSafe(w.wt),/links para fora do worktree: .*pacotes.*NADA foi apagado/);
    assert.ok(existsSync(join(w.wt,'a.txt')),'the worktree is still there');
    assert.deepEqual(w.shared(),['compartilhado','compartilhado']);
    assert.equal(git(w.repo,'worktree','list').split('\n').length,2);
  }finally{w.cleanup();}
});

test('never the main checkout, never a folder that is not a registered worktree; a missing folder is nothing to do',()=>{
  const w=world();
  try{
    assert.throws(()=>removeWorktreeSafe(w.repo),/checkout principal/);
    const loose=join(w.root,'solta');mkdirSync(loose);
    assert.throws(()=>removeWorktreeSafe(loose,{repo:w.repo}),/não é um worktree registrado/);
    assert.deepEqual(removeWorktreeSafe(join(w.root,'nao-existe'),{repo:w.repo}),{removed:false,motivo:'não existe'});
    assert.deepEqual(w.shared(),['compartilhado','compartilhado']);
  }finally{w.cleanup();}
});

test('the CLI aborts with exit 1 and leaves everything in place when a link survives',()=>{
  const w=world();
  try{
    link(join(w.repo,'node_modules'),join(w.wt,'outro-link'));
    let code=0,err='';
    try{execFileSync(process.execPath,[join(import.meta.dirname,'../../tools/wt-rm.mjs'),w.wt],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch(e){code=(e as {status:number}).status;err=String((e as {stderr:string}).stderr);}
    assert.equal(code,1);assert.match(err,/ABORTADO/);
    assert.ok(existsSync(w.wt));assert.deepEqual(w.shared(),['compartilhado','compartilhado']);
  }finally{w.cleanup();}
});
