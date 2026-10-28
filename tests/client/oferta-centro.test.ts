// D-052 (NEW-20261016-ORQ-oferta-melhoria-centro): the upgrade offer as one centred window like the board's
// design/ref-ofertas-de-melhoria.png: rarity, "Niv N", the "atual > novo" line, the waiting line and Pular / Rolar de novo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OFFER_WINDOW_TITLE,REROLL_LABEL,SKIP_LABEL,WAIT_LINE,levelLabel,offerRarity,offerValue} from '../../src/client/hud/offer-card.ts';

const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');

test('the texts of the reference, in Portuguese',()=>{
  assert.equal(OFFER_WINDOW_TITLE,'Ofertas de melhoria');
  assert.equal(WAIT_LINE,'Esperando os outros jogadores…');
  assert.deepEqual([SKIP_LABEL,REROLL_LABEL],['Pular','Rolar de novo']);
  assert.equal(levelLabel(9),'Niv 9');assert.equal(levelLabel(0),'Niv 1');
});

test('rarity by the level the card reaches; an evolution is always lendária',()=>{
  assert.deepEqual([1,2,3,4,5,6,7,8].map(l=>offerRarity('boleto',l)),['nova','comum','comum','rara','rara','epica','epica','lendaria']);
  assert.equal(offerRarity('boleto-evo',1),'lendaria');
});

test('a passive shows its stat before and after ("1,1x > 1,2x"); a weapon or a snack has no line of numbers',()=>{
  assert.deepEqual(offerValue('megafone',2),{label:'Área',from:'1,1x',to:'1,2x'});
  assert.deepEqual(offerValue('tenis',1),{label:'Velocidade',from:'1x',to:'1,1x'});
  assert.deepEqual(offerValue('marmita',3),{label:'Vida máxima',from:'140',to:'160'});
  assert.equal(offerValue('chinelo',3),undefined);
  assert.equal(offerValue('coxinha',1),undefined);
  assert.equal(offerValue('nao-existe',2),undefined);
});

test('one window over the whole screen (veil, title, fan, buttons) on every screen; the old corner panel loses; nothing scrolls',()=>{
  const css=read('src/client/hud/offer-centro.css'),ts=read('src/client/hud/offer.ts'),hud=read('src/client/hud/hud.ts');
  assert.match(hud,/import '\.\/offer-centro\.css';/);
  assert.match(ts,/el\('section','rh-offer rh-ofc'\)/,'keeps .rh-offer for the zones, edges and windows lists');
  // px39: the veil covers the game, the HUD and the pause's clock; the title at the top, the fan, the buttons at the base.
  assert.match(css,/\.rh \.rh-offer\.rh-ofc\{[^}]*position:fixed;z-index:30;inset:0;[^}]*flex-direction:column;[^}]*background:var\(--px39-veu\)/);
  assert.doesNotMatch(css,/overflow(-y)?:(auto|scroll)/);
  // px39: the cards open as a fan (the default pick in the middle, turned sides), the same in landscape.
  assert.match(css,/\.rh-card\[data-fan=l\]\{[^}]*--rot:-[\d.]+deg/);
  assert.match(css,/\.rh-card\[data-fan=r\]\{[^}]*--rot:[\d.]+deg/);
  assert.match(ts,/cardFor\(offer,choice,index,slots\[index\]\)/);
  // Landscape: the same column (no grid of two columns), scaled to the height.
  assert.doesNotMatch(css,/grid-template-areas/);
  // No text under 12 px: every card size has a 12 px floor.
  assert.match(css,/\.rh-card\{[^}]*font-size:max\(12px,/);
  // Skip and reroll: off at 0 until the room sends them (RunPause has neither).
  assert.match(ts,/b\.disabled=true;/);
});
