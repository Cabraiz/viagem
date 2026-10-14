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

/**
 * Import specifiers and path-like string literals of a source text: `./`/`../` strings stay relative to the file; other
 * literals with a `/` (or a root file name like index.html) come back as repo-root paths ('/…'); a template literal
 * gives its static prefix up to the first `${` as a folder; `join(…)` of literal segments counts as one path. Paths that
 * do not exist are dropped later (affectedTests checks them), so the net is wide on purpose: a missed test is the
 * expensive mistake. Returns {imports, paths}: imports (static, dynamic, side-effect, `new URL(…, import.meta.url)`)
 * carry a change on through whatever imports the file; paths are files read as data or text (and folders scanned):
 * only a change to the file itself (or inside the folder) reaches the reader.
 */
export function references(text){
  const out=new Set(),imports=new Set();
  const add=(s)=>{
    s=s.trim();
    if(!s||/[\s*?<>|]/.test(s)||s.startsWith('node:')||/^[a-z]+:\/\//i.test(s))return;
    if(s.startsWith('./')||s.startsWith('../'))out.add(s.replace(/\/$/,''));
    else if(s.startsWith('/'))out.add(s.replace(/\/$/,''));
    else if(s.includes('/')||/^[\w.-]+\.[a-z]{1,6}$/i.test(s))out.add('/'+s.replace(/\/$/,''));
  };
  for(const re of [/\bfrom\s*['"]([^'"\n]+)['"]/g,/\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,/\bimport\s+['"]([^'"\n]+)['"]/g,
    /new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g])for(const m of text.matchAll(re))imports.add(m[1]);
  const result=()=>({imports:[...imports],paths:[...out].filter(p=>!imports.has(p))});
  // A file whose literals are fixtures, not dependencies (the tools' own tests), opts out of the string scan.
  if(/^\/\/ test-changed: imports-only\b/m.test(text))return result();
  // Every quoted literal (no ${}).
  for(const m of text.matchAll(/'([^'\n]{1,200})'|"([^"\n]{1,200})"|`([^`$\n]{1,200})`/g))add(m[1]??m[2]??m[3]);
  // Template literals with ${}: their static prefix as a folder (`public/art/lite/sprites/${id}.webp` → that folder).
  for(const m of text.matchAll(/`([^`$\n]{1,200})\$\{/g)){const p=m[1].slice(0,m[1].lastIndexOf('/')+1);if(/[^./]/.test(p))add(p);}
  // join(repo,'scripts','x.mjs') and the like: the literal segments as one path.
  for(const m of text.matchAll(/\bjoin\(([^()\n]{1,300})\)/g)){
    const parts=[...m[1].matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)].map(x=>x[1]??x[2]);
    if(parts.length>1)add(parts.join('/'));
  }
  return result();
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
  // Reverse edges. importers: module → the files that import it (followed transitively). readers: file → the files that
  // read it as data/text, and folders → the files that scan them (only for the files that really changed).
  const importers=new Map(),readers=new Map(),folders=[];
  const edge=(m,to,f)=>{let s=m.get(to);if(!s)m.set(to,s=new Set());s.add(f);};
  for(const f of files){
    const {imports,paths}=references(read(f));
    for(const spec of imports){const to=resolveRef(f,spec,exists);if(!to)continue;if(isDir(to))folders.push({dir:to==='.'?'':to+'/',user:f});else edge(importers,to,f);}
    for(const spec of paths){const to=resolveRef(f,spec,exists);if(!to)continue;if(isDir(to))folders.push({dir:to==='.'?'':to+'/',user:f});else edge(readers,to,f);}
  }
  const testSet=new Set(tests),hit=new Map(),seen=new Set(),queue=[];
  const visit=(f,why)=>{if(seen.has(f))return;seen.add(f);queue.push([f,why]);};
  for(const c of changed){
    visit(c,c);
    for(const r of readers.get(c)??[])visit(r,c);
    for(const {dir,user} of folders)if(c.startsWith(dir))visit(user,c);
  }
  while(queue.length){
    const [f,why]=queue.shift();
    if(testSet.has(f)&&!hit.has(f))hit.set(f,why);
    for(const u of importers.get(f)??[])visit(u,why);
  }
  if(changed.some(f=>WIRE.test(f)))for(const t of tests)if(isWireTest(t)&&!hit.has(t))hit.set(t,'protocol/determinism (contract, protocol or rules changed)');
  if(changed.some(f=>f.startsWith('src/'))&&testSet.has(ARCH_TEST)&&!hit.has(ARCH_TEST))hit.set(ARCH_TEST,'architecture (src changed)');
  const list=[...hit.keys()].sort();
  return {all:false,tests:list,reasons:Object.fromEntries(list.map(t=>[t,hit.get(t)]))};
}

/** Changed files of the checkout against `base`: commits since the merge-base, the working tree, untracked files. */
export function changedFiles(base){
  const mb=git('merge-base',base,'HEAD')[0];
  // --no-renames: a moved file counts at its old path too (its old importers must run).
  return [...new Set([...git('diff','--name-only','--no-renames',mb),...git('ls-files','--others','--exclude-standard')])].map(f=>f.replace(/\\/g,'/'));
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
