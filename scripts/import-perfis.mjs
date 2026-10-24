// The enemies' dating-app profile photos (card nome-inimigo-rede-social): the chosen ChatGPT portraits
// (<evidence>/fotos/loteN/escolhidas/<id>.png, ~763×1024) → public/art/perfis/<id>.webp (384×512), and the two button
// pictures (fotos/botoes/curtir|passar.png) → public/art/perfis/botao-<curtir|passar>.webp (128×128, alpha).
// Usage: node scripts/import-perfis.mjs --fotos <dir of id.png> [--botoes <dir with curtir.png and passar.png>]
import {mkdir,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const PERFIS_DIR=path.join(ROOT,'public','art','perfis');
export const PHOTO_SIZE=Object.freeze([384,512]);
export const BUTTON_SIZE=128;
const safeId=id=>/^[a-z][a-z0-9-]*$/.test(id);

export async function importPhotos(fotos,out=PERFIS_DIR){
  await mkdir(out,{recursive:true});
  const done=[];
  for(const file of (await readdir(fotos)).filter(f=>f.endsWith('.png')).sort()){
    const id=file.slice(0,-4);
    if(!safeId(id))throw new Error(`bad id: ${file}`);
    await sharp(path.join(fotos,file)).resize(...PHOTO_SIZE,{fit:'cover',position:'attention'}).webp({quality:78}).toFile(path.join(out,id+'.webp'));
    done.push(id);
  }
  return done;
}

export async function importButtons(botoes,out=PERFIS_DIR){
  await mkdir(out,{recursive:true});
  for(const name of ['curtir','passar'])await sharp(path.join(botoes,name+'.png'))
    .resize(BUTTON_SIZE,BUTTON_SIZE,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:85,alphaQuality:90}).toFile(path.join(out,`botao-${name}.webp`));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
  const fotos=arg('--fotos'),botoes=arg('--botoes');
  if(!fotos&&!botoes){console.error('usage: node scripts/import-perfis.mjs --fotos <dir> [--botoes <dir>]');process.exit(2);}
  const ids=fotos?await importPhotos(fotos):[];
  if(botoes)await importButtons(botoes);
  let bytes=0;for(const f of await readdir(PERFIS_DIR))bytes+=(await stat(path.join(PERFIS_DIR,f))).size;
  console.log(`${ids.length} fotos${botoes?' + 2 botões':''} → public/art/perfis (${Math.round(bytes/1024)} KB no total)`);
}
