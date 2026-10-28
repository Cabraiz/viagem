// Etapa 2: the muzzle of each new ramo A crew per direction (S, SW, W, NW, N, NE, E, SE), read by eye on
// grade_boca.py's 10×10 grid of the fire sheet's shot pose (cell tenths; E/NE/SE = the mirror of W/NW/SW). Written as
// meta.muzzle (cell fractions) into public/art/towers/manifest.json and the index, like the idle-tiro card's bocas.mjs.
//   node evidence/NEW-20261025-ORQ-torres-ramo-a-postos/final/bocas.mjs   (from the repo root)
import {readFileSync,writeFileSync} from 'node:fs';
const mirror=([s,sw,w,nw,n])=>[s,sw,w,nw,n,[10-nw[0],nw[1]],[10-w[0],w[1]],[10-sw[0],sw[1]]];
export const BOCAS={
  'vigia-do-predio':mirror([[5.0,6.4],[1.7,6.4],[0.7,5.5],[2.6,4.4],[5.0,2.7]]),
  'vigias-armados':mirror([[4.7,5.4],[1.8,6.1],[1.5,4.8],[2.1,2.7],[5.0,2.5]]),
  'atiradores-do-telhado':mirror([[4.9,5.7],[3.5,6.0],[3.8,5.8],[5.5,5.0],[5.0,1.8]]),
  'ninho-de-metralhadora':mirror([[4.9,8.5],[3.6,7.4],[2.0,5.1],[3.4,2.8],[5.5,2.7]]),
};
const frac=v=>v.map(([x,y])=>[+(x/10).toFixed(3),+(y/10).toFixed(3)]);
for(const [path,get] of [['public/art/towers/manifest.json',j=>j.pieces],['public/art/manifest.json',j=>j.groups.torres.pieces]]){
  const text=readFileSync(path,'utf8'),json=JSON.parse(text),pieces=get(json);
  for(const [k,v] of Object.entries(BOCAS)){pieces[k].meta??={};pieces[k].meta.muzzle=frac(v);}
  const indent=/\n( +)"/.exec(text)?.[1]??'';
  writeFileSync(path,JSON.stringify(json,null,indent.length||undefined)+(text.endsWith('\n')?'\n':''));
}
console.log('meta.muzzle:',Object.keys(BOCAS).join(', '));
