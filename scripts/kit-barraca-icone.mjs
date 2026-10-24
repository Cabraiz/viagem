// The kit:barraca's own HUD icon (NEW-20261023-ORQ-barracas-no-caminho; until then it wore kit-torre). Cut from the
// game's own barraca sheet (public/art/city/base/barraca.webp, frame 0: lona-1 inteira, view 0), its transparent margin
// trimmed and fitted into a 128 px transparent square like the importer's ui icons (8 px margin), and the ui piece
// written into public/art/manifest.json (kind icon, as kit-torre). No ui/ folder in arte-entrada holds it, so the
// importer's ui group leaves it alone; run this again if the barraca art changes.
//   node scripts/kit-barraca-icone.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SIZE=128,MARGIN=8,ID='kit-barraca';
const manifestFile=path.join(root,'public/art/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const sheet=manifest.groups.base.pieces.barraca.files.sheet,[w,h]=sheet.cell;
const frame=await sharp(path.join(root,'public/art/city/base',sheet.file)).extract({left:0,top:0,width:w,height:h}).png().toBuffer();
const trimmed=await sharp(frame).trim({threshold:8}).png().toBuffer();
const fit=await sharp(trimmed).resize({width:SIZE-2*MARGIN,height:SIZE-2*MARGIN,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
const out=path.join(root,`public/art/ui/${ID}.webp`);
const info=await sharp({create:{width:SIZE,height:SIZE,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite([{input:fit,left:MARGIN,top:MARGIN}]).webp({quality:90,alphaQuality:100,effort:4}).toFile(out);
console.log(`${path.relative(root,out)}: ${info.width}x${info.height}, ${info.size} bytes`);
const file=`${ID}.webp`;
manifest.groups.ui.pieces[ID]={kind:'icon',files:{sheet:{file,cell:[SIZE,SIZE],frames:1,pages:[{file,columns:1,rows:1,firstFrame:0,frameCount:1}]}}};
const raw=fs.readFileSync(manifestFile,'utf8');
fs.writeFileSync(manifestFile,JSON.stringify(manifest)+(raw.endsWith('\n')?'\n':''));
console.log('manifest: ui/'+ID);
