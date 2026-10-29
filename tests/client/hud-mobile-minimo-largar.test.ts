/**
 * NEW-20261029-ORQ-celular-largar-item-seguro (auditoria-controles-celular B, E): on the phone a thumb a bit high on
 * Atacar does not drop the weapon. Holding a slot drops only after 0.8 s and only if the finger never left the slot's
 * 44 px tap area; the slots' tap areas end 12 px or more above Atacar; "Trocar" is a 44 px target.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {foneFooter,RODAPE} from '../../src/client/hud/fone-layout.ts';
import {HOLD_DROP_MS,SLOT_HIT,onTapArea} from '../../src/client/hud/inventory.ts';

type Decl={selector:string;prop:string;value:string};
const INV=declarations(readFileSync(new URL('../../src/client/hud/inventory.css',import.meta.url),'utf8')) as Decl[];
const value=(selector:string,prop:string)=>{
  const found=INV.filter(d=>d.selector===selector&&d.prop===prop).at(-1);
  assert.ok(found,`${selector} { ${prop} }`);return found.value;
};
const VIEWPORTS=[{width:390,height:844},{width:360,height:800},{width:412,height:915},{width:844,height:390},{width:667,height:375}];

test('the slots\' 44 px tap areas end 12 px or more above Atacar, in every phone size and item count',()=>{
  for(const viewport of VIEWPORTS)for(let items=1;items<=6;items++){
    const f=foneFooter({viewport,items});
    for(const s of f.slots){
      const grow=Math.max(0,(RODAPE.hit-s.height)/2),hitBottom=s.y+s.height+grow;
      assert.ok(f.attack.y-hitBottom>=12-1e-9,`${viewport.width}×${viewport.height}, ${items} items: ${f.attack.y-hitBottom} px`);
    }
  }
  assert.equal(SLOT_HIT,RODAPE.hit);
});

test('holding to drop: 0.8 s, and the sinking slot runs for as long',()=>{
  assert.equal(HOLD_DROP_MS,800);
  assert.match(value('.rh-inv-slot.rh-inv-segurando','transition'),/transform \.8s linear/);
});

test('the hold counts only on the slot\'s tap area (the slot grown to 44 px, centred)',()=>{
  const slot={left:100,top:200,width:34,height:34};
  assert.ok(onTapArea(slot,117,217),'the middle');
  assert.ok(onTapArea(slot,95,195),'5 px out: still the 44 px area');
  assert.ok(!onTapArea(slot,94,217),'6 px left: off');
  assert.ok(!onTapArea(slot,117,240),'down towards Atacar: off');
  // A slot already 44 px or bigger is its own area.
  assert.ok(!onTapArea({left:0,top:0,width:44,height:44},45,10));
});

test('"Trocar" is a 44 px target',()=>{
  assert.equal(value('.rh .rh-inv-trocar','min-height'),'44px');
});
