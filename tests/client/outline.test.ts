import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceToFigure,outlineRgba,ringTexturePx} from '../../src/client/render/outline.ts';

const BREU=0x1e1530;
/** w×h RGBA with an opaque white disc of radius rad at (cx,cy). */
function disc(w:number,h:number,cx:number,cy:number,rad:number){
  const px=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.hypot(x-cx,y-cy)<=rad){const i=(y*w+x)*4;px[i]=px[i+1]=px[i+2]=255;px[i+3]=255;}
  return px;
}
const alphaAt=(px:Uint8ClampedArray,w:number,x:number,y:number)=>px[(y*w+x)*4+3];

test('distance transform is exact Euclidean (brute force on a random mask)',()=>{
  const w=23,h=17,a=new Uint8Array(w*h);
  let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  for(let i=0;i<w*h;i++)a[i]=rnd()<0.07?255:0;
  const d=distanceToFigure(a,w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let best=Infinity;
    for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(a[j*w+i]>=128)best=Math.min(best,(x-i)**2+(y-j)**2);
    assert.equal(d[y*w+x],best,`(${x},${y})`);
  }
});

test('ring grows the requested radius outside the figure and keeps the figure pixels untouched',()=>{
  const w=40,h=40,src=disc(w,h,20,20,8),out=outlineRgba(src,w,h,{radius:3,color:BREU,alpha:1});
  for(let i=0;i<src.length;i+=4)if(src[i+3]===255)assert.deepEqual([...out.slice(i,i+4)],[...src.slice(i,i+4)]);
  // 2 px outside the disc: fully Breu; 5 px outside: untouched (transparent).
  const i2=(20*w+20+8+2)*4;
  assert.deepEqual([out[i2],out[i2+1],out[i2+2],out[i2+3]],[0x1e,0x15,0x30,255]);
  assert.equal(alphaAt(out,w,20+8+5,20),0);
  // Ring thickness along a ray ≈ radius (± the soft half pixel).
  let ring=0;for(let x=29;x<40;x++)if(alphaAt(out,w,x,20)>0)ring++;
  assert.ok(ring>=3&&ring<=4,`ring ${ring} px`);
});

test('fractional radius gives a soft, anti-aliased edge; zero radius or alpha changes nothing',()=>{
  const w=30,h=30,src=disc(w,h,15,15,6);
  const soft=outlineRgba(src,w,h,{radius:1.3,color:BREU,alpha:1});
  const partial=[...Array(w).keys()].map(x=>alphaAt(soft,w,x,15)).filter(a=>a>0&&a<255);
  assert.ok(partial.length>0,'some partial-coverage pixels');
  assert.deepEqual([...outlineRgba(src,w,h,{radius:0,color:BREU,alpha:1})],[...src]);
  assert.deepEqual([...outlineRgba(src,w,h,{radius:2,color:BREU,alpha:0})],[...src]);
});

test('ring opacity (umber 85%) and colour are applied; semi-transparent figure edges stay on top',()=>{
  const w=20,h=20,src=disc(w,h,10,10,4),i=((10*w)+10+4+1)*4;
  const out=outlineRgba(src,w,h,{radius:2,color:0x2a2018,alpha:0.85});
  assert.equal(out[i+3],Math.round(0.85*255));assert.deepEqual([out[i],out[i+1],out[i+2]],[0x2a,0x20,0x18]);
  // A half-transparent edge pixel keeps its colour dominance over the ring.
  const edge=new Uint8ClampedArray(src);const e=((10*w)+10)*4;edge[e+3]=128;
  const o2=outlineRgba(edge,w,h,{radius:2,color:BREU,alpha:1});assert.equal(o2[e+3],128,'figure pixels are never altered');
});

test('sheet cells are outlined independently: no ring bleeds into the neighbouring frame',()=>{
  // Two 16×16 cells side by side; the figure touches the right edge of the left cell.
  const w=32,h=16,px=new Uint8ClampedArray(w*h*4);
  for(let y=4;y<12;y++)for(let x=8;x<16;x++){const i=(y*w+x)*4;px[i]=px[i+1]=px[i+2]=px[i+3]=255;}
  const out=outlineRgba(px,w,h,{radius:3,color:BREU,alpha:1,cellW:16,cellH:16});
  for(let y=0;y<h;y++)for(let x=16;x<32;x++)assert.equal(alphaAt(out,w,x,y),0,`right cell (${x},${y}) stays empty`);
  assert.ok(alphaAt(out,w,6,8)>0,'ring inside the left cell');
});

test('ring radius in texture px for a target on screen',()=>{
  // A 192 px sheet drawn at 56 px on screen: 56/192 screen px per texture px → 2 px on screen ≈ 6.86 texture px.
  assert.ok(Math.abs(ringTexturePx(2,56/192)-6.857)<0.01);
  assert.equal(ringTexturePx(2,0),0);
});
