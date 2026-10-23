import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-ignore: a plain .mjs script module
import {pesoVisual,rampa,TINTA,TINTAS} from '../../scripts/insta-tinta.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const IDS=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba'];
const tinta=(TINTAS as Record<string,string[]>)[TINTA as string];
const ler=(file:string)=>sharp(path.join(root,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});

// BUG-20261023-ORQ-insta-letreiros-mesma-cor-tamanho: the maromba's read bigger than the viciado's at the same height.
test('the top bar logos weigh the same (±3 %) in the same 168 rows, each drawing centred in them',async()=>{
  const pesos:number[]=[];
  for(const id of IDS){
    const {data,info}=await ler(`public/art/menu/insta/logo-${id}.webp`);
    assert.equal(info.height,168,id);
    let y0=info.height,y1=-1;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>8){y0=Math.min(y0,y);y1=Math.max(y1,y);}
    assert.ok(Math.abs(y0-(info.height-1-y1))<=2,`${id}: drawn from row ${y0} to ${y1}, not centred`);
    pesos.push(pesoVisual(data,tinta));
  }
  const media=pesos.reduce((a,b)=>a+b)/pesos.length;
  for(const [i,p] of pesos.entries())assert.ok(Math.abs(p/media-1)<=.03,`${IDS[i]}: weight ${Math.round(p)} vs mean ${Math.round(media)}`);
});

test('every logo (source and lite copy) is painted in the one ink: its opaque pixels sit on the ramp',async()=>{
  const amostras=Array.from({length:257},(_,i)=>rampa(tinta,i/256));
  for(const id of IDS)for(const file of [`public/art/menu/insta/logo-${id}.webp`,`public/art/lite/menu/insta/logo-${id}.webp`]){
    const {data}=await ler(file);let fora=0,opacos=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]<250)continue;
      opacos++;
      const d=Math.min(...amostras.map(c=>Math.hypot(data[i]-c[0],data[i+1]-c[1],data[i+2]-c[2])));
      if(d>30)fora++; // the lossy WebP drifts a little at sharp edges; a different ink is off by 45+ on most pixels
    }
    assert.ok(fora/opacos<.01,`${file}: ${(100*fora/opacos).toFixed(1)} % of its pixels off the ink`);
  }
});
