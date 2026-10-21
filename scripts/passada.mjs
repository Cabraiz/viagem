#!/usr/bin/env node
/**
 * Card NEW-20261021-ORQ-passo-sem-deslizar: the drawn stride of the detailed hero walks (sprite-motion WALK_STRIDE).
 * For each side walk (W/E: the travel lies across the screen, no foreshortening), frames i and i+k (16 samples a cycle)
 * are matched in the feet band (the lowest ~14% of the figure): the 2D shift that best lays one on the other, among the
 * shifts going back (the planted foot stays on the ground while the body goes on), is the foot's travel in that step.
 * The sum over the cycle, over the clip's height, is the stride in heights per cycle.
 *
 *   node scripts/passada.mjs     # per clip, then the median
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(ROOT,'package.json'))('sharp');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8'));
const pieces=manifest.groups.personagens.pieces??manifest.groups.personagens;
const CELL=96,strides=[];
for(const [id,piece] of Object.entries(pieces)){
  const m16=!!piece.files?.['walk16-S'];
  for(const [name,f] of Object.entries(piece.files??{})){
    const m=/^walk(16|128)-([WE])$/.exec(name);
    if(!m||(m[1]==='128')===m16||f.cell?.[0]!==CELL)continue;
    const page=f.pages[0],n=f.frames,ux=m[2]==='W'?-1:1;
    const {data,info}=await sharp(path.join(ROOT,'public/art/sprites',page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const masks=[...Array(n)].map((_,i)=>{const c=i%page.columns,r=Math.floor(i/page.columns),a=new Uint8Array(CELL*CELL);
      for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++)a[y*CELL+x]=data[((r*CELL+y)*info.width+c*CELL+x)*4+3]>128?1:0;return a;});
    let bottom=0;for(const a of masks)for(let j=a.length-1;j>=0;j--)if(a[j]){bottom=Math.max(bottom,Math.floor(j/CELL));break;}
    const top=bottom-Math.max(6,Math.round(f.height*.14)),k=n/16;let travel=0;
    for(let i=0;i<n;i+=k){
      const A=masks[i],B=masks[(i+k)%n];let best=-1,back=0;
      for(let sy=-6;sy<=6;sy++)for(let sx=-6;sx<=6;sx++){
        if(-sx*ux<.5)continue;
        let s=0;for(let y=top;y<=bottom;y++)for(let x=0;x<CELL;x++){if(!A[y*CELL+x])continue;const X=x+sx,Y=y+sy;if(X>=0&&X<CELL&&Y>=0&&Y<CELL&&B[Y*CELL+X])s++;}
        if(s>best){best=s;back=-sx*ux;}
      }
      travel+=back;
    }
    const stride=travel/f.height;strides.push(stride);
    console.log(`${id.padEnd(20)} ${name.padEnd(10)} travel ${String(travel).padStart(3)} px / height ${f.height} = ${stride.toFixed(2)}`);
  }
}
const s=[...strides].sort((a,b)=>a-b),mid=s.length>>1;
console.log(`median stride: ${(s.length%2?s[mid]:(s[mid-1]+s[mid])/2).toFixed(2)} heights per cycle over ${s.length} side walks`);
