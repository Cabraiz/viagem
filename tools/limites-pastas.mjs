#!/usr/bin/env node
/**
 * At most 6 items per folder in src/ (NEW-20261030-ORQ-trava-pastas-no-ci), run ONLY by
 * .github/workflows/limites-pastas.yml on a push to main. It is not in the queue's suite, test:changed or ci.mjs:
 * a red run stays red on GitHub and wakes nobody.
 *   node tools/limites-pastas.mjs            check src/ against tools/limites-pastas.base.json
 *   node tools/limites-pastas.mjs --gravar   rewrite the base (the ORQ only, in a batch, with the reason in the commit)
 * Items = direct children of a folder (files + subfolders), from `git ls-files src` (tracked files only, so a local
 * check and the CI see the same tree). Ratchet, like tests/tools/limites-codigo.test.ts:
 *   a folder in the base cannot grow; once it is at ≤ 6 (or gone) its entry has to leave the base;
 *   any other folder cannot pass 6.
 * Exit 0 green, 1 with problems (one per line).
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const LIMITE=6;
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BASE_FILE=resolve(root,'tools','limites-pastas.base.json');

/** Tracked paths ('src/a/b.ts', …) → folder → number of direct items (files + subfolders). */
export function itensPorPasta(paths){
  const filhos=new Map();
  for(const p of paths){
    const parts=p.split('/');
    for(let i=1;i<parts.length;i++){
      const pasta=parts.slice(0,i).join('/');
      if(!filhos.has(pasta))filhos.set(pasta,new Set());
      filhos.get(pasta).add(parts[i]);
    }
  }
  return new Map([...filhos].sort(([a],[b])=>a<b?-1:1).map(([pasta,s])=>[pasta,s.size]));
}

/** counts (from itensPorPasta) against the base {limite, pastas: {folder: max}} → one message per problem. */
export function problemas(counts,base){
  const out=[];
  for(const [pasta,n] of counts){
    const max=base.pastas[pasta];
    if(max===undefined){if(n>base.limite)out.push(`${pasta}: ${n} itens (> ${base.limite}). Agrupe em subpastas de até ${base.limite}.`);}
    else if(n>max)out.push(`${pasta}: cresceu de ${max} para ${n} itens. Pasta da base só pode diminuir: ponha o novo numa subpasta.`);
    else if(n<=base.limite)out.push(`${pasta}: agora tem ${n} itens (≤ ${base.limite}). Tire a entrada de tools/limites-pastas.base.json.`);
  }
  for(const pasta of Object.keys(base.pastas))if(!counts.has(pasta))out.push(`${pasta}: não existe mais. Tire (ou renomeie) a entrada da base.`);
  return out;
}

/** The base that makes today's tree green: every folder above the limit, at its current size. */
export function snapshot(counts){
  const pastas={};
  for(const [pasta,n] of counts)if(n>LIMITE)pastas[pasta]=n;
  return {limite:LIMITE,pastas};
}

export function lerSrc(cwd=root){
  return execFileSync('git',['ls-files','-z','src'],{cwd,encoding:'utf8'}).split('\0').filter(Boolean);
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const counts=itensPorPasta(lerSrc());
  if(process.argv.includes('--gravar')){
    writeFileSync(BASE_FILE,JSON.stringify(snapshot(counts),null,2)+'\n');
    console.log(`base regravada: ${BASE_FILE} (${Object.keys(snapshot(counts).pastas).length} de ${counts.size} pastas acima de ${LIMITE})`);
    process.exit(0);
  }
  const base=JSON.parse(readFileSync(BASE_FILE,'utf8'));
  const out=problemas(counts,base);
  if(base.limite!==LIMITE)out.unshift(`a base tem limite ${base.limite}, o script ${LIMITE}.`);
  if(out.length){
    console.error(`limites-pastas: ${out.length} problema(s) em src/ (máximo ${LIMITE} itens por pasta):`);
    for(const p of out)console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`limites-pastas: ok (${counts.size} pastas; ${Object.keys(base.pastas).length} na base, nenhuma cresceu)`);
}
