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
import {main,ordered,failedFilesFromTap,smokeGist,contractFiles,printsSheet,isGeneratedArt} from '../../tools/fila.mjs';

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

test('printsSheet: the CI print sheet of the commit (prints-no-ci): ok, failed with its reasons, or missing',()=>{
  const board=mkdtempSync(join(tmpdir(),'fila-folha-'));
  try{
    const dir=join(board,'evidence','prints-ci','vgm','x','abc1234');
    assert.equal(printsSheet(board,'vgm/x','abc1234ffff'),'sem folha de prints do CI');
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'folha.json'),JSON.stringify({ok:true,fails:[]}));
    assert.equal(printsSheet(board,'vgm/x','abc1234ffff'),'ok');
    writeFileSync(join(dir,'folha.json'),JSON.stringify({ok:false,fails:['tremor']}));
    assert.match(printsSheet(board,'vgm/x','abc1234ffff'),/FALHOU: tremor/);
  }finally{rmSync(board,{recursive:true,force:true});}
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

test('a failing test file only the culprit branch adds: the main and the earlier steps do not run it (NEW-20261014-ORQ-fila-teste-novo)',()=>{
  const w=world();
  try{
    // The real local suite (node --test): the main has a green test; the branch adds a red one. node --test on a path
    // that does not exist is an error, so without the filter the main looked red (lote 20261014-204519).
    mkdirSync(join(w.repo,'tests'));
    writeFileSync(join(w.repo,'tests/ok.test.ts'),"import test from 'node:test';test('ok',()=>{});\n");
    git(w.repo,'add','-A');git(w.repo,'commit','-qm','ok');git(w.repo,'push','-q','origin','main');
    w.branch('vgm/boa','src/boa.ts','export const boa=1;\n');
    w.branch('vgm/teste-novo','tests/novo.test.ts',"import test from 'node:test';import assert from 'node:assert';test('novo',()=>assert.fail('vermelho'));\n");
    main(['pronto','NEW-boa','--branch','vgm/boa',...w.opts]);main(['pronto','NEW-teste-novo','--branch','vgm/teste-novo',...w.opts]);
    const state=main(['lote',...w.opts.map(o=>o==='node check.mjs'?'local':o)]);
    assert.equal(state.abortado,undefined,'the main is not "red" for a file it does not have');
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-boa'],'boa alone does not have the file either');
    assert.deepEqual(state.devolvidos.map((d:{card:string})=>d.card),['NEW-teste-novo']);
    const back=JSON.parse(readFileSync(join(w.board,'fila/resultados/NEW-teste-novo.json'),'utf8'));
    assert.deepEqual(back.falhas,['tests/novo.test.ts']);
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

test('the upgrade smoke (BUG-20261014-ORQ-mapa-cache-velho): the base checked out and built, the script run with --upgrade-from it, the checkout removed',()=>{
  const w=world();
  try{
    // A repo whose smoke script has the upgrade mode: it records its arguments; the build only marks the checkout.
    mkdirSync(join(w.repo,'scripts'));
    writeFileSync(join(w.repo,'build.mjs'),"import {writeFileSync} from 'node:fs';writeFileSync('built.txt','1');");
    writeFileSync(join(w.repo,'package.json'),JSON.stringify({scripts:{build:'node build.mjs'}}));
    writeFileSync(join(w.repo,'scripts/smoke-prod.mjs'),"// --upgrade-from <checkout>"+String.fromCharCode(10)+"import {appendFileSync,existsSync} from 'node:fs';import {join} from 'node:path';"+String.fromCharCode(10)
      +"const i=process.argv.indexOf('--upgrade-from');const prev=i>0?process.argv[i+1]:'';"+String.fromCharCode(10)
      +"appendFileSync(process.env.FILA_RUNS,'smoke '+(prev?'upgrade '+(existsSync(join(prev,'built.txt'))?'base-built':'base-not-built'):'normal')+(existsSync('built.txt')?' lote-built':'')+String.fromCharCode(10));");
    git(w.repo,'add','-A');git(w.repo,'commit','-qm','smoke script');git(w.repo,'push','-q','origin','main');
    w.branch('vgm/u','src/u.ts','export const u=1;'+String.fromCharCode(10));
    main(['pronto','NEW-u','--branch','vgm/u',...w.opts]);
    const state=main(['lote',...w.opts]);
    assert.equal(state.estado,'publicado');
    assert.deepEqual(w.runs().filter(r=>r.startsWith('smoke')),['smoke normal lote-built','smoke upgrade base-built lote-built']);
    assert.equal(git(w.repo,'worktree','list').split(String.fromCharCode(10)).length,1,'the base checkout is gone too');
    assert.ok(!existsSync(join(w.board,'locks','browser-1')),'the browser slot is released');
  }finally{w.cleanup();}
});

test('BUG-20261020-ORQ-fila-job-build: a red job:build (the CI smoke) is checked by the smoke on the main, then on the batch one branch at a time',()=>{
  // The "CI" says job:build when a source says SMOKE-QUEBRADO (job:lint for OUTRO-JOB); the local smoke fails on it too.
  const nl=String.fromCharCode(10);
  const ci=`node -e "const fs=require('fs');const src=fs.readdirSync('src').filter(f=>f.endsWith('.ts')).map(f=>fs.readFileSync('src/'+f,'utf8')).join();`
    +`const job=src.includes('OUTRO-JOB')?'job:lint':src.includes('SMOKE-QUEBRADO')?'job:build':null;`
    +`if(job){console.log('FILA-FAILED: '+JSON.stringify([job]));process.exit(1);}"`;
  const smoke=`node -e "const fs=require('fs');fs.appendFileSync(process.env.FILA_RUNS,'smoke'+String.fromCharCode(10));`
    +`if(fs.readdirSync('src').filter(f=>f.endsWith('.ts')).some(f=>fs.readFileSync('src/'+f,'utf8').includes('SMOKE-QUEBRADO'))){console.log('trace');console.log('smoke normal: FALHOU · chunk: x 60 s');process.exit(1);}"`;
  const opts=(w:{opts:string[]})=>[...w.opts.map(o=>o==='node check.mjs'?ci:o),'--smoke',smoke];
  // Main green: the culprit goes back with reason smoke and the smoke's line; the other one goes in.
  let w=world();
  try{
    w.branch('vgm/ok','src/ok.ts','export const ok=1;'+nl);
    w.branch('vgm/smk','src/smk.ts','export const smk="SMOKE-QUEBRADO";'+nl);
    main(['pronto','NEW-ok','--branch','vgm/ok',...w.opts]);main(['pronto','NEW-smk','--branch','vgm/smk',...w.opts]);
    const state=main(['lote',...opts(w)]);
    assert.equal(state.estado,'publicado');assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-ok']);
    assert.equal(state.devolvidos.length,1);
    const back=state.devolvidos[0];
    assert.equal(back.card,'NEW-smk');assert.equal(back.motivo,'smoke');assert.equal(back.smoke,'smoke normal: FALHOU · chunk: x 60 s');
    assert.deepEqual(back.falhas,['job:build']);
    assert.equal(JSON.parse(readFileSync(join(w.board,'fila/resultados/NEW-smk.json'),'utf8')).motivo,'smoke');
    // The main, step 1 (ok), step 2 (ok+smk) → the culprit; then the green batch's own smoke.
    assert.equal(w.runs().filter(r=>r==='smoke').length,4);
  }finally{w.cleanup();}
  // Main red: aborted as before, nobody blamed.
  w=world();
  try{
    writeFileSync(join(w.repo,'src/base.ts'),'export const base="SMOKE-QUEBRADO";'+nl);git(w.repo,'commit','-qam','main vermelha');git(w.repo,'push','-q','origin','main');
    w.branch('vgm/a','src/a.ts','export const a=1;'+nl);
    main(['pronto','NEW-a','--branch','vgm/a',...w.opts]);
    const red=main(['lote',...opts(w)]);
    assert.equal(red.abortado,'a main falha');assert.deepEqual(red.devolvidos,[]);
    assert.ok(existsSync(join(w.board,'fila/NEW-a.json')),'not blamed');assert.ok(!existsSync(join(w.board,'fila/.lote')));
    assert.equal(w.runs().filter(r=>r==='smoke').length,1,'only the main\'s smoke');
  }finally{w.cleanup();}
  // Another job with no rule: aborted without saying the main fails, no smoke run.
  w=world();
  try{
    w.branch('vgm/j','src/j.ts','export const j="OUTRO-JOB";'+nl);
    main(['pronto','NEW-j','--branch','vgm/j',...w.opts]);
    const other=main(['lote',...opts(w)]);
    assert.equal(other.abortado,'falha de job sem arquivo');assert.deepEqual(other.devolvidos,[]);
    assert.ok(existsSync(join(w.board,'fila/NEW-j.json')));assert.deepEqual(w.runs(),[]);
  }finally{w.cleanup();}
});

test('a failed smoke\'s reason: its verdict lines, not the traces before them',()=>{
  const trace='  rastro normal: '+JSON.stringify(Array.from({length:3},(_,s)=>({s,sala:'',tick:-1,salaMs:9,resp:false})));
  const out=[trace,'smoke normal: INFRA · não entrou: nada mudou em 90 s',trace,'smoke chaveiro: OK (travou nas 2 tentativas)'].join('\r\n');
  assert.equal(smokeGist(out),'smoke normal: INFRA · não entrou: nada mudou em 90 s / smoke chaveiro: OK (travou nas 2 tentativas)');
  assert.equal(smokeGist('o navegador não abriu'),'o navegador não abriu','no verdict line: the start of the output');
  assert.equal(smokeGist('x'.repeat(900)).length,600);
});

// NEW-20261017-ORQ-fila-manifest-auto: public/art/manifest.json (the importer's index of every group) conflicted in almost
// every lote. A conflict only there is regenerated from the group manifests (the checkout's own writeIndex) and checked
// with `node scripts/art-lite.mjs --check`; any other file in conflict still sends the branch back.
const SPEC=`export const GROUPS={a:{output:'public/art/a'},b:{output:'public/art/b'}};\n`;
const CONVERT=`import {readFileSync,writeFileSync,existsSync} from 'node:fs';
export async function writeIndex(specs,{outRoot}){
  const groups={};
  for(const [g,s] of Object.entries(specs)){const f=outRoot+'/'+s.output+'/manifest.json';if(existsSync(f))groups[g]={output:s.output,pieces:JSON.parse(readFileSync(f,'utf8')).pieces};}
  writeFileSync(outRoot+'/public/art/manifest.json',JSON.stringify({version:2,groups})+'\\n');
}\n`;
// The lite check: red while a copy is missing (public/art/a/SEM-LITE stands for one).
const LITE=`import {existsSync} from 'node:fs';
if(existsSync('public/art/a/SEM-LITE')){console.error('art-lite: copies missing or older than their source: a/x');process.exit(1);}\n`;

function artWorld(lite=LITE){
  const w=world(),art=(dir:string,pieces:object)=>{mkdirSync(join(w.repo,dir),{recursive:true});writeFileSync(join(w.repo,dir,'manifest.json'),JSON.stringify({pieces},null,2)+'\n');};
  const index=(a:object,b:object)=>writeFileSync(join(w.repo,'public/art/manifest.json'),JSON.stringify({version:2,groups:{a:{output:'public/art/a',pieces:a},b:{output:'public/art/b',pieces:b}}})+'\n');
  mkdirSync(join(w.repo,'scripts/art-v2'),{recursive:true});
  writeFileSync(join(w.repo,'scripts/art-v2/spec.mjs'),SPEC);writeFileSync(join(w.repo,'scripts/art-v2/convert.mjs'),CONVERT);
  writeFileSync(join(w.repo,'scripts/art-lite.mjs'),lite);
  art('public/art/a',{um:1});art('public/art/b',{dois:2});index({um:1},{dois:2});
  const runLite=()=>{if(lite!==LITE)execFileSync(process.execPath,['scripts/art-lite.mjs'],{cwd:w.repo});};
  runLite();
  git(w.repo,'add','-A');git(w.repo,'commit','-qm','arte');git(w.repo,'push','-q','origin','main');
  /**
   * A branch that imports into group `g` (its manifest and the index, as the importer writes both; `indexOnly`: the
   * index alone), plus extra files.
   */
  const importing=(name:string,g:'a'|'b',pieces:object,extra:Record<string,string>={},indexOnly=false)=>{
    git(w.repo,'checkout','-q','-b',name,'main');
    const a=g==='a'?pieces:{um:1},b=g==='b'?pieces:{dois:2};
    if(!indexOnly)art(`public/art/${g}`,pieces);
    index(a,b);runLite();
    for(const [f,t] of Object.entries(extra))writeFileSync(join(w.repo,f),t);
    git(w.repo,'add','-A');git(w.repo,'commit','-qm',name);git(w.repo,'checkout','-q','main');
  };
  return {...w,importing,art,runLite};
}

test('a conflict only in public/art/manifest.json is regenerated from the group manifests, checked by art-lite and integrated; one with another file, or a red art-lite, goes back',()=>{
  const w=artWorld();
  try{
    w.importing('vgm/arte-a','a',{um:1,tres:3});
    w.importing('vgm/arte-b','b',{dois:2,quatro:4});           // the index conflicts with arte-a's, nothing else
    w.importing('vgm/arte-b2','b',{dois:2,cinco:5});           // the index and, after arte-b, b's manifest
    w.importing('vgm/sem-lite','a',{um:1,seis:6},{'public/art/a/SEM-LITE':'x'},true); // the index only, a copy missing
    main(['pronto','NEW-arte-a','--branch','vgm/arte-a',...w.opts]);
    main(['pronto','NEW-arte-b','--branch','vgm/arte-b',...w.opts]);
    main(['pronto','NEW-arte-b2','--branch','vgm/arte-b2',...w.opts]);
    main(['pronto','NEW-sem-lite','--branch','vgm/sem-lite',...w.opts]);
    const state=main(['lote',...w.opts]);
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-arte-a','NEW-arte-b']);
    const back=Object.fromEntries(state.devolvidos.map((d:{card:string})=>[d.card,d]));
    assert.deepEqual(Object.keys(back).sort(),['NEW-arte-b2','NEW-sem-lite']);
    assert.deepEqual([...back['NEW-arte-b2'].arquivos].sort(),['public/art/b/manifest.json','public/art/manifest.json'],'another file in conflict: back as before');
    assert.equal(back['NEW-arte-b2'].nota,undefined,'no regeneration tried');
    assert.deepEqual(back['NEW-sem-lite'].arquivos,['public/art/manifest.json']);
    assert.match(back['NEW-sem-lite'].nota,/art-lite --check falhou .*copies missing/);
    git(w.repo,'fetch','-q','origin');
    const index=JSON.parse(git(w.repo,'show','origin/main:public/art/manifest.json'));
    assert.deepEqual(index.groups.a.pieces,{um:1,tres:3});assert.deepEqual(index.groups.b.pieces,{dois:2,quatro:4},'both imports in the index');
    assert.ok(!git(w.repo,'show','origin/main:public/art/manifest.json').includes('<<<<<<<'));
    assert.match(git(w.repo,'log','-1','--format=%s',`${state.sha}^2`),/arte-b/,'the merge commit of arte-b is there');
    assert.equal(git(w.repo,'worktree','list').split('\n').length,1,'no batch worktree left');
  }finally{w.cleanup();}
});

// NEW-20261020-ORQ-fila-art-lite-auto: torres-entregues went back twice with public/art/manifest.json and
// scripts/art-lite.json in conflict (art-lite remade the copies of the sheets the branch changed). Conflicts only in
// generated art (the index, art-lite.json, public/art/lite/**) are made again by writeIndex + art-lite and checked; a
// source file in the conflict still sends the branch back, untouched.
// The stub art-lite: art-lite.json and lite/todas.txt from every group manifest, one line each (so they conflict).
const LITE_MAKES=`import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
const {GROUPS}=await import('./art-v2/spec.mjs');
const read=f=>JSON.parse(readFileSync(f,'utf8')),files={};
for(const s of Object.values(GROUPS)){const f=s.output+'/manifest.json';if(!existsSync(f))continue;
  for(const [p,v] of Object.entries(read(f).pieces))files[s.output.split('/').pop()+'/'+p]=v;}
const sorted=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));
const todas=JSON.stringify(sorted(files))+'\\n';
const rec=existsSync('scripts/art-lite.json')?read('scripts/art-lite.json'):{files:{}};
if(process.argv.includes('--check')){
  if(JSON.stringify(sorted(rec.files))!==JSON.stringify(sorted(files))||readFileSync('public/art/lite/todas.txt','utf8')!==todas){
    console.error('art-lite: copies missing or older than their source');process.exit(1);}
  process.exit(0);
}
rec.files=sorted({...rec.files,...files});
mkdirSync('public/art/lite',{recursive:true});writeFileSync('public/art/lite/todas.txt',todas);
writeFileSync('scripts/art-lite.json',JSON.stringify(rec)+'\\n');
`;

test('a conflict in public/art/manifest.json + scripts/art-lite.json + a lite copy is made again by art-lite and integrated; with a .ts in it, back untouched',()=>{
  const w=artWorld(LITE_MAKES);
  try{
    writeFileSync(join(w.repo,'src-x.ts'),'0\n');git(w.repo,'add','-A');git(w.repo,'commit','-qm','x');git(w.repo,'push','-q','origin','main');
    w.importing('vgm/arte-a','a',{um:1,tres:3},{'src-x.ts':'1\n'});
    w.importing('vgm/arte-b','b',{dois:2,quatro:4});           // index, art-lite.json and lite/todas.txt conflict with arte-a's
    // A third group (c) with its lite, plus a source file both it and arte-a changed.
    writeFileSync(join(w.repo,'scripts/art-v2/spec.mjs'),SPEC.replace("};",",c:{output:'public/art/c'}};"));
    git(w.repo,'add','-A');git(w.repo,'commit','-qm','grupo c');git(w.repo,'push','-q','origin','main');
    git(w.repo,'checkout','-q','-b','vgm/arte-ts','main');
    w.art('public/art/c',{sete:7});w.runLite();writeFileSync(join(w.repo,'src-x.ts'),'2\n');
    git(w.repo,'add','-A');git(w.repo,'commit','-qm','arte-ts');git(w.repo,'checkout','-q','main');
    for(const [card,branch] of [['NEW-arte-a','vgm/arte-a'],['NEW-arte-b','vgm/arte-b'],['NEW-arte-ts','vgm/arte-ts']])
      main(['pronto',card,'--branch',branch,...w.opts]);
    const state=main(['lote',...w.opts]);
    assert.deepEqual(state.integrados.map((e:{card:string})=>e.card),['NEW-arte-a','NEW-arte-b']);
    assert.deepEqual(state.devolvidos.map((d:{card:string})=>d.card),['NEW-arte-ts']);
    const back=state.devolvidos[0];
    assert.ok(back.arquivos.includes('src-x.ts')&&back.arquivos.includes('scripts/art-lite.json'),back.arquivos.join(', '));
    assert.equal(back.nota,undefined,'no regeneration tried');
    git(w.repo,'fetch','-q','origin');
    const show=(f:string)=>git(w.repo,'show',`origin/main:${f}`);
    assert.deepEqual(JSON.parse(show('scripts/art-lite.json')).files,{'a/tres':3,'a/um':1,'b/dois':2,'b/quatro':4},'both sides in art-lite.json');
    assert.deepEqual(JSON.parse(show('public/art/lite/todas.txt')),{'a/tres':3,'a/um':1,'b/dois':2,'b/quatro':4},'the copy made again');
    const index=JSON.parse(show('public/art/manifest.json'));
    assert.deepEqual(index.groups.a.pieces,{um:1,tres:3});assert.deepEqual(index.groups.b.pieces,{dois:2,quatro:4});
    for(const f of ['scripts/art-lite.json','public/art/lite/todas.txt','public/art/manifest.json'])assert.ok(!show(f).includes('<<<<<<<'),f);
    assert.equal(git(w.repo,'worktree','list').split('\n').length,1,'no batch worktree left');
  }finally{w.cleanup();}
});

test('isGeneratedArt: the index, art-lite.json and the lite copies; not a group manifest, a sheet or code',()=>{
  assert.deepEqual(['public/art/manifest.json','scripts/art-lite.json','public/art/lite/towers/t1/base.webp','public/art/towers/manifest.json',
    'public/art/towers/t1/base.webp','scripts/art-lite.mjs','src/client/art/manifest.ts'].filter(isGeneratedArt),
  ['public/art/manifest.json','scripts/art-lite.json','public/art/lite/towers/t1/base.webp']);
});

// NEW-20261017-ORQ-fila-deploy-seguro + fila-deploy-ordem: lote 13 changed the city map (v2 → v3); the Worker went up
// by hand ~20 min before pages.yml published the site, and every phone on the old site saw "Atualize a página". pages.yml
// has no Cloudflare token, so the Worker can only go up by the Orquestrador's deploy:rooms: the order is always
// deploy:rooms first, then publicar (its health-gate holds the site until the Worker matches). A lote that changes what
// the Worker matches with the client (a map's manifest or bytes, the protocol, multiplayer.json) needs the Worker even
// without a --worker entry, and the queue warns that the old site is out of step for ~20 min.
test('deploy:rooms first, then publicar, always; a map or protocol change also warns the site is out of step for ~20 min, and needs the Worker without --worker',(t)=>{
  const said:string[]=[];
  t.mock.method(console,'log',(...a:unknown[])=>{said.push(a.join(' '));});
  for(const [file,flag,contract] of [['public/maps/cidade.manifest.json',[],true],['src/so-codigo.ts',['--worker'],false]] as const){
    const w=world();
    try{
      said.length=0;mkdirSync(join(w.repo,'public/maps'),{recursive:true});
      w.branch('vgm/w',file,'{"version":3}\n');
      main(['pronto','NEW-w','--branch','vgm/w',...flag,...w.opts]);
      const state=main(['lote',...w.opts]);
      assert.equal(state.estado,'aguardando-worker',contract?'a map change waits for the Worker even without --worker':'--worker');
      assert.deepEqual(state.contrato,contract?[file]:[]);
      const log=said.join('\n');
      assert.match(log,/run deploy:rooms/,'the deploy:rooms command, every time');
      assert.match(log,/depois, com FILA_ORQ=1: node tools\/fila\.mjs publicar/);
      assert.equal(/fora de passo por ~20 min/.test(log),contract);
      assert.throws(()=>main(['publicar',state.lote,...w.opts]),/depois do deploy:rooms/);
      said.length=0;
      orq(()=>main(['publicar',state.lote,...w.opts]));
      assert.equal(/fora de passo por ~20 min.*confira o site em ~25 min/.test(said.join('\n')),contract,'the reminder after the push');
    }finally{w.cleanup();}
  }
});

test('contractFiles: the maps\' manifests and bytes, the protocol and multiplayer.json; nothing else',()=>{
  assert.deepEqual(contractFiles(['public/maps/cidade-nevada.manifest.json','public/maps/cidade-nevada.json','src/protocol/protocol4.ts',
    'src/protocol/room.ts','public/multiplayer.json','public/maps/thumbs/a.webp','src/sim/core.ts','public/art/manifest.json','tests/protocol/x.test.ts']),
  ['public/maps/cidade-nevada.manifest.json','public/maps/cidade-nevada.json','src/protocol/protocol4.ts','src/protocol/room.ts','public/multiplayer.json']);
});
