// D-049 item 2 (NEW-20261014-ORQ-fila-integracao-e-testes-afetados): run only the tests a change can reach.
//   npm run test:changed [base] [--list] [--json] [--files a,b,…]
// base: the git ref the branch is compared with (default origin/main); the changed files are the commits since the
// merge-base, the working tree and the untracked files (or exactly --files, comma-separated repo paths). A test is affected when it imports a changed file directly or
// through any chain of imports (static, `import('…')`, `new URL('…', import.meta.url)`), or names its path (or a folder
// it lies in) in a string literal: assets like public/maps/cidade-nevada.json and tests that scan a folder.
// Always added: a change in src/contract, src/protocol or src/rules brings the protocol and determinism suites; any
// change under src/ brings the architecture test. A change to package.json, the lockfile, a tsconfig or this script
// runs the whole suite. The full suite still runs at integration (tools/fila.mjs); this is for working on a branch.
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,join,posix,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const CODE=/\.(ts|mts|mjs|js|cjs)$/;
/** Changes that may affect anything: the whole suite. */
export const GLOBAL=[/^package(-lock)?\.json$/,/^tsconfig[^/]*\.json$/,/^scripts\/test-changed\.mjs$/];
/** Sectors whose change also runs the protocol and determinism suites. */
export const WIRE=/^src\/(contract|protocol|rules)\//;
/** The protocol and determinism suites (paths). */
export const isWireTest=(f)=>/^tests\/protocol\//.test(f)||/determin|checkpoint/i.test(posix.basename(f));
export const ARCH_TEST='tests/arquitetura.test.ts';

const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',maxBuffer:64<<20}).split('\n').map(s=>s.trim()).filter(Boolean);

/** Import specifiers and repo-path string literals of a source text. */
export function references(text){
  const out=new Set();
  for(const re of [/\bfrom\s*['"]([^'"\n]+)['"]/g,/\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,/\bimport\s+['"]([^'"\n]+)['"]/g,
    /new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g])for(const m of text.matchAll(re))out.add(m[1]);
  // Repo paths in any string literal (fromRoot('public/…'), readFileSync('src/…'), readdirSync of a folder): no ${}.
  for(const m of text.matchAll(/['"`]\.{0,2}\/?((?:public|src|scripts|multiplayer|tests|backend|tools)\/[^'"`$\s]*)['"`]/g))out.add('/'+m[1].replace(/\/$/,''));
  return [...out];
}

/** A specifier of `from` as a repo-relative path (posix), or undefined for packages and node: modules. */
export function resolveRef(from,spec,exists){
  if(spec.startsWith('node:')||!/^[./]/.test(spec))return undefined;
  const base=spec.startsWith('/')?spec.slice(1):posix.normalize(posix.join(posix.dirname(from),spec));
  if(base.startsWith('..'))return undefined;
  if(exists(base))return base;
  for(const ext of ['.ts','.mjs','.js','/index.ts'])if(exists(base+ext))return base+ext;
  return base;
}

/**
 * The affected test files. files: repo-relative paths of every tracked code/test file; read(path) its text;
 * changed: repo-relative changed paths; tests: the test files. Returns {all, tests, reasons}.
 */
export function affectedTests({files,read,exists,isDir,changed,tests}){
  if(changed.some(f=>GLOBAL.some(re=>re.test(f))))return {all:true,tests:[...tests],reasons:{'*':changed.filter(f=>GLOBAL.some(re=>re.test(f)))}};
  // Reverse edges: target → the files that reference it; folders referenced as a prefix.
  const users=new Map(),folders=[];
  for(const f of files){
    for(const spec of references(read(f))){
      const to=resolveRef(f,spec,exists);
      if(!to)continue;
      if(isDir(to))folders.push({dir:to+'/',user:f});
      else{let s=users.get(to);if(!s)users.set(to,s=new Set());s.add(f);}
    }
  }
  const testSet=new Set(tests),hit=new Map(),seen=new Set(),queue=[];
  const visit=(f,why)=>{if(seen.has(f))return;seen.add(f);queue.push([f,why]);};
  for(const c of changed){
    visit(c,c);
    for(const {dir,user} of folders)if(c.startsWith(dir))visit(user,c);
  }
  while(queue.length){
    const [f,why]=queue.shift();
    if(testSet.has(f)&&!hit.has(f))hit.set(f,why);
    for(const u of users.get(f)??[])visit(u,why);
    for(const {dir,user} of folders)if(f.startsWith(dir))visit(user,why);
  }
  if(changed.some(f=>WIRE.test(f)))for(const t of tests)if(isWireTest(t)&&!hit.has(t))hit.set(t,'protocol/determinism (contract, protocol or rules changed)');
  if(changed.some(f=>f.startsWith('src/'))&&testSet.has(ARCH_TEST)&&!hit.has(ARCH_TEST))hit.set(ARCH_TEST,'architecture (src changed)');
  const list=[...hit.keys()].sort();
  return {all:false,tests:list,reasons:Object.fromEntries(list.map(t=>[t,hit.get(t)]))};
}

/** Changed files of the checkout against `base`: commits since the merge-base, the working tree, untracked files. */
export function changedFiles(base){
  const mb=git('merge-base',base,'HEAD')[0];
  return [...new Set([...git('diff','--name-only',mb),...git('ls-files','--others','--exclude-standard')])].map(f=>f.replace(/\\/g,'/'));
}

function main(argv){
  const fi=argv.indexOf('--files'),given=fi<0?undefined:(argv[fi+1]??'').split(',').map(s=>s.trim().replace(/\\/g,'/')).filter(Boolean);
  if(fi>=0)argv=argv.filter((_,i)=>i!==fi&&i!==fi+1);
  const flags=new Set(argv.filter(a=>a.startsWith('--'))),base=argv.find(a=>!a.startsWith('--'))??'origin/main';
  const files=git('ls-files','src','tests','multiplayer','scripts','backend','tools').filter(f=>CODE.test(f));
  const tests=files.filter(f=>/^tests\/.*\.test\.ts$/.test(f));
  const abs=(f)=>join(ROOT,f);
  const changed=given??changedFiles(base);
  const r=affectedTests({files,tests,changed,read:f=>readFileSync(abs(f),'utf8'),exists:f=>existsSync(abs(f)),
    isDir:f=>existsSync(abs(f))&&statSync(abs(f)).isDirectory()});
  if(flags.has('--json')){console.log(JSON.stringify({base,changed,all:r.all,tests:r.tests,total:tests.length,reasons:r.reasons}));if(flags.has('--list'))return 0;}
  else console.error(`test:changed vs ${base}: ${changed.length} changed file(s) → ${r.all?'the whole suite':`${r.tests.length} of ${tests.length} test files`}`);
  if(flags.has('--list')){if(!flags.has('--json'))for(const t of r.tests)console.log(`${t}  (${r.reasons[t]??r.reasons['*']})`);return 0;}
  const run=r.all?['tests/**/*.test.ts']:r.tests;
  if(!run.length){console.error('no affected test');return 0;}
  const res=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-concurrency=4',...run],{cwd:ROOT,stdio:'inherit'});
  return res.status??1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main(process.argv.slice(2));
