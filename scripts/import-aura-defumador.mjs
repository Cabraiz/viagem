#!/usr/bin/env node
/**
 * BUG-20261022-ORQ-circulo-roxo: the Defumador's aura is painted smoke (ChatGPT via Codex, Myth look), not a purple
 * ellipse. The paintings are the ring of incense smoke seen by the game's camera (an ellipse twice as wide as tall) on
 * flat black; this script lifts each one off the black (alpha from the brightest channel, colour un-premultiplied),
 * fades whatever reaches the canvas edge, and packs them side by side as the frames of one small lossy WebP (already
 * the lite size: no copy under public/art/lite/). The client (render/aura-ring.ts) cross-fades the frames.
 *
 *   node scripts/import-aura-defumador.mjs a.png b.png [more.png…]   → public/art/fx/aura-defumador.webp
 */
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const sharp=createRequire(import.meta.url)('sharp');
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
/** One frame's size (2:1, the ground ellipse) and where the strip goes. */
export const FRAME_W=512,FRAME_H=256;
const OUT=join(ROOT,'public/art/fx/aura-defumador.webp');
/** The channel value read as fully opaque smoke (the paintings never reach white). */
const OPAQUE=.42;
/** Brightness kept by the grey smoke (saturated embers keep all of theirs). */
const SMOKE_SHADE=.6;

/** Alpha from black for one RGBA buffer, in place: un-premultiplied colour, and zero at the ellipse that fits the frame. */
export function liftFromBlack(data,w,h){
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,m=Math.max(r,g,b);
    const ex=(x+.5)/w*2-1,ey=(y+.5)/h*2-1,d=Math.hypot(ex,ey);
    const edge=d>=1?0:d<=.86?1:(1-d)/.14;
    // The painting is smoke × lift over black. Grey smoke is darkened (it has to read on the snow), embers keep their glow.
    const lift=Math.min(1,m/OPAQUE),sat=m>1e-4?(m-Math.min(r,g,b))/m:0,un=lift>1e-4?(SMOKE_SHADE+(1-SMOKE_SHADE)*sat)/lift:0;
    data[i]=Math.round(Math.min(1,r*un)*255);data[i+1]=Math.round(Math.min(1,g*un)*255);data[i+2]=Math.round(Math.min(1,b*un)*255);
    data[i+3]=Math.round(lift*edge*edge*(3-2*edge)*255);
  }
  return data;
}

async function frame(file){
  const {data,info}=await sharp(file).removeAlpha().resize(FRAME_W,FRAME_H,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return liftFromBlack(data,info.width,info.height);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const files=process.argv.slice(2);
  if(!files.length){console.error('uso: node scripts/import-aura-defumador.mjs a.png b.png');process.exit(2);}
  const strip=Buffer.alloc(FRAME_W*files.length*FRAME_H*4);
  for(const [n,f] of files.entries()){
    const one=await frame(f);
    for(let y=0;y<FRAME_H;y++)one.copy(strip,((y*files.length*FRAME_W)+n*FRAME_W)*4,y*FRAME_W*4,(y+1)*FRAME_W*4);
  }
  await sharp(strip,{raw:{width:FRAME_W*files.length,height:FRAME_H,channels:4}}).webp({quality:72,alphaQuality:70,effort:6}).toFile(OUT);
  console.log(`${OUT}: ${files.length} quadros de ${FRAME_W}×${FRAME_H}`);
}
