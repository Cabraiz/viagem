#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-inimigos-animacao-2x-lenta (the user: "tá parecendo alguém tendo um treco"): from a log of
 * scripts/pes-inimigos-jogo.mjs (per rendered frame: screen point, sheet key and frame, moving flag), per enemy kind:
 * - idle and walk speed: sheet frames shown a second (column changes / time in that loop);
 * - jitter beyond the speed: loop switches (idle ↔ walk) a second, facing-row changes a second, column jumps that are
 *   not the next frame (a cycle restart or a jump back), and screen-motion reversals a second (position jitter).
 *
 *   node scripts/tremedeira-inimigos.mjs <log.json> [--md out.md]
 */
import fs from 'node:fs';
const [logFile]=process.argv.slice(2);
const mdAt=process.argv.indexOf('--md'),mdOut=mdAt>0?process.argv[mdAt+1]:undefined;
const log=JSON.parse(fs.readFileSync(logFile,'utf8'));
const manifest=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces;
/** art:enemy:<id>:<anim>[:pN] → {art, anim, page}. */
const parseKey=k=>{const m=/^art:enemy:([^:]+):(.+?)(?::p(\d+))?$/.exec(k);return m?{art:m[1],anim:m[2],page:m[3]?Number(m[3])-1:0}:undefined;};
const cell=(key,frame)=>{
  const p=parseKey(key);if(!p)return undefined;
  const file=manifest[p.art]?.files[p.anim];if(!file)return undefined;
  const pages=file.pages?.length?file.pages:[{firstFrame:0}],n=file.frames??1,g=(pages[p.page]?.firstFrame??0)+frame;
  return {anim:p.anim,row:Math.floor(g/n),col:g%n,frames:n,fps:typeof file.fps==='number'?file.fps:file.fps?.[p.anim]??8};
};
const byEnemy=new Map();
for(const r of log.rows){const [t,id,art,kind,wx,wy,sx,sy,key,frame,,moving]=r;const c=cell(key,frame);if(!c)continue;
  (byEnemy.get(id)??byEnemy.set(id,{art,rows:[]}).get(id)).rows.push({t,sx,sy,moving,...c});}
const perArt=new Map();
for(const [,e] of byEnemy){
  const rows=e.rows;if(rows.length<20)continue;
  const a=perArt.get(e.art)??perArt.set(e.art,{art:e.art,secs:0,time:{},changes:{},switches:0,rowChanges:0,jumps:0,reversals:0,movingFlips:0,fps:{}}).get(e.art);
  let prevDir=0;
  for(let i=1;i<rows.length;i++){
    const p=rows[i-1],q=rows[i],dt=(q.t-p.t)/1000;a.secs+=dt;
    a.time[p.anim]=(a.time[p.anim]??0)+dt;a.fps[p.anim]=p.fps;
    if(q.moving!==p.moving)a.movingFlips++;
    if(q.anim!==p.anim){a.switches++;continue;}
    if(q.row!==p.row)a.rowChanges++;
    if(q.col!==p.col){a.changes[q.anim]=(a.changes[q.anim]??0)+1;if(q.col!==(p.col+1)%q.frames)a.jumps++;}
    // Screen motion along its main axis: a sign flip of a step over 0.05 px is a reversal (jitter when frequent).
    const dx=q.sx-p.sx,dy=q.sy-p.sy,m=Math.abs(dx)>=Math.abs(dy)?dx:dy;
    if(Math.abs(m)>.05){const d=Math.sign(m);if(prevDir&&d!==prevDir)a.reversals++;prevDir=d;}
  }
}
const out=[...perArt.values()].map(a=>{
  const rate=n=>a.secs>0?n/a.secs:0,loopFps=anim=>a.time[anim]>.3?(a.changes[anim]??0)/a.time[anim]:NaN;
  return {art:a.art,secs:+a.secs.toFixed(1),idleFps:loopFps('idle'),idleFileFps:a.fps.idle,walkFps:Number.isFinite(loopFps('walk'))?loopFps('walk'):loopFps('fly'),walkFileFps:a.fps.walk??(a.fps.fly!==undefined?`voo ${a.fps.fly}`:undefined),
    idleShare:(a.time.idle??0)/a.secs,switchesPerS:rate(a.switches),movingFlipsPerS:rate(a.movingFlips),rowPerS:rate(a.rowChanges),jumpsPerS:rate(a.jumps),reversalsPerS:rate(a.reversals)};
}).sort((x,y)=>y.secs-x.secs);
const f=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'–';
const lines=['| inimigo | s | parado q/s (arquivo) | andar q/s (arquivo) | % parado | troca parado↔andar /s | moving pisca /s | troca de direção /s | salto de quadro /s | vaivém na tela /s |','|---|---|---|---|---|---|---|---|---|---|',
  ...out.map(r=>`| ${r.art} | ${r.secs} | ${f(r.idleFps)} (${r.idleFileFps??'–'}) | ${f(r.walkFps)} (${r.walkFileFps??'–'}) | ${f(r.idleShare*100,0)} | ${f(r.switchesPerS)} | ${f(r.movingFlipsPerS)} | ${f(r.rowPerS)} | ${f(r.jumpsPerS)} | ${f(r.reversalsPerS)} |`)];
const tot=k=>{const s=out.reduce((x,r)=>x+r.secs,0);return out.reduce((x,r)=>x+(Number.isFinite(r[k])?r[k]*r.secs:0),0)/Math.max(1e-9,s);};
lines.push('',`Média ponderada: troca parado↔andar ${f(tot('switchesPerS'))}/s · moving pisca ${f(tot('movingFlipsPerS'))}/s · direção ${f(tot('rowPerS'))}/s · salto ${f(tot('jumpsPerS'))}/s · vaivém ${f(tot('reversalsPerS'))}/s`);
console.log(lines.join('\n'));
if(mdOut)fs.writeFileSync(mdOut,lines.join('\n')+'\n');
