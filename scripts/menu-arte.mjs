// The heroes' own art on the stadium menu (NEW-20261021-ORQ-menu-arte-viciado): the approved letreiro (name + plaque in
// one picture) and the hero drawn in place over the 1920x1080 stadium, as light WebPs under public/art/menu/.
//   - letreiro: the transparent margin trimmed, 1000 px wide (the PC shows it at most ~46vw);
//   - heroi: only the hero's box of the 1920x1080 picture (src/client/ui/stadium.ts RECORTES keeps the same box, so the
//     page puts it back where it was), full size and a 2/3 copy for windows under 1440 px;
//   - botao: the confirm button's pill, star and burst (E7), half size;
//   - fundo: a hero's own background, bigger than the screen (the 1920x1080 picture in the middle at 320,313 of 2560x1707,
//     like fundo-estadio-viciado), WebP q95; scripts/art-lite.mjs makes its lite copy.
// A hero with its own `evidence` folder reads its files there. The CLT (NEW-20261021-ORQ-tela-clt-pose2) is encoded at a
// higher quality than the first hero: no visible blocks on his outline at 1080p.
//   node scripts/menu-arte.mjs [--evidence D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-elenco-cartoon-estadio]
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--evidence');
const evidence=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-elenco-cartoon-estadio';
const HEROES=[
  // box = the hero's opaque pixels in the 1920x1080 file (sharp trim), the same numbers as RECORTES in stadium.ts.
  {id:'viciado-em-bet',letreiro:'letreiro-fiel-recorte.png',heroi:'viciado-1080p-no-lugar.png',box:{left:955,top:21,width:788,height:1053}},
  {id:'clt-cansado',evidence:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-tela-clt-pose2',heroi:'clt-cansado-1080p-no-lugar.png',
    box:{left:793,top:74,width:633,height:863},webp:{quality:92,alphaQuality:100,effort:6},
    fundo:'fundo-clt-2560.png'},
];
const HERO_WEBP={quality:80,alphaQuality:90,effort:6};
const out=(dir,file)=>{mkdirSync(path.join(root,'public/art/menu',dir),{recursive:true});return path.join(root,'public/art/menu',dir,file);};
const report=(file,info)=>console.log(`${path.relative(root,file)}: ${info.width}x${info.height}, ${info.size} bytes`);
// The confirm button (E7, 21/10, for every hero): a 9-slice pill without text (caps of 259 px of the 298 px height, the
// middle stretches; estadio.css border-image), the star on the left and the burst on the right. Half size: the PC
// shows the pill at most 76 px tall, so 149 px covers DPR 2.
const BUTTON=[['botao-pilula.png','pilula'],['botao-estrela.png','estrela'],['botao-icone-direita.png','icone-direita']];
for(const [file,name] of BUTTON){
  const source=path.join(evidence,file),{width}=await sharp(source).metadata(),target=out('botao',`${name}.webp`);
  report(target,await sharp(source).resize({width:Math.round(width/2)}).webp({quality:85,alphaQuality:95,effort:6}).toFile(target));
}
for(const hero of HEROES){
  const dir=hero.evidence??evidence;
  if(hero.letreiro){
    const sign=await sharp(path.join(dir,hero.letreiro)).trim().toBuffer();
    const signFile=out('letreiro',`${hero.id}.webp`);
    report(signFile,await sharp(sign).resize({width:1000}).webp({quality:82,alphaQuality:90,effort:6}).toFile(signFile));
  }
  if(hero.fundo){
    const source=path.join(dir,hero.fundo),{width,height}=await sharp(source).metadata();
    if(width!==2560||height!==1707)throw new Error(`${hero.fundo}: expected 2560x1707, got ${width}x${height}`);
    const file=out('',`fundo-${hero.id}.webp`);
    report(file,await sharp(source).webp({quality:95,effort:6}).toFile(file));
  }
  const source=path.join(dir,hero.heroi);
  const {width,height}=await sharp(source).metadata();
  if(width!==1920||height!==1080)throw new Error(`${hero.heroi}: expected 1920x1080, got ${width}x${height}`);
  const trimmed=await sharp(source).trim().toBuffer({resolveWithObject:true});
  const found={left:-trimmed.info.trimOffsetLeft,top:-trimmed.info.trimOffsetTop,width:trimmed.info.width,height:trimmed.info.height};
  if(JSON.stringify(found)!==JSON.stringify(hero.box))throw new Error(`${hero.id}: the hero's box is ${JSON.stringify(found)}, update box and RECORTES`);
  const cut=await sharp(source).extract(hero.box).toBuffer();
  for(const scale of [1,2/3]){
    const w=Math.round(hero.box.width*scale),file=out('heroi',`${hero.id}-${w}.webp`);
    report(file,await sharp(cut).resize({width:w,kernel:'lanczos3'}).webp(hero.webp??HERO_WEBP).toFile(file));
  }
}
