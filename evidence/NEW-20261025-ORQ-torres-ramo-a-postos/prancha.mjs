// Etapa 1 board: each concept (2 variants on chroma green) keyed, split A|B, trimmed and scaled to the game's size
// (object width = the footprint's usual art width: 2x2 ~370, 3x3 ~520 art px, capped at 2.45x the hero's height), next to the hero (154 art px) with the
// 2.5x line. node prancha.mjs [scale=0.5] → conceito/prancha-conceito.png
import sharp from 'sharp';import {existsSync} from 'node:fs';import {join} from 'node:path';
import {hero,pronta,HERO_PX} from './refs-lib.mjs';
const DIR='evidence/NEW-20261025-ORQ-torres-ramo-a-postos/conceito',S=+(process.argv[2]??0.5);
const TOWERS=[['vigia-do-predio','T1','Guarita',2],['vigias-armados','A2','Vigias Armados',2],['atiradores-do-telhado','A3','Plataforma de Tiro',2],
  ['ninho-de-metralhadora','A4','Ninho de Metralhadora',3],['guarnicao-do-predio','A5','Bunker',3],['ninho-do-sniper','A4b','Ninho do Sniper',2],
  ['equipe-antimaterial','A5b','Equipe Antimaterial',2]];
const WIDTH={2:370,3:520},MAX_H=2.45; // slim posts cap at the 2.5x line (narrower, not shrunk-building)
export async function key(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){const r=data[i],g=data[i+1],b=data[i+2];const m=g-Math.max(r,b);
    if(m>60)data[i+3]=0;else if(m>20){data[i+3]=Math.round(255*(60-m)/40);data[i+1]=Math.max(r,b);}else if(m>0)data[i+1]=Math.max(r,b);}
  return {data,info};}
// Split at the widest empty column run near the middle.
export function halves({data,info}){const {width:w,height:h}=info,col=new Array(w).fill(0);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>40)col[x]++;
  let best=[0,0],run=null;for(let x=Math.floor(w*.25);x<w*.75;x++){if(col[x]<2){run??=x;if(x-run>best[1]-best[0])best=[run,x];}else run=null;}
  const cut=best[1]>best[0]?Math.round((best[0]+best[1])/2):Math.round(w/2);return [[0,cut],[cut,w]];}
async function piece(k,[x0,x1],{data,info},fp){
  const img=await sharp(data,{raw:info}).extract({left:x0,top:0,width:x1-x0,height:info.height}).png().toBuffer();
  const t=await sharp(img).trim({threshold:1}).toBuffer({resolveWithObject:true});
  const k2=Math.min(WIDTH[fp]/t.info.width,MAX_H*HERO_PX/t.info.height);const out=await sharp(t.data).resize({width:Math.round(t.info.width*k2)}).png().toBuffer({resolveWithObject:true});
  return out;}
const label=(lines,w)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${lines.length*30+6}">${lines.map((l,i)=>
  `<text x="${w/2}" y="${26+i*30}" font-family="Segoe UI,Arial" font-size="${i?22:24}" font-weight="${i?400:700}" fill="${i?'#37474f':'#102027'}" text-anchor="middle">${l}</text>`).join('')}</svg>`);
const H=await hero();const pad=40,gap=50;
const rows=[];
for(const v of [0,1]){const items=[];
  for(const [k,lab,name,fp] of TOWERS){const f=join(DIR,`${k}.webp`);if(!existsSync(f))continue;
    const keyed=await key(f);const p=await piece(k,halves(keyed)[v],keyed,fp);
    items.push({img:p,hero:true,lines:[`${lab} ${name} (${'AB'[v]})`,`${(p.info.height/HERO_PX).toFixed(1).replace('.',',')}× · ${fp}×${fp}`]});}
  const ref=await pronta('antiaerea-quadrupla');items.push({img:ref,hero:true,lines:['C4 Antiaérea (ref.)',`${(ref.info.height/HERO_PX).toFixed(1).replace('.',',')}×`]});
  rows.push(items);}
const cellW=i=>Math.max(i.img.info.width+(i.hero?H.info.width+12:0),260);
const rowH=Math.max(HERO_PX*2.5,...rows.flat().map(i=>i.img.info.height))+pad+80;
const W=Math.max(...rows.map(r=>r.reduce((s,i)=>s+cellW(i)+gap,pad)));
const comp=[];rows.forEach((items,ri)=>{const base=ri*rowH+rowH-80;let x=pad;
  const lineY=Math.round(base-HERO_PX*2.5);
  comp.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"><line x1="0" y1="2" x2="${W}" y2="2" stroke="#e53935" stroke-width="3" stroke-dasharray="14 10"/><text x="8" y="30" font-family="Segoe UI,Arial" font-size="22" fill="#e53935">limite 2,5× o herói</text></svg>`),left:0,top:lineY});
  comp.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="4"><rect width="${W}" height="4" fill="#90a4ae"/></svg>`),left:0,top:base});
  for(const it of items){const cw=cellW(it),hw=it.hero?H.info.width+12:0,x0=Math.round(x+(cw-it.img.info.width-hw)/2);
    if(it.hero)comp.push({input:H.data,left:x0,top:base-H.info.height});
    comp.push({input:it.img.data,left:x0+hw,top:base-it.img.info.height});
    comp.push({input:label(it.lines,cw),left:x,top:base+8});x+=cw+gap;}});
const full=await sharp({create:{width:W,height:rows.length*rowH,channels:4,background:'#eceff1'}}).composite(comp).png().toBuffer();
await sharp(full).resize({width:Math.round(W*S)}).png().toFile(join(DIR,'prancha-conceito.png'));
console.log('prancha',W,rows.length*rowH,'itens',rows.map(r=>r.length));
