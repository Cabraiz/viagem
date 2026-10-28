// Style/scale reference for the Codex prompts (hero + ramo B/C bases at the game's relative scale): node refs.mjs <out-dir>
import sharp from 'sharp';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
import {hero,pronta} from './refs-lib.mjs';
const out=process.argv[2];mkdirSync(out,{recursive:true});
const items=[await hero(),await pronta('morteiro'),await pronta('antiaerea-quadrupla'),await pronta('holofote'),await pronta('obuseiro'),await hero()];
for(const [i,it] of items.entries())console.log(i,it.info.width,it.info.height);
const pad=30,W=items.reduce((s,i)=>s+i.info.width+pad,pad),H=Math.max(...items.map(i=>i.info.height))+2*pad;
let x=pad;const comp=items.map(i=>{const o={input:i.data,left:x,top:H-pad-i.info.height};x+=i.info.width+pad;return o;});
const full=await sharp({create:{width:W,height:H,channels:4,background:'#ffffff'}}).composite(comp).png().toBuffer();
await sharp(full).toFile(join(out,'ref-estilo-full.png'));
await sharp(full).resize({width:768}).png().toFile(join(out,'ref-estilo.png'));
console.log('W',W,'H',H);
