#!/usr/bin/env node
/**
 * Card NEW-20261022-ORQ-monstros-sem-deslizar ("e os inimigos me atacam de costas?"): from a log of
 * scripts/pes-inimigos-sandbox.mjs --cerco (the hero standing at world HERO, view 0), per enemy: the frames it is
 * within 1.6 u of the hero, and the share of them whose 8-direction row points more than 45° away from him (its back or
 * side to him), and the same while it plays a swing (any one-shot action).
 *
 *   node scripts/de-costas.mjs <log.json> [--md out.md]
 */
import fs from 'node:fs';
const HERO={x:12,y:12.5},LOOPS=new Set(['walk','idle','fly']);
const log=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pieces=JSON.parse(fs.readFileSync('public/art/manifest.json','utf8')).groups.inimigos.pieces;
const by=new Map();
for(const r of log.rows){
  const [, ,art,,x,y,,,key,frame]=r,anim=key.split(':').slice(3).join(':').replace(/:p\d+$/,''),file=pieces[art].files[anim];
  const tx=HERO.x-x,ty=HERO.y-y,d=Math.hypot(tx,ty);if(d>1.6||!file||(file.directions??1)<8)continue;
  const row=Math.floor(frame/file.frames);
  // The target's angle on the ground plane (0 = S, clockwise), as horde-art.ts groundFacingRow reads it.
  let a=Math.atan2(-(tx-ty),tx+ty)*180/Math.PI;if(a<0)a+=360;
  let off=Math.abs(row*45-a)%360;if(off>180)off=360-off;
  const o=by.get(art)??by.set(art,{n:0,bad:0,sn:0,sbad:0}).get(art);
  o.n++;if(off>45)o.bad++;if(!LOOPS.has(anim)){o.sn++;if(off>45)o.sbad++;}
}
const p=(a,b)=>b?`${Math.round(a/b*100)}% (${a}/${b})`:'—';
const lines=['| inimigo | perto do herói: de costas/lado (> 45°) | golpeando: de costas/lado |','|---|---|---|'];
for(const [art,o] of [...by].sort())lines.push(`| ${art} | ${p(o.bad,o.n)} | ${p(o.sbad,o.sn)} |`);
console.log(lines.join('\n'));
const i=process.argv.indexOf('--md');if(i>0)fs.writeFileSync(process.argv[i+1],lines.join('\n')+'\n');
