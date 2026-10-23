#!/usr/bin/env node
/**
 * Pack 12 `mascote` and `investida` weapons (card NEW-20261022-ORQ-arsenal-completo-no-bau, fatia B): the small allies
 * (vira-lata, papagaio) and the creature that crosses the screen (mula-sem-cabeca). The art v2 importer has no group
 * for them (scripts/art-v2 is not touched), so this one writes them in the enemies' format, which the client already
 * reads (art/manifest.ts): public/art/mascote/<id>/<anim>.webp, 8 rows (S, SW, W, NW, N, NE, E, SE) × `frames`
 * columns, anchor 50 %/88 %, and public/art/mascote/manifest.json {version:2, group:'mascote', pieces}.
 * The dark rim of D-037 (spec.mjs RIM, convert.mjs applyRim: cell by cell, only outside the drawing) like the enemies'.
 *
 *   node scripts/import-mascote.mjs <pasta>   <pasta>/<id>/<anim>.png (8 rows × frames, cell from meta.json) + meta.json
 *                                             {"cell":[96,96],"fps":{"walk":10,…}}
 */
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {RIM,ANCHOR,DIRECTIONS as DIRS} from './art-v2/spec.mjs';
import {applyRim} from './art-v2/convert.mjs';

sharp.cache(false);
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export const OUT_DIR='public/art/mascote';
export const DIRECTIONS=DIRS.length;
export {RIM,ANCHOR};
const sha=buf=>createHash('sha256').update(buf).digest('hex');

export async function importMascotes(input,root=ROOT){
  const pieces={};
  for(const id of readdirSync(input).filter(n=>existsSync(join(input,n,'meta.json'))).sort()){
    const meta=JSON.parse(readFileSync(join(input,id,'meta.json'),'utf8')),[cw,ch]=meta.cell,files={};
    mkdirSync(join(root,OUT_DIR,id),{recursive:true});
    for(const anim of Object.keys(meta.fps)){
      const {data,info}=await sharp(join(input,id,`${anim}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(info.height!==ch*DIRECTIONS||info.width%cw)throw new Error(`${id}/${anim}.png: ${info.width}×${info.height}, esperado N×${cw} por ${ch*DIRECTIONS}`);
      const frames=info.width/cw;
      const rimmed=applyRim({data,width:info.width,height:info.height},[cw,ch],RIM);
      const webp=await sharp(rimmed,{raw:{width:info.width,height:info.height,channels:4}}).webp({lossless:true,effort:6}).toBuffer();
      const file=`${id}/${anim}.webp`,h=sha(webp);
      writeFileSync(join(root,OUT_DIR,file),webp);
      files[anim]={file,cell:[cw,ch],frames,directions:DIRECTIONS,anchor:ANCHOR,fps:meta.fps[anim],rim:RIM,
        pages:[{file,columns:frames,rows:DIRECTIONS,firstFrame:0,frameCount:frames*DIRECTIONS,sha256:h}],sha256:h};
    }
    pieces[id]={kind:'animations',files,sha256:sha(Buffer.from(JSON.stringify(files)))};
  }
  const manifest={version:2,group:'mascote',pieces};
  writeFileSync(join(root,OUT_DIR,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const input=process.argv[2];
  if(!input){console.error('uso: node scripts/import-mascote.mjs <pasta>');process.exit(2);}
  const m=await importMascotes(input);
  for(const [id,p] of Object.entries(m.pieces))console.log(`${id}: ${Object.entries(p.files).map(([a,f])=>`${a} ${f.frames}×8`).join(', ')}`);
}
