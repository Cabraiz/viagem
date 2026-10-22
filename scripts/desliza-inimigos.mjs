#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: the planted foot's slide per enemy, from a log of scripts/pes-inimigos-jogo.mjs
 * (per rendered frame: screen point, sheet frame, scale) and the drawn strides of scripts/passada-inimigos.mjs.
 * For every frame of the walk sheet the figure holds, the planted foot should stay on the ground: it moves with the
 * figure while the frame holds and comes back by the drawn travel of one frame (stride × figure ÷ frames) when the
 * next frame shows. Its slide in that frame = |ground the figure walked on screen − that drawn travel|. Also the
 * cadence (cycles/s) against the speed on screen, and the cadence that would lock the foot.
 *
 *   node scripts/desliza-inimigos.mjs <log.json> <passada.json> [--md out.md]
 */
import fs from 'node:fs';
const [logFile,strideFile]=process.argv.slice(2);
const log=JSON.parse(fs.readFileSync(logFile,'utf8')),strides=Object.fromEntries(JSON.parse(fs.readFileSync(strideFile,'utf8')).map(r=>[r.id,r]));
const manifest=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces;
const feetSrc=fs.readFileSync('src/client/art/enemy-feet.ts','utf8'),FEET={};
for(const m of feetSrc.matchAll(/'([^']+)':\{from:'(\w+)',feetY:([\d.]+),footW:[\d.]+,figureH:([\d.]+)/g))FEET[m[1]]={from:m[2],figureH:+m[4]};
const by=new Map();
for(const r of log.rows){const [t,id,art,kind,wx,wy,sx,sy,key,frame,scale,moving]=r;if(!key.includes(':walk'))continue;(by.get(id)??by.set(id,[]).get(id)).push({t,art,sx,sy,frame,scale,moving});}
const out=[];
for(const [id,rows] of by){
  if(rows.length<30)continue;const art=rows[0].art,walk=manifest[art]?.files.walk;if(!walk)continue;
  const n=walk.frames,figure=rows[0].scale*(FEET[art]?.figureH??.7)*walk.cell[1],stride=strides[art]?.stride;
  let path=0,changes=0,holds=[],ground=0,start=rows[0].t;
  for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];const d=Math.hypot(b.sx-a.sx,b.sy-a.sy);path+=d;ground+=d;
    if(b.frame!==a.frame){changes++;holds.push(ground);ground=0;}}
  const secs=(rows.at(-1).t-start)/1000,speed=path/secs,cps=changes/n/secs;
  const step=stride*figure/n,slides=holds.slice(1).map(g=>Math.abs(g-step)).sort((a,b)=>a-b);
  const med=slides.length?slides[slides.length>>1]:NaN,p90=slides.length?slides[Math.floor(slides.length*.9)]:NaN;
  out.push({id,art,secs,figure,speed,cps,need:speed/(stride*figure),stride,slideMed:med,slide90:p90,perCycle:speed/Math.max(cps,1e-6)-stride*figure});
}
out.sort((a,b)=>a.art.localeCompare(b.art));
const lines=['| inimigo | figura px | vel. px/s | ciclos/s hoje | ciclos/s p/ travar | passada (alturas) | deslize/quadro mediana px | p90 px | deslize/ciclo px |','|---|---|---|---|---|---|---|---|---|'];
for(const o of out)lines.push(`| ${o.art} | ${o.figure.toFixed(0)} | ${o.speed.toFixed(0)} | ${o.cps.toFixed(2)} | ${o.need.toFixed(2)} | ${o.stride.toFixed(2)} | ${o.slideMed.toFixed(1)} | ${o.slide90.toFixed(1)} | ${o.perCycle.toFixed(0)} |`);
console.log(lines.join('\n'));
const i=process.argv.indexOf('--md');if(i>0)fs.writeFileSync(process.argv[i+1],lines.join('\n')+'\n');
