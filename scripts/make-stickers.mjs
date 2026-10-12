#!/usr/bin/env node
/**
 * Adesivos ilustrados de itens, prêmios e sons (NEW-20261009-DSG-adesivos-itens, revisao-visual.md §2.4).
 * Gera src/ui/stickers.svg a partir da geometria abaixo: `node scripts/make-stickers.mjs` (o teste
 * tests/stickers.test.ts confere que o arquivo gerado bate com este script).
 *
 * Mesmo traço do sprite de sistema (src/ui/icons.svg): silhueta com sombra dura Breu + borda branca-papel, arte com
 * contorno Breu, cor chapada só por classe de token, uma luz (ik-brilho) e uma sombra (ik-tom, recortada pela peça).
 * Cada adesivo tem uma leve inclinação própria (o `rot`), para não parecer carimbado em série.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const n=v=>+v.toFixed(2);
/** One drawn piece. `sil` = part of the sticker's outline (paper edge and hard shadow). */
const piece=(tag,attrs,cls,sil)=>({tag,attrs,cls,sil:sil??(/^f-/.test(cls))});
const attr=a=>Object.entries(a).map(([k,v])=>`${k}="${typeof v==='number'?n(v):v}"`).join(' ');
const P=(d,cls,o={})=>piece('path',{d,...o.a},cls,o.sil);
const C=(cx,cy,r,cls,o={})=>piece('circle',{cx,cy,r,...o.a},cls,o.sil);
const E=(cx,cy,rx,ry,cls,o={})=>piece('ellipse',{cx,cy,rx,ry,...(o.rot!==undefined?{transform:`rotate(${o.rot} ${cx} ${cy})`}:{}),...o.a},cls,o.sil);
const R=(x,y,w,h,rx,cls,o={})=>piece('rect',{x,y,width:w,height:h,...(rx?{rx}:{}),...(o.rot!==undefined?{transform:`rotate(${o.rot} ${n(x+w/2)} ${n(y+h/2)})`}:{}),...o.a},cls,o.sil);
/** A group of pieces under one transform (a copy of a shape, a turned part). */
const G=(transform,pieces)=>({group:true,transform,pieces});
/** Detail line inside the shape (not outline). */
const L=(d,o={})=>P(d,o.thin?'ik-fina':'ik-linha',{sil:false,...o});
/** Open stroke that IS part of the outline (handle, strap, antenna): breu line, and the paper edge follows it. */
const S=(d)=>P(d,'f-nada',{sil:true});
/** Thick colored stroke with a breu outline (umbrella handle, broom stick): two strokes, one outline. */
const T=(d,color)=>[P(d,'ik-cabo-fundo',{sil:true}),P(d,`ik-cabo c-${color}`,{sil:false})];
/** Light: one short papel-claro stroke. */
const LUZ=d=>P(d,'ik-brilho',{sil:false});
/** Shade: one translucent breu patch, clipped to the given pieces (so it never spills off the body). */
const TOM=(d,clip)=>({tom:true,d,clip:[clip].flat()});
const DOT=(cx,cy,r,cls='ik-ponto')=>piece('circle',{cx,cy,r},cls,false);

const flat=list=>list.flat(Infinity);
function render(p,mode){
  if(p.group){const inner=p.pieces.flat(Infinity).map(x=>render(x,mode)).filter(Boolean).join('');return inner?`<g transform="${p.transform}">${inner}</g>`:'';}
  if(p.tom)return mode==='art'?`<path d="${p.d}" class="ik-tom" clip-path="url(#${p.clipId})"/>`:'';
  if(mode==='sil'){
    if(!p.sil)return '';
    return `<${p.tag} ${attr(p.attrs)}${p.cls==='f-nada'||p.cls==='ik-cabo-fundo'?' fill="none"':''}/>`;
  }
  if(mode==='clip')return `<${p.tag} ${attr(p.attrs)}/>`;
  return `<${p.tag} ${attr(p.attrs)} class="${p.cls}"/>`;
}

// ---------------------------------------------------------------- shapes reused by more than one sticker
const chineloSole='M24 7C31 7 34 12 33.2 18C32.5 23 30 25.5 30.5 29.5C31 35 29 41 23.5 41C18 41 16.4 36 16.9 30.5C17.4 25.5 15 22.5 15 17C15 11 18 7 24 7Z';
const chineloStrap='M22.6 12.8L25.4 12.8L32.2 25.2L29.8 27.2L24 17.6L18.2 27.2L15.8 25.2Z';
/** `tom`: this copy carries the sticker's one shade and one light (the back copy of a pair does not). */
const chinelo=(tom=true)=>{
  const sole=P(chineloSole,'f-cartolina');
  return [sole,P('M17 33C18 38 21 40.5 24 40.5C28 40.5 30.5 37 30.6 31.5',  'ik-fina',{sil:false}),
    tom?TOM('M29 6L42 6L42 44L24 44C29 41 31.5 36 30.8 29.5C30.3 25 33.5 22 33.5 17C33.5 12 31 8.5 29 6Z',sole):[],
    P(chineloStrap,'f-amarelo'),C(24,14.2,2.4,'f-amarelo'),tom?LUZ('M18.6 13.5a7.5 7.5 0 0 1 3-4.2'):[]];
};
const coxinhaBody='M24 5C26.5 11 38 19 38 30C38 36.5 35 40.5 31 41.5L17 41.5C13 40.5 10 36.5 10 30C10 19 21.5 11 24 5Z';
const slip=(x,y,cls)=>R(x,y,26,30,2,cls);
const barcode=(x0,y0,h)=>[
  ...[0,6,13,20].map(dx=>L(`M${x0+dx} ${y0}L${x0+dx} ${y0+h}`)),
  ...[2.8,9,11,16.4,23].map(dx=>L(`M${x0+dx} ${y0}L${x0+dx} ${y0+h}`,{thin:true})),
];
const medal=(cls,digit)=>{
  const disc=C(24,30,12.5,cls);
  return [
    P('M14 3L22 3L27.5 18L20 19.5Z','f-lilas'),P('M34 3L26 3L20.5 18L28 19.5Z','f-lilas-escuro'),
    disc,TOM('M24 17A13 13 0 0 1 24 43A9 13 0 0 0 24 17Z',disc),
    ...T(digit,'claro'),LUZ('M14.5 27a10 10 0 0 1 4-6'),
  ];
};

// ---------------------------------------------------------------- the stickers
// name, title (read by screen readers through the caller's label), tilt, pieces
const STICKERS=[
  // ---------- items (src/game/hud/items.ts) ----------
  ['chinelo','Chinelo da Mãe',-24,chinelo()],
  ['boleto','Boleto Vencido',-9,(()=>{const paper=slip(11,8,'f-claro');return [
    paper,TOM('M37 6L40 6L40 40L30 40Z',paper),P('M30 38L37 31L37 36Q37 38 35 38Z','f-papel',{sil:false}),
    L('M15 13.5L27 13.5'),L('M15 18.5L23 18.5',{thin:true}),
    R(25.5,15,9.5,6,1,'f-lilas',{rot:-14,sil:false}),
    ...barcode(15,24,9),LUZ('M13.5 26l0 8')];})()],
  ['cafe','Café Derramado',-4,(()=>{
    const puddle=P('M14 36C14 31 20 30 25 31C29 28 36 29 38 32C43 32 45 35 43 38C41 41 35 41 31 40.5C26 42 19 42 16 40.5C14.5 39.5 14 38 14 36Z','f-cafe');
    const cup=P('M12 12L34 12L32.5 28Q31.5 35 23 35Q14.5 35 13.5 28Z','f-claro');
    return [puddle,
      G('rotate(-72 24 24) translate(-2 -5)',[...T('M33.5 16Q41 15.5 40.5 22Q40 28 32.5 26.5','claro'),cup,
        R(14,17,19,4,0,'f-lilas',{sil:false}),
        TOM('M28 10L40 10L40 40L22 40Q30 36 28 10Z',cup),E(23,12,11,3,'f-cafe'),LUZ('M17 24l1 5')]),
      P('M33 12Q31 8 34 5M39 14Q37 10 40 7','f-nada',{sil:false}),C(43,29,1.6,'f-cafe')];})()],
  ['guarda-chuva','Guarda-chuva da Vó',12,(()=>{
    const dome=P('M6 25C6 14 14 7.5 24 7.5C34 7.5 42 14 42 25Q39 22 36 25Q33 22 30 25Q27 22 24 25Q21 22 18 25Q15 22 12 25Q9 22 6 25Z','f-lilas');
    return [...T('M24 25L24 37Q24 42 28.5 42Q32.5 42 32.5 38','casca'),
      dome,P('M24 7.5Q18.5 14 18 25Q21 22 24 25Q27 22 30 25Q29.5 14 24 7.5Z','f-papel'),
      DOT(13,19,1.6,'ik-flor'),DOT(35,19,1.6,'ik-flor'),DOT(24,17,1.6,'ik-flor'),
      TOM('M30 4L46 4L46 30L30 30Q31 14 30 4Z',dome),C(24,6,1.8,'f-breu'),LUZ('M10 19a14 14 0 0 1 6-7.5')];})()],
  ['pombo','Pombo da Praça',-6,(()=>{
    const body=E(26,28,15,10.5,'f-pedra',{rot:-12});
    const head=C(14.5,16,6.5,'f-pedra');
    return [P('M37 23L46 17L45.5 27Z','f-pedra'),body,
      P('M12 39L12 43M17 39L17 43','f-nada',{sil:true}),
      P('M24 22C30 20 36 22 38 27C32 30 26 29 24 22Z','f-claro',{sil:false}),L('M27 24L33 26.5',{thin:true}),L('M27.5 27L33 28',{thin:true}),
      head,P('M10 21C13 24 18 25 21.5 22.5L22 27C18 29 13 27.5 10.5 25Z','f-gema',{sil:false}),
      TOM('M8 34C16 42 34 42 42 30L44 44L6 44Z',body),
      P('M8.5 15.5L4 17.5L8.5 19Z','f-papel'),C(13,14.5,2.2,'f-cone',{sil:false}),C(13,14.5,0.9,'f-breu',{sil:false}),
      LUZ('M12 11a5 5 0 0 1 4-1.5')];})()],
  ['audio','Áudio de 5 Minutos',-6,(()=>{
    const bubble=P('M10 11L40 11Q44 11 44 15L44 31Q44 35 40 35L12 35L4 41L7 33Q4 32 4 29L4 15Q4 11 10 11Z','f-claro');
    return [bubble,TOM('M2 30L46 26L46 44L2 44Z',bubble),
      C(13,23,6,'f-lilas'),P('M11 19.5L16.5 23L11 26.5Z','f-claro',{sil:false}),
      ...[[21,4],[24,8],[27,5],[30,10],[33,6],[36,8],[39,3]].map(([x,h])=>L(`M${x} ${23-h/2}L${x} ${23+h/2}`)),
      LUZ('M8 15l4-1')];})()],
  ['chinelo-evo','Havaianas do Caos',0,[
    P('M5 30Q2 18 12 10M43 18Q46 30 36 38','f-nada',{sil:false}),
    G('translate(-8 2) rotate(-32 24 24) scale(.82) translate(5 5)',chinelo(false)),
    G('translate(8 1) rotate(26 24 24) scale(.82) translate(5 5)',chinelo()),
    P('M20 41L22.5 36L25 41L30 42L25.5 44.5L26 49L22.5 46.5L19 49L19.5 44.5L15 42Z','f-amarelo',{a:{transform:'translate(1 -4) scale(.95) rotate(8 22 42)'}})]],
  ['boleto-evo','Carnê Infinito',0,(()=>{const front=slip(13,12,'f-claro');return [
    slip(8,9,'f-papel',),G('rotate(9 24 24)',[slip(14,6,'f-papel')]),
    G('rotate(-6 24 24)',[front,TOM('M36 10L42 10L42 44L34 44Z',front),
      ...[17,22,27,32].map(x=>C(x,12,1.8,'f-nada',{sil:false})),
      L('M17 19L31 19'),L('M17 23.5L26 23.5',{thin:true}),...barcode(17,29,8)]),
    LUZ('M15 30l0 7')];})()],
  ['cafe-evo','Cafeteira Industrial',-4,(()=>{
    const body=P('M12 15L36 15L36.5 31Q36.5 34 33.5 34L14.5 34Q11.5 34 11.5 31Z','f-pedra');
    return [P('M30 9Q32 6 30 3M35 11Q37 8 35 5','f-nada',{sil:false}),
      R(13,33,3,8,1,'f-breu'),R(32,33,3,8,1,'f-breu'),
      body,P('M10.5 16Q24 5 37.5 16Z','f-pedra'),C(24,9,2.4,'f-breu'),
      R(16,18.5,4.5,12,2,'f-claro',{sil:false}),R(16,24,4.5,6.5,2,'f-cafe',{sil:false}),
      R(10.5,21,27,3,1,'f-claro',{sil:false}),
      P('M26 34L31 34L31 36.5L29.5 36.5L29.5 38L27.5 38L27.5 36.5L26 36.5Z','f-breu'),
      P('M23 39L34 39L33 44Q33 46 31 46L26 46Q24 46 24 44Z','f-claro'),E(28.5,39,5.5,1.4,'f-cafe',{sil:false}),
      TOM('M30 12L40 12L40 36L30 36Z',body),L('M24 27L33 27',{thin:true}),L('M24 30.5L30 30.5',{thin:true}),
      LUZ('M14.5 19l0 8')];})()],
  ['cafe-forte','Café Coado na Meia',-8,(()=>{
    const sock=P('M13 13L27 13L27 25C27 29 30 30 34 31C40 32.5 41 39 36 40.5C32 41.5 26 41.5 22 40.5C15 39 13 34 13 28Z','f-claro');
    return [...T('M28 11L41 5','pedra'),sock,
      P('M13 17L27 17L27 21L13 21Z','f-lilas',{sil:false}),P('M13 25L27 25L27 27Q28 29 30 29.5L13 29.5Z','f-lilas',{sil:false}),
      P('M24 40.5C21 38 23 34 27 33.5C31 33 35 32 37.5 33.5C41 36 39.5 40 36 40.5C32 41.5 27 41.5 24 40.5Z','f-cafe',{sil:false}),
      TOM('M30 6L46 6L46 46L20 46C34 42 33 35 28 31Z',sock),
      E(20,12,9,3,'f-nada'),P('M30 44Q31 42 32 44A1.6 1.6 0 0 1 30 44Z','f-cafe'),
      LUZ('M16 23l0 10')];})()],
  ['marmita','Marmita da Vó',-5,(()=>{
    const box=R(7,25,34,15,4,'f-pedra');
    return [R(30,5,9,24,3,'f-pedra',{rot:24}),
      P('M9 26C9 18 16 13.5 24 13.5C32 13.5 39 18 39 26Z','f-claro'),
      E(19,20.5,6.5,4.5,'f-claro',{sil:false}),C(19.5,20.5,2.8,'f-amarelo',{sil:false}),
      DOT(29,19,1.2,'ik-ponto'),DOT(32,22,1.2,'ik-ponto'),DOT(27,23,1.2,'ik-ponto'),DOT(34,25,1.2,'ik-ponto'),
      box,L('M7 30.5L41 30.5'),R(3.5,28,4.5,7,1.5,'f-claro'),R(40,28,4.5,7,1.5,'f-claro'),
      TOM('M4 35.5L46 35.5L46 44L4 44Z',box),LUZ('M11 34.5l9 0')];})()],
  ['tenis','Tênis de Feira',-8,(()=>{
    const upper=P('M6 31C6 23 9 17 14 16.5L21 17.5C23 21.5 27.5 23.5 33 24.5C39 25.5 42 28 42 32L42 33L6 33Z','f-claro');
    return [P('M5 32L43 32C43 36 41.5 39 38 39L9 39C6.5 39 5 37 5 32Z','f-papel'),upper,
      TOM('M4 29C14 31 30 31 46 28L46 34L4 34Z',upper),
      P('M12 30C18 30 25 28 34 24C29 29 22 31.5 15 31.5C19 32.5 26 32 30 30.5C24 34 15 33.5 12 30Z','f-lilas',{sil:false}),
      L('M17 20L21 19'),L('M18.5 23L23 21.5'),L('M20.5 26L25 24.3'),
      R(5,14,6,8,2,'f-lilas'),L('M8 36L40 36',{thin:true}),LUZ('M9 22a8 8 0 0 1 3-3.5')];})()],
  ['megafone','Megafone do Carro do Ovo',-4,(()=>{
    const car=P('M5 33L5 28Q5 24 9 23.5L14 22L18 16.5Q19.5 15 22 15L32 15Q35 15 36.5 17.5L39.5 23Q43 24 43 28L43 33Z','f-lilas');
    return [P('M22 15L22 10','f-nada'),
      P('M14 4L20 7.5L20 11.5L14 13Z','f-claro'),P('M20 6L33 1L33 18L20 13Z','f-claro'),E(33,9.5,2.6,8.5,'f-amarelo'),
      P('M37 5Q40 9.5 37 14M40.5 2Q45 9.5 40.5 17','f-nada',{sil:false}),
      car,P('M19.5 17.5L23.5 17.5L23.5 23L16 23Z','f-gema',{sil:false}),P('M26.5 17.5L32 17.5Q33.5 17.5 34.5 19L36.5 23L26.5 23Z','f-gema',{sil:false}),
      E(25,28.5,3,3.8,'f-claro',{sil:false}),
      TOM('M3 30L45 30L45 36L3 36Z',car),
      C(13,34,4.6,'f-breu'),C(35,34,4.6,'f-breu'),C(13,34,1.8,'f-pedra',{sil:false}),C(35,34,1.8,'f-pedra',{sil:false}),
      LUZ('M8 27l4-1.5')];})()],
  ['bone','Boné do Pai',-10,(()=>{
    const crown=P('M12 29C12 17.5 19 11 28 11C37 11 42 18 42 29Z','f-lilas');
    return [crown,P('M12 29C12 17.5 19 11 28 11C25 15 23.5 21 24 29Z','f-claro',{sil:false}),
      DOT(33,18,1),DOT(37,21,1),DOT(33,24,1),DOT(37,26,1),
      C(18.5,21,3.2,'f-amarelo',{sil:false}),
      TOM('M30 9L46 9L46 30L32 30C36 24 35 15 30 9Z',crown),
      P('M3 29.5L12 27L42 28.5L42 32L4 33Z','f-lilas-escuro'),C(28,10.5,2,'f-lilas'),
      LUZ('M15 22a12 12 0 0 1 4-7')];})()],
  ['ima','Ímã de Geladeira',-6,(()=>{
    const slice=P('M8 41L17 9.5Q33 11 41.5 25Z','f-amarelo');
    return [P('M6 4L10 8M3 10L8 11','f-nada',{sil:false}),
      slice,P('M17 9.5Q33 11 41.5 25L38 27Q31 15.5 16 13.5Z','f-dourado',{sil:false}),
      C(20,22,3.2,'f-casca',{sil:false}),C(28,24.5,2.6,'f-casca',{sil:false}),C(17,32,2.6,'f-casca',{sil:false}),
      TOM('M8 41L41.5 25L46 40L10 46Z',slice),
      P('M11 2L15 6L11 10L7 6Z','f-gema',{a:{transform:'translate(-4 7)'}}),
      LUZ('M13 31l3-11')];})()],
  ['oculos','Óculos Juliet',6,(()=>{
    const left=P('M4 19C9 16 19 16.5 22.5 19L21.5 27C18.5 32.5 10 32.5 7 28.5Z','f-lilas-escuro');
    const right=P('M44 19C39 16 29 16.5 25.5 19L26.5 27C29.5 32.5 38 32.5 41 28.5Z','f-lilas-escuro');
    return [S('M4 20L1 24M44 20L47 24'),left,right,
      P('M6 24L22 19L22 22L7 27Z','f-gema',{sil:false}),P('M26 22L42 19L42 22L27 26Z','f-gema',{sil:false}),
      P('M8 28L21 24L20.5 26.5L10 30Z','f-amarelo',{sil:false}),P('M28 27L40 24L39.5 27L30 30Z','f-amarelo',{sil:false}),
      TOM('M0 28L48 28L48 40L0 40Z',[left,right]),
      R(4,15.5,40,4.5,2,'f-pedra'),P('M20 18L28 18L26 22.5L22 22.5Z','f-pedra'),
      C(8,17.7,1,'f-breu',{sil:false}),C(40,17.7,1,'f-breu',{sil:false}),LUZ('M10 21l5-1.5')];})()],
  ['cartao','Cartão Fidelidade',-7,(()=>{
    const card=R(5,11,38,26,3,'f-claro');
    return [card,P('M5 14Q5 11 8 11L40 11Q43 11 43 14L43 18.5L5 18.5Z','f-lilas',{sil:false}),
      ...[11.5,19.5,27.5,35.5].map((x,i)=>C(x,26.5,3.3,i===0?'f-lilas':'f-nada',{sil:false})),
      L('M10 33L30 33',{thin:true}),
      TOM('M3 33L45 33L45 39L3 39Z',card),LUZ('M8 22l0 3')];})()],
  ['coxinha','Coxinha da Cantina',-10,(()=>{
    // A real bite out of the outline (a circle around 37,12), and the catupiry face inside it, wide enough to read at 24 px.
    const body=P('M24 5C24.6 6.5 25 8 25.5 9.5A12 12 0 0 0 37 24C37.7 26 38 28 38 30C38 36.5 35 40.5 31 41.5L17 41.5C13 40.5 10 36.5 10 30C10 19 21.5 11 24 5Z','f-dourado');
    return [body,DOT(16,24,1.2),DOT(21,33,1.2),DOT(15,34,1.2),DOT(21,38,1.2),DOT(28,37,1.2),DOT(17,29,1.2),DOT(33,35,1.2),DOT(27,31,1.2),DOT(20,18,1.2),
      P('M25.5 9.5A12 12 0 0 0 37 24Q34 30.5 26.5 28Q19 24 20.5 16Q22 11 25.5 9.5Z','f-claro',{sil:false}),
      E(25,21,3,2,'f-amarelo',{sil:false,rot:-30}),
      TOM('M33 28L46 28L46 46L22 46C32 42 37.5 36 37.5 30Z',body),
      LUZ('M13.5 30a13 13 0 0 1 3-8')];})()],
  ['misterio','Item misterioso',-6,(()=>{
    const box=R(9,16,30,24,2,'f-papel');
    return [P('M9 16L4 10L18 8L22 16Z','f-casca'),P('M39 16L44 10L30 8L26 16Z','f-casca'),box,
      TOM('M30 14L42 14L42 42L30 42Z',box),
      P('M19.5 24Q19.5 19.5 24 19.5Q28.5 19.5 28.5 23.5Q28.5 26 25.5 27L25.5 30','f-nada',{sil:false}),C(25.5,34.5,1.8,'f-breu',{sil:false}),
      LUZ('M12 20l0 7')];})()],

  // ---------- awards (src/game/hud/awards.ts) ----------
  ['banana','Mais caiu',8,(()=>{
    const back=P('M21 31C20 22 22 13.5 28 8.5L31.5 10C28 15 27.5 23 27.5 31Z','f-amarelo');
    return [back,R(27,6,4.5,4,1,'f-casca',{rot:32}),
      C(24,31,4.6,'f-claro'),
      P('M22 30C16 29.5 9 32.5 5.5 39C12 39.5 18.5 37 23.5 34Z','f-amarelo'),
      P('M26 30C32 29.5 39 32 42.5 38.5C36 39.5 29.5 37 24.5 34Z','f-amarelo'),
      P('M22 33C20.5 37 21.5 41.5 25.5 43.5C27 39.5 27 36 26 33Z','f-amarelo'),
      TOM('M4 37C14 36 34 36 44 37L44 46L4 46Z',[P('M22 30C16 29.5 9 32.5 5.5 39C12 39.5 18.5 37 23.5 34Z','x'),P('M26 30C32 29.5 39 32 42.5 38.5C36 39.5 29.5 37 24.5 34Z','x')]),
      L('M24.5 27L27 13',{thin:true}),LUZ('M23.5 25a14 14 0 0 1 2-10')];})()],
  ['ambulancia','Rei do resgate',-5,(()=>{
    const van=P('M4 34L4 17Q4 14 7 14L30 14Q33 14 35 16.5L41 24Q44 25 44 28L44 34Z','f-claro');
    return [R(15,9,7,5,1.5,'f-cone'),van,P('M32 17.5L37 24L32 24Z','f-gema',{sil:false}),
      R(4,25,40,3.5,0,'f-lilas',{sil:false}),
      P('M14 17L18 17L18 20L21 20L21 24L18 24L18 27L14 27L14 24L11 24L11 20L14 20Z','f-cartolina',{sil:false}),
      TOM('M2 30L46 30L46 38L2 38Z',van),
      C(12,35,4.6,'f-breu'),C(35,35,4.6,'f-breu'),C(12,35,1.8,'f-pedra',{sil:false}),C(35,35,1.8,'f-pedra',{sil:false}),
      LUZ('M7 22l0-4')];})()],
  ['mochila','Carregou o time',-7,(()=>{
    const bag=P('M11 20Q11 12 19 12L29 12Q37 12 37 20L37 39Q37 42 34 42L14 42Q11 42 11 39Z','f-lilas');
    return [P('M17 13Q17 6 24 6Q31 6 31 13','f-nada'),
      G('rotate(-20 30 9)',[R(26,2,8,15,4,'f-dourado'),L('M28.5 6L31.5 5',{thin:true}),L('M28.5 10L31.5 9',{thin:true})]),
      bag,R(15,27,18,12,3,'f-papel',{sil:false}),L('M15 31L33 31',{thin:true}),
      TOM('M30 10L40 10L40 44L30 44Z',bag),S('M11 22L7 36'),S('M37 22L41 36'),LUZ('M14 18l0 6')];})()],
  ['rodo','Exterminador de gosma',0,(()=>{
    const goo=P('M4 40C4 33 9 30 14 31C16 27 23 28 24 32C27 31 30 34 29 38L29 40Z','f-gema');
    return [goo,TOM('M2 37L31 37L31 42L2 42Z',goo),
      P('M10.5 33.5L13.5 36.5M13.5 33.5L10.5 36.5','f-nada',{sil:false}),P('M18 33.5L21 36.5M21 33.5L18 36.5','f-nada',{sil:false}),
      ...T('M37 31L41 6','casca'),
      R(29,29,16,5,1.5,'f-lilas',{rot:6}),R(28.5,33.5,17,3.5,1,'f-breu',{rot:6}),
      LUZ('M7 34a6 6 0 0 1 3-2.5')];})()],
  ['antena','Build mais sem sentido',-6,(()=>{
    const tv=R(7,20,34,21,4,'f-lilas');
    return [S('M22 20L13 9M26 20L32 9'),C(13,8.5,2,'f-pedra'),
      P('M30 7C30 3 37 3 37 7C40 7 40 12 36.5 12C35.5 15 30 14.5 30 12C27 12 27 7 30 7Z','f-pedra'),
      L('M30 8Q32 11 34 8T37 10',{thin:true}),
      tv,R(11,24,21,14,3,'f-gema',{sil:false}),L('M14 28L22 28',{thin:true}),L('M17 32L29 32',{thin:true}),
      C(36.5,27,2,'f-claro',{sil:false}),C(36.5,34,2,'f-claro',{sil:false}),
      TOM('M3 37L45 37L45 44L3 44Z',tv),R(12,40,4,4,1,'f-breu'),R(32,40,4,4,1,'f-breu'),
      LUZ('M14 35l0-6')];})()],
  ['ima-ferradura','Ímã humano',28,(()=>{
    const u=P('M10 12L19 12L19 26A5 5 0 0 0 29 26L29 12L38 12L38 26A14 14 0 0 1 10 26Z','f-lilas');
    return [u,R(10,10,9,6,1,'f-pedra'),R(29,10,9,6,1,'f-pedra'),
      TOM('M30 22L42 22L42 44L20 44Z',u),
      P('M12 5L14 1M24 5L24 0M36 5L34 1','f-nada',{sil:false}),
      LUZ('M13 27a11 11 0 0 0 3 7')];})()],
  ['camera','Turista',8,(()=>{
    const body=R(5,15,38,24,4,'f-lilas');
    return [S('M7 18Q2 30 9 40'),R(10,10,10,6,1.5,'f-lilas'),R(31,11,8,5,1,'f-amarelo'),
      body,R(5,21,38,4,0,'f-lilas-escuro',{sil:false}),
      C(25,28,9,'f-claro'),C(25,28,5.6,'f-lilas-escuro',{sil:false}),C(23,26,1.8,'f-gema',{sil:false}),
      TOM('M3 34L46 34L46 42L3 42Z',body),LUZ('M9 31l0-7')];})()],
  ['coxinhas','Colecionador de coxinha',0,(()=>{
    const plate=E(24,39,20,5.5,'f-claro');
    const cx=(x,y,s)=>G(`translate(${x} ${y}) scale(${s})`,[P(coxinhaBody,'f-dourado'),DOT(19,26,1.3),DOT(25,33,1.3),DOT(20,36,1.3)]);
    return [plate,TOM('M2 40L46 40L46 46L2 46Z',plate),
      cx(-1,15,.62),cx(19,15,.62),cx(9,2,.62),LUZ('M9 37l6-1')];})()],
  ['bau-aberto','Sortudo do baú',-5,(()=>{
    const base=R(8,24,32,18,3,'f-papel');
    return [P('M12 6L15 12M24 2L24 9M36 6L33 12','f-nada',{sil:false}),
      P('M8 25L6 13Q6 9 10 9.5L38 9.5Q42 9 42 13L40 25Z','f-lilas'),
      C(15,23,4.5,'f-amarelo'),C(24,21,5,'f-amarelo'),C(33,23,4.5,'f-amarelo'),C(20,25,4,'f-amarelo'),C(29,25,4,'f-amarelo'),
      base,R(21,26,6,7,1.5,'f-breu',{sil:false}),L('M14 24L14 42M34 24L34 42'),
      TOM('M6 36L42 36L42 44L6 44Z',base),LUZ('M21 19a4 4 0 0 1 3-2')];})()],
  ['travesseiro','Bate mas não mata',-14,(()=>{
    const pillow=P('M6 11Q15 15 24 13Q33 15 42 11Q38 24 42 37Q33 33 24 35Q15 33 6 37Q10 24 6 11Z','f-claro');
    return [pillow,L('M10 15Q24 19 38 15M10 33Q24 29 38 33',{thin:true}),
      TOM('M4 28Q24 25 44 28L44 40L4 40Z',pillow),P('M17 21Q19 24 17 27M31 21Q29 24 31 27','f-nada',{sil:false}),
      P('M36 2Q45 1 46 7Q40 9 36 2Z','f-claro'),L('M37 3L44 6',{thin:true}),P('M2 40Q8 36 12 41Q6 46 2 40Z','f-claro'),L('M3 40L11 41',{thin:true}),
      LUZ('M10 29a14 14 0 0 1 0-8')];})()],
  ['borboleta','Evolução de novela',-8,(()=>{
    const up=[P('M23 22C18 8 6 6 5 13C4 20 12 24 23 24Z','f-amarelo'),P('M25 22C30 8 42 6 43 13C44 20 36 24 25 24Z','f-amarelo')];
    const low=[P('M23 25C14 25 9 31 12 36C15 40 21 35 23 28Z','f-lilas'),P('M25 25C34 25 39 31 36 36C33 40 27 35 25 28Z','f-lilas')];
    return [S('M23 14L18 5M25 14L30 5'),...low,...up,
      C(12,14,2.8,'f-lilas',{sil:false}),C(36,14,2.8,'f-lilas',{sil:false}),
      TOM('M0 20L48 20L48 26L0 26Z',up),E(24,25,2.6,10,'f-breu'),LUZ('M9 11l3-2')];})()],
  ['halter','Marombeiro de upgrade',-18,(()=>{
    const can=(x)=>[R(x,13,11,22,2,'f-claro'),R(x,19,11,10,0,'f-lilas',{sil:false}),E(x+5.5,13,5.5,2,'f-pedra',{sil:false})];
    const left=R(5,13,11,22,2,'f-claro'),right=R(32,13,11,22,2,'f-claro');
    return [R(14,21.5,20,5,2,'f-pedra'),...can(5),...can(32),
      TOM('M3 30L46 30L46 37L3 37Z',[left,right]),LUZ('M8 17l0 8')];})()],
  ['claquete','Figurante de luxo',-6,(()=>{
    const board=R(7,18,34,23,3,'f-lilas-escuro');
    return [board,L('M12 26L36 26',{thin:true}),L('M12 32L28 32',{thin:true}),
      R(7,18,34,6,1,'f-claro',{sil:false}),P('M12 18L17 24M20 18L25 24M28 18L33 24','ik-linha',{sil:false}),
      G('rotate(-16 7 17)',[R(7,11,34,6,1,'f-claro'),P('M12 11L17 17M20 11L25 17M28 11L33 17','ik-linha',{sil:false})]),
      C(9.5,17.5,1.8,'f-breu',{sil:false}),
      TOM('M5 35L43 35L43 43L5 43Z',board),LUZ('M11 30l0 6')];})()],
  ['moeda','Empate',-10,(()=>{
    const face=E(24,24,13,16,'f-amarelo');
    return [E(26.5,24,13,16,'f-dourado'),face,E(24,24,9,12,'f-nada',{sil:false}),
      P('M19 28Q24 33 29 28','f-nada',{sil:false}),C(20.5,21,1.6,'f-breu',{sil:false}),C(27.5,21,1.6,'f-breu',{sil:false}),
      TOM('M30 4L44 4L44 44L28 44Q36 24 30 4Z',face),
      P('M4 12Q2 24 6 34M44 14Q47 24 43 34','f-nada',{sil:false}),
      LUZ('M15 18a10 13 0 0 1 4-7')];})()],
  ['medalha-2','Segundo lugar',-6,medal('f-pedra','M20 26.5Q20 23 24 23Q28 23 28 26.5Q28 29 20.5 35.5L28.5 35.5')],
  ['medalha-3','Terceiro lugar',-6,medal('f-casca','M20 24Q24 21.5 27 23.5Q29 26.5 24.5 29Q29 30 27.8 33.5Q25 36.5 20 35')],
  ['medalha','Na trave',-6,medal('f-papel','M24 36C18 31 16.5 28 18 25.5C19.5 23.5 22.5 23.5 24 26C25.5 23.5 28.5 23.5 30 25.5C31.5 28 30 31 24 36Z')],
];

export const STICKER_TITLES=Object.fromEntries(STICKERS.map(([name,title])=>[name,title]));

export function buildSprite(){
  const defs=[],symbols=[];
  for(const [name,title,rot,raw] of STICKERS){
    const pieces=flat([raw]);
    const wrap=s=>rot?`<g transform="rotate(${rot} 24 24)">${s}</g>`:s;
    // Clip paths for the shade patches.
    let k=0;
    const tag=list=>list.forEach(p=>{
      if(p.group){tag(flat(p.pieces));return;}
      if(p.tom){p.clipId=`ca-${name}-${k++}`;defs.push(`<clipPath id="${p.clipId}">${p.clip.map(c=>render(c,'clip')).join('')}</clipPath>`);}
    });
    tag(pieces);
    defs.push(`<g id="sa-${name}">${wrap(pieces.map(p=>render(p,'sil')).join(''))}</g>`);
    symbols.push(`<symbol id="a-${name}" viewBox="0 0 48 48"><title>${title}</title><use href="#sa-${name}" class="ik-sombra"/><use href="#sa-${name}" class="ik-papel"/><g class="ik-arte">${wrap(pieces.map(p=>render(p,'art')).join(''))}</g></symbol>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<!-- Adesivos ilustrados de itens, prêmios e sons (NEW-20261009-DSG-adesivos-itens). GERADO por scripts/make-stickers.mjs:
     não edite à mão. Cores só por classe (src/ui/icons.css, tokens). -->
<defs>
${defs.join('\n')}
</defs>
${symbols.join('\n')}
</svg>
`;
}
export const STICKER_LIST=STICKERS.map(([name])=>name);

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const out=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/ui/stickers.svg');
  fs.writeFileSync(out,buildSprite());
  console.log(`${STICKERS.length} adesivos em ${path.relative(process.cwd(),out)} (${fs.statSync(out).size} bytes)`);
}
