// The heroes' own art on the stadium menu (NEW-20261021-ORQ-menu-arte-viciado): the approved letreiro (name + plaque in
// one picture) and the hero drawn in place over the 1920x1080 stadium, as light WebPs under public/art/menu/.
//   - letreiro: the transparent margin trimmed, 1000 px wide (the PC shows it at most ~46vw);
//   - heroi: only the hero's box of the 1920x1080 picture (src/client/ui/stadium.ts RECORTES keeps the same box, so the
//     page puts it back where it was), full size and a 2/3 copy for windows under 1440 px;
//   - botao: the confirm button's pill, star and burst (E7), half size.
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
];
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
  const sign=await sharp(path.join(evidence,hero.letreiro)).trim().toBuffer();
  const signFile=out('letreiro',`${hero.id}.webp`);
  report(signFile,await sharp(sign).resize({width:1000}).webp({quality:82,alphaQuality:90,effort:6}).toFile(signFile));
  const source=path.join(evidence,hero.heroi);
  const {width,height}=await sharp(source).metadata();
  if(width!==1920||height!==1080)throw new Error(`${hero.heroi}: expected 1920x1080, got ${width}x${height}`);
  const trimmed=await sharp(source).trim().toBuffer({resolveWithObject:true});
  const found={left:-trimmed.info.trimOffsetLeft,top:-trimmed.info.trimOffsetTop,width:trimmed.info.width,height:trimmed.info.height};
  if(JSON.stringify(found)!==JSON.stringify(hero.box))throw new Error(`${hero.id}: the hero's box is ${JSON.stringify(found)}, update box and RECORTES`);
  const cut=await sharp(source).extract(hero.box).toBuffer();
  for(const scale of [1,2/3]){
    const w=Math.round(hero.box.width*scale),file=out('heroi',`${hero.id}-${w}.webp`);
    report(file,await sharp(cut).resize({width:w}).webp({quality:80,alphaQuality:90,effort:6}).toFile(file));
  }
}
