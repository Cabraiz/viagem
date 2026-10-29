/**
 * Auditoria UI 28/10 items 1–3 and 6/17 (card NEW-20261028-ORQ-oferta-pausa-hud-consertos): the pause's "Escolham! N s"
 * sits over the px39 offer's plaque and in front of its veil; once you picked, the offer keeps only your card (no
 * empty block, no live Pular/Rolar); "Rolar de novo" whole in landscape; the side cards inside a 390 px portrait; on the
 * PC the empty slots are solid with their key, the attack says "Espaço" and the HUD grows 1.25× on a big screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAUSE_GAP,pauseOverOffer} from '../../src/client/hud/pausa.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');

test('pauseOverOffer: centred on the plaque, right above it, inside the screen',()=>{
  const at=pauseOverOffer({viewport:{width:390,height:844},box:{width:200,height:60},head:{x:45,y:200,width:300,height:50}});
  assert.deepEqual(at,{x:95,y:200-PAUSE_GAP-60});
  // A plaque near the left edge: the box stays PAUSE_GAP inside.
  assert.equal(pauseOverOffer({viewport:{width:390,height:844},box:{width:300,height:60},head:{x:0,y:200,width:60,height:40}}).x,PAUSE_GAP);
  // No room above: it never goes over the top band.
  assert.equal(pauseOverOffer({viewport:{width:844,height:390},box:{width:300,height:60},head:{x:300,y:30,width:240,height:40},top:20}).y,Math.round(20+PAUSE_GAP/2));
});

test('pausa.css: the box over the offer is in front of its veil (z 30)',()=>{
  assert.match(read('src/client/hud/pausa.css'),/\.rh-pausa\[data-na-oferta\]\{z-index:31\}/);
});

test('offer.ts: after your pick only your card stays, disabled, and the wait line shows only then',()=>{
  const src=read('src/client/hud/offer.ts');
  assert.match(src,/putHidden\(wait,!onlyWait\)/);
  assert.match(src,/card\.disabled=true;card\.classList\.add\('rh-card-default','rh-card-chosen'\)/);
  const css=read('src/client/hud/offer-centro.css');
  assert.match(css,/\.rh-ofc-only-wait :is\(\.rh-offer-foot,\.rh-window-fall,\.rh-ofc-actions\)\{display:none\}/);
});

test('PC: solid empty slots of 44 px, the Espaço cap, the HUD 1.25× from 1200×680',()=>{
  const inv=read('src/client/hud/inventory.css');
  assert.match(inv,/\.rh\[data-hud=mesa\] \.rh-inv\{--inv-slot:44px\}/);
  assert.match(inv,/\.rh\[data-hud=mesa\] \.rh-inv-slot\[data-empty=true\]\{border:2px solid/);
  assert.match(read('src/client/coop.css'),/\[data-input=mouse\] #coop-attack::after\{content:'Espaço'/);
  assert.match(read('src/client/hud/hud.css'),/@media \(min-width:1200px\) and \(min-height:680px\)\{\s*\.rh\[data-hud=mesa\] :is\(\.rh-top,\.rh-team,\.rh-inv\)\{zoom:1\.25\}/);
});
