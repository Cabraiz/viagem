#!/usr/bin/env node
/**
 * NEW-20261031-ORQ-tiro-rapido-e-local: the 4 red arrows that spin around the enemy the hero's shot is aimed at
 * (render/focus-arrows.ts). ONE painting (ChatGPT via Codex, evidence/setas-foco/prompt.txt): four glossy red chevrons
 * pointing in at an empty middle, on flat green. This keys the green out (scripts/import-aura-defumador.mjs keyGreen),
 * crops a square centred on the painting's middle (the arrows' centre stays the frame's) and writes one small WebP.
 * Already light for the phone (no copy under public/art/lite/).
 *
 *   node scripts/import-foco-setas.mjs out.png   → public/art/fx/foco-setas.webp
 */
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bbox,keyGreen} from './import-aura-defumador.mjs';

const sharp=createRequire(import.meta.url)('sharp');
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
/** The frame's side (px) and the transparent margin kept around the arrows. */
export const SIDE=256,PAD=4;
const OUT=join(ROOT,'public/art/fx/foco-setas.webp');

const [file]=process.argv.slice(2);
if(!file){console.error('uso: node scripts/import-foco-setas.mjs out.png');process.exit(2);}
const {data,info}=await sharp(file).removeAlpha().ensureAlpha().raw().toBuffer({resolveWithObject:true});
keyGreen(data);
const W=info.width,H=info.height,box=bbox(data,W,H);
if(!box)throw new Error('nenhuma seta na pintura');
const cx=W/2,cy=H/2,half=Math.ceil(Math.max(cx-box.x0,box.x1+1-cx,cy-box.y0,box.y1+1-cy));
const S=2*half,sq=Buffer.alloc(S*S*4),sx=Math.round(cx-half),sy=Math.round(cy-half);
for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const ux=sx+x,uy=sy+y;if(ux<0||uy<0||ux>=W||uy>=H)continue;
  data.copy(sq,(y*S+x)*4,(uy*W+ux)*4,(uy*W+ux)*4+4);
}
await sharp(sq,{raw:{width:S,height:S,channels:4}}).resize(SIDE-2*PAD,SIDE-2*PAD,{kernel:'lanczos3'})
  .extend({top:PAD,bottom:PAD,left:PAD,right:PAD,background:{r:0,g:0,b:0,alpha:0}})
  .webp({quality:85,alphaQuality:90,effort:6}).toFile(OUT);
console.log(`${OUT}: ${SIDE}×${SIDE}`);
