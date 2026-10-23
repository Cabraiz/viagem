// The row's faces (NEW-20261023-ORQ-selecao-miniatura-rosto, the user 23/10: "thumbnail do rosto com background dos
// personagens"): each hero's Instagram profile photo (scripts/insta-arte.mjs, perfil-<hero>.webp: his face over his own
// screen's background) as a small square under public/art/menu/rosto/, q95; scripts/art-lite.mjs (MENU_LITE `rosto/`)
// makes the lossy copies the row loads (ui/miniatura.ts).
// 192 px: the row's tile is at most 9.63vh wide x 1/.82 tall (127 CSS px on a 1080 screen, 58 on a phone), cover.
//   node scripts/miniatura-rosto.mjs
import sharp from 'sharp';
import {mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inDir=path.join(root,'public/art/menu/insta'),outDir=path.join(root,'public/art/menu/rosto');
mkdirSync(outDir,{recursive:true});
const WEBP={quality:95,alphaQuality:100,effort:6,smartSubsample:true};
export const ROSTO_PX=192;

for(const file of readdirSync(inDir).filter(f=>/^perfil-.+\.webp$/.test(f))){
  const id=file.slice('perfil-'.length,-'.webp'.length);
  await sharp(path.join(inDir,file)).resize(ROSTO_PX,ROSTO_PX,{kernel:'lanczos3'}).webp(WEBP).toFile(path.join(outDir,`${id}.webp`));
}
console.error('miniatura-rosto: public/art/menu/rosto/ pronto');
