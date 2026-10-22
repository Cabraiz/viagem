#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar: do the legs keep pace with the ground? From a frame-by-frame log of
 * scripts/pes-inimigos-sandbox.mjs (walkers slowing down to a stop at each end of their lane), per enemy: the walk
 * cycles the legs make per figure height walked, at full pace (over 75 % of its top speed on screen) and slowed down
 * (under 35 %). Legs that follow the ground give the same number both ways; legs on the clock (the game of before)
 * make several times more steps per height when slowed: the "animação rápida" of a crowd.
 *
 *   node scripts/pernas-por-chao.mjs <log.json> [--md out.md]
 */
import fs from 'node:fs';
const log=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pieces=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces;
const by=new Map();for(const r of log.rows)(by.get(r[1])??by.set(r[1],[]).get(r[1])).push(r);
const out=[];
for(const [,rows] of by){
  const art=rows[0][2],walk=pieces[art].files.walk,n=walk.frames;
  const speeds=rows.slice(1).map((r,i)=>Math.hypot(r[6]-rows[i][6],r[7]-rows[i][7])),top=Math.max(...speeds);
  // The figure on screen: its scale × the cell drawn (lite or full) × the share of the cell the figure fills (~0.75).
  const fig=rows[0][10]*(rows[0][15]??walk.cell[1])*.75;
  const b={fast:{c:0,d:0},slow:{c:0,d:0}};
  for(let i=1;i<rows.length;i++){
    const v=speeds[i-1],k=v>top*.75?'fast':v>top*.02&&v<top*.35?'slow':undefined;if(!k)continue;
    const a=rows[i-1],r=rows[i];if(!/:walk/.test(r[8]))continue;
    b[k].d+=v;if(a[9]!==r[9]||a[8]!==r[8])b[k].c+=1/n;
  }
  const per=x=>x.d>0?x.c/(x.d/fig):NaN;
  out.push({art,fast:per(b.fast),slow:per(b.slow)});
}
out.sort((a,b)=>a.art.localeCompare(b.art));
const f=v=>Number.isFinite(v)?v.toFixed(2):'—';
const lines=['| inimigo | ciclos de perna por altura andada: passo cheio | freando | freando ÷ cheio |','|---|---|---|---|'];
for(const o of out)lines.push(`| ${o.art} | ${f(o.fast)} | ${f(o.slow)} | ${f(o.slow/o.fast)}× |`);
console.log(lines.join('\n'));
const i=process.argv.indexOf('--md');if(i>0)fs.writeFileSync(process.argv[i+1],lines.join('\n')+'\n');
