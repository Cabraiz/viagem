/**
 * ARQ-setores: the import arrows between sectors (design/arquitetura-setores.md, OWNERS.md).
 * Reads every relative import with the same regex as the board's graph script and fails on
 *  1. an arrow the table does not allow (e.g. sim → client, contract → anything);
 *  2. an import between sectors that does not go through the target's port (`<sector>/index.ts`).
 * scripts/ and tests/ may import anything, internals included. No exception list: fix the code, not this file.
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

export function sectorOf(file:string):Sector|undefined{
  for(const [sector,dir] of Object.entries(PORTS))if(file.startsWith(dir+'/'))return sector as Sector;
  // The Vite entry and the ambient declarations are the client's.
  if(file==='src/main.ts'||file==='src/env.d.ts')return 'client';
  const top=file.split('/')[0];
  if(top==='multiplayer'||top==='backend'||top==='scripts'||top==='tests')return top;
  return undefined;
}

const SKIP=new Set(['node_modules','.vite','dist','.wrangler']);
const walk=(d:string):string[]=>existsSync(d)?readdirSync(d).flatMap(f=>{
  const p=join(d,f);if(SKIP.has(f))return [];
  return statSync(p).isDirectory()?walk(p):[p];
}):[];
/** Same regex as the board's graph.mjs: static and dynamic imports, re-exports, side-effect imports and require. */
const IMPORT=/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface Arrow {from:string;to:string;fromSector:Sector;toSector:Sector}
export function arrows():Arrow[]{
  const files=['src','multiplayer','backend'].flatMap(d=>walk(join(root,d))).map(p=>norm(relative(root,p))).filter(f=>/\.(ts|mts|mjs|cjs|js)$/.test(f));
  const out:Arrow[]=[];
  for(const from of files){
    const fromSector=sectorOf(from);if(!fromSector)continue;
    const src=readFileSync(join(root,from),'utf8');
    for(const m of src.matchAll(IMPORT)){
      const spec=m[1]??m[2]??m[3]??m[4];
      if(!spec||!spec.startsWith('.'))continue;
      const to=norm(relative(root,resolve(root,dirname(from),spec.replace(/\?.*$/,''))));
      const toSector=sectorOf(to);
      if(!toSector||toSector===fromSector)continue;
      out.push({from,to,fromSector,toSector});
    }
  }
  return out;
}

const all=arrows();

test('arquitetura: the scan sees the sectors (guards against a silent empty scan)',()=>{
  assert.ok(all.length>50,`only ${all.length} arrows between sectors`);
  for(const sector of ['client','sim','multiplayer'] as const)assert.ok(all.some(a=>a.fromSector===sector),`no arrow from ${sector}`);
  for(const dir of Object.values(PORTS))assert.ok(existsSync(join(root,dir,'index.ts')),`${dir}/index.ts (the port) is missing`);
});

test('arquitetura: only the arrows of the table (OWNERS.md)',()=>{
  const bad=all.filter(a=>{const ok=ALLOWED[a.fromSector];return ok!=='any'&&!ok.includes(a.toSector);})
    .map(a=>`${a.fromSector} → ${a.toSector}: ${a.from} importa ${a.to}`);
  assert.deepEqual(bad,[],`setas proibidas:\n${bad.join('\n')}`);
});

test('arquitetura: between sectors, imports go through the port (index.ts)',()=>{
  const bad=all.filter(a=>ALLOWED[a.fromSector]!=='any'&&PORTS[a.toSector]&&a.to!==`${PORTS[a.toSector]}/index.ts`)
    .map(a=>`${a.from} importa ${a.to} (use ${PORTS[a.toSector]}/index.ts)`);
  assert.deepEqual(bad,[],`imports fora da porta:\n${bad.join('\n')}`);
});
