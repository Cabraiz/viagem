// The heroes' Instagram stories (NEW-20261023-ORQ-insta-stories-4-herois): the Codex art of steps 1-2 (E4,
// viagem-board/evidence/<ID>/gerar/recorte, ~620-730 x 1000-1020) chosen in its README, in the order they play, as
// public/art/menu/insta/story-<hero>-<k>.webp: cut to the viewer's 9:16 in the middle (insta.css .insta-story-palco,
// object-fit cover) at 576x1024, never enlarged past the cut-out's height; scripts/art-lite.mjs (MENU_LITE `insta/`)
// makes the lossy copies the viewer loads when it opens.
//   node scripts/insta-stories.mjs [--evidence D:/Gits/viagem-board/evidence/NEW-20261023-ORQ-insta-stories-4-herois/gerar]
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--evidence');
const gerar=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/evidence/NEW-20261023-ORQ-insta-stories-4-herois/gerar';
const outDir=path.join(root,'public/art/menu/insta');
mkdirSync(outDir,{recursive:true});
const WEBP={quality:92,effort:6,smartSubsample:true};

/** The README's choices: the cut-out numbers of each hero, in the order they play (ui/insta.ts INSTA_STORIES). */
export const ESCOLHIDAS={'viciado-em-bet':['viciado',[2,3,4,1]],'clt-cansado':['clt',[1,7,4,5]],
  'gato-nada-pra-comer':['gato',[2,1,5,6]],'maromba':['maromba',[1,2,4,8]]};
const W=576,H=1024;

for(const [id,[name,picks]] of Object.entries(ESCOLHIDAS)){
  for(const [k,n] of picks.entries()){
    const src=path.join(gerar,'recorte',`${name}-${n}.png`);
    await sharp(src).resize(W,H,{fit:'cover',position:'centre',kernel:'lanczos3'}).webp(WEBP).toFile(path.join(outDir,`story-${id}-${k+1}.webp`));
  }
}
console.log('insta-stories: ok');
