// test-changed: imports-only (its path strings are fixtures of a throwaway repo, not dependencies)
// NEW-20261014-ORQ-fila-integracao-e-testes-afetados (D-049 item 2): scripts/test-changed.mjs picks the tests a change
// can reach through imports and repo-path strings, and widens the set for the wire sectors, src/ and the build config.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- a plain .mjs script, no types
import {affectedTests,references,resolveRef} from '../../scripts/test-changed.mjs';

/** A tiny repo: path → text; folders are the prefixes of its paths. */
function repo(tree:Record<string,string>){
  const files=Object.keys(tree),tests=files.filter(f=>/^tests\/.*\.test\.ts$/.test(f));
  const isDir=(p:string)=>files.some(f=>f.startsWith(p+'/'));
  return {files,tests,read:(f:string)=>tree[f]??'',exists:(p:string)=>p in tree||isDir(p),isDir};
}
const TREE={
  'src/client/hud/minimap.ts':"export const m=1;",
  'src/client/hud/index.ts':"export * from './minimap.ts';",
  'src/client/scene.ts':"import {m} from './hud/index.ts';",
  'src/sim/run.ts':"import type {X} from '../contract/index.ts';",
  'src/contract/index.ts':"export type X=1;",
  'tests/client/scene.test.ts':"import '../../src/client/scene.ts';",
  'tests/client/lazy.test.ts':"const s=await import('../../src/client/hud/minimap.ts');",
  'tests/sim/run.test.ts':"import {run} from '../../src/sim/run.ts';",
  'tests/sim/asset.test.ts':"const t=readFileSync(fromRoot('public/maps/city.json'),'utf8');",
  'tests/client/lint.test.ts':"for(const f of readdirSync('src/client/hud'))check(f);",
  'tests/protocol/wire.test.ts':"import '../../src/protocol/x.ts';",
  'tests/rooms/room-determinism.test.ts':"",
  'tests/arquitetura.test.ts':"",
  'public/maps/city.json':"{}",
  'src/protocol/x.ts':"",
};
const run=(changed:string[])=>affectedTests({...repo(TREE),changed});

test('references: static, dynamic, side-effect and new URL imports, and repo paths in strings',()=>{
  const refs=references("import a from './a.ts';export {b} from \"../b.ts\";import './c.ts';const d=await import('./d.ts');"
    +"new URL('../../public/x.json',import.meta.url);fromRoot('public/maps/y.json');readdirSync('src/client/hud/');const t=`src/${k}`;");
  assert.deepEqual(refs.imports.sort(),['../../public/x.json','../b.ts','./a.ts','./c.ts','./d.ts'].sort(),'modules (and new URL) are imports');
  assert.deepEqual(refs.paths.sort(),['/public/maps/y.json','/src','/src/client/hud'].sort(),'data and folders are paths; `src/${k}` gives its folder');
  // The review's misses: a helper's '../../multiplayer/…', join() of literal segments, a root file, a template folder.
  const more=references("read('../../multiplayer/wrangler.jsonc');join(repo,'scripts','import-roster.mjs');readFileSync('index.html');"
    +"load(`public/art/lite/sprites/${id}.webp`);fromRoot(`../../${path}`);fetch('https://x.y/z');'node:fs';'no slash'").paths;
  for(const r of ['../../multiplayer/wrangler.jsonc','/scripts/import-roster.mjs','/index.html','/public/art/lite/sprites'])assert.ok(more.includes(r),r);
  assert.ok(!more.some((r:string)=>r==='/'||r==='..'||r==='../..'||r.includes('https')||r.includes('node:')),`no repo-wide folder, URL or node: ${more}`);
  assert.deepEqual(references("// test-changed: imports-only\nimport x from './x.ts';const f='src/protocol/x.ts';").paths,[],'opted out of the string scan');
  assert.equal(resolveRef('tests/a/x.test.ts','node:fs',()=>true),undefined);
  assert.equal(resolveRef('tests/a/x.test.ts','phaser',()=>true),undefined);
  assert.equal(resolveRef('src/a/b.ts','../c',(p:string)=>p==='src/c.ts'),'src/c.ts');
  assert.equal(resolveRef('tests/x.test.ts','/src/client/lobby.ts',()=>true),'src/client/lobby.ts','a page-side /src import is a repo path');
});

test('a leaf change reaches its importers through every chain (barrel re-exports, dynamic imports), a folder scan and the architecture test',()=>{
  const r=run(['src/client/hud/minimap.ts']);
  assert.equal(r.all,false);
  assert.deepEqual(r.tests,['tests/arquitetura.test.ts','tests/client/lazy.test.ts','tests/client/lint.test.ts','tests/client/scene.test.ts']);
  assert.equal(r.reasons['tests/client/scene.test.ts'],'src/client/hud/minimap.ts');
});

test('an asset change reaches the tests that name its path; a test file change runs itself',()=>{
  assert.deepEqual(run(['public/maps/city.json']).tests,['tests/sim/asset.test.ts']);
  assert.deepEqual(run(['tests/sim/run.test.ts']).tests,['tests/sim/run.test.ts']);
  assert.deepEqual(run(['docs/notes.md']).tests,[],'nothing imports it');
});

test('contract, protocol or rules: also the protocol and determinism suites',()=>{
  const r=run(['src/contract/index.ts']);
  assert.ok(r.tests.includes('tests/sim/run.test.ts'),'the importer');
  assert.ok(r.tests.includes('tests/protocol/wire.test.ts')&&r.tests.includes('tests/rooms/room-determinism.test.ts'),'the wire suites');
  assert.ok(!r.tests.includes('tests/client/scene.test.ts'),'not the unrelated client test');
});

test('package.json, the lockfile, a tsconfig or the script itself: the whole suite',()=>{
  for(const f of ['package.json','package-lock.json','tsconfig.pure.json','scripts/test-changed.mjs']){
    const r=run([f]);assert.equal(r.all,true,f);assert.equal(r.tests.length,repo(TREE).tests.length);
  }
});

test('a reader of a file or a folder runs only when that file (or one in the folder) really changed, not when an import of it did',()=>{
  // tools/x.mjs scans tests/ (its text); a src change that reaches tests/client/scene.test.ts must not bring tools/x.mjs.
  const tree={...TREE,'tools/x.mjs':"const t=readdirSync('tests/client');",'tests/tools/x.test.ts':"import '../../tools/x.mjs';"};
  const reach=(changed:string[])=>affectedTests({...repo(tree),changed}).tests;
  assert.ok(!reach(['src/client/hud/minimap.ts']).includes('tests/tools/x.test.ts'),'not through the scene test it scans');
  assert.ok(reach(['tests/client/scene.test.ts']).includes('tests/tools/x.test.ts'),'a file in the scanned folder changed');
});
