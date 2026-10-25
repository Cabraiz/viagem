// Style/scale reference for the Codex prompts: hero + ramo B/C "pronta" bases, all at the game's relative scale
// (tower art × 0.5 world px; the hero's FIGURE is drawn 96 × HERO_DRAW_SCALE 0.8 = 76.8 world px tall, character-sprites
// 96/height → 153.6 tower-art px).
// node refs.mjs <out-dir>
import sharp from 'sharp';import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
const man=JSON.parse(readFileSync('public/art/manifest.json','utf8')).groups;
export const HERO_PX=154;
const T=man.torres.pieces,P=man.personagens.pieces;
async function cell(file,cw,ch,cols,idx){const x=(idx%cols)*cw,y=Math.floor(idx/cols)*ch;
  return sharp(file).extract({left:x,top:y,width:cw,height:ch}).png().toBuffer();}
async function trim(buf){const t=await sharp(buf).trim({threshold:1}).toBuffer({resolveWithObject:true});return t;}
export async function hero(){const f=P['clt-cansado'].files['idle16-S'];const b=await cell(join('public/art/sprites',f.file),96,96,(await sharp(join('public/art/sprites',f.file)).metadata()).width/96,0);
  const t=await trim(b);const big=await sharp(t.data).resize({height:HERO_PX,kernel:'lanczos3'}).png().toBuffer();return trim(big);}
export async function pronta(kind,row='pronta',view=0){const f=T[kind].files.base;const i=f.rows.indexOf(row)*f.views+view;
  const pg=f.pages.find(p=>i>=p.firstFrame&&i<p.firstFrame+p.frameCount);
  return trim(await cell(join('public/art/towers',pg.file),f.cell[0],f.cell[1],pg.columns,i-pg.firstFrame));}
