// The stadium behind the menu (NEW-20261021-ORQ-menu-estadio): the background the user approved on 21/10 (1920x1080)
// as light WebPs. PC: the whole picture (1920 and a 1280 lite copy). Phone held upright: a crop centred on the bar
// (src/client/ui/stadium.ts STADIUM.tall.crop, the same numbers), whole height, 768 px (57 KB: no lite copy needed).
//   node scripts/estadio-fundo.mjs [--input D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-tela-estadio-fundo/fundo-e1-1080p.png]
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--input');
const input=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-tela-estadio-fundo/fundo-e1-1080p.png';
const {width,height}=await sharp(input).metadata();
if(width!==1920||height!==1080)throw new Error(`expected 1920x1080, got ${width}x${height}`);
const TALL={left:422,top:0,width:768,height:1080};
const jobs=[
  {name:'estadio-1920',width:1920},
  {name:'estadio-1280',width:1280},
  {name:'estadio-retrato-768',width:768,crop:TALL},
];
for(const job of jobs){
  const out=path.join(root,`public/art/ui-extra/${job.name}.webp`);
  let image=sharp(input);
  if(job.crop)image=image.extract(job.crop);
  const info=await image.resize({width:job.width}).webp({quality:78,effort:6}).toFile(out);
  console.log(`${path.relative(root,out)}: ${info.width}x${info.height}, ${info.size} bytes`);
}
