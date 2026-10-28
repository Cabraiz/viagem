#!/usr/bin/env node
// Recolors only an enemy's shirt to red on every sheet, keeping the frames pixel-for-pixel otherwise
// (card NEW-20261028-ORQ-teste-inimigo-blusa-vermelha). Writes public/art/enemies/<id>-vermelho/.
// Mask: dark blue pixels (the shirt), minus anything near the bright blue shorts, keeping per cell only the
// biggest blob (stray shading on the legs stays as is). The copies the game downloads (lite on the phone, enemies-pc on
// the computer) are recolored the same way from their own files, so they keep their cells and baked shadow.
// Usage: node scripts/recolor-blusa.mjs [id] [--debug]
import {readdir,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const id=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'bebado';
const debug=process.argv.includes('--debug');
const root=path.resolve(import.meta.dirname,'..');
/** The sheet families of an enemy and their cell (art-lite: liteCell 78, pcCell 109). */
const FAMILIES=[['public/art/enemies',128],['public/art/lite/enemies',78],['public/art/lite/enemies-pc',109]];

const SHIRT={hueMin:195,hueMax:265,vMin:.06,vMax:.42,sMin:.12,sMax:.8};
const SHORTS={sMin:.55,vMin:.45};
const SHORTS_PAD=2,MIN_BLOB=12;
const scaled=(n,cell,pow=1)=>Math.max(1,Math.round(n*(cell/128)**pow));
const RED_HUE=356;

function hsv(r,g,b){
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0;
  if(d>0)h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;
  return [(h*60+360)%360,mx?d/mx:0,mx];
}
function rgb(h,s,v){
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c,k=Math.floor(h/60)%6;
  const [r,g,b]=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][k];
  return [(r+m)*255,(g+m)*255,(b+m)*255];
}
const isBlue=h=>h>=SHIRT.hueMin&&h<=SHIRT.hueMax;

/** Mask of the shirt's pixels in an RGBA buffer, cell by cell. */
export function shirtMask(px,w,h,cell){
  const n=w*h,cand=new Uint8Array(n),shorts=new Uint8Array(n);
  for(let i=0;i<n;i++){
    if(px[i*4+3]<16)continue;
    const [hu,s,v]=hsv(px[i*4]/255,px[i*4+1]/255,px[i*4+2]/255);
    if(!isBlue(hu))continue;
    if(s>=SHORTS.sMin&&v>=SHORTS.vMin)shorts[i]=1;
    else if(v>=SHIRT.vMin&&v<=SHIRT.vMax&&s>=SHIRT.sMin&&s<=SHIRT.sMax)cand[i]=1;
  }
  const pad=scaled(SHORTS_PAD,cell),minBlob=scaled(MIN_BLOB,cell,2);
  // Drop candidates next to the shorts (their shaded folds are dark blue too).
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!cand[i])continue;
    out:for(let dy=-pad;dy<=pad;dy++)for(let dx=-pad;dx<=pad;dx++){
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&yy>=0&&xx<w&&yy<h&&shorts[yy*w+xx]){cand[i]=0;break out;}
    }
  }
  // Keep the biggest blob of each cell.
  const mask=new Uint8Array(n),seen=new Uint8Array(n);
  for(let cy=0;cy<h;cy+=cell)for(let cx=0;cx<w;cx+=cell){
    let best=[];
    for(let y=cy;y<cy+cell&&y<h;y++)for(let x=cx;x<cx+cell&&x<w;x++){
      const s0=y*w+x;if(!cand[s0]||seen[s0])continue;
      const blob=[],stack=[s0];seen[s0]=1;
      while(stack.length){
        const i=stack.pop(),ix=i%w,iy=(i-ix)/w;blob.push(i);
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
          const xx=ix+dx,yy=iy+dy;
          if(xx<cx||yy<cy||xx>=cx+cell||yy>=cy+cell||xx>=w||yy>=h)continue;
          const j=yy*w+xx;if(cand[j]&&!seen[j]){seen[j]=1;stack.push(j);}
        }
      }
      if(blob.length>best.length)best=blob;
    }
    if(best.length>=minBlob)for(const i of best)mask[i]=1;
  }
  // Fill the shirt's holes: dark, bluish or grey pixels mostly surrounded by it (its darkest folds).
  for(let pass=0;pass<3;pass++){
    const add=[];
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;if(mask[i]||shorts[i]||px[i*4+3]<16)continue;
      const [hu,s,v]=hsv(px[i*4]/255,px[i*4+1]/255,px[i*4+2]/255);
      if(v>SHIRT.vMax||!(isBlue(hu)||s<.25||hu>265))continue;
      let k=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)k+=mask[i+dy*w+dx];
      if(k>=5)add.push(i);
    }
    if(!add.length)break;
    for(const i of add)mask[i]=1;
  }
  return mask;
}

/** Recolors the masked pixels to red, keeping their shading (value lifted a bit so dark navy reads as red). */
export function recolor(px,mask){
  const out=Buffer.from(px);
  for(let i=0;i<mask.length;i++){
    if(!mask[i])continue;
    const [,s,v]=hsv(px[i*4]/255,px[i*4+1]/255,px[i*4+2]/255);
    const [r,g,b]=rgb(RED_HUE,Math.min(.95,.78+s*.25),Math.min(.97,.32+v*1.7));
    out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;
  }
  return out;
}

for(const [family,cell] of FAMILIES){
  const srcDir=path.join(root,family,id),outDir=path.join(root,family,`${id}-vermelho`);
  if(!existsSync(srcDir))continue;
  const files=(await readdir(srcDir)).filter(f=>f.endsWith('.webp'));
  await mkdir(outDir,{recursive:true});
  for(const f of files){
    const {data,info}=await sharp(path.join(srcDir,f)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    // One-row sheets (sleep, wake) keep their full cell in every family.
    const mask=shirtMask(data,info.width,info.height,info.height<=128?info.height:cell);
    const raw={raw:{width:info.width,height:info.height,channels:4}};
    // The full sheets are lossless like the approved art; the copies are lossy like art-lite's.
    await sharp(recolor(data,mask),raw).webp(cell===128?{lossless:true}:{quality:90,alphaQuality:100}).toFile(path.join(outDir,f));
    if(debug){
      const dbg=Buffer.from(data);
      for(let i=0;i<mask.length;i++)if(mask[i]){dbg[i*4]=255;dbg[i*4+1]=0;dbg[i*4+2]=255;}
      await sharp(dbg,raw).png().toFile(path.join(outDir,`${f}.mask.png`));
    }
    console.log(`${family}/${id}-vermelho/${f}`,`${info.width}x${info.height}`,'shirt px',mask.reduce((a,b)=>a+b,0));
  }
}
