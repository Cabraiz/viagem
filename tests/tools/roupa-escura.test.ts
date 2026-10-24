import test from 'node:test';
import assert from 'node:assert/strict';
import {separar,recolorir,alvosDa,leitura,TERNO} from '../../scripts/roupa-escura.mjs';

/**
 * A 1×8 sheet of 48×64 cells (8 directions), each the same "tiozão": a skin head (rows 6-19), an orange shirt down to
 * the feet (anchor .88 → row 56), a dark outline; shaded top to bottom so the colours spread like real art.
 */
const CW=48,CH=64;
function sheet(){
  const w=CW,h=CH*8,px=new Uint8ClampedArray(w*h*4);
  for(let r=0;r<8;r++)for(let y=0;y<CH;y++)for(let x=0;x<w;x++){
    const head=((x-23.5)/8)**2+((y-13)/7)**2<=1,body=y>=19&&y<=56&&Math.abs(x-23.5)<=12;
    if(!head&&!body)continue;
    const edgeHead=((x-23.5)/6)**2+((y-13)/5)**2>1,edgeBody=y>=55||Math.abs(x-23.5)>10;
    const s=1-(y%9)*.02,p=((r*CH+y)*w+x)*4;
    const c=head?(edgeHead&&!body?[40,30,25]:[225,180,140]):(edgeBody?[40,30,25]:[200,90,40]);
    for(let k=0;k<3;k++)px[p+k]=Math.round(c[k]*s);
    px[p+3]=255;
  }
  return {w,h,px};
}
const at=(s:{w:number,px:Uint8ClampedArray},x:number,y:number)=>Array.from(s.px.slice((y*s.w+x)*4,(y*s.w+x)*4+4));

test('roupa escura finds the shirt (not the head), darkens it to the suit tone keeping alpha, rim and head, and raises the value read',()=>{
  const a=sheet(),orig=sheet();
  const sep=separar(a.px,a.w,[CW,CH],.88);
  const shirt=sep.grupos.filter((g:{j:number})=>sep.roupa.includes(g.j));
  assert.ok(shirt.length>=1,'achou a roupa');
  assert.ok(shirt.every((g:{cabeca:number})=>g.cabeca<.05),'a roupa não é a cabeça');
  assert.ok(sep.pele.length>=1&&!sep.pele.some((j:number)=>sep.roupa.includes(j)),'pele e roupa separadas');
  const antes=leitura(a.px,a.w,[CW,CH]).leitura;
  recolorir(a.px,a.w,a.h,[CW,CH],.88,sep.C,alvosDa({},sep));
  for(let i=3;i<a.px.length;i+=4)assert.equal(a.px[i],orig.px[i],'alfa intacto');
  assert.deepEqual(at(a,23,12),at(orig,23,12),'cabeça intacta');
  assert.deepEqual(at(a,12,40),at(orig,12,40),'contorno (borda do alfa) intacto');
  const [r,g,b]=at(a,23,40);
  assert.ok(Math.max(r,g,b)-Math.min(r,g,b)<20&&r<TERNO[0]*2.3,`camisa no tom do terno: ${r},${g},${b}`);
  const depois=leitura(a.px,a.w,[CW,CH]).leitura;
  assert.ok(depois>antes+.3,`leitura ${antes.toFixed(2)} → ${depois.toFixed(2)}`);
  const b2=sheet(),sep2=separar(b2.px,b2.w,[CW,CH],.88);
  recolorir(b2.px,b2.w,b2.h,[CW,CH],.88,sep2.C,alvosDa({},sep2));
  assert.deepEqual(b2.px,a.px,'determinístico');
});

test('a destaque group goes to its own colour, away from the skin',()=>{
  const a=sheet(),sep=separar(a.px,a.w,[CW,CH],.88);
  recolorir(a.px,a.w,a.h,[CW,CH],.88,sep.C,alvosDa({roupa:[],destaque:{grupos:sep.roupa,cor:'#2f6fd6'}},sep));
  const [r,,b]=at(a,23,40);
  assert.ok(b>r+40,`camisa azul: r ${r} b ${b}`);
});
