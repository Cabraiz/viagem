// Card NEW-20261022-ORQ-corrida-clt (and corrida-proporcao-contorno, item C; empurrar-uno: the push too; animacao-receber-dano: the hurt): every run pose keeps the city's "você"
// contour, white (Papel) inside black (Breu), all the way round, in the full sheet and in its lite copy. Each frame is
// baked the way the game bakes the hero's city copy (the figure box crop, padded for the sticker, render/outline.ts
// bandsRgba with CITY_STICKER's bands) and the rendered outline is walked: every px on its outside edge must be Breu,
// with Papel just inside it (≤ 5 px), on at least CONTOUR_MIN of the perimeter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {bandsRgba} from '../../src/client/render/outline.ts';
import {CITY_RING,CITY_STICKER,CITY_STICKER_CSS,cropOf,variantGeometry} from '../../src/client/render/city-outline-rules.ts';

const sharp=createRequire(import.meta.url)('sharp');
const manifest=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8'));
const CONTOUR_MIN=.95,CELL=96;
const PAPEL=CITY_STICKER[1].color,rgb=(c:number)=>[c>>16&255,c>>8&255,c&255];
const near=(d:Uint8ClampedArray,i:number,c:number,tol=40)=>{const [r,g,b]=rgb(c);return Math.abs(d[i]-r)+Math.abs(d[i+1]-g)+Math.abs(d[i+2]-b)<=tol;};

/** One frame baked with the sticker: the share of its outside edge that is Breu with Papel within 5 px inside (the outer Breu band is 2.5 px). */
function contour(sheet:{data:Buffer;width:number},frame:number,cols:number,box:{left:number;top:number;right:number;bottom:number}){
  const g=variantGeometry(CELL,CELL,1,1,1,cropOf(box,CELL,CELL),CITY_STICKER_CSS)!,w=g.slotW,h=g.slotH;
  const src=new Uint8ClampedArray(w*h*4),x0=(frame%cols)*CELL+g.crop.x,y0=Math.floor(frame/cols)*CELL+g.crop.y;
  for(let y=0;y<g.crop.h;y++)for(let x=0;x<g.crop.w;x++){
    const s=((y0+y)*sheet.width+x0+x)*4,t=((y+g.pad)*w+x+g.pad)*4;for(let k=0;k<4;k++)src[t+k]=sheet.data[s+k];
  }
  const out=bandsRgba(src,w,h,CITY_STICKER.map(b=>({width:b.css*g.perCss,color:b.color})),w,h);
  const on=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&out[(y*w+x)*4+3]>128;
  // The outside: the clear px reached from the slot's border (a pinhole inside the figure is not its contour).
  const outside=new Uint8Array(w*h),stack:number[]=[];
  for(let x=0;x<w;x++)stack.push(x,(h-1)*w+x);for(let y=0;y<h;y++)stack.push(y*w,y*w+w-1);
  while(stack.length){const p=stack.pop()!,x=p%w,y=(p-x)/w;if(outside[p]||on(x,y))continue;outside[p]=1;
    if(x>0)stack.push(p-1);if(x<w-1)stack.push(p+1);if(y>0)stack.push(p-w);if(y<h-1)stack.push(p+w);}
  const out_=(x:number,y:number)=>x<0||y<0||x>=w||y>=h||outside[y*w+x]===1;
  let edge=0,good=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(!on(x,y)||!(out_(x-1,y)||out_(x+1,y)||out_(x,y-1)||out_(x,y+1)))continue;
    edge++;
    // on the slot's border the figure was cut by the crop: no contour there
    if(x===0||y===0||x===w-1||y===h-1||!near(out,(y*w+x)*4,CITY_RING.color))continue;
    let papel=false;
    for(let dy=-5;dy<=5&&!papel;dy++)for(let dx=-5;dx<=5&&!papel;dx++){
      const d=Math.hypot(dx,dy),xx=x+dx,yy=y+dy;
      if(d>=1.5&&d<=5&&xx>=0&&yy>=0&&xx<w&&yy<h&&near(out,(yy*w+xx)*4,PAPEL))papel=true;
    }
    if(papel)good++;
  }
  return edge?good/edge:0;
}

const runs=Object.entries(manifest.pieces as Record<string,{files:Record<string,{file:string;frames:number;figure:{left:number;top:number;right:number;bottom:number};pages:{columns:number}[]}>}>)
  .flatMap(([id,p])=>Object.entries(p.files).filter(([k])=>k.startsWith('run16-')||k.startsWith('push16-')||k.startsWith('pull16-')||k.startsWith('hurt16-')).map(([k,f])=>({id,key:k,f})));

test('the run, push and hurt sheets the game shows include the viciado\'s, the CLT\'s and the gato\'s',()=>{
  for(const id of ['viciado-em-bet','clt-cansado','gato-nada-pra-comer'])for(const m of ['run16-','push16-','hurt16-'])
    assert.equal(runs.filter(r=>r.id===id&&r.key.startsWith(m)).length,5,`${id}: 5 drawn ${m} directions`);
  // puxar-uno-corda: the rope pull of the viciado and the CLT (the gato and the maromba next)
  for(const id of ['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba'])assert.equal(runs.filter(r=>r.id===id&&r.key.startsWith('pull16-')).length,5,`${id}: 5 drawn pull16 directions`);
});

for(const {id,key,f} of runs)test(`${id} ${key}: Breu outside Papel on ≥ ${CONTOUR_MIN*100} % of every pose's contour, full and lite`,async()=>{
  for(const [kind,file] of [['full',`public/art/sprites/${f.file}`],['lite',`public/art/lite/sprites/${f.file}`]]){
    assert.ok(existsSync(file),`${kind}: ${file}`);
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sheet={data,width:info.width};
    const low:string[]=[];
    for(let i=0;i<f.frames;i++){const c=contour(sheet,i,f.pages[0].columns,f.figure);if(c<CONTOUR_MIN)low.push(`frame ${i} ${(c*100).toFixed(1)} %`);}
    assert.deepEqual(low,[],`${id} ${key} ${kind}`);
  }
});

test('the meter fails a pose with a light, soft fringe around it (a keying halo washes the black band out)',async()=>{
  const f=manifest.pieces['viciado-em-bet'].files['run16-W'];
  const {data,info}=await sharp(`public/art/sprites/${f.file}`).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sheet={data,width:info.width};
  assert.ok(contour(sheet,0,4,f.figure)>=CONTOUR_MIN);
  // frame 0: every clear px within 6 px of the figure becomes a half-clear white halo
  const halo=Buffer.from(data),solid=(x:number,y:number)=>x>=0&&y>=0&&x<CELL&&y<CELL&&data[(y*info.width+x)*4+3]>128;
  for(let y=0;y<CELL;y++)for(let x=0;x<CELL;x++){
    const i=(y*info.width+x)*4;if(data[i+3]>20)continue;
    let near6=false;for(let dy=-6;dy<=6&&!near6;dy++)for(let dx=-6;dx<=6&&!near6;dx++)if(dx*dx+dy*dy<=36&&solid(x+dx,y+dy))near6=true;
    if(near6){halo[i]=halo[i+1]=halo[i+2]=255;halo[i+3]=110;}
  }
  const c=contour({data:halo,width:info.width},0,4,f.figure);
  assert.ok(c<CONTOUR_MIN,`halo: ${c}`);
});
