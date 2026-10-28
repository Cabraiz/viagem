// The muzzle of each delivered weapon per direction (S, SW, W, NW, N, NE, E, SE), read by eye on grade.mjs's 10×10
// grid of the idle sheet's frame 0 (cell tenths): where the flash, the tracer, the rocket or the beam starts. Written
// as meta.muzzle (cell fractions) into public/art/towers/manifest.json and the index. node bocas.mjs
import {readFileSync,writeFileSync} from 'node:fs';
export const BOCAS={
  obuseiro:[[4.9,7.8],[3.3,8.4],[1.6,5.5],[2.7,3.4],[5.0,1.9],[8.6,2.7],[8.4,5.3],[6.3,7.4]],
  'antiaerea-quadrupla':[[4.8,8.1],[1.4,8.0],[0.9,5.0],[1.8,2.8],[5.0,1.6],[7.8,2.3],[8.8,5.2],[7.5,8.4]],
  holofote:[[4.3,4.7],[3.4,4.9],[2.6,4.7],[2.5,4.1],[4.3,3.9],[5.3,3.8],[5.6,4.6],[4.3,4.5]],
  morteiro:[[5.3,5.0],[4.1,4.5],[3.3,4.4],[2.5,5.1],[5.0,3.4],[4.4,2.9],[7.5,4.7],[6.6,5.2]],
  'rojao-de-festa':[[5.0,5.1],[3.4,4.7],[2.8,4.2],[3.1,2.8],[5.0,1.6],[7.2,2.3],[7.3,3.9],[7.2,4.8]],
  'lanca-foguetes':[[5.0,5.8],[4.4,5.8],[3.5,5.6],[3.4,4.9],[5.0,4.6],[6.4,4.9],[6.1,5.3],[5.3,5.0]],
};
const frac=v=>v.map(([x,y])=>[+(x/10).toFixed(3),+(y/10).toFixed(3)]);
for(const [path,get] of [['public/art/towers/manifest.json',j=>j.pieces],['public/art/manifest.json',j=>j.groups.torres.pieces]]){
  const json=JSON.parse(readFileSync(path,'utf8')),pieces=get(json);
  for(const [k,v] of Object.entries(BOCAS)){pieces[k].meta??={};pieces[k].meta.muzzle=frac(v);}
  const text=readFileSync(path,'utf8'),indent=/\n( +)"/.exec(text)?.[1]??'';
  writeFileSync(path,JSON.stringify(json,null,indent.length||undefined)+(text.endsWith('\n')?'\n':''));
}
console.log('meta.muzzle:',Object.keys(BOCAS).join(', '));
