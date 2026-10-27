/**
 * Fundo do minimapa da Cidade Nevada v5 (NEW-20261025-ORQ-mapa-conexoes-sem-beco): a pintura do ChatGPT da v4
 * (evidence/minimapa-arte-chatgpt/fundo/fundo-m1-t1.png, world-aligned, IoU 0,964) com o chão que a v5 abriu (passagens,
 * entulho tirado) repintado de neve: cada pixel de uma amostra aberta copia a cor do pixel de neve da v4 mais perto
 * (a mesma textura da pintura, sem chamar o ChatGPT de novo). Grava evidence/minimapa-arte-chatgpt/fundo/fundo-m2-v5.png,
 * que scripts/minimapa/atlas.mjs leva ao jogo.
 * Uso: node --experimental-strip-types scripts/minimapa/fundo-v5.ts
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {decodeCityAsset,type CityAsset} from '../../src/maps/index.ts';

/** The commit whose asset (v4) the painting was made from. */
export const V4_COMMIT='078bc794';
const EV='evidence/minimapa-arte-chatgpt/fundo';
const asset=(text:string):CityAsset=>{const d=decodeCityAsset(text);if(!d.ok)throw new Error(d.error);return d.asset;};
const v4=asset(execFileSync('git',['show',`${V4_COMMIT}:public/maps/cidade-nevada.json`],{encoding:'utf8',maxBuffer:64<<20}));
const v5=asset(readFileSync('public/maps/cidade-nevada.json','utf8'));
if(v4.version!==4||v5.version!==5)throw new Error(`versions ${v4.version}, ${v5.version}`);

const {data,info}=await sharp(`${EV}/fundo-m1-t1.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height,{w:SW,h:SH}=v5.samples;
const sample=(x:number,y:number)=>[Math.min(SW-1,Math.floor(x*SW/W)),Math.min(SH-1,Math.floor(y*SH/H))] as const;
// Pixels to repaint: open on v5, shut on v4. Donors: open on both (snow of the painting), away from the patch's edge.
const patch=new Uint8Array(W*H),donor=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const [sx,sy]=sample(x,y),o4=v4.walkable(sx,sy),o5=v5.walkable(sx,sy);
  if(o5&&!o4)patch[x+y*W]=1;else if(o4&&o5)donor[x+y*W]=1;
}
// A donor pixel must sit 2 px inside the snow (its rim is the walls' lighter edge).
const inner=donor.slice();
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!donor[x+y*W])continue;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=W||Y>=H||!donor[X+Y*W]){inner[x+y*W]=0;dy=3;break;}}}
const out=Buffer.from(data);let painted=0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!patch[x+y*W])continue;
  let best=-1;
  for(let r=1;r<40&&best<0;r++)for(let dy=-r;dy<=r&&best<0;dy++)for(const dx of Math.abs(dy)===r?Array.from({length:2*r+1},(_,i)=>i-r):[-r,r]){
    const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<W&&Y<H&&inner[X+Y*W]){best=X+Y*W;break;}}
  if(best<0)continue;
  for(let c=0;c<3;c++)out[(x+y*W)*3+c]=data[best*3+c];painted++;
}
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile(`${EV}/fundo-m2-v5.png`);
console.log(JSON.stringify({painted,of:W*H,out:`${EV}/fundo-m2-v5.png`}));
