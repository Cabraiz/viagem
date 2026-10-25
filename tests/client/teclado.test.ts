// BUG-20261024-ORQ-teclado-cobre-nome-bora: with the phone's keyboard up on the name field, the choice column takes the
// box the keyboard leaves, so the field and BORA! sit right above the keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {caixaTeclado,tecladoAberto} from '../../src/client/ui/teclado.ts';

test('tecladoAberto: short, or much shorter than the page without the keyboard',()=>{
  assert.equal(tecladoAberto(844,844),false);assert.equal(tecladoAberto(390,390),false);
  assert.equal(tecladoAberto(800,844),false,'the URL bar only');
  assert.equal(tecladoAberto(430,844),true,'upright with the keyboard');
  assert.equal(tecladoAberto(180,390),true,'on its side with the keyboard');
});

test('caixaTeclado: the visible part, in the host\'s px, only while the field has the focus',()=>{
  const base={focado:true,vvAltura:430,vvTopo:0,cheia:844,hostTopo:0};
  assert.deepEqual(caixaTeclado(base),{top:0,height:430});
  assert.equal(caixaTeclado({...base,focado:false}),undefined,'no focus: the keyboard is not ours');
  assert.equal(caixaTeclado({...base,vvAltura:844}),undefined,'keyboard down');
  assert.equal(caixaTeclado({...base,vvAltura:0}),undefined,'no visual viewport size yet');
  // Chrome may pan the visual viewport to the field; a scrolled host moves the other way.
  assert.deepEqual(caixaTeclado({...base,vvTopo:120.4}),{top:120,height:430});
  assert.deepEqual(caixaTeclado({...base,vvTopo:120,hostTopo:-50}),{top:170,height:430});
  // A browser that shrinks the layout (resizes-content): innerHeight is short too, the height before the focus decides.
  assert.deepEqual(caixaTeclado({...base,vvAltura:430.6,cheia:844}),{top:0,height:430});
  assert.deepEqual(caixaTeclado({focado:true,vvAltura:178,vvTopo:0,cheia:390,hostTopo:0}),{top:0,height:178});
});

test('main.ts keeps the menu column above the keyboard; the CSS has the keyboard box',()=>{
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  assert.match(main,/manterAcimaDoTeclado\(etapa\.section,nameInput\)/);
  const estadio=readFileSync(new URL('../../src/client/estadio.css',import.meta.url),'utf8');
  assert.match(estadio,/\.estadio-escolha\[data-teclado\] \{[^}]*top: var\(--tec-top\)[^}]*height: var\(--tec-h\)[^}]*justify-content: flex-end/);
  const insta=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
  assert.match(insta,/\[data-teclado\] \{ --u: calc\(min\(100vw, var\(--tec-cheia/);
});
