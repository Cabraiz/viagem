/**
 * NEW-20261023-ORQ-caixa-icone-torre-arma: every item square tells a tower from a weapon at a glance, with a seal in its
 * top-right corner (the tower or the sword sticker), in the inventory and on the offer cards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KIT_IDS} from '../../src/rules/index.ts';
import {allItemDisplays,familySeal,itemFamily} from '../../src/client/hud/items.ts';
import {ICON_NAMES} from '../../src/client/ui/icon.ts';

const css=(f:string)=>readFileSync(new URL(`../../src/client/hud/${f}`,import.meta.url),'utf8');
const rule=(text:string,selector:string)=>{
  const at=text.indexOf(`${selector}{`);assert.ok(at>=0,`${selector} is styled`);
  return text.slice(at+selector.length+1,text.indexOf('}',at));
};
const px=(body:string,prop:string)=>Number(new RegExp(`(?:^|;)${prop}:(-?\\d+)px`).exec(body)?.[1]);

test('a kit de torre (walls too) is a tower, a weapon or an evolution a weapon, the rest wears no seal',()=>{
  for(const id of KIT_IDS)assert.equal(itemFamily(id),'torre',id);
  assert.equal(itemFamily('kit-torre'),'torre');
  for(const item of allItemDisplays()){
    if(item.kind==='weapon'||item.kind==='evolution')assert.equal(itemFamily(item.id),'arma',item.id);
    if(item.kind==='passive')assert.equal(itemFamily(item.id),undefined,item.id);
  }
  for(const id of ['heal','coxinha','brigadeiro','marmita','oculos'])assert.equal(itemFamily(id),undefined,id);
  assert.equal(itemFamily('arma-que-ninguem-conhece'),'arma','an id the catalog does not know shows as a weapon');
});

test('the seal is the tower or the sword sticker, decorative (the name is in the square\'s label)',()=>{
  assert.ok(ICON_NAMES.includes('espada')&&ICON_NAMES.includes('torre'));
  assert.match(familySeal(KIT_IDS[0]),/^<span class="rh-selo" data-selo="torre" aria-hidden="true"><svg [^>]*data-icon="torre"/);
  assert.match(familySeal('chinelo'),/data-selo="arma"[^>]*><svg [^>]*data-icon="espada"/);
  assert.equal(familySeal('marmita'),'');
  assert.equal(familySeal('coxinha'),'');
});

test('the seal rides the top-right corner, at least 18 px, over the inventory slot and the offer card\'s square',()=>{
  const seal=rule(css('hud.css'),'.rh-selo');
  assert.match(seal,/position:absolute/);
  assert.ok(px(seal,'width')>=18&&px(seal,'height')>=18,'≥ 18 px on the smallest phone');
  assert.ok(px(seal,'top')<0&&px(seal,'right')<0,'half outside the square: the item sticker stays clear');
  assert.match(rule(css('hud.css'),'.rh-card-icon'),/position:relative/);
  const ofc=rule(css('offer-centro.css'),'.rh .rh-ofc .rh-card-icon>.rh-selo');
  assert.ok(px(ofc,'width')>=18);
  // The inventory's stack number goes to the bottom-left: a seal on the row below never covers it.
  const inv=css('inventory.css');
  assert.match(rule(inv,'.rh-inv-pilha'),/left:-3px/);
  assert.doesNotMatch(rule(inv,'.rh-inv-pilha'),/right:/);
  assert.match(rule(inv,'.rh-inv-selo'),/display:contents/);
});
