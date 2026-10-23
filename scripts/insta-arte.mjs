// The phone's upright hero pick as an Instagram profile (NEW-20261023-ORQ-selecao-mobile-instagram): the Codex art of
// steps 1-2 (E5, viagem-board/evidence/<ID>/gerar) as WebPs at twice the CSS size the screen shows them (DPR 2) under
// public/art/menu/insta/, q95; scripts/art-lite.mjs (MENU_LITE `insta/`) makes the lossy copies the page loads.
//   - perfil-<hero>.webp: the profile photo chosen in the README (one per hero), a square, 360 px (165 CSS px at most);
//     the stories' circles show the same file;
//   - grade-<hero>-<1..3>.webp: the 3 grid photos, cut in the middle to the reference's cell (228x262, folha-8), 272x312;
//   - icone-<name>.webp: the icons on the chroma green, keyed out (despilled edge), 96 px on their longer side;
//   - logo.webp: the viciado's letreiro (public/art/menu/letreiro) trimmed, 240 px wide (103 CSS px in the top bar).
//   node scripts/insta-arte.mjs [--evidence D:/Gits/viagem-board/evidence/NEW-20261023-ORQ-selecao-mobile-instagram/gerar]
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
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
const PERFIL={'viciado-em-bet':['viciado',1],'clt-cansado':['clt',1],'gato-nada-pra-comer':['gato',1],'maromba':['maromba',4]};
const PERFIL_PX=360,GRADE=[272,312];

for(const [id,[name,option]] of Object.entries(PERFIL)){
  const src=path.join(gerar,'recorte',`perfil-${name}-${option}.png`),{width,height}=await sharp(src).metadata(),side=Math.min(width,height);
  await sharp(src).extract({left:Math.floor((width-side)/2),top:Math.floor((height-side)/2),width:side,height:side})
    .resize(PERFIL_PX,PERFIL_PX,{kernel:'lanczos3'}).webp(WEBP).toFile(out(`perfil-${id}.webp`));
  for(let i=1;i<=3;i++){
    const g=path.join(gerar,'recorte',`grade-${name}-${i}.png`);
    await sharp(g).resize(GRADE[0],GRADE[1],{fit:'cover',position:'centre',kernel:'lanczos3'}).webp(WEBP).toFile(out(`grade-${id}-${i}.webp`));
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

await sharp(path.join(root,'public/art/menu/letreiro/viciado-em-bet.webp')).trim({threshold:1}).resize({width:240,kernel:'lanczos3'}).webp(WEBP).toFile(out('logo.webp'));
console.error('insta-arte: public/art/menu/insta/ pronto');
