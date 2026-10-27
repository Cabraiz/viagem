// NEW-20261017-ORQ-fila-deploy-seguro: pages.yml publishes the site only when the live rooms Worker matches it in the
// protocol AND the maps (scripts/health-gate.mjs over /health). Both directions refuse: a Worker ahead of the site
// (lote 13: map v3 while the site still had v2) and a site ahead of the Worker (a map-only lote whose Worker deploy
// was skipped). The Worker side (/health tells its maps) is tests/rooms/room-index.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error -- a plain .mjs script, no types
import {expected,gate,buildProblems,gitHistory} from '../../scripts/health-gate.mjs';
// @ts-expect-error -- a plain .mjs script, no types
import {workerFiles,workerChanges} from '../../scripts/worker-files.mjs';

const want=expected();
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const HEAD=git('.','rev-parse','HEAD');
const city=JSON.parse(readFileSync('public/maps/cidade-nevada.manifest.json','utf8'));
const health=(over:object={})=>({status:'ok',service:'viagem-salas',protocol:want.protocol,maps:{'cidade-nevada':{version:city.version,hash:city.hash}},build:HEAD.slice(0,12),...over});

test('expected: the site\'s protocol and every map manifest it ships',()=>{
  assert.equal(want.protocol,JSON.parse(readFileSync('public/multiplayer.json','utf8')).protocol);
  assert.deepEqual(want.maps['cidade-nevada'],{version:city.version,hash:city.hash});
});

test('gate: the same protocol and maps pass; a Worker behind or ahead in the map, another protocol, or no maps at all refuse',()=>{
  assert.deepEqual(gate(health(),want),{ok:true,problems:[]});
  const map=(version:number,hash:string)=>health({maps:{'cidade-nevada':{version,hash}}});
  const behind=gate(map(city.version-1,'a'.repeat(64)),want);
  assert.equal(behind.ok,false);assert.match(behind.problems[0],new RegExp(`serve v${city.version-1} .*o site v${city.version}`));
  assert.equal(gate(map(city.version+1,'b'.repeat(64)),want).ok,false,'a Worker ahead of the site (lote 13)');
  assert.equal(gate(map(city.version,'c'.repeat(64)),want).ok,false,'same version, other bytes');
  assert.match(gate(health({protocol:want.protocol-1}),want).problems.join(),/protocolo: o Worker fala/);
  assert.match(gate(health({maps:undefined}),want).problems.join(),/sem maps: Worker anterior/);
  assert.equal(gate(undefined,want).ok,false);
});

/** The CLI against a local /health answering `body` (no retries). */
function cli(body:object):Promise<{code:number;out:string}>{
  return new Promise((done,fail)=>{
    const server=createServer((_,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(body));});
    server.listen(0,'127.0.0.1',()=>{
      const port=(server.address() as {port:number}).port;
      const p=spawn(process.execPath,['scripts/health-gate.mjs',`http://127.0.0.1:${port}/health`,'--tries','1'],{stdio:['ignore','pipe','pipe']});
      let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);
      p.on('error',fail);p.on('close',code=>{server.close();done({code:code??-1,out});});
    });
  });
}

test('the CLI pages.yml runs: exit 0 when the Worker matches, 1 with the reason when it is behind or ahead',async()=>{
  const ok=await cli(health());
  assert.equal(ok.code,0,ok.out);assert.match(ok.out,/casa com o site/);
  for(const v of [city.version-1,city.version+1]){
    const off=await cli(health({maps:{'cidade-nevada':{version:v,hash:'d'.repeat(64)}}}));
    assert.equal(off.code,1,off.out);assert.match(off.out,/::error::mapa cidade-nevada/);
  }
});

// NEW-20261025-ORQ-health-gate-build-sha: lote 23 changed the sim with the same protocol and maps; the Worker stayed on
// lote 22 and the gate let the site go. /health's build must be the site's commit, or one after which nothing the
// Worker bundles changed (a site-only lote does not redeploy the Worker, so "always HEAD" would never publish).
test('buildProblems: HEAD passes; an older build passes only when nothing the Worker bundles changed since; unknown or missing refuses',()=>{
  const head='a'.repeat(40),since=(m:Record<string,string[]|null>)=>(sha:string)=>m[sha];
  assert.deepEqual(buildProblems(head.slice(0,12),head,since({})),[]);
  assert.deepEqual(buildProblems(`${head.slice(0,12)}-sujo`,head,since({})),[],'a dirty deploy is judged by its commit');
  assert.deepEqual(buildProblems('b'.repeat(12),head,since({['b'.repeat(12)]:[]})),[],'only the site moved');
  const stale=buildProblems('c'.repeat(12),head,since({['c'.repeat(12)]:['src/sim/core.ts']}));
  assert.equal(stale.length,1);assert.match(stale[0],/build: o Worker é do commit c{12}, o site a{12}, e desde então mudou o que o Worker empacota \(src\/sim\/core\.ts\)/);
  assert.match(buildProblems('d'.repeat(12),head,since({['d'.repeat(12)]:null})).join(),/não está no histórico/);
  for(const b of ['desconhecido',undefined,'x'])assert.match(buildProblems(b,head,since({})).join(),/não diz de que commit veio/);
});

test('workerFiles + gitHistory: the Worker\'s import closure, and what changed in it since a build, on a throwaway repo',()=>{
  const root=mkdtempSync(join(tmpdir(),'gate-'));
  try{
    git(root,'init','-q','-b','main');
    for(const [k,v] of [['user.email','gate@test'],['user.name','gate'],['commit.gpgsign','false']])git(root,'config',k,v);
    for(const d of ['multiplayer','src/sim','src/maps','src/client','public/maps'])mkdirSync(join(root,d),{recursive:true});
    writeFileSync(join(root,'multiplayer/worker.ts'),"import {core} from '../src/sim/index.ts';\nimport {map} from '../src/maps';\n");
    writeFileSync(join(root,'multiplayer/wrangler.jsonc'),'{}\n');
    writeFileSync(join(root,'src/sim/index.ts'),"export {core} from './core.ts';\n");
    writeFileSync(join(root,'src/sim/core.ts'),"import type {X} from './tipos';\nexport const core=1;\n");
    writeFileSync(join(root,'src/sim/tipos.ts'),'export type X=1;\n');
    writeFileSync(join(root,'src/maps/index.ts'),"import cidade from '../../public/maps/cidade.json' with {type:'json'};\nexport const map=cidade;\n");
    writeFileSync(join(root,'public/maps/cidade.json'),'{}\n');
    writeFileSync(join(root,'src/client/tela.ts'),"import {core} from '../sim/core.ts';\n");
    git(root,'add','-A');git(root,'commit','-qm','um');
    const files=workerFiles(root);
    assert.deepEqual(files,['multiplayer/worker.ts','multiplayer/wrangler.jsonc','public/maps/cidade.json','src/maps/index.ts',
      'src/sim/core.ts','src/sim/index.ts','src/sim/tipos.ts'],'the client is not in the Worker');
    assert.deepEqual(workerChanges(['src/client/tela.ts','src/sim/core.ts'],files),['src/sim/core.ts']);
    const um=git(root,'rev-parse','HEAD');
    writeFileSync(join(root,'src/client/tela.ts'),'export const tela=2;\n');git(root,'commit','-qam','dois');
    assert.deepEqual(gitHistory(root).changedSince(um.slice(0,12)),[],'a site-only commit leaves the Worker current');
    writeFileSync(join(root,'src/sim/core.ts'),'export const core=2;\n');git(root,'commit','-qam','tres');
    const h=gitHistory(root);
    assert.equal(h.head,git(root,'rev-parse','HEAD'));
    assert.deepEqual(h.changedSince(um.slice(0,12)),['src/sim/core.ts'],'lote 23: the sim moved, the Worker did not');
    assert.equal(h.changedSince('e'.repeat(12)),null,'a commit outside this history');
    assert.deepEqual(workerFiles(join(root,'src')),[],'no Worker, nothing bundled');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('the CLI refuses a Worker whose build is not in this history, and names the build when it passes',async()=>{
  const ok=await cli(health());
  assert.equal(ok.code,0,ok.out);assert.match(ok.out,new RegExp(`build ${HEAD.slice(0,12)}`));
  const off=await cli(health({build:'f'.repeat(12)}));
  assert.equal(off.code,1,off.out);assert.match(off.out,/::error::build: o Worker é do commit f{12}, que não está no histórico/);
});
