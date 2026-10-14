/**
 * Ficha de torre in the HUD (D-048): the top bar shows the team's one material pile as whole fichas (tokensOf) with a
 * ring filling to the next one (tokenProgress), one line, spoken in pt-BR; the prices go through price.ts (the forge's
 * and the evolutions' helpers are what the Grana step swaps). The player never reads coco, pedra or "unidades".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenMarkup,tokenReadout} from '../../src/client/hud/camp.ts';
import {FREE_PRICE,evolvePriceLabel,fichasText,forgePriceLabel,tokenPriceLabel} from '../../src/client/hud/price.ts';
import {DEFENSES,RECIPES,TOWER_TOKENS,UNITS_PER_TOKEN,tokenProgress,tokensOf} from '../../src/rules/index.ts';
import {icon} from '../../src/client/ui/icon.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';

const read=(path:string)=>readFileSync(new URL(`../../src/client/hud/${path}`,import.meta.url),'utf8');

test('the top bar counts whole fichas and fills the ring to the next one (tokensOf / tokenProgress)',()=>{
  assert.equal(UNITS_PER_TOKEN,40,'the numbers below assume 40 units a ficha');
  assert.deepEqual(tokenReadout(0),{tokens:0,progress:0,percent:0,label:'0 fichas de torre, próxima em 0%'});
  assert.deepEqual(tokenReadout(36),{tokens:0,progress:.9,percent:90,label:'0 fichas de torre, próxima em 90%'},'"falta pouco"');
  assert.deepEqual(tokenReadout(40),{tokens:1,progress:0,percent:0,label:'1 ficha de torre, próxima em 0%'});
  assert.equal(tokenReadout(150).label,'3 fichas de torre, próxima em 75%');
  assert.equal(tokenReadout(29).percent,72,'rounds down (72.5)');
  assert.equal(tokenReadout(39.99).percent,99,'never "próxima em 100%" before the ficha shows');
  for(const bad of [Number.NaN,-5,Number.POSITIVE_INFINITY])assert.equal(tokenReadout(bad).tokens,0,String(bad));
  for(let u=0;u<=400;u+=7){const r=tokenReadout(u);assert.equal(r.tokens,tokensOf(u),String(u));assert.equal(r.progress,tokenProgress(u),String(u));}
});

test('the top bar markup: the tower sticker in its ring and the count, one line, no coco or pedra',()=>{
  const html=tokenMarkup(36);
  assert.ok(html.includes(icon('torre')),'the tower sticker (icon sprite, art when imported)');
  assert.match(html,/^<span class="rh-camp-anel" aria-hidden="true">.*<\/span><b>0<\/b>$/,'ring first, then the count');
  assert.match(html,/class="rh-camp-anel-fundo"/,'the track always shows (N=0 at 90% still reads)');
  assert.match(html,/class="rh-camp-anel-cheio"[^>]*pathLength="100" stroke-dasharray="90 100"/);
  assert.match(tokenMarkup(0),/stroke-dasharray="0 100"/);assert.match(tokenMarkup(150),/stroke-dasharray="75 100"[^]*<b>3<\/b>$/);
  // One line: only inline pieces, no line break, no block element.
  assert.doesNotMatch(html,/\n|<br|<div|<p[ >]/);
  assert.doesNotMatch(html,/coco|pedra|unidade/i);
  const camp=read('camp.ts');
  assert.match(camp,/token\.setAttribute\('role','img'\)/);
  assert.match(camp,/token\.innerHTML=tokenMarkup\(camp\.units\);token\.setAttribute\('aria-label',tokenReadout\(camp\.units\)\.label\)/,'the label rides with the markup');
  assert.doesNotMatch(camp,/icon\('(coco|pedra)'/,'the two piles are gone from the HUD');
  const css=read('camp.css');
  assert.match(css,/\.rh-camp-token\{flex:none;white-space:nowrap\}/,'the token never wraps');
  assert.match(css,/\.rh-camp-anel\{[^}]*width:30px;height:30px\}/,'a 30 px ring fits the 40 px band');
  assert.doesNotMatch(css.match(/\.rh-camp\{[^}]*\}/)![0],/flex-wrap:wrap/);
});

test('fixtures: the "falta pouco" ring outside the forge scene, and one tag short in it',()=>{
  assert.deepEqual(tokenReadout(fakeView('camp-horn',1).camp!.units),{tokens:3,progress:.9,percent:90,label:'3 fichas de torre, próxima em 90%'});
  const forge=fakeView('camp-forge',1).camp!.units;
  assert.deepEqual(Object.values(RECIPES).map(r=>forge>=r.cost),[true,true,false]);
});

test('prices: fichas for building, material for the forge and the evolutions (the Grana step swaps two helpers)',()=>{
  assert.deepEqual(tokenPriceLabel(TOWER_TOKENS.root),{html:`<b>1</b>${icon('torre')}`,speech:'1 ficha de torre'});
  assert.equal(tokenPriceLabel(TOWER_TOKENS.gustavao).speech,'3 fichas de torre');
  assert.equal(fichasText(0),'0 fichas de torre');
  assert.deepEqual(forgePriceLabel(RECIPES.reparo.cost),{html:`<b>5</b>${icon('material')}`,speech:'5 de material'});
  assert.deepEqual(evolvePriceLabel(DEFENSES['vigias-armados']),{html:`<b>10</b>${icon('material')}`,speech:'10 de material'});
  assert.equal(FREE_PRICE.speech,'grátis');
  for(const p of [tokenPriceLabel(3),forgePriceLabel(7),evolvePriceLabel({cost:36}),FREE_PRICE])assert.doesNotMatch(`${p.html} ${p.speech}`,/coco|pedra|unidade/i);
  // Every price in the forge and the obra goes through these helpers (one place to swap for R$).
  const camp=read('camp.ts'),obra=read('towers/obra.ts');
  assert.match(camp,/forgePriceLabel\(r\.cost\)\.html/);assert.match(camp,/Custa \$\{forgePriceLabel\(cost\)\.speech\}/);
  assert.match(obra,/const priceOf=\(c:ObraCard\):PriceLabel=>c\.tokens!==undefined\?tokenPriceLabel\(c\.tokens\):c\.cost===0\?FREE_PRICE:evolvePriceLabel\(c\);/);
  assert.doesNotMatch(obra,/rh-obra-mat|icon\('(coco|pedra)'\)/,'the two-icon material display is gone');
});
