// The phone's upright hero pick as an Instagram profile (NEW-20261023-ORQ-selecao-mobile-instagram): the Codex art of
// steps 1-2 (E5, viagem-board/evidence/<ID>/gerar) as WebPs at twice the CSS size the screen shows them (DPR 2) under
// public/art/menu/insta/, q95; scripts/art-lite.mjs (MENU_LITE `insta/`) makes the lossy copies the page loads.
//   - perfil-<hero>.webp: the profile photo chosen in the README (one per hero), a square, 360 px (165 CSS px at most);
//     the stories' circles show the same file;
//   - grade-<hero>-<1..3>.webp: the 3 grid photos, cut in the middle to the reference's cell (228x262, folha-8), 272x312;
//   - icone-<name>.webp: the icons on the chroma green, keyed out (despilled edge), 96 px on their longer side;
//   - post-<hero>-<1..3>.webp: the same 3 photos opened as a post (BUG-20261023-ORQ-instagram-letreiro-do-perfil), the
//     square in the middle of the cut-out at 480 px (the cut-outs are ~490 wide: never enlarged);
//   - logo-<hero>.webp: the top bar's logo is the letreiro of the profile on screen (same bug; public/art/menu/letreiro),
//     trimmed to its drawing, 168 px tall (140 card px, DPR 2). The gato's is only his fish tag with its ring and bell:
//     the collar stays out (SO_A_PLACA). A hero whose letreiro is not in public/ yet is skipped (the maromba's
//     came from vgm/fundo-maromba, copied in for the run).
//   node scripts/insta-arte.mjs [--evidence D:/Gits/viagem-board/evidence/NEW-20261023-ORQ-selecao-mobile-instagram/gerar]
import sharp from 'sharp';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--evidence');
const gerar=flag>0?process.argv[flag+1]:'D:/Gits/viagem-board/evidence/NEW-20261023-ORQ-selecao-mobile-instagram/gerar';
const outDir=path.join(root,'public/art/menu/insta');
mkdirSync(outDir,{recursive:true});
const out=file=>path.join(outDir,file);
const WEBP={quality:95,alphaQuality:100,effort:6,smartSubsample:true};

/** The README's choices (E5): the option number of each hero's profile sheet. */
const PERFIL={'viciado-em-bet':['viciado',1],'clt-cansado':['clt',1],'gato-nada-pra-comer':['gato',1],'maromba':['maromba',4],
  'vendedor-praia':['vendedor',4],'aposentado':['aposentado',3]};
const PERFIL_PX=360,GRADE=[272,312],POST_PX=480,LOGO_H=168;

for(const [id,[name,option]] of Object.entries(PERFIL)){
  const src=path.join(gerar,'recorte',`perfil-${name}-${option}.png`),{width,height}=await sharp(src).metadata(),side=Math.min(width,height);
  await sharp(src).extract({left:Math.floor((width-side)/2),top:Math.floor((height-side)/2),width:side,height:side})
    .resize(PERFIL_PX,PERFIL_PX,{kernel:'lanczos3'}).webp(WEBP).toFile(out(`perfil-${id}.webp`));
  for(let i=1;i<=3;i++){
    const g=path.join(gerar,'recorte',`grade-${name}-${i}.png`);
    await sharp(g).resize(GRADE[0],GRADE[1],{fit:'cover',position:'centre',kernel:'lanczos3'}).webp(WEBP).toFile(out(`grade-${id}-${i}.webp`));
    await sharp(g).resize(POST_PX,POST_PX,{fit:'cover',position:'centre',kernel:'lanczos3'}).webp(WEBP).toFile(out(`post-${id}-${i}.webp`));
  }
}

// icones.png (1536x1024): two rows of five on #00FF00; the boxes found by the green's connected components, padded.
const ICONES={sino:[35,170,247,284],menu:[350,199,226,236],verificado:[637,178,264,269],cadeado:[969,175,212,274],grade:[1261,194,244,243],
  video:[28,597,263,208],coracao:[328,591,263,221],oculos:[616,627,306,152],coroa:[944,567,275,239],pata:[1252,571,269,241]};
const sheet=await sharp(path.join(gerar,'icones.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(const [name,[x,y,w,h]] of Object.entries(ICONES)){
  const pad=8,left=x-pad,top=y-pad,W=w+2*pad,H=h+2*pad,px=Buffer.alloc(W*H*4),{data,info}=sheet;
  for(let j=0;j<H;j++)for(let i=0;i<W;i++){
    const s=((top+j)*info.width+left+i)*4,d=(j*W+i)*4;
    let r=data[s],g=data[s+1],b=data[s+2];
    // How green the pixel is beyond its other channels: 0 = the icon, 1 = the key; the edge in between fades and loses
    // its green spill (g down to the larger of r and b).
    const spill=g-Math.max(r,b),a=spill<=40?1:spill>=150?0:1-(spill-40)/110;
    if(spill>0)g=Math.max(r,b);
    px[d]=r;px[d+1]=g;px[d+2]=b;px[d+3]=Math.round(255*a);
  }
  const scale=96/Math.max(W,H);
  await sharp(px,{raw:{width:W,height:H,channels:4}}).trim({threshold:1}).resize(Math.round(W*scale),Math.round(H*scale),{fit:'inside',kernel:'lanczos3'})
    .webp(WEBP).toFile(out(`icone-${name}.webp`));
}

// The letreiros' transparent margins are not one colour (sharp's trim keeps them): cut to the opaque pixels instead.
async function alphaBox(img){
  const {data,info}=await img.clone().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=-1,y1=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return {left:x0,top:y0,width:x1-x0+1,height:y1-y0+1};
}
/**
 * The gato's tag: his letreiro's rows from the top of the tag's ring (2530 of 4163) down, and the pink collar the ring
 * and the bell hang on taken out of the rows above the fish (2850): the gold ring and bell stay, no cut-off collar.
 */
const SO_A_PLACA={'gato-nada-pra-comer':{top:2530,colar:2850,argola:[1170,1680]}};
// Pink (its highlights too): more blue than green, unlike the gold (whose blue is below its green).
const rosa=(r,g,b)=>r-g>40&&b>g&&r>=b;
for(const id of Object.keys(PERFIL)){
  const src=path.join(root,`public/art/menu/letreiro/${id}.webp`);
  if(!existsSync(src)){console.error(`insta-arte: ${id} sem letreiro em public/art/menu/letreiro, logo pulado`);continue;}
  let img=sharp(src);
  const placa=SO_A_PLACA[id];
  if(placa){
    const {data,info}=await img.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=placa.top;y<placa.colar;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*4;if(x<placa.argola[0]||x>placa.argola[1]||rosa(data[i],data[i+1],data[i+2]))data[i+3]=0;}
    img=sharp(await sharp(data,{raw:info}).extract({left:0,top:placa.top,width:info.width,height:info.height-placa.top}).png().toBuffer());
  }
  const box=await alphaBox(img);
  await sharp(await img.extract(box).png().toBuffer()).resize({height:LOGO_H,kernel:'lanczos3'}).webp(WEBP).toFile(out(`logo-${id}.webp`));
}
console.error('insta-arte: public/art/menu/insta/ pronto');
