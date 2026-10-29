/**
 * Card muitas-luzes: the ChatGPT halo sheet (evidence/NEW-20261029-ORQ-muitas-luzes/halos-1.png, six glows on black
 * in a 3x2 grid) to public/art/luzes/halos.webp, one 768x512 atlas of 256 px frames drawn ADD (render/luzes/). The
 * near-black floor is cut (an ADD quad would lift it into a faint square) and the glow goes to colour on alpha.
 *
 *   node scripts/import-luzes.mjs [sheet.png]
 */
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';

const SRC=process.argv[2]??'D:/Gits/viagem-board/evidence/NEW-20261029-ORQ-muitas-luzes/halos-1.png';
const OUT='public/art/luzes/halos.webp',CELL=256,COLS=3,ROWS=2,FLOOR=8;

const {data,info}=await sharp(SRC).removeAlpha().resize(CELL*COLS,CELL*ROWS,{kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
const out=Buffer.alloc(info.width*info.height*4);
for(let p=0;p<info.width*info.height;p++){
  const r=data[p*3],g=data[p*3+1],b=data[p*3+2],m=Math.max(r,g,b);
  const x=p%info.width,y=(p/info.width)|0,cx=x%CELL,cy=y%CELL,edge=Math.min(cx,cy,CELL-1-cx,CELL-1-cy);
  // Alpha = brightness over the floor, 0 on the frame's last 2 px (no bleed between frames when filtered).
  const a=edge<2?0:Math.max(0,Math.min(255,Math.round((m-FLOOR)*255/(255-FLOOR))));
  const k=m>0?255/m:0;
  out[p*4]=Math.round(r*k);out[p*4+1]=Math.round(g*k);out[p*4+2]=Math.round(b*k);out[p*4+3]=a;
}
mkdirSync('public/art/luzes',{recursive:true});
await sharp(out,{raw:{width:info.width,height:info.height,channels:4}}).webp({quality:88,alphaQuality:90}).toFile(OUT);
console.log(`${OUT} ${info.width}x${info.height}`);
