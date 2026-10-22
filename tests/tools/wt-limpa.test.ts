// test-changed: imports-only (its path strings are fixtures of a throwaway repo, not dependencies)
// BUG-20261022-ORQ-disco-cheio-guarda: on 22/10 D: filled up (680 MB free, 110 worktrees). tools/wt-limpa.mjs removes
// only the worktrees that are done — the HEAD in origin/main, no tracked change, untouched for a while, not queued, not a
// card in progress, not an open lote's — after copying their untracked final evidence; tools/wt-novo.mjs refuses a new
// worktree below 25 GB free and tells the Orquestrador. On a throwaway repository with a bare "origin" and a board.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error -- plain .mjs tools, no types
import {limpa,duracao} from '../../tools/wt-limpa.mjs';
// @ts-expect-error -- plain .mjs tools, no types
import {candidatas,discoLivre,exigeEspaco,recadoOrq} from '../../tools/wt-guarda.mjs';
// @ts-expect-error -- plain .mjs tools, no types
import {novaWorktree} from '../../tools/wt-novo.mjs';

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const H=3600e3;

function world(){
  const root=mkdtempSync(join(tmpdir(),'wtlimpa-')),origin=join(root,'origin.git'),repo=join(root,'viagem'),board=join(root,'board'),wt=join(root,'wt');
  mkdirSync(board);mkdirSync(wt);
  git(root,'init','-q','--bare','-b','main',origin);git(root,'clone','-q',origin,repo);
  for(const [k,v] of [['user.email','wt@test'],['user.name','wt'],['commit.gpgsign','false']])git(repo,'config',k,v);
  writeFileSync(join(repo,'a.txt'),'a\n');git(repo,'checkout','-q','-b','main');git(repo,'add','-A');git(repo,'commit','-qm','base');git(repo,'push','-q','-u','origin','main');
  /** A worktree on its own branch with one commit; `push` puts that commit in origin/main (the card integrated). */
  const make=(name:string,{push=true}={})=>{
    const dir=join(wt,name);git(repo,'worktree','add','-q','-b',`vgm/${name}`,dir,'main');
    writeFileSync(join(dir,`${name}.txt`),name);git(dir,'add','-A');git(dir,'commit','-qm',name);
    if(push){git(dir,'push','-q','origin',`vgm/${name}:main`);git(repo,'fetch','-q','origin');git(repo,'merge','-q','--ff-only','origin/main');}
    return dir;
  };
  return {root,repo,board,wt,make,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('duracao: 2h, 90m, 1d; anything else is refused',()=>{
  assert.equal(duracao('2h'),2*H);assert.equal(duracao('90m'),90*60e3);assert.equal(duracao('1d'),24*H);
  assert.throws(()=>duracao('2 horas'),/duração inválida/);
});

test('only what is done goes: integrated and untouched; queued, in progress, open lote, unmerged, with work, or fresh stay',()=>{
  const w=world();
  try{
    const feito=w.make('feito'),fila=w.make('na-fila'),andamento=w.make('andamento'),solto=w.make('solto',{push:false});
    const mexendo=w.make('mexendo'),lixo=w.make('com-lixo'),lote=join(w.wt,'fila-20261022-043442');
    git(w.repo,'worktree','add','-q','-b','fila/20261022-043442',lote,'main');
    writeFileSync(join(mexendo,'a.txt'),'mexendo\n');// tracked change
    writeFileSync(join(lixo,'rascunho.ts'),'x');// untracked outside evidence/
    mkdirSync(join(feito,'evidence','prova'),{recursive:true});writeFileSync(join(feito,'evidence','prova','final.png'),'png');
    mkdirSync(join(w.board,'fila','.lote'),{recursive:true});writeFileSync(join(w.board,'fila','.lote','lote.txt'),'20261022-043442');
    writeFileSync(join(w.board,'fila','NEW-x.json'),JSON.stringify({card:'NEW-x',branch:'vgm/na-fila',sha:'0'}));
    mkdirSync(join(w.board,'claims','NEW-andamento'),{recursive:true});writeFileSync(join(w.board,'claims','NEW-andamento','owner.txt'),'Executor-3 vgm/andamento');
    mkdirSync(join(w.board,'claims','NEW-feito'),{recursive:true});writeFileSync(join(w.board,'claims','NEW-feito','owner.txt'),'Executor-1 vgm/feito');
    mkdirSync(join(w.board,'integrated'),{recursive:true});writeFileSync(join(w.board,'integrated','NEW-feito'),'');// its card is done
    const now=candidatas(w.repo,w.board,{agora:Date.now(),fetch:false});
    assert.ok(now.every((v:{pode:boolean})=>!v.pode),'everything was just touched: nothing goes before 2 h');
    const later=Date.now()+3*H,by=(l:{path:string,motivo:string,pode:boolean}[])=>Object.fromEntries(l.map(v=>[v.path.replace(/\\/g,'/').split('/').pop(),v]));
    const v=by(candidatas(w.repo,w.board,{agora:later,fetch:false}));
    assert.equal(v['feito'].pode,true);
    assert.match(v['na-fila'].motivo,/na fila/);
    assert.match(v['andamento'].motivo,/card em andamento \(claims\/NEW-andamento\)/);
    assert.match(v['solto'].motivo,/fora da origin\/main/);
    assert.match(v['mexendo'].motivo,/mudança rastreada/);
    assert.match(v['com-lixo'].motivo,/não rastreado.*rascunho\.ts/);
    assert.match(v['fila-20261022-043442'].motivo,/lote aberto/);
    // The removal (the age through the reflog is real: "2 h" from now cannot be waited for, so 0 here).
    const r=limpa({repo:w.repo,board:w.board,idadeMs:0,fetch:false,log:()=>{}});
    assert.deepEqual(r.removidas.map((x:{path:string})=>x.path.replace(/\\/g,'/').split('/').pop()),['feito']);
    assert.ok(!existsSync(feito));assert.equal(git(w.repo,'branch','--list','vgm/feito'),'','its branch too');
    assert.equal(readFileSync(join(w.board,'evidence','NEW-feito','prova','final.png'),'utf8'),'png','its evidence copied first');
    for(const d of [fila,andamento,solto,mexendo,lixo,lote])assert.ok(existsSync(d),`${d} kept`);
    // Once the lote is closed, its leftover checkout goes even off the main (machine-made).
    rmSync(join(w.board,'fila','.lote'),{recursive:true});
    const r2=limpa({repo:w.repo,board:w.board,idadeMs:0,fetch:false,log:()=>{}});
    assert.deepEqual(r2.removidas.map((x:{path:string})=>x.path.replace(/\\/g,'/').split('/').pop()),['fila-20261022-043442']);
  }finally{w.cleanup();}
});

test('the guard: below 25 GB free no new worktree (one note to the Orquestrador); above 85% a warning; otherwise silent',()=>{
  const w=world();
  try{
    const caixa=()=>{try{return readFileSync(join(w.board,'caixa','ORQ.md'),'utf8');}catch{return '';}};
    assert.throws(()=>novaWorktree('x',{repo:w.repo,board:w.board,wt:w.wt,modules:false,fake:'0.7,932'}),/0\.7 GB livres \(mínimo 25 GB\): recusei a worktree x/);
    assert.ok(!existsSync(join(w.wt,'x')),'nothing made');
    assert.match(caixa(),/· disco → ORQ\n\[P0\] disco .*recusei a worktree x/);
    assert.equal(recadoOrq(w.board,'recusa','de novo'),false,'the same kind of note waits half an hour');
    const dir=novaWorktree('y',{repo:w.repo,board:w.board,wt:w.wt,modules:false,fake:'100,1000'});
    assert.equal(git(dir,'rev-parse','--abbrev-ref','HEAD'),'vgm/y');
    assert.match(caixa(),/\[aviso\] disco .*90% de uso/);
    const before=caixa();exigeEspaco(w.board,w.repo,'teste',{fake:'500,1000'});assert.equal(caixa(),before,'50%: no note');
    const real=discoLivre(w.repo,'');assert.ok(real.total>0&&real.livre>=0&&real.uso>=0&&real.uso<=1,'the real drive is read');
  }finally{w.cleanup();}
});
