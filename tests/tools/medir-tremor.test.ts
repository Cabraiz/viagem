import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: plain .mjs script, no types
import {medirQuadro,acharTremores,residuos,saltos,mascaraQuadro,classificarQuadro} from '../../scripts/medir-tremor.mjs';

const W=64,H=64;
/** A frame: a body rectangle (cx ± 8, top..58) with two feet (rows 59..60) whose lowest row alternates. */
function quadro(dx=0,dy=0,{alto=0,pe=0}:{alto?:number;pe?:number}={}){
  const rgba=new Uint8Array(W*H*4);
  const px=(x:number,y:number)=>{if(x>=0&&x<W&&y>=0&&y<H)rgba[(y*W+x)*4+3]=255;};
  for(let y=20-alto;y<=58;y++)for(let x=24;x<=40;x++)px(x+dx,y+dy);
  for(let y=59;y<=60+(pe===0?1:0);y++)for(let x=24;x<=29;x++)px(x+dx,y+dy);
  for(let y=59;y<=60+(pe===1?1:0);y++)for(let x=35;x<=40;x++)px(x+dx,y+dy);
  return medirQuadro(rgba,W,0,0,W,H);
}

test('medirQuadro: feet, top, height and the feet center between both feet whichever is lower',()=>{
  const a=quadro(0,0,{pe:0}),b=quadro(0,0,{pe:1});
  assert.equal(a.base,61);assert.equal(a.topo,20);assert.equal(a.altura,42);
  assert.equal(a.pex,32);assert.equal(b.pex,32,'the lower foot changing sides does not move the feet center');
  assert.equal(medirQuadro(new Uint8Array(W*H*4),W,0,0,W,H),null);
});

test('residuos and saltos wrap around in a loop and not in a one-shot animation',()=>{
  assert.deepEqual(residuos([0,0,4,0,0],true),[0,-2,4,-2,0]);
  assert.deepEqual(residuos([4,0,0,0],false),[0,-2,0,0]);
  assert.deepEqual(saltos([1,1,3],true),[-2,0,2]);
  assert.deepEqual(saltos([1,1,3],false),[0,0,2]);
});

test('a walk whose frames sway smoothly has no tremor; one frame shifted sideways is the only finding',()=>{
  const suave=Array.from({length:8},(_,i)=>quadro(Math.round(2*Math.sin(i/8*2*Math.PI)),0,{pe:i>>2&1}));
  assert.deepEqual(acharTremores(suave,'walk'),[]);
  const torto=suave.map((q,i)=>i===5?quadro(9,0,{pe:1}):q);
  const t=acharTremores(torto,'walk');
  assert.ok(t.length>=1&&t.every(a=>a.quadro===5),JSON.stringify(t));
  assert.ok(t.some(a=>a.medida==='cx'&&a.gravidade>=1));
});

test('a foot that drops 2 px for one frame of the idle loop is a pe finding; a slam jump of the same size is not',()=>{
  const parado=Array.from({length:6},(_,i)=>quadro(0,i===3?2:0));
  const t=acharTremores(parado,'idle');
  assert.ok(t.some(a=>a.quadro===3&&a.medida==='pe'),JSON.stringify(t));
  assert.deepEqual(acharTremores(parado,'slam').filter(a=>a.medida==='pe'),[],'actions get FROUXO × the limit');
});

test('a frame 8 % taller than its neighbours is an altura finding; an empty frame is reported as vazio',()=>{
  const seq=Array.from({length:6},(_,i)=>quadro(0,0,{alto:i===2?4:0}));
  assert.ok(acharTremores(seq,'idle').some(a=>a.quadro===2&&a.medida==='altura'));
  const vazio=[quadro(),null,quadro(),quadro()];
  assert.deepEqual(acharTremores(vazio,'walk').filter(a=>a.medida==='vazio').map(a=>a.quadro),[1]);
});

test('limits scale with the cell: the same 2 px drop in a 384 cell is below the limit',()=>{
  const parado=Array.from({length:6},(_,i)=>quadro(0,i===3?2:0));
  assert.deepEqual(acharTremores(parado,'idle',384).filter(a=>a.medida==='pe'),[]);
});

/** The same body as quadro() as an RGBA buffer, plus a raised arm (a different drawing) when `braco`. */
function rgba(dx=0,{pe=0,braco=false}:{pe?:number;braco?:boolean}={}){
  const b=new Uint8Array(W*H*4),px=(x:number,y:number)=>{if(x>=0&&x<W&&y>=0&&y<H)b[(y*W+x)*4+3]=255;};
  for(let y=20;y<=58;y++)for(let x=24;x<=40;x++)px(x+dx,y);
  for(let y=59;y<=60+(pe===0?1:0);y++)for(let x=24;x<=29;x++)px(x+dx,y);
  for(let y=59;y<=60+(pe===1?1:0);y++)for(let x=35;x<=40;x++)px(x+dx,y);
  if(braco)for(let y=2;y<=30;y++)for(let x=41;x<=56;x++)px(x+dx,y);
  return b;
}
const seq=(fs:Uint8Array[])=>({medidas:fs.map(b=>medirQuadro(b,W,0,0,W,H)),mascaras:fs.map(b=>mascaraQuadro(b,W,0,0,W,H,1))});

test('classificarQuadro: a frame shifted sideways is desalinhamento with the shift back as correction',()=>{
  const {medidas,mascaras}=seq(Array.from({length:8},(_,i)=>rgba(i===5?9:0,{pe:i>>2&1})));
  const c=classificarQuadro(mascaras,medidas,5,true);
  assert.equal(c.tipo,'desalinhamento',JSON.stringify(c));
  assert.ok(c.iouAlinhado>c.iouCru);assert.ok(Math.abs(c.correcao.dx+9)<0.5,String(c.correcao.dx));assert.equal(c.correcao.dy,0);
});

test('classificarQuadro: a neighbour that is also out of place does not spoil the alignment with the other one',()=>{
  const {medidas,mascaras}=seq(Array.from({length:8},(_,i)=>rgba(i===5?9:i===6?-7:0,{pe:i>>2&1})));
  assert.equal(classificarQuadro(mascaras,medidas,5,true).tipo,'desalinhamento');
});

test('classificarQuadro: a frame with a different drawing is arte-nova; an empty frame too',()=>{
  const {medidas,mascaras}=seq(Array.from({length:8},(_,i)=>rgba(0,{pe:i>>2&1,braco:i===3})));
  assert.equal(classificarQuadro(mascaras,medidas,3,true).tipo,'arte-nova');
  assert.deepEqual(classificarQuadro(mascaras,[...medidas.slice(0,3),null,...medidas.slice(4)],3,true),{tipo:'arte-nova',motivo:'vazio'});
});
