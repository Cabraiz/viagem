// The heroes' Instagram stories (NEW-20261023-ORQ-insta-stories-4-herois, NEW-20261024-ORQ-stories-vendedor-aposentado):
// the Codex art of each card (viagem-board/evidence/<card>/gerar/recorte, ~600-730 x 1000-1020) chosen in its README, in the order they play, as
// public/art/menu/insta/story-<hero>-<k>.webp: cut to the viewer's 9:16 in the middle (insta.css .insta-story-palco,
// object-fit cover) at 576x1024, never enlarged past the cut-out's height; scripts/art-lite.mjs (MENU_LITE `insta/`)
// makes the lossy copies the viewer loads when it opens.
//   node scripts/insta-stories.mjs [--evidence D:/Gits/viagem-board/evidence] [--so vendedor-praia,aposentado]
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(nome)=>{const i=process.argv.indexOf(nome);return i>0?process.argv[i+1]:undefined;};
const evidence=arg('--evidence')??'D:/Gits/viagem-board/evidence';
const so=arg('--so')?.split(',');
const outDir=path.join(root,'public/art/menu/insta');
mkdirSync(outDir,{recursive:true});
const WEBP={quality:92,effort:6,smartSubsample:true};

/** The READMEs' choices: each hero's card, cut-out name and numbers, in the order they play (ui/insta.ts INSTA_STORIES). */
const QUATRO='NEW-20261023-ORQ-insta-stories-4-herois',DOIS='NEW-20261024-ORQ-stories-vendedor-aposentado';
export const ESCOLHIDAS={'viciado-em-bet':[QUATRO,'viciado',[2,3,4,1]],'clt-cansado':[QUATRO,'clt',[1,7,4,5]],
  'gato-nada-pra-comer':[QUATRO,'gato',[2,1,5,6]],'maromba':[QUATRO,'maromba',[1,2,4,8]],
  'vendedor-praia':[DOIS,'vendedor',[1,2,8,7]],'aposentado':[DOIS,'aposentado',[1,2,4,8]]};
const W=576,H=1024;

for(const [id,[card,name,picks]] of Object.entries(ESCOLHIDAS)){
  if(so&&!so.includes(id))continue;
  const gerar=path.join(evidence,card,'gerar');
  for(const [k,n] of picks.entries()){
    const src=path.join(gerar,'recorte',`${name}-${n}.png`);
    await sharp(src).resize(W,H,{fit:'cover',position:'centre',kernel:'lanczos3'}).webp(WEBP).toFile(path.join(outDir,`story-${id}-${k+1}.webp`));
  }
}
console.log('insta-stories: ok');
