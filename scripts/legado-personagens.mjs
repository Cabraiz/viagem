// Moves a removed hero's art out of the game into legado/personagens/<id>/ (NEW-20261023-ORQ-remover-7-personagens).
// Every tracked file under public/ (and scripts/hand-keys/) named `<id>.*` or `<id>-*` is `git mv`ed (history kept) to
// legado/personagens/<id>/<path under public/art>; its entries leave the group manifests (personagens, rostos, menu)
// and land in legado/personagens/manifest-legado.json; the client index is then rewritten from the group manifests
// (writeIndex). legado/ is outside public/ and src/, so outside the build and the site; .ignore keeps it from searches.
// Afterwards run `node scripts/art-lite.mjs` (art-lite.json and the lite copies) and `--check`.
//   node scripts/legado-personagens.mjs <id> [<id>...] [--dry-run]
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GROUPS,MANIFEST_VERSION} from './art-v2/spec.mjs';
import {readManifest,manifestPath,writeIndex,writeAtomic} from './art-v2/convert.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LEGADO='legado/personagens';
const MANIFEST_GROUPS=['personagens','rostos','menu'];
const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{encoding:'utf8'});

/** Does `name` (a file or a manifest piece id) belong to hero `id`? */
export const isHeroName=(name,id)=>name===id||name.startsWith(`${id}.`)||name.startsWith(`${id}-`);

/** The tracked public/ files of `id`, with their destination under legado/. */
export function plannedMoves(id,tracked){
  // The art under public/, and the hand marks drawn by eye (scripts/hand-keys/<id>.json, read by hand-points.mjs).
  return tracked.filter(f=>(f.startsWith('public/')||f.startsWith('scripts/hand-keys/'))&&isHeroName(path.posix.basename(f),id))
    .map(f=>({from:f,to:`${LEGADO}/${id}/${f.startsWith('public/')?path.posix.relative('public/art',f):path.posix.relative('scripts',f)}`}));
}

async function main(){
  const argv=process.argv.slice(2),dryRun=argv.includes('--dry-run'),ids=argv.filter(a=>!a.startsWith('--'));
  if(!ids.length){console.error('Uso: node scripts/legado-personagens.mjs <id> [<id>...] [--dry-run]');process.exitCode=2;return;}
  const tracked=git('ls-files','public','scripts/hand-keys').split('\n').filter(Boolean);
  const legadoFile=path.join(ROOT,LEGADO,'manifest-legado.json');
  const legado=existsSync(legadoFile)?JSON.parse(readFileSync(legadoFile,'utf8')):{version:MANIFEST_VERSION,groups:{}};
  let moved=0;
  for(const id of ids){
    for(const {from,to} of plannedMoves(id,tracked)){
      moved++;
      if(dryRun){console.log(`${from} -> ${to}`);continue;}
      mkdirSync(path.join(ROOT,path.dirname(to)),{recursive:true});
      git('mv',from,to);
    }
  }
  const touched={};
  for(const group of MANIFEST_GROUPS){
    const spec=GROUPS[group],file=manifestPath(spec,{outRoot:ROOT}),manifest=await readManifest(file);
    if(!manifest)continue;
    const out=Object.keys(manifest.pieces).filter(k=>ids.some(id=>isHeroName(k,id)));
    if(!out.length)continue;
    const kept=legado.groups[group]??={output:spec.output,pieces:{}};
    for(const k of out){kept.pieces[k]=manifest.pieces[k];delete manifest.pieces[k];}
    touched[group]=spec;
    console.log(`${group}: ${out.length} entradas -> manifest-legado.json`);
    if(!dryRun)await writeAtomic(file,`${JSON.stringify(manifest,null,2)}\n`);
  }
  if(!dryRun){
    mkdirSync(path.dirname(legadoFile),{recursive:true});
    for(const g of Object.values(legado.groups))g.pieces=Object.fromEntries(Object.keys(g.pieces).sort().map(k=>[k,g.pieces[k]]));
    writeFileSync(legadoFile,`${JSON.stringify(legado,null,2)}\n`);
    if(Object.keys(touched).length)await writeIndex(touched,{outRoot:ROOT});
  }
  console.log(`${moved} arquivos ${dryRun?'seriam movidos':'movidos'} para ${LEGADO}/.`);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await main();
