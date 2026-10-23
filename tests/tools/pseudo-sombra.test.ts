import test from 'node:test';
import assert from 'node:assert/strict';
import {shadeCell} from '../../scripts/pseudo-sombra.mjs';

/** A 32×48 cell with an opaque mid-grey ellipse (the figure) on transparency. */
function cell(){
  const w=32,h=48,px=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const inside=((x-15.5)/12)**2+((y-23.5)/21)**2<=1,p=(y*w+x)*4;
    if(inside){px[p]=px[p+1]=px[p+2]=128;px[p+3]=255;}
  }
  return {w,h,px};
}

test('pseudo-sombra V6b3 shades the figure without touching alpha, the rim or the outside, and the same input gives the same output',()=>{
  const a=cell(),b=cell(),orig=cell();
  shadeCell(a.px,a.w,0,0,a.w,a.h,3);shadeCell(b.px,b.w,0,0,b.w,b.h,3);
  assert.deepEqual(a.px,b.px);
  for(let i=3;i<a.px.length;i+=4)assert.equal(a.px[i],orig.px[i]);
  const at=(x:number,y:number)=>a.px[(y*a.w+x)*4];
  // Sun upper left: the right flank comes out darker than the left one, the soles darker than the chest.
  assert.ok(at(24,24)<at(7,24),`direita ${at(24,24)} × esquerda ${at(7,24)}`);
  assert.ok(at(15,42)<at(15,18),`pés ${at(15,42)} × peito ${at(15,18)}`);
  assert.equal(at(0,0),0);
});
