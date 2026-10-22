#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: the stride of every enemy walk sheet (public/art/enemies), on the side
 * rows (W = row 2, E = row 6 of the 8-direction sheets: the travel lies across the screen, no foreshortening), three
 * ways, in heights of the figure per walk cycle (the mean of W and E):
 *  - `volta` (back travel): frames i and i+1 matched in the feet band (the lowest ~14 % of the figure), the shift that
 *    best lays one on the other is the planted foot's travel in that step, summed over the cycle. Either way, so the
 *    drawing's frame-to-frame jitter cancels out: the foot's real travel. A foot locked to the ground needs it.
 *  - `heroi`: the same, but only shifts going back count (scripts/passada.mjs, the hero's method): on these walks,
 *    drawn almost in place, the jitter adds up as travel, so it reads several times `volta`.
 *  - `visivel` (visible step): how far the feet open (widest minus narrowest span of the lowest 6 % of the figure) times
 *    the steps a cycle (the narrowest moments, 1 or 2): the step the eye reads from the legs. The client walks the
 *    sheet by the ground covered with it (art/enemy-strides.ts), since `volta` is ~0 on almost every sheet.
 *
 *   node scripts/passada-inimigos.mjs            # table per enemy
 *   node scripts/passada-inimigos.mjs --json f   # also writes the table as JSON
 *   node scripts/passada-inimigos.mjs --ts       # writes src/client/art/enemy-strides.ts (the client's table)
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(ROOT,'package.json'))('sharp');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8'));
const group=manifest.groups.inimigos,pieces=group.pieces??group;
const ROWS={W:{row:2,ux:-1},E:{row:6,ux:1}};

/** Alpha masks (alpha > 128) of row `row`'s frames of a walk file. */
async function masks(file,row){
  const [cw,ch]=file.cell,n=file.frames,out=[];
  const cache=new Map();
  for(let i=0;i<n;i++){
    const g=row*n+i;const page=file.pages.find(p=>g>=p.firstFrame&&g<p.firstFrame+p.frameCount);const l=g-page.firstFrame;
    let img=cache.get(page.file);
    if(!img){img=await sharp(path.join(ROOT,group.output??'public/art/enemies',page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});cache.set(page.file,img);}
    const c=l%page.columns,r=Math.floor(l/page.columns),a=new Uint8Array(cw*ch);
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)a[y*cw+x]=img.data[((r*ch+y)*img.info.width+c*cw+x)*4+3]>128?1:0;
    out.push(a);
  }
  return out;
}
/** One side row: {height px, volta, heroi, visivel} in heights per cycle. */
async function rowStride(file,{row,ux}){
  const [cw,ch]=file.cell,n=file.frames,M=await masks(file,row);
  const box=M.map(a=>{let t=ch,b=-1;for(let j=0;j<a.length;j++)if(a[j]){const y=Math.floor(j/cw);if(y<t)t=y;b=y;}return {t,b};});
  const bottom=Math.max(...box.map(q=>q.b)),height=bottom-Math.min(...box.map(q=>q.t))+1;
  const top=bottom-Math.max(4,Math.round(height*.14)),R=Math.max(4,Math.round(cw*.08));
  let volta=0,heroi=0;
  for(let i=0;i<n;i++){
    const A=M[i],B=M[(i+1)%n];let best=-1,back=0,bestB=-1,backB=0;
    for(let sy=-3;sy<=3;sy++)for(let sx=-R;sx<=R;sx++){
      let s=0;for(let y=top;y<=bottom;y++)for(let x=0;x<cw;x++){if(!A[y*cw+x])continue;const X=x+sx,Y=y+sy;if(X>=0&&X<cw&&Y>=0&&Y<ch&&B[Y*cw+X])s++;}
      const b=-sx*ux;
      if(s>best||(s===best&&Math.abs(b)<Math.abs(back))){best=s;back=b;}
      if(b>=0&&(s>bestB||(s===bestB&&b<backB))){bestB=s;backB=b;}
    }
    volta+=back;heroi+=backB;
  }
  // Feet span per frame (lowest 6 % of each frame's own figure) and the steps: its local minima over the cycle.
  const spans=M.map((a,i)=>{const h=box[i].b-box[i].t+1,band=Math.max(3,Math.round(h*.06));let L=cw,Rx=-1;
    for(let y=box[i].b-band;y<=box[i].b;y++)for(let x=0;x<cw;x++)if(a[y*cw+x]){if(x<L)L=x;if(x>Rx)Rx=x;}return Rx-L+1;});
  let mins=0;for(let i=0;i<n;i++){const a=spans[(i+n-1)%n],b=spans[i],c=spans[(i+1)%n];if(b<a&&b<=c)mins++;}
  const steps=Math.max(1,Math.min(2,mins));
  return {height,volta:volta/height,heroi:heroi/height,visivel:(Math.max(...spans)-Math.min(...spans))*steps/height};
}

const rows=[];
for(const [id,piece] of Object.entries(pieces)){
  const file=piece.files?.walk;if(!file)continue;
  const W=await rowStride(file,ROWS.W),E=await rowStride(file,ROWS.E),m=k=>+((W[k]+E[k])/2).toFixed(3);
  rows.push({id,frames:file.frames,fps:file.fps,cell:file.cell[0],volta:m('volta'),heroi:m('heroi'),visivel:m('visivel')});
}
for(const r of rows)console.log(`${r.id.padEnd(28)} ${r.frames}f ${String(r.fps).padStart(2)}fps cell ${String(r.cell).padStart(3)}  volta ${r.volta.toFixed(2).padStart(5)}  heroi ${r.heroi.toFixed(2)}  visivel ${r.visivel.toFixed(2)}`);
const med=k=>{const s=rows.map(r=>r[k]).sort((a,b)=>a-b),i=s.length>>1;return (s.length%2?s[i]:(s[i-1]+s[i])/2).toFixed(2);};
console.log(`median over ${rows.length} walks: volta ${med('volta')}, heroi ${med('heroi')}, visivel ${med('visivel')} heights per cycle`);
const j=process.argv.indexOf('--json');if(j>0)fs.writeFileSync(process.argv[j+1],JSON.stringify(rows,null,1));
if(process.argv.includes('--ts')){
  const body=rows.map(r=>`  '${r.id}':${r.visivel},`).join('\n');
  fs.writeFileSync(path.join(ROOT,'src/client/art/enemy-strides.ts'),`// Generated by scripts/passada-inimigos.mjs from public/art/manifest.json: do not edit by hand.
// Per enemy art id with a walk sheet, its visible step: how far the feet open in one walk cycle (widest minus narrowest
// span, times the steps a cycle), in heights of the figure, the mean of the W and E rows. art/horde-art.ts walks the
// sheet by the ground covered with it.
export const ENEMY_STRIDES:Readonly<Record<string,number>>=Object.freeze({
${body}
});
`);
}
