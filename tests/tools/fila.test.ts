// test-changed: imports-only (its path strings are fixtures of a throwaway repo, not dependencies)
// NEW-20261014-ORQ-fila-integracao-e-testes-afetados (D-049 item 3): the integration queue on a throwaway repo (a bare
// "origin", its main checkout and a board): three branches — one with a protocol change, one that conflicts with the
// main, one clean — give 1 suite, 1 protocol bump, the conflict sent back and 2 integrated after the Worker step; a
// branch that breaks the suite is found alone and sent back while the rest goes in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error -- a plain .mjs tool, no types
import {main,ordered,failedFilesFromTap} from '../../tools/fila.mjs';

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const PROTOCOL=`/**\n * 16 since the 1.7× city.\n * The join handshake refuses other versions with the update message.\n */\nexport const PROTOCOL_VERSION=16;\n`;
// The suite: red when a source says QUEBRADO (FILA_FILES limits nothing here); every run is counted in runs.txt.
const CHECK=`import {readdirSync,readFileSync,appendFileSync} from 'node:fs';
appendFileSync(process.env.FILA_RUNS,(process.env.FILA_FILES||'*')+'\\n');
const bad=readdirSync('src').filter(f=>f.endsWith('.ts')&&readFileSync('src/'+f,'utf8').includes('QUEBRADO'));
if(bad.length){console.log('FILA-FAILED: '+JSON.stringify(['tests/a.test.ts']));process.exit(1);}`;

function world(){
  const root=mkdtempSync(join(tmpdir(),'fila-'));
  const origin=join(root,'origin.git'),repo=join(root,'viagem'),board=join(root,'board'),wt=join(root,'wt');
  mkdirSync(board);mkdirSync(wt);
  git(root,'init','-q','--bare','-b','main',origin);
  git(root,'clone','-q',origin,repo);
  for(const [k,v] of [['user.email','fila@test'],['user.name','fila'],['commit.gpgsign','false']])git(repo,'config',k,v);
  mkdirSync(join(repo,'src/protocol'),{recursive:true});mkdirSync(join(repo,'public'));
  writeFileSync(join(repo,'src/protocol/protocol4.ts'),PROTOCOL);
  writeFileSync(join(repo,'public/multiplayer.json'),JSON.stringify({endpoint:'x',protocol:16}));
  writeFileSync(join(repo,'src/base.ts'),'export const base=1;\n');
  writeFileSync(join(repo,'notas.txt'),'linha original\n');
  writeFileSync(join(repo,'check.mjs'),CHECK);
  git(repo,'checkout','-q','-b','main');git(repo,'add','-A');git(repo,'commit','-qm','base');git(repo,'push','-q','-u','origin','main');
  const branch=(name:string,file:string,text:string)=>{
    git(repo,'checkout','-q','-b',name,'main');writeFileSync(join(repo,file),text);git(repo,'add','-A');git(repo,'commit','-qm',name);git(repo,'checkout','-q','main');
  };
  const runs=join(root,'runs.txt');writeFileSync(runs,'');
  const opts=['--repo',repo,'--board',board,'--wt',wt,'--no-modules','--suite','node check.mjs'];
  process.env.FILA_RUNS=runs;
  return {root,repo,board,branch,opts,runs:()=>readFileSync(runs,'utf8').split('\n').filter(Boolean),
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

/** Runs `fn` as the Orquestrador (FILA_ORQ=1), the only one who publishes a lote that needs the Worker. */
function orq<T>(fn:()=>T):T{process.env.FILA_ORQ='1';try{return fn();}finally{delete process.env.FILA_ORQ;}}

test('ordered: P0 first, then arrival',()=>{
  const e=(card:string,prio:string,at:string)=>({card,prio,at});
  assert.deepEqual(ordered([e('c','P1','2'),e('a','P0','3'),e('b','P1','1')]).map((x:{card:string})=>x.card),['a','b','c']);
});

test('failedFilesFromTap: the file of each top-level failure, from its location (node 26 TAP), repo-relative',()=>{
  const tap=["TAP version 13","# Subtest: a","not ok 1 - a","  ---","  duration_ms: 0.8","  type: 'test'",
    "  location: 'D:\\\\Gits\\\\viagem\\\\tests\\\\sim\\\\a.test.ts:1:63'","  ...","# Subtest: b","ok 2 - b","  ---",
    "  location: 'D:\\\\Gits\\\\viagem\\\\tests\\\\sim\\\\b.test.ts:1:1'","  ...",
    "# Subtest: c","    not ok 1 - inner","    ---","    location: 'D:\\\\x\\\\tests\\\\deep.test.ts:2:2'","    ...",
    "not ok 3 - c","  ---","  location: 'D:\\\\Gits\\\\viagem\\\\tests\\\\client\\\\c.test.ts:9:1'","  ...",
    "not ok 4 - tests\\\\rooms\\\\broken.test.ts","  ---","  failureType: 'testCodeFailure'","  ..."].join('\n');
  assert.deepEqual(failedFilesFromTap(tap),['tests/sim/a.test.ts','tests/client/c.test.ts','tests/rooms/broken.test.ts']);
});

test('ACCEPTANCE: protocol + conflict + clean → 1 suite, 1 bump, the conflict sent back, 2 integrated after the Worker',()=>{
  const w=world();
  try{
    w.branch('vgm/proto','src/novo-campo.ts','export const campo=1;\n');
    w.branch('vgm/limpa','src/limpa.ts','export const limpa=1;\n');
    w.branch('vgm/conflito','notas.txt','linha do executor\n');
    // The main moves after vgm/conflito branched: the same line, another text.
    writeFileSync(join(w.repo,'notas.txt'),'linha da main\n');git(w.repo,'commit','-qam','main mexe');git(w.repo,'push','-q','origin','main');
    main(['pronto','NEW-proto','--branch','vgm/proto','--protocol','--prio','P0',...w.opts]);
    main(['pronto','NEW-limpa','--branch','vgm/limpa',...w.opts]);
    main(['pronto','NEW-conflito','--branch','vgm/conflito',...w.opts]);
    const state=main(['lote',...w.opts]);
    assert.equal(state.estado,'aguardando-worker','the protocol needs the Worker: the queue stops for the Orquestrador');
    assert.equal(state.suites,1,'one suite for the batch');assert.deepEqual(w.runs(),['*']);
    assert.equal(state.protocol,17,'one bump: 16 → 17');
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-proto','NEW-limpa']);
    assert.deepEqual(state.devolvidos.map((d:{card:string;motivo:string})=>[d.card,d.motivo]),[['NEW-conflito','conflito']]);
    const back=JSON.parse(readFileSync(join(w.board,'fila/resultados/NEW-conflito.json'),'utf8'));
    assert.equal(back.status,'devolvido');assert.deepEqual(back.arquivos,['notas.txt']);
    assert.ok(!existsSync(join(w.board,'fila/NEW-conflito.json')),'out of the queue until it is queued again');
    assert.throws(()=>main(['lote',...w.opts]),/lote aberto/,'one batch at a time');
    // An executor cannot push a lote that needs the Worker: only the Orquestrador, after his deploy (FILA_ORQ=1).
    assert.throws(()=>main(['publicar',state.lote,...w.opts]),/Worker pendente/);
    // The Orquestrador published the Worker: push once.
    orq(()=>main(['publicar',state.lote,...w.opts]));
    git(w.repo,'fetch','-q','origin');
    assert.equal(git(w.repo,'rev-parse','origin/main'),state.sha);
    const proto=git(w.repo,'show','origin/main:src/protocol/protocol4.ts');
    assert.match(proto,/export const PROTOCOL_VERSION=17;/);assert.match(proto,/17 given by the integration queue .*NEW-proto/);
    assert.equal(JSON.parse(git(w.repo,'show','origin/main:public/multiplayer.json')).protocol,17);
    assert.ok(git(w.repo,'show','origin/main:src/limpa.ts').includes('limpa'));
    for(const card of ['NEW-proto','NEW-limpa']){
      assert.ok(existsSync(join(w.board,'integrated',card)));
      const r=JSON.parse(readFileSync(join(w.board,'fila/resultados',`${card}.json`),'utf8'));
      assert.equal(r.status,'integrado');assert.equal(r.sha,state.sha);
    }
    assert.ok(!existsSync(join(w.board,'fila/.lote')),'the batch lock is released');
    assert.equal(git(w.repo,'rev-parse','main'),state.sha,'the main checkout followed by fast-forward');
    assert.equal(git(w.repo,'worktree','list').split('\n').length,1,'no batch worktree left');
  }finally{w.cleanup();}
});

test('a branch that breaks the suite is found (main checked first, then the batch rebuilt one branch at a time) and sent back; the rest goes in on the second suite',()=>{
  const w=world();
  try{
    w.branch('vgm/boa','src/boa.ts','export const boa=1;\n');
    w.branch('vgm/quebrada','src/quebrada.ts','export const x="QUEBRADO";\n');
    main(['pronto','NEW-boa','--branch','vgm/boa',...w.opts]);
    main(['pronto','NEW-quebrada','--branch','vgm/quebrada',...w.opts]);
    const state=main(['lote',...w.opts]);
    assert.equal(state.estado,'publicado','no Worker needed: pushed straight away');
    assert.equal(state.suites,2,'the batch suite, then the batch without the culprit');
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-boa']);
    assert.deepEqual(state.devolvidos.map((d:{card:string})=>d.card),['NEW-quebrada']);
    const back=JSON.parse(readFileSync(join(w.board,'fila/resultados/NEW-quebrada.json'),'utf8'));
    assert.match(back.motivo,/a suíte falha com a branch/);assert.deepEqual(back.falhas,['tests/a.test.ts']);
    assert.deepEqual(w.runs().filter(r=>r!=='*'),['tests/a.test.ts','tests/a.test.ts','tests/a.test.ts'],'only the failing files: on the main, + boa, + boa + quebrada');
    git(w.repo,'fetch','-q','origin');
    assert.ok(git(w.repo,'show','origin/main:src/boa.ts'));
    assert.throws(()=>git(w.repo,'show','origin/main:src/quebrada.ts'));
  }finally{w.cleanup();}
});

test('a branch that moved after "pronto" is sent back, not merged at its new head',()=>{
  const w=world();
  try{
    w.branch('vgm/mexida','src/m.ts','export const m=1;\n');
    main(['pronto','NEW-mexida','--branch','vgm/mexida',...w.opts]);
    git(w.repo,'checkout','-q','vgm/mexida');writeFileSync(join(w.repo,'src/m.ts'),'export const m=2;\n');git(w.repo,'commit','-qam','depois');git(w.repo,'checkout','-q','main');
    const state=main(['lote',...w.opts]);
    assert.deepEqual(state.integrados,[]);assert.match(state.devolvidos[0].motivo,/mudou depois do pronto/);
    assert.ok(!existsSync(join(w.board,'fila/.lote')));
  }finally{w.cleanup();}
});

test('--suite ci: E7\'s tools/ci.mjs on the pushed fila/ branch; exit 2 falls back to the local suite; the remote branch goes away',()=>{
  for(const [exit,expectLocal] of [[0,false],[2,true]] as const){
    const w=world();
    try{
      // The fake CI records the branch it was asked about and whether that branch was on the remote.
      mkdirSync(join(w.repo,'tools'));mkdirSync(join(w.repo,'tests'));
      writeFileSync(join(w.repo,'tools/ci.mjs'),`import {execFileSync} from 'node:child_process';import {appendFileSync} from 'node:fs';
const b=process.argv[3];const remote=execFileSync('git',['ls-remote','origin','refs/heads/'+b],{encoding:'utf8'}).trim();
appendFileSync(process.env.FILA_RUNS,'ci '+b+' '+(remote?'remote':'missing')+String.fromCharCode(10));
if(${exit}===2){console.error('rede');process.exit(2);}
console.log(JSON.stringify({ok:true,failedFiles:[],url:'https://ci/run/1'}));`);
      writeFileSync(join(w.repo,'tests/ok.test.ts'),"import test from 'node:test';test('ok',()=>{});\n");
      git(w.repo,'add','-A');git(w.repo,'commit','-qm','ci tool');git(w.repo,'push','-q','origin','main');
      w.branch('vgm/x','src/x.ts','export const x=1;\n');
      main(['pronto','NEW-x','--branch','vgm/x',...w.opts]);
      const opts=w.opts.map(o=>o==='node check.mjs'?'ci':o);
      const state=main(['lote',...opts]);
      assert.equal(state.estado,'publicado');assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-x']);
      const runs=w.runs();
      assert.equal(runs.length,1);assert.match(runs[0],/^ci fila\/\S+ remote$/,'ci.mjs asked about the pushed batch branch');
      assert.equal(state.url,expectLocal?null:'https://ci/run/1',expectLocal?'exit 2: the local suite decided':'the CI run is kept');
      git(w.repo,'fetch','-q','--prune','origin');
      assert.equal(git(w.repo,'branch','-r','--list','origin/fila/*'),'','the batch branch is deleted from the remote');
    }finally{w.cleanup();}
  }
});

test('review: an empty queue and a crash mid-lote leave no lock and no worktree behind',()=>{
  const w=world();
  try{
    main(['lote',...w.opts]);main(['lote',...w.opts]);
    assert.ok(!existsSync(join(w.board,'fila/.lote')),'an empty queue twice: the lock is gone');
    w.branch('vgm/p','src/p.ts','export const p=1;\n');
    main(['pronto','NEW-p','--branch','vgm/p','--protocol',...w.opts]);
    // The bump cannot find the protocol file: the lote throws after its worktree exists.
    assert.throws(()=>main(['lote',...w.opts,'--protocol-file','src/protocol/nao-existe.ts']));
    assert.ok(!existsSync(join(w.board,'fila/.lote')),'the lock is released');
    assert.equal(git(w.repo,'worktree','list').split('\n').length,1,'the batch worktree is removed');
    assert.ok(existsSync(join(w.board,'fila/NEW-p.json')),'the entry is still queued');
  }finally{w.cleanup();}
});

test('review: a suite with no list of failures, or a red main, aborts the lote and keeps every entry queued',()=>{
  const w=world();
  try{
    w.branch('vgm/a','src/a.ts','export const a=1;\n');
    main(['pronto','NEW-a','--branch','vgm/a',...w.opts]);
    const infra=main(['lote',...w.opts.map(o=>o==='node check.mjs'?'node -e "process.exit(1)"':o)]);
    assert.equal(infra.abortado,'sem lista de falhas');assert.deepEqual(infra.devolvidos,[]);
    assert.ok(existsSync(join(w.board,'fila/NEW-a.json')));
    // The main itself breaks the failing files.
    writeFileSync(join(w.repo,'src/base.ts'),'export const base="QUEBRADO";\n');git(w.repo,'commit','-qam','main vermelha');git(w.repo,'push','-q','origin','main');
    const red=main(['lote',...w.opts]);
    assert.equal(red.abortado,'a main falha');assert.deepEqual(red.devolvidos,[]);
    assert.ok(existsSync(join(w.board,'fila/NEW-a.json')),'not blamed');
    assert.ok(!existsSync(join(w.board,'fila/.lote')));
  }finally{w.cleanup();}
});

test('review: a failure only two branches make together goes back to the second one; the first goes in',()=>{
  const w=world();
  try{
    writeFileSync(join(w.repo,'par.mjs'),"import {existsSync} from 'node:fs';import {appendFileSync} from 'node:fs';appendFileSync(process.env.FILA_RUNS,(process.env.FILA_FILES||'*')+String.fromCharCode(10));\n"
      +"if(existsSync('src/p1.ts')&&existsSync('src/p2.ts')){console.log('FILA-FAILED: '+JSON.stringify(['tests/par.test.ts']));process.exit(1);}\n");
    git(w.repo,'add','-A');git(w.repo,'commit','-qm','par');git(w.repo,'push','-q','origin','main');
    w.branch('vgm/p1','src/p1.ts','export const p1=1;\n');w.branch('vgm/p2','src/p2.ts','export const p2=1;\n');
    main(['pronto','NEW-p1','--branch','vgm/p1',...w.opts]);main(['pronto','NEW-p2','--branch','vgm/p2',...w.opts]);
    const state=main(['lote',...w.opts.map(o=>o==='node check.mjs'?'node par.mjs':o)]);
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-p1']);
    assert.deepEqual(state.devolvidos.map((d:{card:string})=>d.card),['NEW-p2']);
  }finally{w.cleanup();}
});

test('review: a newer pronto while the lote waits for the Worker stays queued; pronto from a worktree finds the main checkout',async()=>{
  const w=world();
  try{
    w.branch('vgm/n','src/n.ts','export const n=1;\n');
    main(['pronto','NEW-n','--branch','vgm/n','--protocol',...w.opts]);
    const state=main(['lote',...w.opts]);assert.equal(state.estado,'aguardando-worker');
    git(w.repo,'checkout','-q','vgm/n');writeFileSync(join(w.repo,'src/n.ts'),'export const n=2;\n');git(w.repo,'commit','-qam','n2');git(w.repo,'checkout','-q','main');
    const newer=main(['pronto','NEW-n','--branch','vgm/n','--protocol',...w.opts]);
    orq(()=>main(['publicar',state.lote,...w.opts]));
    const r=JSON.parse(readFileSync(join(w.board,'fila/resultados/NEW-n.json'),'utf8'));
    assert.equal(r.status,'integrado');assert.equal(r.sha,state.sha);
    assert.equal(JSON.parse(readFileSync(join(w.board,'fila/NEW-n.json'),'utf8')).sha,newer.sha,'the newer SHA is still queued');
    assert.throws(()=>orq(()=>main(['publicar',state.lote,...w.opts])),/publicado/,'a published lote is not pushed again');
    // The tool resolves the main checkout from any worktree of the repository.
    // @ts-expect-error -- .mjs
    const {mainCheckout}=await import('../../tools/fila.mjs');
    const other=join(w.root,'wt','outro');git(w.repo,'worktree','add','-q','-b','vgm/outro',other,'main');
    const norm=(p:string)=>p.split(String.fromCharCode(92)).join('/').toLowerCase();
    assert.equal(norm(mainCheckout(other)),norm(w.repo));
  }finally{w.cleanup();}
});

test('the production smoke runs after a green suite and before the push: a failing smoke aborts the lote, everyone stays queued',()=>{
  const w=world();
  try{
    w.branch('vgm/s','src/s.ts','export const s=1;'+String.fromCharCode(10));
    main(['pronto','NEW-s','--branch','vgm/s',...w.opts]);
    const red=main(['lote',...w.opts,'--smoke','node -e "process.exit(1)"']);
    assert.equal(red.abortado,'smoke');assert.ok(existsSync(join(w.board,'fila/NEW-s.json')),'still queued');
    git(w.repo,'fetch','-q','origin');assert.throws(()=>git(w.repo,'show','origin/main:src/s.ts'),'nothing pushed');
    const green=main(['lote',...w.opts,'--smoke','node -e "process.exit(0)"']);
    assert.equal(green.estado,'publicado');assert.equal(green.smoke,'ok');
  }finally{w.cleanup();}
});
