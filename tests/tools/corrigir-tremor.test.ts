import test from 'node:test';
import assert from 'node:assert/strict';
import {correcaoQuadro,moverCelula,marcados,naBorda} from '../../scripts/corrigir-tremor.mjs';
import {medirQuadro} from '../../scripts/medir-tremor.mjs';

const q=(cx:number,base=100,altura=80)=>({cx,base,altura,pex:cx,topo:base-altura+1,largura:30,cy:base-altura/2,escala:40});

test('loop: o quadro que pulou de lado volta para a média dos vizinhos; o eixo não marcado não mexe',()=>{
  const qs=[q(64),q(65),q(94),q(66),q(64),q(65)];
  assert.deepEqual(correcaoQuadro(qs,2,'walk',new Set(['x']),1),{dx:65.5-94,dy:0,s:1});
  // Só a altura marcada e o medidor não achou escala (≈ 1): nada a fazer, o balanço do andar fica.
  assert.deepEqual(correcaoQuadro(qs,2,'walk',new Set(['s']),1.01),{dx:0,dy:0,s:1});
});

test('ação: só o pico isolado entra; movimento que segue (queda, golpe) fica',()=>{
  // Morte caindo para a direita: cada quadro mais à direita que o anterior — não é pico.
  const queda=[q(60),q(70),q(85),q(100),q(110)];
  assert.equal(correcaoQuadro(queda,2,'death',new Set(['x']),1),null);
  // Um quadro só fora, os dois vizinhos juntos: pico.
  const pico=[q(60),q(61),q(80),q(61),q(60)];
  assert.equal(correcaoQuadro(pico,2,'death',new Set(['x']),1)?.dx,-19);
});

test('marcados: só desalinhamento, por quadro, juntando os eixos; pex (pose dos pés) não move',()=>{
  const a=(quadro:number,medida:string,tipo='desalinhamento')=>({inimigo:'x',anim:'walk',dir:0,quadro,medida,tipo,correcao:{escala:1}});
  const l=marcados([a(1,'cx'),a(1,'pe'),a(2,'pex'),a(3,'cx','arte-nova')],'x','walk');
  assert.deepEqual(l.map(m=>[m.quadro,[...m.eixos].sort()]),[[1,['x','y']]]);
});

test('moverCelula leva o pé (cx, base) até o lugar pedido sem mudar o desenho',async()=>{
  const w=40,h=40,cel=Buffer.alloc(w*h*4);
  for(let y=10;y<30;y++)for(let x=5;x<15;x++)cel[(y*w+x)*4+3]=255; // bloco 10×20, pé em y=29, cx=9.5
  const antes=medirQuadro(cel,w,0,0,w,h)!;
  const depois=medirQuadro(await moverCelula(cel,w,h,{dx:12,dy:-3,s:1},antes.cx,antes.base),w,0,0,w,h)!;
  assert.equal(depois.cx,antes.cx+12);assert.equal(depois.base,antes.base-3);assert.equal(depois.altura,antes.altura);
});

test('naBorda conta o que encosta na borda da célula: o quadro movido para fora dela foi cortado',async()=>{
  const w=20,h=20,cel=Buffer.alloc(w*h*4);
  for(let y=5;y<15;y++)for(let x=5;x<15;x++)cel[(y*w+x)*4+3]=255;
  assert.equal(naBorda(cel,w,h),0);
  const movido=await moverCelula(cel,w,h,{dx:8,dy:0,s:1},10,14);
  assert.ok(naBorda(movido,w,h)>0);
});
