// Sprite importer. Three modes:
//   node --experimental-strip-types scripts/import-sprites.mjs <batchDir>
//       the approved single-direction sheets (lote-N/<id>/), regenerates src/client/sprites/sprite-catalog.ts.
//   node --experimental-strip-types scripts/import-sprites.mjs --dir4 <dir> [--lab] [--replace]
//       4-direction atlases (<dir>/<id>/atlas-4dir.png or <dir>/<id>.dir4.png; format in docs/sprite-directions.md),
//       all-or-nothing (scripts/import-dir4.mjs). Adds public/art/sprites/<id>.dir4.webp and the class's `dir4` entry
//       in the catalog. The approved <id>.webp is never written; an existing <id>.dir4.webp is only replaced with
//       --replace. --lab writes the TEST batch to tests/fixtures/sprites-4dir/ instead and leaves the catalog alone.
//   node --experimental-strip-types scripts/import-sprites.mjs --figures
//       re-measures the figure boxes of the art already in public/art/sprites into the catalog (no art is written),
//       so the game never reads a sheet's pixels in the middle of a match.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {classes} from '../src/rules/classes.ts';
import {validateSingleSheet,raw,figureBox} from './sprite-atlas.mjs';
import {importDirectional,readCatalog,writeCatalog} from './import-dir4.mjs';

const exists=file=>stat(file).then(()=>true,()=>false);
await mkdir('artifacts',{recursive:true});
const args=process.argv.slice(2);
const ids=classes.map(c=>c.id);

if(args[0]==='--dir4'){
  const root=args[1],lab=args.includes('--lab'),replace=args.includes('--replace');
  if(!root)throw new Error('Passe a pasta do lote de 4 direções.');
  const {report,ignored}=await importDirectional({root,ids,lab,replace,outDir:lab?'tests/fixtures/sprites-4dir':'public/art/sprites'});
  if(ignored.length)console.warn(`Ignorado (não é id de classe): ${ignored.join(', ')}`);
  await writeFile(`artifacts/sprite-import-dir4${lab?'-lab':''}-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({classes:report.length,lab,bytes:report.reduce((n,r)=>n+r.bytes,0),heights:Object.fromEntries(report.map(r=>[r.id,r.height]))}));
}else if(args[0]==='--figures'){
  const catalog=await readCatalog();
  for(const id of Object.keys(catalog)){
    const single=await raw(`public/art/sprites/${id}.webp`);catalog[id].figure=figureBox(single.data,single.width,single.height);
    if(catalog[id].dir4){const dir4=await raw(`public/art/sprites/${id}.dir4.webp`);catalog[id].dir4.figure=figureBox(dir4.data,dir4.width,dir4.height);}
  }
  await writeCatalog(catalog);
  console.log(JSON.stringify({figures:Object.keys(catalog).length}));
}else if(args[0]&&!args[0].startsWith('--')){
  const root=args[0];
  await mkdir('public/art/sprites',{recursive:true});
  const previous=await readCatalog().catch(()=>({}));
  const report=[],catalog={};
  for(const [i,hero] of classes.entries()){
    const batch=path.join(root,`lote-${Math.floor(i/6)+1}`),dir=path.join(batch,hero.id);
    const status=JSON.parse(await readFile(path.join(dir,'status.json'),'utf8'));
    let source;
    try{const meta=JSON.parse(await readFile(path.join(dir,'atlas.json'),'utf8'));source=path.join(dir,meta.image);}catch{
      const file=status.files.atlas;
      for(const candidate of [path.join(dir,file),path.join(batch,file)])if(await exists(candidate)){source=candidate;break;}
    }
    if(!source)throw new Error(`${hero.id}: folha não encontrada`);
    const {height,figure}=await validateSingleSheet(source,hero.id);
    const output=`public/art/sprites/${hero.id}.webp`;
    await sharp(source).webp({lossless:true,effort:6}).toFile(output);
    catalog[hero.id]={height,figure};
    // Re-importing the single sheets keeps the 4-direction entries whose atlas is in place.
    if(previous[hero.id]?.dir4&&await exists(`public/art/sprites/${hero.id}.dir4.webp`))catalog[hero.id].dir4=previous[hero.id].dir4;
    report.push({id:hero.id,source,output,bytes:(await stat(output)).size,frames:18,artStatus:'candidate',issues:status.remainingIssues??status.remainingProblems??status.issues??[]});
  }
  await writeCatalog(catalog);
  await writeFile('artifacts/sprite-import-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({classes:report.length,frames:report.length*18,bytes:report.reduce((n,r)=>n+r.bytes,0)}));
}else throw new Error('Uso: import-sprites.mjs <pasta-do-lote> | --dir4 <pasta> [--lab] [--replace] | --figures');
