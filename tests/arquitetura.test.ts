/**
 * ARQ-setores: the import arrows between sectors (design/arquitetura-setores.md, OWNERS.md).
 * Scans src/, multiplayer/ and backend/ (comments stripped first) and fails on
 *  1. an arrow the table does not allow (e.g. sim → client, contract → anything);
 *  2. an import between sectors that does not go through the target's port (`<sector>/index.ts`);
 *     a folder import (`'../sim'`) counts as importing that folder's index.ts;
 *  3. a file under src/ that belongs to no sector, or an import that lands on one (it would be a bridge);
 *  4. a package a sector may not use (`phaser` only in the client), DOM globals in a pure sector,
 *     and imports that cannot be checked (`import(variable)`).
 * Imports are read from static/dynamic import, export … from, require, `new URL('…', import.meta.url)`,
 * `import.meta.glob(…)` and the static prefix of `import(\`…${x}\`)`.
 * scripts/ and tests/ may import anything, internals included. No exception list: fix the code, not this file.
 * The last test plants each kind of violation in memory and checks it is caught (and that look-alikes are not).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const norm=(p:string)=>p.split(sep).join('/');

type Sector='contract'|'rules'|'maps'|'sim'|'protocol'|'client'|'multiplayer'|'backend'|'scripts'|'tests';
/** Sector → folder of its port (index.ts). multiplayer and backend are leaves: nobody in the build imports them. */
export const PORTS:Partial<Record<Sector,string>>={
  contract:'src/contract',rules:'src/rules',maps:'src/maps',sim:'src/sim',protocol:'src/protocol',client:'src/client',
};
/** Who may import whom (besides itself). */
export const ALLOWED:Record<Sector,readonly Sector[]|'any'>={
  contract:[],
  rules:['contract'],
  maps:['contract'],
  sim:['contract','rules','maps'],
  protocol:['contract'],
  client:['contract','rules','maps','protocol'],
  multiplayer:['contract','rules','maps','sim','protocol'],
  backend:['contract'],
  scripts:'any',
  tests:'any',
};
/** Packages (non-relative specifiers) each sector may import. Pure sectors import none. */
export const PACKAGES:Record<Sector,(spec:string)=>boolean>={
  contract:()=>false,rules:()=>false,maps:()=>false,sim:()=>false,protocol:()=>false,
  client:spec=>spec==='phaser'||spec.startsWith('phaser/'),
  multiplayer:spec=>spec.startsWith('cloudflare:'),
  backend:spec=>spec.startsWith('@libsql/')||spec.startsWith('node:'),
  scripts:()=>true,tests:()=>true,
};
/** Sectors that run on the server too, so they must not touch the browser. */
const PURE:ReadonlySet<Sector>=new Set(['contract','rules','maps','sim','protocol']);
/**
 * Browser globals used as globals: member access (`.` or `?.`) on window/document/navigator/location/self,
 * the same through globalThis, and storage/animation/element names. Not preceded by `.`, a word char or `$`,
 * so a local `const window=…` or `s.window.length` is not flagged.
 */
const DOM=/(?<![.\w$])(?:window|document|navigator|location|self)\s*\??\.|(?<![.\w$])globalThis\s*\??\.\s*(?:window|document|navigator|location|localStorage|sessionStorage)\b|(?<![.\w$])(?:localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTML[A-Za-z]*Element)\b/g;
const SOURCE=/\.(ts|mts|cts|tsx|jsx|mjs|cjs|js|astro)$/;

export function sectorOf(file:string):Sector|undefined{
  for(const [sector,dir] of Object.entries(PORTS))if(file===dir||file.startsWith(dir+'/'))return sector as Sector;
  // The Vite entry, the ambient declarations and the Astro pages are the client's.
  if(file==='src/main.ts'||file==='src/env.d.ts'||file.startsWith('src/pages/'))return 'client';
  const top=file.split('/')[0];
  if(top==='multiplayer'||top==='backend'||top==='scripts'||top==='tests')return top;
  return undefined;
}

/**
 * Blanks comments (and, with `strings`, string/template text) keeping offsets and newlines, so a quote inside a
 * comment cannot derail the import regex and prose cannot look like code. Regex literals are copied as they are,
 * and the `${…}` expressions of a template stay code (blanked recursively).
 * Known limit (adversarial only): a regex literal right after `)` or an identifier (`await /a\//`) is not detected.
 */
export function blank(src:string,strings=false):string{
  let out='',i=0;
  const keep=(s:string)=>s.replace(/[^\n]/g,' ');
  while(i<src.length){
    const c=src[i],n=src[i+1];
    if(c==='/'&&n==='/'){const end=src.indexOf('\n',i);const j=end<0?src.length:end;out+=keep(src.slice(i,j));i=j;continue;}
    if(c==='/'&&n==='*'){const end=src.indexOf('*/',i+2);const j=end<0?src.length:end+2;out+=keep(src.slice(i,j));i=j;continue;}
    // A regex literal (a `/` where an expression starts) may hold quotes, e.g. /[&<>"']/g: copy it as is.
    if(c==='/'&&/[(,=:[!&|?{};+\-*%~^<>]\s*$|^\s*$|\breturn\s*$/.test(out.slice(out.lastIndexOf('\n')+1))){
      let j=i+1,klass=false;
      while(j<src.length&&src[j]!=='\n'&&(klass||src[j]!=='/')){if(src[j]==='\\')j++;else if(src[j]==='[')klass=true;else if(src[j]===']')klass=false;j++;}
      if(src[j]==='/'){out+=strings?'/'+keep(src.slice(i+1,j))+'/':src.slice(i,j+1);i=j+1;continue;}
    }
    if(c==='`'){
      let j=i+1,piece='`';
      while(j<src.length&&src[j]!=='`'){
        if(src[j]==='\\'){const esc=src.slice(j,j+2);piece+=strings?keep(esc):esc;j+=2;continue;}
        if(src[j]==='$'&&src[j+1]==='{'){
          let depth=1,k=j+2;
          while(k<src.length&&depth){if(src[k]==='{')depth++;else if(src[k]==='}')depth--;k++;}
          const closed=depth===0;
          piece+='${'+blank(src.slice(j+2,closed?k-1:k),strings)+(closed?'}':'');j=k;continue;
        }
        piece+=strings&&src[j]!=='\n'?' ':src[j];j++;
      }
      out+=piece+(j<src.length?'`':'');i=j+1;continue;
    }
    if(c==='\''||c==='"'){
      let j=i+1;while(j<src.length&&src[j]!==c&&src[j]!=='\n'){if(src[j]==='\\')j++;j++;}
      const body=src.slice(i+1,Math.min(j,src.length));
      out+=c+(strings?keep(body):body)+(j<src.length&&src[j]===c?c:'');i=j+(src[j]===c?1:0);continue;
    }
    out+=c;i++;
  }
  return out;
}

const SKIP=new Set(['node_modules','.vite','dist','.wrangler']);
const walk=(d:string):string[]=>existsSync(d)?readdirSync(d).flatMap(f=>{
  const p=join(d,f);if(SKIP.has(f))return [];
  return statSync(p).isDirectory()?walk(p):[p];
}):[];

/**
 * Static imports and re-exports (whitespace optional: `import{a}from'x'`, `export*from'x'`), side-effect imports,
 * literal dynamic imports (also with a trailing comma or an options object) and require (also with a space or a template).
 */
const IMPORT=/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*(['"`])([^'"`$]+)\2\s*[,)]|\bimport\s*['"]([^'"]+)['"]|\brequire\s*\(\s*(['"`])([^'"`$]+)\5\s*\)/g;
const NEW_URL=/new\s+URL\(\s*(['"`])([^'"`$]+)\1\s*,\s*import\.meta\.url/g;
/** import.meta.glob / globEager, typed or not, with one pattern or an array of patterns. */
const GLOB=/import\.meta\.glob(?:Eager)?\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|(['"`])[^'"`]*\2)/g;
const TEMPLATE_IMPORT=/\bimport\s*\(\s*`([^`$]*)\$\{/g;
/** import(x), require(x) and new URL(x, import.meta.url) with a non-literal first argument. */
const OPAQUE=/\b(?:import|require)\s*\(\s*(?![\s'"`)])|new\s+URL\(\s*(?![\s'"`])[^,()]*,\s*import\.meta\.url/g;

export interface Arrow {from:string;to:string;fromSector:Sector;toSector:Sector;line:number}
export interface Finding {kind:'sem-setor'|'destino-sem-setor'|'pacote'|'dom'|'opaco';file:string;line:number;detail:string}

const lineAt=(src:string,index:number)=>src.slice(0,index).split('\n').length;
/**
 * Resolves a relative or Vite-root (`/src/…`) specifier to a repo path: a folder means its index.ts,
 * a missing extension or `.js` falls back to the `.ts` file (as tsc and Vite resolve them).
 */
function target(from:string,spec:string,folder=false):string{
  const clean=spec.replace(/\?.*$/,'');
  const abs=clean.startsWith('/')?join(root,clean):resolve(root,dirname(from),clean);
  if(folder)return norm(relative(root,abs)).replace(/\/$/,'');
  if(existsSync(abs)&&statSync(abs).isDirectory())return norm(relative(root,join(abs,'index.ts')));
  if(!existsSync(abs)){
    for(const alt of [abs+'.ts',abs.replace(/\.js$/,'.ts'),abs.replace(/\.jsx$/,'.tsx'),abs.replace(/\.mjs$/,'.mts')])
      if(alt!==abs&&existsSync(alt))return norm(relative(root,alt));
  }
  return norm(relative(root,abs));
}
/** `…/node_modules/@scope/pkg/x` → `@scope/pkg/x`, so a relative path cannot dodge the package rule. */
const packageOf=(to:string)=>{const at=to.lastIndexOf('node_modules/');return at<0?undefined:to.slice(at+'node_modules/'.length);};

/** Arrows and findings of one file (path relative to the repo, `/` separators). */
export function analyze(file:string,source:string):{arrows:Arrow[];findings:Finding[]}{
  const arrows:Arrow[]=[],findings:Finding[]=[];
  const fromSector=sectorOf(file);
  if(!fromSector){findings.push({kind:'sem-setor',file,line:1,detail:'arquivo fora de qualquer setor (OWNERS.md)'});return {arrows,findings};}
  const code=blank(source);
  const specs:{spec:string;index:number;folder?:boolean}[]=[];
  for(const m of code.matchAll(IMPORT))specs.push({spec:(m[1]??m[3]??m[4]??m[6])!,index:m.index!});
  for(const m of code.matchAll(NEW_URL))specs.push({spec:m[2],index:m.index!});
  for(const m of code.matchAll(GLOB))for(const p of m[1].matchAll(/(['"`])([^'"`]+)\1/g)){
    const pattern=p[2].replace(/^!/,'');
    specs.push({spec:pattern.split('*')[0]||'./',index:m.index!,folder:pattern.includes('*')});
  }
  for(const m of code.matchAll(TEMPLATE_IMPORT))specs.push({spec:m[1]||'./',index:m.index!,folder:true});
  if(ALLOWED[fromSector]!=='any')for(const m of code.matchAll(OPAQUE))
    findings.push({kind:'opaco',file,line:lineAt(code,m.index!),detail:'import()/require()/new URL() com especificador não literal não pode ser verificado'});
  for(const {spec,index,folder} of specs){
    const line=lineAt(code,index);
    const relativeSpec=spec.startsWith('.')||spec.startsWith('/');
    const to=relativeSpec?target(file,spec,folder):'';
    const pkg=relativeSpec?packageOf(to):spec;
    if(pkg!==undefined){
      if(!PACKAGES[fromSector](pkg))findings.push({kind:'pacote',file,line,detail:`${fromSector} não pode importar o pacote '${pkg}'`});
      continue;
    }
    const toSector=sectorOf(to);
    if(!toSector){
      // A folder (glob/template) or a source file outside every sector is a way around the table: a bridge.
      if(folder||SOURCE.test(to)||to===''||to==='src'||to.startsWith('src/'))
        findings.push({kind:'destino-sem-setor',file,line,detail:`importa ${to||'.'}, que não pertence a nenhum setor`});
      continue;
    }
    if(toSector!==fromSector)arrows.push({from:file,to,fromSector,toSector,line});
  }
  if(PURE.has(fromSector)){
    const prose=blank(source,true);
    for(const m of prose.matchAll(DOM))findings.push({kind:'dom',file,line:lineAt(prose,m.index!),detail:`${fromSector} usa o global de navegador '${m[0].replace(/\s*\??\.$/,'')}'`});
  }
  return {arrows,findings};
}

/** Arrow messages that break the table or skip the port. */
export function arrowProblems(list:readonly Arrow[]):string[]{
  const out:string[]=[];
  for(const a of list){
    const ok=ALLOWED[a.fromSector];
    if(ok==='any')continue;
    if(!ok.includes(a.toSector))out.push(`${a.fromSector} → ${a.toSector}: ${a.from}:${a.line} importa ${a.to}`);
    else if(PORTS[a.toSector]&&a.to!==`${PORTS[a.toSector]}/index.ts`)out.push(`${a.from}:${a.line} importa ${a.to} (use ${PORTS[a.toSector]}/index.ts)`);
  }
  return out;
}

const files=['src','multiplayer','backend'].flatMap(d=>walk(join(root,d))).map(p=>norm(relative(root,p))).filter(f=>SOURCE.test(f));
const results=files.map(f=>analyze(f,readFileSync(join(root,f),'utf8')));
const all=results.flatMap(r=>r.arrows);
const findings=results.flatMap(r=>r.findings);
const show=(list:readonly Finding[])=>list.map(f=>`${f.file}:${f.line} ${f.detail}`).join('\n');

test('arquitetura: the scan sees the sectors (guards against a silent empty scan)',()=>{
  assert.ok(all.length>50,`only ${all.length} arrows between sectors`);
  for(const sector of ['client','sim','multiplayer'] as const)assert.ok(all.some(a=>a.fromSector===sector),`no arrow from ${sector}`);
  for(const dir of Object.values(PORTS))assert.ok(existsSync(join(root,dir,'index.ts')),`${dir}/index.ts (the port) is missing`);
  assert.ok(files.some(f=>f.endsWith('.astro')),'the Astro pages are scanned');
});

test('arquitetura: only the arrows of the table (OWNERS.md)',()=>{
  const bad=all.filter(a=>{const ok=ALLOWED[a.fromSector];return ok!=='any'&&!ok.includes(a.toSector);})
    .map(a=>`${a.fromSector} → ${a.toSector}: ${a.from}:${a.line} importa ${a.to}`);
  assert.deepEqual(bad,[],`setas proibidas:\n${bad.join('\n')}`);
});

test('arquitetura: between sectors, imports go through the port (index.ts)',()=>{
  const bad=all.filter(a=>ALLOWED[a.fromSector]!=='any'&&PORTS[a.toSector]&&a.to!==`${PORTS[a.toSector]}/index.ts`)
    .map(a=>`${a.from}:${a.line} importa ${a.to} (use ${PORTS[a.toSector]}/index.ts)`);
  assert.deepEqual(bad,[],`imports fora da porta:\n${bad.join('\n')}`);
});

test('arquitetura: every file under src/ belongs to a sector, and nothing imports a file that does not',()=>{
  const bad=findings.filter(f=>f.kind==='sem-setor'||f.kind==='destino-sem-setor');
  assert.equal(bad.length,0,`arquivos sem setor:\n${show(bad)}`);
});

test('arquitetura: packages per sector, no browser globals in pure sectors, no unverifiable import()',()=>{
  const bad=findings.filter(f=>f.kind==='pacote'||f.kind==='dom'||f.kind==='opaco');
  assert.equal(bad.length,0,`violações:\n${show(bad)}`);
});

test('arquitetura: planted violations are caught and look-alikes are not',()=>{
  const problems=(file:string,source:string)=>{const r=analyze(file,source);return [...arrowProblems(r.arrows),...r.findings.map(f=>`${f.kind}: ${f.detail}`)];};
  const caught:[string,string,string][]=[
    // [name, file, source]
    ['rules → client','src/rules/__p.ts',"import {mountWaitingRoom} from '../client/index.ts';"],
    ['sim → protocol','src/sim/__p.ts',"import {sha256Hex} from '../protocol/index.ts';"],
    ['port bypass','src/client/__p.ts',"import {STAT_KEYS} from '../rules/stats.ts';"],
    ['dynamic import maps → sim','src/maps/__p.ts',"const s=await import('../sim/index.ts');"],
    ['re-export contract → rules','src/contract/__p.ts',"export {STAT_KEYS} from '../rules/index.ts';"],
    ['import type client → sim','src/client/__p.ts',"import type {SimContext} from '../sim/index.ts';"],
    ['client → multiplayer','src/client/__p.ts',"import {Simulation} from '../../multiplayer/simulation.ts';"],
    ['A1 folder import','src/client/__p.ts',"import type {SimContext} from '../sim';"],
    ['A1 folder import with slash','src/client/__p.ts',"import type {SimContext} from '../sim/';"],
    ['A1 Vite root path','src/client/__p.ts',"import {x} from '/src/sim/index.ts';"],
    ['A2 file outside sectors','src/util.ts',"export const x=1;"],
    ['A2 bridge through a sectorless file','src/client/__p.ts',"import {x} from '../util.ts';"],
    ['A3 phaser outside client','src/rules/__p.ts',"import Phaser from 'phaser';"],
    ['A3 unknown package in client','src/client/__p.ts',"import _ from 'lodash';"],
    ['A3 window in maps','src/maps/__p.ts',"window.addEventListener('resize',()=>{});"],
    ['A3 document in sim','src/sim/__p.ts',"export const t=()=>document.title;"],
    ['A3 localStorage in protocol','src/protocol/__p.ts',"export const k=localStorage.getItem('x');"],
    ['A3 new URL into another sector','src/contract/__p.ts',"export const u=new URL('../client/index.ts',import.meta.url);"],
    ['A3 import.meta.glob into sim','src/client/__p.ts',"const m=import.meta.glob('../sim/*.ts');"],
    ['A3 template import into sim','src/client/__p.ts',"const m=await import(`../sim/${name}.ts`);"],
    ['A3 opaque import()','src/maps/__p.ts',"const m=await import(name);"],
    ['A3 astro page → sim','src/pages/__p.astro',"---\nimport {x} from '../sim/index.ts';\n---\n<p>oi</p>"],
    ['comment with a quote inside the braces','src/client/__p.ts',"import {a /* it's */} from '../sim/index.ts';"],
    ['regex with quotes before a DOM global','src/rules/__p.ts',"const q=/[\"']/g;export const t=()=>document.title;"],
    // Bypasses found by the independent review (done/NEW-20261012-ORQ-arq-endurecer-teste.md).
    ['import() with a trailing comma','src/client/__p.ts',"const m=await import(\n  '../sim/index.ts',\n);"],
    ['import() with options','src/client/__p.ts',"const m=await import('../sim/index.ts',{with:{type:'js'}});"],
    ['import without whitespace','src/client/__p.ts',"import{SimContext}from'../sim/index.ts';"],
    ['export* without whitespace','src/client/__p.ts',"export*from'../sim/index.ts';"],
    ['side-effect import without whitespace','src/client/__p.ts',"import'../sim/index.ts';"],
    ['glob over every sector','src/client/__p.ts',"const m=import.meta.glob('../*/index.ts');"],
    ['glob from the Vite root','src/client/__p.ts',"const m=import.meta.glob('/src/**/*.ts');"],
    ['template import over every sector','src/client/__p.ts',"const m=await import(`../${n}/x.ts`);"],
    ['bridge outside src/','src/client/__p.ts',"import {x} from '../../lib/bridge.ts';"],
    ['jsx file in a pure sector','src/rules/__p.jsx',"import Phaser from 'phaser';"],
    ['template import without ${}','src/client/__p.ts',"const m=await import(`../sim/index.ts`);"],
    ['typed glob','src/client/__p.ts',"const m=import.meta.glob<{x:1}>('../sim/*.ts');"],
    ['second pattern of a glob array','src/client/__p.ts',"const m=import.meta.glob(['../rules/*.ts','../sim/*.ts']);"],
    ['require with a space','src/rules/__p.cjs',"const c=require ('../client/index.ts');"],
    ['require with a template','src/rules/__p.cjs',"const c=require(`../client/index.ts`);"],
    ['package through a relative node_modules path','src/rules/__p.ts',"import Phaser from '../../node_modules/phaser/src/phaser.js';"],
    ['window?. in maps','src/maps/__p.ts',"export const w=()=>window?.innerWidth;"],
    ['self. in sim','src/sim/__p.ts',"export const h=()=>self.location.href;"],
    ['globalThis.document in protocol','src/protocol/__p.ts',"export const d=globalThis.document;"],
    ['DOM inside a template expression','src/rules/__p.ts',"export const t=()=>`title: ${document.title}`;"],
    ['opaque require','src/rules/__p.cjs',"const c=require(name);"],
    ['opaque new URL','src/contract/__p.ts',"export const u=new URL(path,import.meta.url);"],
  ];
  for(const [name,file,source] of caught)assert.ok(problems(file,source).length>0,`plantada e NÃO pega: ${name}`);
  const clean:[string,string,string][]=[
    ['local variable named window','src/rules/__p.ts',"const window=3;export const w=window/2;"],
    ['browser word in a string','src/rules/__p.ts',"export const t='document.title e window.open';"],
    ['import in a comment','src/client/__p.ts',"// import {x} from '../sim/index.ts'\n/* import('../sim') */ export const y=1;"],
    ['port import','src/client/__p.ts',"import {STAT_KEYS} from '../rules/index.ts';"],
    ['folder import of an allowed port','src/client/__p.ts',"import {STAT_KEYS} from '../rules';"],
    ['phaser in the client','src/client/__p.ts',"import Phaser from 'phaser';"],
    ['a property named window','src/protocol/__p.ts',"export const n=(s:{window:number[]})=>s.window.length;"],
    ['.js specifier for a port','src/client/__p.ts',"import {STAT_KEYS} from '../rules/index.js';"],
    ['template text without code','src/rules/__p.ts',"export const t=`abra a window.open e o document`;"],
    ['import() of an allowed port with options','src/client/__p.ts',"const m=await import('../rules/index.ts',{with:{type:'js'}});"],
  ];
  for(const [name,file,source] of clean)assert.deepEqual(problems(file,source),[],`falso positivo: ${name}`);
});
