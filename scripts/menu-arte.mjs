// The heroes' own art on the stadium menu (NEW-20261021-ORQ-menu-arte-viciado): the approved letreiro (name + plaque in
// one picture) and the hero drawn in place over the 1920x1080 stadium, as light WebPs under public/art/menu/.
//   - letreiro: the transparent margin trimmed, LETREIRO_WIDTH wide (never upscaled) and q95. The PC shows it at most
//     min(33.2vw, 56.4vh), 1218 px on a 4K screen; 2x that holds a 200 % zoom. The first one was cut out of the 1080p
//     screen (~900 px) and enlarged: pixelated. NEW-20261021-ORQ-letreiro-na-cena (the user chose variation 2): Codex
//     redrew the stadium with the sign inside it (the scene's light on it), the sign was cut out of that picture (mask of
//     a green-only edit + grabCut, 1 px eaten, no halo) after Real-ESRGAN (x4plus-anime, 4x then halved): 2726 px.
//     The CLT's (NEW-20261021-ORQ-letreiro-clt-na-cena, the user chose variation 2: an office plaque of frosted glass, not
//     the viciado's balloon letters) the same way, drawn into the plateau's sunset;
//   - heroi: only the hero's box of the 1920x1080 picture (src/client/ui/stadium.ts RECORTES keeps the same box, so the
//     page puts it back where it was), full size and a 2/3 copy for windows under 1440 px; with an `esrgan` file (the
//     box enlarged 2x by Real-ESRGAN, NEW-20261021-ORQ-heroi-esrgan-no-ar) every copy comes from it: 2x, 4/3, 1x, 2/3;
//   - botao: the confirm button's pill, star and burst (E7), half size;
//   - fundo: a hero's own background, bigger than the screen (the 1920x1080 picture in the middle at 320,313 of 2560x1707,
//     like fundo-estadio-viciado), WebP q95; scripts/art-lite.mjs makes its lite copy;
//   - mureta (NEW-20261021-ORQ-mureta-camada-frente): the stadium's bar under its top edge, cut out of the very file the
//     page draws (the lite fundo-estadio-viciado) and drawn over the viciado, so his back sneaker stands behind it. The
//     edge is stadium.ts MURETA_TOPO; `--so mureta --mede` measures it again (prints the cubic) instead of trusting it.
// A hero with its own `evidence` folder reads its files there. The CLT (NEW-20261021-ORQ-tela-clt-pose2) is encoded at a
// higher quality than the first hero: no visible blocks on his outline at 1080p.
//   node scripts/menu-arte.mjs [--evidence D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-elenco-cartoon-estadio]
//        [--so letreiro|heroi|botao|fundo|mureta] [--mede]   (only that part: the button's art is E7's, redone by its own cards)
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--evidence');
const evidence=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-elenco-cartoon-estadio';
const soFlag=process.argv.indexOf('--so'),so=soFlag>0?process.argv[soFlag+1]:undefined,part=(name)=>!so||so===name;
// heroi-esrgan-no-ar (the user, 21/10: option B): the box enlarged 2x by Real-ESRGAN x4plus-anime (E6,
// NEW-20261021-ORQ-realesrgan-herois-menu), alpha without a halo.
const ESRGAN='D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-realesrgan-herois-menu/saida';
const HEROES=[
  // box = every pixel of the hero with any alpha in the 1920x1080 file (alphaBox: the soft edge under the soles too; a
  // `trim` dropped 2 px of it), the same numbers as RECORTES in stadium.ts.
  {id:'viciado-em-bet',letreiro:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-letreiro-na-cena/letreiro-2-2x.png',heroi:'viciado-1080p-no-lugar.png',
    esrgan:'viciado-2x-x4plus-anime.png',box:{left:953,top:19,width:793,height:1058}},
  {id:'clt-cansado',evidence:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-tela-clt-pose2',
    letreiro:'D:/Gits/viagem-board/evidence/NEW-20261021-ORQ-letreiro-clt-na-cena/letreiro-2-2x.png',heroi:'clt-cansado-1080p-no-lugar.png',
    esrgan:'clt-2x-x4plus-anime.png',box:{left:792,top:73,width:635,height:865},fundo:'fundo-clt-2560.png'},
  // NEW-20261022-ORQ-gato-personagem-completo (the user chose pose 1, the bowl): Codex redrew the cat of the in-scene
  // picture alone on green (same light), keyed with the colour unmixed; in the viciado's box (same height, middle and
  // sole line). His 2x is Real-ESRGAN 4x of that native cutout, reduced (`esrganDir`: his own folder). His background is
  // the rooftop without him plus `sombra` (contact shadow + the wet tiles' reflection, a semi-transparent layer in the
  // bleed's px, kept apart so a new pose only redoes it).
  {id:'gato-nada-pra-comer',evidence:'D:/Gits/viagem-board/evidence/NEW-20261022-ORQ-gato-destaque-8',
    heroi:'gato-nada-pra-comer-1080p-no-lugar.png',esrgan:'gato-2x-x4plus-anime.png',esrganDir:'.',
    box:{left:944,top:19,width:812,height:1058},fundo:'../NEW-20261022-ORQ-tela-gato-nada-pra-comer/fundo-gato-2560.png',
    sombra:'gato-1-sombra-2560.png'},
];
// menu-pes-nitidez (the user, 21/10: "muito pixelado"): q95 and the alpha untouched, at the source's own size and 2/3.
/** The letreiro's width: 2x the most the PC shows (1218 px on 4K). */
const LETREIRO_WIDTH=2436;
const HERO_WEBP={quality:95,alphaQuality:100,smartSubsample:true,effort:6};
/** The box of every pixel with alpha > 0. */
async function alphaBox(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let top=Infinity,bottom=-1,left=Infinity,right=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>0){
    if(y<top)top=y;if(y>bottom)bottom=y;if(x<left)left=x;if(x>right)right=x;
  }
  return {left,top,width:right-left+1,height:bottom-top+1};
}
const out=(dir,file)=>{mkdirSync(path.join(root,'public/art/menu',dir),{recursive:true});return path.join(root,'public/art/menu',dir,file);};
const report=(file,info)=>console.log(`${path.relative(root,file)}: ${info.width}x${info.height}, ${info.size} bytes`);
// The confirm button (E7, 21/10, for every hero): a 9-slice pill without text (caps of 259 px of the 298 px height, the
// middle stretches; estadio.css border-image), the star on the left and the burst on the right. Half size: the PC
// shows the pill at most 76 px tall, so 149 px covers DPR 2.
const BUTTON=[['botao-pilula.png','pilula'],['botao-estrela.png','estrela'],['botao-icone-direita.png','icone-direita']];
for(const [file,name] of part('botao')?BUTTON:[]){
  const source=path.join(evidence,file),{width}=await sharp(source).metadata(),target=out('botao',`${name}.webp`);
  report(target,await sharp(source).resize({width:Math.round(width/2)}).webp({quality:85,alphaQuality:95,effort:6}).toFile(target));
}
// The bar's top edge: per column, the top of the light band over the purple pad (4 rows of it), searched ±14 px around
// a line read on gridded zooms; then a cubic fit, dropping what is more than 3 px off it (the crowd's highlights above).
async function measureBar(file,focal){
  const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at=(x,y)=>{const i=((y+focal.y)*info.width+(x+focal.x))*3;return [data[i],data[i+1],data[i+2]];};
  // Left of 1330 the band is pale yellow (blue low), right of it white with the yellow wall behind (blue low too).
  const band=(x,y)=>{const [r,g,b]=at(x,y);return x<1330?r>165&&g>165:Math.min(r,g,b)>170;};
  const read=[[900,948],[1000,950],[1080,952],[1140,962],[1200,966],[1260,976],[1320,987],[1400,997],[1440,1006],[1520,1028],[1600,1051],[1680,1075],[1760,1097],[1840,1121]];
  const guess=x=>{const i=Math.max(1,read.findIndex(([px])=>px>=x)),[a,b]=read[i-1],[c,d]=read[i];return b+(d-b)*(x-a)/(c-a);};
  let xs=[],ys=[];
  for(let x=900;x<=1840;x++){const g=Math.round(guess(x));for(let y=g-14;y<=g+14;y++)if([0,1,2,3].every(k=>band(x,y+k))){xs.push((x-1370)/470);ys.push(y);break;}}
  const fit=()=>{
    const A=Array.from({length:4},()=>Array(5).fill(0));
    xs.forEach((x,k)=>{const p=[1,x,x*x,x*x*x];for(let i=0;i<4;i++){for(let j=0;j<4;j++)A[i][j]+=p[i]*p[j];A[i][4]+=p[i]*ys[k];}});
    for(let i=0;i<4;i++){let m=i;for(let r=i+1;r<4;r++)if(Math.abs(A[r][i])>Math.abs(A[m][i]))m=r;[A[i],A[m]]=[A[m],A[i]];
      for(let r=0;r<4;r++)if(r!==i){const f=A[r][i]/A[i][i];for(let c=i;c<5;c++)A[r][c]-=f*A[i][c];}}
    return A.map((row,i)=>row[4]/row[i]);
  };
  let coef;
  for(let round=0;round<8;round++){
    coef=fit();const y=x=>coef[0]+coef[1]*x+coef[2]*x*x+coef[3]*x**3,keep=xs.map((x,k)=>Math.abs(ys[k]-y(x))<=3);
    xs=xs.filter((_,k)=>keep[k]);ys=ys.filter((_,k)=>keep[k]);
  }
  const rms=Math.sqrt(xs.reduce((a,x,k)=>a+(ys[k]-(coef[0]+coef[1]*x+coef[2]*x*x+coef[3]*x**3))**2,0)/xs.length);
  return {coef:coef.map(v=>+v.toFixed(3)),rms,kept:xs.length};
}
if(part('mureta')){
  const {STADIUM,MURETA_TOPO,muretaTopo,RECORTES}=await import(pathToFileURL(path.join(root,'src/client/ui/stadium.ts')).href);
  const focal=STADIUM.bleed.focal,source=path.join(root,'public/art/lite/menu/fundo-estadio-viciado.webp');
  if(process.argv.includes('--mede')){
    const got=await measureBar(source,focal);
    console.log(`mureta: coef ${JSON.stringify(got.coef)} (${got.kept} colunas, ${got.rms.toFixed(2)} px rms); stadium.ts tem ${JSON.stringify(MURETA_TOPO.coef)}`);
  }
  // The bar under its edge (alpha 0 above, 1 a px below, a 1 px ramp between), in the background file's own px.
  const box=RECORTES['viciado-em-bet'].frente,left=focal.x+box.x,top=focal.y+box.y;
  const {data,info}=await sharp(source).extract({left,top,width:box.w,height:box.h}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)
    data[(y*info.width+x)*4+3]=Math.round(255*Math.min(1,Math.max(0,box.y+y+1-muretaTopo(box.x+x+.5))));
  const file=path.join(root,'public',box.file);
  report(file,await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).webp({quality:95,alphaQuality:100,smartSubsample:true,effort:6}).toFile(file));
}
for(const hero of HEROES){
  const dir=hero.evidence??evidence;
  if(part('letreiro')&&hero.letreiro){
    const sign=await sharp(path.resolve(dir,hero.letreiro)).trim().toBuffer();
    const signFile=out('letreiro',`${hero.id}.webp`);
    report(signFile,await sharp(sign).resize({width:LETREIRO_WIDTH,kernel:'lanczos3',withoutEnlargement:true}).webp({quality:95,alphaQuality:100,smartSubsample:true,effort:6}).toFile(signFile));
  }
  if(part('fundo')&&hero.fundo){
    const source=path.join(dir,hero.fundo),{width,height}=await sharp(source).metadata();
    if(width!==2560||height!==1707)throw new Error(`${hero.fundo}: expected 2560x1707, got ${width}x${height}`);
    const file=out('',`fundo-${hero.id}.webp`);
    const layered=hero.sombra?sharp(source).composite([{input:path.join(dir,hero.sombra)}]):sharp(source);
    report(file,await layered.webp({quality:95,effort:6}).toFile(file));
  }
  if(!part('heroi'))continue;
  const source=path.join(dir,hero.heroi);
  const {width,height}=await sharp(source).metadata();
  if(width!==1920||height!==1080)throw new Error(`${hero.heroi}: expected 1920x1080, got ${width}x${height}`);
  const found=await alphaBox(source);
  if(JSON.stringify(found)!==JSON.stringify(hero.box))throw new Error(`${hero.id}: the hero's box is ${JSON.stringify(found)}, update box and RECORTES`);
  // The 2x file is the same box twice as big: the page keeps the 1x box (RECORTES) and the feet stay on the bar.
  const big=hero.esrgan?path.resolve(hero.esrganDir?path.resolve(dir,hero.esrganDir):ESRGAN,hero.esrgan):undefined,base=big?2:1;
  if(big){
    const meta=await sharp(big).metadata();
    if(meta.width!==hero.box.width*2||meta.height!==hero.box.height*2)throw new Error(`${hero.esrgan}: expected the box at 2x, got ${meta.width}x${meta.height}`);
  }
  const cut=big?await sharp(big).toBuffer():await sharp(source).extract(hero.box).toBuffer();
  for(const scale of big?[2,4/3,1,2/3]:[1,2/3]){
    const w=Math.round(hero.box.width*scale),file=out('heroi',`${hero.id}-${w}.webp`);
    report(file,await (scale===base?sharp(cut):sharp(cut).resize({width:w,kernel:'lanczos3'})).webp(HERO_WEBP).toFile(file));
  }
}
