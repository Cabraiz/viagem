// Trimmed size (art px) of every tower's "pronta" view 0, against the hero (154 art px): node medir.mjs
import {pronta,HERO_PX} from './refs-lib.mjs';
import {readFileSync} from 'node:fs';
const T=JSON.parse(readFileSync('public/art/manifest.json','utf8')).groups.torres.pieces;
for(const k of Object.keys(T)){if(!T[k].files.base)continue;const t=await pronta(k);
  console.log(k.padEnd(24),String(T[k].meta?.footprint),'w',t.info.width,'h',t.info.height,'h/hero',(t.info.height/HERO_PX).toFixed(2),'w/tile',(t.info.width/T[k].meta.footprint[0]).toFixed(0));}
