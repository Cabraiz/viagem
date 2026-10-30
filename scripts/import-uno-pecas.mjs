// Card NEW-20261029-ORQ-carro-chaveiro-arte: the 4 parts that fall off the Quadradão (bumper, mirror, door, hood), generated
// by the Codex in the Uno's style (arte-entrada/cenario/base/carro-pecas/pecas.png: green background, 2×2 grid in
// CAR_PARTS order: para-choque, retrovisor / porta, capo). Keys the green out (no fringe), cuts each part by its
// quadrant's opaque box, puts the 4 on one 4×1 sheet of square cells at one scale (they keep their sizes relative to one
// another), each centred. Prints each part's opaque width/height (uno-pecas-art.ts PECAS_SIZES).
// usage: node scripts/import-uno-pecas.mjs <pecas.png> [out=public/art/lite/veiculos/quadradao-pecas.webp] [cell=256]
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const [IN,OUT='public/art/lite/veiculos/quadradao-pecas.webp',CELL='256']=process.argv.slice(2);const C=+CELL;
if(!IN)throw new Error('usage: node scripts/import-uno-pecas.mjs <pecas.png> [out] [cell]');
const {data,info}=await sharp(IN).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let p=0;p<data.length;p+=4){const r=data[p],g=data[p+1],b=data[p+2],grn=g-Math.max(r,b);
  if(grn>110&&g>170)data[p+3]=0;
  else if(grn>30){data[p+3]=Math.min(data[p+3],Math.round(255*(1-(grn-30)/80)));data[p+1]=Math.max(r,b);}}
const W=info.width,H=info.height,hw=Math.floor(W/2),hh=Math.floor(H/2);
const keyed=await sharp(Buffer.from(data),{raw:{width:W,height:H,channels:4}}).png().toBuffer();
const boxes=[];
for(let q=0;q<4;q++){const x0=(q%2)*hw,y0=Math.floor(q/2)*hh;let l=W,r=-1,t=H,b=-1;
  for(let y=y0;y<y0+hh;y++)for(let x=x0;x<x0+hw;x++)if(data[(y*W+x)*4+3]>60){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y;}
  if(r<0)throw new Error(`quadrant ${q}: no part`);
  boxes.push({l,t,w:r-l+1,h:b-t+1});}
const scale=Math.min(...boxes.map(o=>(C*.94)/Math.max(o.w,o.h))),comp=[],parts=[];
const names=['para-choque','retrovisor','porta','capo'];
for(const [k,o] of boxes.entries()){const sw=Math.max(1,Math.round(o.w*scale)),sh=Math.max(1,Math.round(o.h*scale));
  const piece=await sharp(keyed).extract({left:o.l,top:o.t,width:o.w,height:o.h}).resize(sw,sh,{kernel:'lanczos3'}).png().toBuffer();
  comp.push({input:piece,left:k*C+Math.round((C-sw)/2),top:Math.round((C-sh)/2)});parts.push({part:names[k],w:sw,h:sh});}
mkdirSync(dirname(OUT),{recursive:true});
await sharp({create:{width:4*C,height:C,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(comp).webp({quality:88,alphaQuality:100,effort:6}).toFile(OUT);
console.log(JSON.stringify({cell:C,parts}));
