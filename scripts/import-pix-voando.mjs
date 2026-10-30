#!/usr/bin/env node
/**
 * NEW-20261029-ORQ-bico-sem-limite-pix-voando: the money that flies around a hero on a bico (render/bancos/pix.ts) is
 * ONE painting (ChatGPT via Codex, the stickers' cartoon look), not shapes drawn in code: on flat magenta, row 1 holds
 * three green R$ notes (flat, bent, folded) and row 2 the teal PIX diamond and the "+R$ 5" pop. This script keys the
 * magenta out (despilled edge), finds each piece in its slot of the layout and writes
 *   public/art/fx/pix-voando.webp  four square frames: nota, nota curvada, nota dobrada, losango PIX (BIT_FRAMES);
 *   public/art/fx/pix-mais5.webp   the "+R$ 5" label.
 * Each piece fills its frame less the padding, centred. Already light for the phone (no copy under public/art/lite/).
 *
 *   node scripts/import-pix-voando.mjs folha.png
 */
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const sharp=createRequire(import.meta.url)('sharp');
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
/** Side of one bit frame, the bit frames, and the label's size (px). */
export const BIT_FRAME=96,BIT_FRAMES=4,LABEL_W=192,LABEL_H=96;
const PAD=4;
/** Slots of the painting, as fractions of it: [left, top, right, bottom]. */
const SLOTS=[[0,0,.362,.5],[.362,0,.72,.5],[.72,0,1,.5],[0,.5,.45,1],[.45,.5,1,1]];

/**
 * Magenta key for one RGBA buffer, in place: min(r,b) − g over 90 is background, under 40 is the piece, a ramp between,
 * and the magenta spill on the ramp is pulled down to g (no pink halo).
 */
export function keyMagenta(data){
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],k=Math.min(r,b)-g;
    const a=k>=90?0:k<=40?1:(90-k)/50;
    if(k>0){data[i]=r-k;data[i+2]=b-k;}
    data[i+3]=Math.round(a*255);
  }
  return data;
}

/** Bounding box of alpha > 24 inside [x0,x1)×[y0,y1) of a w-wide RGBA buffer, or undefined. */
export function bbox(data,w,x0,y0,x1,y1){
  let bx0=x1,by0=y1,bx1=-1,by1=-1;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(data[(y*w+x)*4+3]>24){if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y;}
  return bx1<0?undefined:{x0:bx0,y0:by0,x1:bx1+1,y1:by1+1};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [file]=process.argv.slice(2);
  if(!file){console.error('uso: node scripts/import-pix-voando.mjs folha.png');process.exit(2);}
  const {data,info}=await sharp(file).removeAlpha().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  keyMagenta(data);
  const W=info.width,H=info.height,raw={raw:{width:W,height:H,channels:4}};
  const piece=async(n,fw,fh)=>{
    const [l,t,r,b]=SLOTS[n],box=bbox(data,W,Math.round(l*W),Math.round(t*H),Math.round(r*W),Math.round(b*H));
    if(!box)throw new Error(`peça ${n+1}: nada no lugar dela`);
    return sharp(data,raw).extract({left:box.x0,top:box.y0,width:box.x1-box.x0,height:box.y1-box.y0})
      .resize(fw-2*PAD,fh-2*PAD,{fit:'contain',kernel:'lanczos3',background:{r:0,g:0,b:0,alpha:0}})
      .extend({top:PAD,bottom:PAD,left:PAD,right:PAD,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  };
  const webp={quality:85,alphaQuality:90,effort:6};
  const comp=[];
  for(let n=0;n<BIT_FRAMES;n++)comp.push({input:await piece(n,BIT_FRAME,BIT_FRAME),left:n*BIT_FRAME,top:0});
  const bits=join(ROOT,'public/art/fx/pix-voando.webp'),label=join(ROOT,'public/art/fx/pix-mais5.webp');
  await sharp({create:{width:BIT_FRAME*BIT_FRAMES,height:BIT_FRAME,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(comp).webp(webp).toFile(bits);
  await sharp(await piece(4,LABEL_W,LABEL_H)).webp(webp).toFile(label);
  console.log(`${bits}: ${BIT_FRAMES} quadros de ${BIT_FRAME}×${BIT_FRAME}\n${label}: ${LABEL_W}×${LABEL_H}`);
}
