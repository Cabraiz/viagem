#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: the table per enemy walk sheet. From scripts/passada-inimigos.mjs
 * (--json) and the sheets themselves:
 *  - cadence (walk cycles a second) today (the clock: the file's fps × ENEMY_ANIM_RATE ÷ frames) and after (the ground:
 *    PACE ÷ its visible step, PACE being the bêbado's pace measured in the city, in figure heights a second), and the
 *    drift of the planted foot per cycle at that pace, both ways (ground per cycle − the foot's real travel `volta`);
 *  - the loop seam: on every row, the distance (1 − IoU of the figures, feet on the same spot) from the last frame back
 *    to the first, over the median distance between neighbouring frames; ≤ SEAM_MAX (or under SEAM_FLOOR) passes;
 *  - the proportion, walk against the idle's first frame of the same row: height (±4 %) and √area (±6 %), medians.
 *
 *   node scripts/tabela-andar-inimigos.mjs <passadas.json> [--md out.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(ROOT,'package.json'))('sharp');
const group=JSON.parse(fs.readFileSync(path.join(ROOT,'public/art/manifest.json'),'utf8')).groups.inimigos,pieces=group.pieces;
const strides=Object.fromEntries(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).map(r=>[r.id,r]));
const PACE=.35,RATE=.7,STRIDE_MIN=.3,MAX_CPS=3,SEAM_MAX=1.2,SEAM_FLOOR=.08,TOL={height:.04,area:.06};
const images=new Map();
async function frame(file,g){
  const page=file.pages.find(p=>g>=p.firstFrame&&g<p.firstFrame+p.frameCount),l=g-page.firstFrame,[cw,ch]=file.cell;
  let img=images.get(page.file);if(!img){img=await sharp(path.join(ROOT,group.output??'public/art/enemies',page.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});images.set(page.file,img);}
  const c=l%page.columns,r=Math.floor(l/page.columns),a=new Uint8Array(cw*ch);let top=ch,bottom=-1,left=cw,right=-1,area=0;
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(img.data[((r*ch+y)*img.info.width+c*cw+x)*4+3]>128){a[y*cw+x]=1;area++;if(y<top)top=y;bottom=y;if(x<left)left=x;if(x>right)right=x;}
  return {a,cw,ch,top,bottom,cx:Math.round((left+right)/2),area,h:bottom-top+1};
}
/** 1 − IoU of two figures with their feet (bottom row, middle column) on the same spot. */
function dist(A,B){
  const dx=B.cx-A.cx,dy=B.bottom-A.bottom;let inter=0;
  for(let y=0;y<A.ch;y++)for(let x=0;x<A.cw;x++)if(A.a[y*A.cw+x]){const X=x+dx,Y=y+dy;if(X>=0&&X<B.cw&&Y>=0&&Y<B.ch&&B.a[Y*B.cw+X])inter++;}
  return 1-inter/(A.area+B.area-inter||1);
}
const med=v=>{const s=[...v].sort((a,b)=>a-b);return s[s.length>>1];};
const rows=[];
for(const [id,piece] of Object.entries(pieces)){
  const walk=piece.files.walk;if(!walk)continue;const idle=piece.files.idle,n=walk.frames,dirs=walk.directions??1,st=strides[id];
  const seams=[],heights=[],areas=[];
  for(let r=0;r<dirs;r++){
    const F=[];for(let i=0;i<n;i++)F.push(await frame(walk,r*n+i));
    const d=F.map((f,i)=>dist(f,F[(i+1)%n])),seam=d[n-1],m=med(d.slice(0,n-1));
    seams.push(seam<=SEAM_FLOOR?0:seam/Math.max(m,1e-6));
    if(idle&&idle.cell[1]===walk.cell[1]){const I=await frame(idle,r*(idle.frames??1));heights.push(med(F.map(f=>f.h))/I.h);areas.push(Math.sqrt(med(F.map(f=>f.area))/I.area));}
  }
  const cpsToday=(walk.fps??8)*RATE/n,step=Math.max(STRIDE_MIN,st.visivel),cpsAfter=Math.min(MAX_CPS,PACE/step);
  const seam=Math.max(...seams),height=heights.length?med(heights):NaN,area=areas.length?med(areas):NaN;
  const fails=[];
  if(st.volta<.15)fails.push('andar no lugar');
  if(seam>SEAM_MAX)fails.push('emenda');
  if(Math.abs(height-1)>TOL.height)fails.push('altura');
  if(Math.abs(area-1)>TOL.area)fails.push('área');
  rows.push({id,n,fps:walk.fps,cpsToday,cpsAfter,volta:st.volta,heroi:st.heroi,visivel:st.visivel,
    driftToday:PACE/cpsToday-st.volta,driftAfter:PACE/cpsAfter-st.volta,seam,height,area,fails});
}
const f=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—',pc=v=>Number.isFinite(v)?`${v>=1?'+':''}${((v-1)*100).toFixed(0)}%`:'—';
const lines=[
  `Ritmo do jogo: ${PACE} altura da figura por segundo (o bêbado medido na cidade). Deriva = chão por ciclo − volta real do pé, em % da altura da figura (100 % = a figura inteira).`,'',
  '| inimigo | quadros | ciclos/s hoje | ciclos/s depois | volta real do pé | passada visível | deriva/ciclo hoje | deriva/ciclo depois | emenda n→1 | altura andar/parado | área | reprovado em |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for(const r of rows)lines.push(`| ${r.id} | ${r.n} | ${f(r.cpsToday)} | ${f(r.cpsAfter)} | ${f(r.volta)} | ${f(r.visivel)} | ${f(r.driftToday*100,0)}% | ${f(r.driftAfter*100,0)}% | ${f(r.seam,1)}× | ${pc(r.height)} | ${pc(r.area)} | ${r.fails.join(', ')||'—'} |`);
const count=k=>rows.filter(r=>r.fails.includes(k)).length;
lines.push('',`${rows.length} folhas de andar: andar no lugar (volta < 0,15) ${count('andar no lugar')}; emenda > ${SEAM_MAX}× ${count('emenda')}; altura fora de ±4 % ${count('altura')}; área fora de ±6 % ${count('área')}.`);
console.log(lines.slice(-1)[0]);
const i=process.argv.indexOf('--md');if(i>0)fs.writeFileSync(process.argv[i+1],lines.join('\n')+'\n');
