// Popup de escolha com arte (NEW-20261025-ORQ-popup-escolha-trico).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {ESCOLHA_HEROIS,escolhaArte} from '../../src/client/ui/escolha-popup.ts';
import {classes} from '../../src/rules/classes.ts';

test('cada herói com arte tem os 2 botões (amigos feliz, sozinho triste) em webp leve, e é uma classe de verdade',()=>{
  const ids=new Set(classes.map(c=>c.id));
  assert.equal(ESCOLHA_HEROIS.length,6);
  for(const id of ESCOLHA_HEROIS){
    assert.ok(ids.has(id),`${id}: não é classe`);
    const arte=escolhaArte(id)!;
    for(const url of [arte.amigos,arte.sozinho,arte.amigosDeitado,arte.sozinhoDeitado]){
      const file=`public${url}`;
      assert.ok(existsSync(file),`${file} falta`);
      assert.ok(statSync(file).size<120_000,`${file}: pesado demais para o popup`);
      if(url===arte.amigos||url===arte.amigosDeitado)assert.ok(temAlfa(file),`${file}: o grupo vai recortado, sem cenário (webp com transparência)`);
    }
  }
});

// BUG-20261026-ORQ-popup-trico-ajustes: os amigos vão recortados em cima do bloco amarelo; o sozinho é arte cheia com o chão lavanda.
function temAlfa(file:string):boolean {
  const b=readFileSync(file);
  if(b.toString('ascii',12,16)==='VP8X')return (b[20]&0x10)!==0;
  return b.toString('ascii',12,16)==='VP8L'&&(b[24]&0x10)!==0;
}

test('herói sem arte fica com os botões de texto de hoje',()=>{
  assert.equal(escolhaArte('cidadao-comum'),null);
});

test('moldura de tricô e X existem; o texto do botão fica num span (o "Preparando…" e o convite não apagam a imagem); a arte só entra ao abrir',()=>{
  for(const f of ['moldura-trico','x-fechar','bloco-amigos','bloco-sozinho'])assert.ok(existsSync(`public/art/menu/escolha/${f}.webp`),f);
  const main=readFileSync('src/main.ts','utf8');
  assert.match(main,/<button id="enter-island" class="secondary-button"><span class="escolha-rotulo">Jogar sozinho<\/span><\/button>/);
  assert.match(main,/coopButton\.innerHTML='<span class="escolha-rotulo">Jogar com amigos<\/span>'/);
  assert.doesNotMatch(main,/coopButton\.textContent=|button\.textContent=/,'texto do botão sempre pelo rotulo()');
  assert.match(main,/mostrarEscolha\(dialog,selected\.id\);\n\s*dialog\.showModal\(\);dialog\.focus\(\);/,'o foco ao abrir não cai no X');
  assert.match(main,/<div class="solo-row"><button id="enter-island"[^]*?<div class="solo-bots"/,'os bots ficam dentro do bloco do "Jogar sozinho"');
  const css=readFileSync('src/client/ui/escolha.css','utf8');
  assert.match(css,/border-image:url\('\/art\/menu\/escolha\/moldura-trico\.webp'\)/);
  assert.match(css,/x-fechar\.webp/);
  assert.match(css,/bloco-amigos\.webp/);assert.match(css,/bloco-sozinho\.webp/);
});
