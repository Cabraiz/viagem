// Stone podium under the heroes on the creation screen (NEW-20261013-ORQ-podio-personagens).
// Trims the transparent margin of the user's PNG and writes light WebPs for the big portrait (600 px) and the
// class cards (160 px). The importer (import-art-v2) only takes 128 px ui icons, so this piece has its own script.
//   node scripts/podio-webp.mjs [--input D:/Gits/viagem-board/arte-entrada/ui-extra/podio.png]
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--input');
const input=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/arte-entrada/ui-extra/podio.png';
const trimmed=await sharp(input).trim({threshold:8}).toBuffer({resolveWithObject:true});
console.log(`recorte: ${trimmed.info.width}x${trimmed.info.height}`);
for(const width of [600,160]){
  const out=path.join(root,`public/art/ui-extra/podio-${width}.webp`);
  const info=await sharp(trimmed.data).resize({width}).webp({quality:82,alphaQuality:90,effort:6}).toFile(out);
  console.log(`${path.relative(root,out)}: ${info.width}x${info.height}, ${info.size} bytes`);
}
