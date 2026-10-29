// test-changed: imports-only (its path strings are fixtures of a throwaway repo, not dependencies)
// NEW-20261025-ORQ-cicd-smokes-bench, step 3: the weekly cleanup of the remote's branches (tools/limpa-branches.mjs,
// .github/workflows/limpeza-branches.yml). The rules on plain refs, the porcelain reader, and one run on a throwaway
// repo: what it deletes with --apagar, what it only lists without it, and what it never touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-expect-error -- a plain .mjs tool, no types
import {escolhe,lePush,REGRAS} from '../../tools/limpa-branches.mjs';

const H=3600_000,D=24*H,NOW=Date.parse('2026-10-25T12:00:00Z');
const TOOL=fileURLToPath(new URL('../../tools/limpa-branches.mjs',import.meta.url));

test('escolhe: vgm/ in main and idle 7 days; fila/ and bench/ after 24 h; main and other prefixes never',()=>{
  const r=(name:string,ageMs:number,naBase=false)=>({name,sha:name.padEnd(40,'0'),at:NOW-ageMs,naBase});
  const out=escolhe([
    r('main',30*D,true),r('HEAD',30*D,true),r('vgm/velha-na-main',8*D,true),r('vgm/nova-na-main',6*D,true),r('vgm/velha-fora',30*D,false),
    r('fila/20261020-1',25*H),r('fila/20261025-1',2*H),r('bench/vgm/x-1',2*D),r('bench/vgm/y-1',H),r('outra/coisa',90*D,true),
  ],{now:NOW});
  assert.deepEqual(out.map((b:{name:string})=>b.name),['bench/vgm/x-1','fila/20261020-1','vgm/velha-na-main']);
  assert.match(out[2].motivo,/na main, parada há ≥ 7 dias/);assert.equal(out[2].dias,8);
  assert.equal(REGRAS['vgm/'].idadeMs,7*D);assert.equal(REGRAS['fila/'].idadeMs,24*H);
});

test('lePush: deleted and refused refs from git push --porcelain',()=>{
  const text=['To https://github.com/x/y','-\t:refs/heads/vgm/a\t[deleted]','!\t:refs/heads/fila/b\t[rejected] (stale info)','Done'].join('\n');
  assert.deepEqual(lePush(text),{ok:['vgm/a'],falhas:[{name:'fila/b',why:'[rejected] (stale info)'}]});
});

test('a run on a throwaway remote: only lists without --apagar; with it deletes what the rules pick and keeps the rest',()=>{
  const root=mkdtempSync(join(tmpdir(),'limpa-'));
  const git=(cwd:string,args:string[],env:Record<string,string>={})=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,...env}}).trim();
  try{
    const origin=join(root,'origin.git'),repo=join(root,'repo');
    git(root,['init','-q','--bare','-b','main',origin]);git(root,['clone','-q',origin,repo]);
    for(const [k,v] of [['user.email','t@t'],['user.name','t'],['commit.gpgsign','false']])git(repo,['config',k,v]);
    const at=(ms:number)=>{const d=new Date(ms).toISOString();return {GIT_COMMITTER_DATE:d,GIT_AUTHOR_DATE:d};};
    const commit=(file:string,ms:number)=>{writeFileSync(join(repo,file),file);git(repo,['add','-A']);git(repo,['commit','-qm',file],at(ms));};
    const now=Date.now();
    git(repo,['checkout','-q','-b','main']);commit('base.txt',now-30*D);
    // vgm/old: merged into main, its last commit 10 days ago. vgm/fresh: merged, 2 days. vgm/open: not merged, 30 days.
    git(repo,['checkout','-q','-b','vgm/old']);commit('old.txt',now-10*D);
    git(repo,['checkout','-q','-b','vgm/fresh','main']);commit('fresh.txt',now-2*D);
    git(repo,['checkout','-q','main']);git(repo,['merge','-q','--no-ff','-m','m1','vgm/old'],at(now-9*D));git(repo,['merge','-q','--no-ff','-m','m2','vgm/fresh'],at(now-D));
    git(repo,['checkout','-q','-b','vgm/open','main']);commit('open.txt',now-30*D);
    git(repo,['checkout','-q','-b','fila/old','main']);commit('fila-old.txt',now-3*D);
    git(repo,['checkout','-q','-b','fila/new','main']);commit('fila-new.txt',now-H);
    git(repo,['checkout','-q','main']);
    git(repo,['push','-q','origin','main','vgm/old','vgm/fresh','vgm/open','fila/old','fila/new']);
    git(repo,['fetch','-q','origin']);
    const heads=()=>git(repo,['ls-remote','--heads','origin']).split('\n').map(l=>l.split('refs/heads/')[1]).sort();
    const all=['fila/new','fila/old','main','vgm/fresh','vgm/old','vgm/open'];
    const list=spawnSync(process.execPath,[TOOL,'--out',join(root,'lista.json')],{cwd:repo,encoding:'utf8'});
    assert.equal(list.status,0,list.stderr);
    assert.deepEqual(heads(),all,'without --apagar nothing goes');
    assert.deepEqual(JSON.parse(readFileSync(join(root,'lista.json'),'utf8')).lista.map((b:{name:string})=>b.name),['fila/old','vgm/old']);
    const run=spawnSync(process.execPath,[TOOL,'--apagar','--out',join(root,'apagou.json')],{cwd:repo,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(heads(),['fila/new','main','vgm/fresh','vgm/open']);
    const done=JSON.parse(readFileSync(join(root,'apagou.json'),'utf8'));
    assert.deepEqual(done.apagadas.sort(),['fila/old','vgm/old']);assert.deepEqual(done.falhas,[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
