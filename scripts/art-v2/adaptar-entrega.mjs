#!/usr/bin/env node
/**
 * Adapts an external art delivery (one PNG per view, `<id>.meta.json` sidecars with extra keys, per-direction heights)
 * to the importer's input contract (scripts/art-v2/spec.mjs), without ever touching the delivery.
 *
 *   node scripts/art-v2/adaptar-entrega.mjs <entrega> <saida-arte-entrada> [--clean]
 *
 * <entrega> is the delivery root (with `arte-entrada/` inside) or that `arte-entrada/` itself. The output is a fresh
 * arte-entrada folder for `node scripts/import-art-v2.mjs --input <saida>`, plus `adaptacao.json` (every piece: what was
 * done, scale factors applied, refusals with the reason). Idempotent: same delivery → same bytes.
 *
 * Each group adapter (scripts/art-v2/adaptar/*.mjs) exports `adapt({src, out, log})`, where `src` and `out` are the
 * delivery's and the output's arte-entrada roots, and returns a list of records
 * `{group, id, action, factor?, notes?:string[], refused?:string}` (refused → the piece is not written).
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const ADAPTERS=['cenario','decor','personagens','inimigos','geral'];

export async function adaptarEntrega(entrega,saida,{clean=false,log=()=>{}}={}){
  const src=fs.existsSync(path.join(entrega,'arte-entrada'))?path.join(entrega,'arte-entrada'):entrega;
  if(!fs.existsSync(src))throw new Error(`Entrega não encontrada: ${entrega}`);
  if(path.resolve(saida).startsWith(path.resolve(src)))throw new Error('A saída não pode ficar dentro da entrega.');
  if(clean)fs.rmSync(saida,{recursive:true,force:true});
  fs.mkdirSync(saida,{recursive:true});
  const records=[];
  for(const name of ADAPTERS){
    const mod=await import(pathToFileURL(path.join(import.meta.dirname,'adaptar',`${name}.mjs`)).href);
    records.push(...await mod.adapt({src,out:saida,log}));
  }
  records.sort((a,b)=>`${a.group}/${a.id}`.localeCompare(`${b.group}/${b.id}`));
  fs.writeFileSync(path.join(saida,'adaptacao.json'),JSON.stringify({version:1,records},null,1)+'\n');
  return records;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  if(args.length<2){console.error('Uso: node scripts/art-v2/adaptar-entrega.mjs <entrega> <saida-arte-entrada> [--clean]');process.exit(2);}
  const records=await adaptarEntrega(args[0],args[1],{clean:process.argv.includes('--clean'),log:m=>console.log(m)});
  const refused=records.filter(r=>r.refused);
  const byGroup={};for(const r of records)(byGroup[r.group]??=[0,0])[r.refused?1:0]++;
  for(const [g,[ok,no]] of Object.entries(byGroup))console.log(`${g}: ${ok} adaptadas, ${no} recusadas`);
  for(const r of refused)console.log(`  - ${r.group}/${r.id}: ${r.refused}`);
  console.log(`Saída: ${path.resolve(args[1])} (detalhes em adaptacao.json). Importe com: node scripts/import-art-v2.mjs --input ${args[1]}`);
}
