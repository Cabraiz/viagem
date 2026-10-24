import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-ignore: a plain .mjs script module
import {centro,LOGO_CAIXA,LOGO_H,pesoVisual} from '../../scripts/insta-logo-medida.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const IDS=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba'];
const ler=(file:string)=>sharp(path.join(root,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const [W,H]=LOGO_CAIXA as number[];

// BUG-20261023-ORQ-insta-letreiros-mesma-cor-tamanho: the maromba's read bigger than the viciado's at the same height,
// and the gato's sat off to the right and down.
test('the top bar logos (source and lite copy) weigh the same (±3 %) and share one visual centre, the canvas middle',async()=>{
  for(const dir of ['public/art/menu/insta','public/art/lite/menu/insta']){
    const pesos:number[]=[];
    for(const id of IDS){
      const {data,info}=await ler(`${dir}/logo-${id}.webp`);
      assert.deepEqual([info.width,info.height],[W,H],`${dir} ${id}`);
      const [cx,cy]=centro(data,info);
      assert.ok(Math.hypot(cx-W/2,cy-H/2)<=2,`${dir} ${id}: visual centre ${cx.toFixed(1)},${cy.toFixed(1)}, not the middle`);
      pesos.push(pesoVisual(data));
    }
    const media=pesos.reduce((a,b)=>a+b)/pesos.length;
    for(const [i,p] of pesos.entries())assert.ok(Math.abs(p/media-1)<=.03,`${dir} ${IDS[i]}: weight ${Math.round(p)} vs mean ${Math.round(media)}`);
  }
});

test('the lightest logo keeps the whole LOGO_H, and each keeps its own colours (no one ink over all)',async()=>{
  const alturas:number[]=[];const cores=new Set<string>();
  for(const id of IDS){
    const {data,info}=await ler(`public/art/menu/insta/logo-${id}.webp`);
    let y0=H,y1=-1,r=0,g=0,b=0,n=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(data[i+3]>8){y0=Math.min(y0,y);y1=Math.max(y1,y);}if(data[i+3]>250){r+=data[i];g+=data[i+1];b+=data[i+2];n++;}}
    alturas.push(y1-y0+1);
    cores.add([r,g,b].map(c=>Math.round(c/n/32)).join());
    assert.ok(info.width===W);
  }
  assert.ok(Math.abs(Math.max(...alturas)-LOGO_H)<=2,`tallest drawing ${Math.max(...alturas)} rows`);
  assert.equal(cores.size,IDS.length,'every letreiro its own average colour');
});
