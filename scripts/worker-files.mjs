/**
 * NEW-20261025-ORQ-health-gate-build-sha: the files the rooms Worker bundles, found by following the relative imports
 * from multiplayer/worker.ts (src/sim, src/rules, src/maps, src/protocol, src/contract and whatever they reach), plus
 * multiplayer/wrangler.jsonc. A change to one of them means the live Worker is stale until `npm run deploy:rooms`:
 * lote 23 changed the sim without touching the protocol, the Worker stayed on lote 22 and the site went up anyway.
 * Used by scripts/health-gate.mjs (pages.yml) and tools/fila.mjs. Plain node, no dependencies.
 */
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';

export const WORKER_ENTRY='multiplayer/worker.ts';
const EXTRA=['multiplayer/wrangler.jsonc'];
// Static `from '…'`, side-effect `import '…'` and dynamic `import('…')`; only relative specifiers are followed.
const SPEC=/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

const isFile=(p)=>{try{return statSync(p).isFile();}catch{return false;}};
function resolve(from,spec){
  const base=join(dirname(from),spec);
  return [base,`${base}.ts`,join(base,'index.ts')].find(isFile);
}

/** Every file the Worker bundles, repo-relative with forward slashes, sorted; [] when the repo has no Worker. */
export function workerFiles(root){
  const entry=join(root,WORKER_ENTRY);
  if(!existsSync(entry))return [];
  const seen=new Set(),todo=[entry];
  while(todo.length){
    const file=todo.pop();
    if(seen.has(file))continue;
    seen.add(file);
    if(!/\.[cm]?[jt]s$/.test(file))continue;// JSON and other assets are bundled but import nothing
    for(const m of readFileSync(file,'utf8').matchAll(SPEC)){const next=resolve(file,m[1]);if(next&&!seen.has(next))todo.push(next);}
  }
  const rel=[...seen].map(f=>relative(root,f).replace(/\\/g,'/'));
  return [...new Set([...rel,...EXTRA.filter(f=>existsSync(join(root,f)))])].sort();
}

/** The `changed` paths (repo-relative) that the Worker bundles. */
export function workerChanges(changed,files){
  const set=new Set(files);
  return changed.filter(f=>set.has(f));
}
