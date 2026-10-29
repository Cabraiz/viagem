#!/usr/bin/env node
/**
 * NEW-20261029-ORQ-aura-defumador-fumaca: the Defumador's aura is a ring of incense puffs rising around the hero
 * (render/aura-ring.ts), each puff living through the frames of ONE painting (ChatGPT via Codex, the attack effects'
 * cartoon look): a 3×2 grid of the puff's life (birth, growing, full, swelling, breaking up, vanishing) on flat green.
 * This script keys the green out (despilled edge), finds each puff, and packs the six side by side as square frames of
 * one small WebP at a common scale (the puff grows from frame to frame), each centred on its puff. Already light for the
 * phone (no copy under public/art/lite/).
 *
 *   node scripts/import-aura-defumador.mjs folha.png   → public/art/fx/aura-defumador.webp
 */
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const sharp=createRequire(import.meta.url)('sharp');
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
/** One frame's side (px), the frames of the sheet and where it goes. */
export const FRAME=160,FRAMES=6;
const COLS=3,ROWS=2,PAD=6;
const OUT=join(ROOT,'public/art/fx/aura-defumador.webp');

/**
 * Green key for one RGBA buffer, in place: g − max(r,b) over 90 is background, under 40 is smoke, a ramp between, and
 * the green spill on the ramp is pulled down to max(r,b) (no green halo on the snow).
 */
export function keyGreen(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],k=g-Math.max(r,b);
    const a=k>=90?0:k<=40?1:(90-k)/50;
    if(k>0)data[i+1]=Math.max(r,b);
    data[i+3]=Math.round(a*255);
  }
  return data;
}

/** Bounding box of alpha > 24 in a w×h RGBA buffer, or undefined. */
export function bbox(data,w,h){
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>24){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return x1<0?undefined:{x0,y0,x1,y1};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [file]=process.argv.slice(2);
  if(!file){console.error('uso: node scripts/import-aura-defumador.mjs folha.png');process.exit(2);}
  const {data,info}=await sharp(file).removeAlpha().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  keyGreen(data);
  const W=info.width,H=info.height,cw=W/COLS,ch=H/ROWS,cells=[];
  for(let n=0;n<FRAMES;n++){
    const left=Math.round((n%COLS)*cw),top=Math.round(Math.floor(n/COLS)*ch),w=Math.round((n%COLS+1)*cw)-left,h=Math.round((Math.floor(n/COLS)+1)*ch)-top;
    const cell=Buffer.alloc(w*h*4);
    for(let y=0;y<h;y++)data.copy(cell,y*w*4,((top+y)*W+left)*4,((top+y)*W+left+w)*4);
    const box=bbox(cell,w,h);
    if(!box)throw new Error(`quadro ${n+1}: nenhum puff na célula`);
    cells.push({cell,w,h,box});
  }
  // One scale for all: the biggest puff fills the frame less the padding.
  const side=Math.max(...cells.map(({box})=>Math.max(box.x1-box.x0+1,box.y1-box.y0+1)));
  const scale=(FRAME-2*PAD)/side,comp=[];
  for(const [n,{cell,w,h,box}] of cells.entries()){
    const cx=(box.x0+box.x1+1)/2,cy=(box.y0+box.y1+1)/2,half=side/2+PAD/scale;
    // The square around the puff's centre (clamped to the cell; transparent outside).
    const sx=Math.round(cx-half),sy=Math.round(cy-half),S=Math.round(2*half),sq=Buffer.alloc(S*S*4);
    for(let y=0;y<S;y++)for(let x=0;x<S;x++){
      const ux=sx+x,uy=sy+y;if(ux<0||uy<0||ux>=w||uy>=h)continue;
      cell.copy(sq,(y*S+x)*4,(uy*w+ux)*4,(uy*w+ux)*4+4);
    }
    const img=await sharp(sq,{raw:{width:S,height:S,channels:4}}).resize(FRAME,FRAME,{kernel:'lanczos3'}).png().toBuffer();
    comp.push({input:img,left:n*FRAME,top:0});
  }
  await sharp({create:{width:FRAME*FRAMES,height:FRAME,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(comp).webp({quality:80,alphaQuality:85,effort:6}).toFile(OUT);
  console.log(`${OUT}: ${FRAMES} quadros de ${FRAME}×${FRAME}`);
}
