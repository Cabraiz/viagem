/**
 * The phone's footer: BUG-20261022-ORQ-hud-mobile-rodape put the stick and the attack on one axis and dropped the dashed
 * empty slots; BUG-20261024-ORQ-joystick-maior-inventario-direita (the user: "aumentar em 20% os joysticks e deixar na
 * direita cima do joystick da direita o inventário") made the stick and the attack 20 % bigger and moved the inventory
 * to a column right above the attack. Pins (1) that tokens.css/explore.css/inventory.css draw what
 * hud/fone-layout.ts foneFooter says, phone only (the desktop keeps 112 px and 14 + 80 × scale), and (2) its guarantees
 * at 360×800, 382×850 (the user's phone), 390×844, 412×915 and 844×390, at 100 % and 125 % text, with 1 to 6 items:
 * stick and attack on one axis, the slots right-aligned with the attack and 12 px or more over it (the hand slot's lift
 * included), rows from the bottom up, tap areas ≥ 44 px clear of both controls, nothing over the hero or the minimap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {foneFooter,foneLayout,foneSkillSide,RODAPE} from '../../src/client/hud/fone-layout.ts';
import {crosses,right,bottom,type Rect} from '../../src/client/hud/zones.ts';

type Decl={selector:string;prop:string;value:string};
const read=(file:string)=>declarations(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8')) as Decl[];
const INV=read('src/client/hud/inventory.css'),EXPLORE=read('src/client/explore.css'),TOKENS=read('src/client/ui/tokens.css');
const value=(decls:Decl[],selector:string,prop:string)=>{
  const found=decls.filter(d=>d.selector===selector&&d.prop===prop).at(-1);
  assert.ok(found,`${selector} { ${prop} }`);return found.value;
};
const VIEWPORTS=[{width:360,height:800},{width:382,height:850},{width:390,height:844},{width:412,height:915},{width:844,height:390}];
const BOX='.rh[data-hud=fone] .rh-inv',TIGHT='@media (max-width:370px),(max-height:500px) .rh[data-hud=fone] .rh-inv';
const PHONE=':root:has(.rh[data-hud=fone],.explore-shell:not([data-input=mouse]))';

test('tokens.css: the desktop keeps 112/96 px and 14 + 80 × scale; the phone is 20 % bigger',()=>{
  assert.equal(value(TOKENS,':root,::backdrop','--joystick'),'112px');
  assert.equal(value(TOKENS,':root,::backdrop','--joystick-justo'),'96px');
  assert.equal(value(TOKENS,':root,::backdrop','--botao-habilidade'),'calc(14px + 80px * var(--t-escala))');
  assert.equal(value(TOKENS,PHONE,'--controle-fone'),String(RODAPE.scale));
  assert.equal(value(TOKENS,PHONE,'--joystick'),'calc(112px * var(--controle-fone))');
  assert.equal(value(TOKENS,PHONE,'--joystick-justo'),'calc(96px * var(--controle-fone))');
  assert.equal(value(TOKENS,PHONE,'--botao-habilidade'),'max(calc(94px * var(--controle-fone)),calc(14px + 80px * var(--t-escala)))');
  assert.equal(RODAPE.stick,112*RODAPE.scale);assert.equal(RODAPE.tightStick,96*RODAPE.scale);
  assert.equal(foneSkillSide(1),94*RODAPE.scale);assert.equal(foneSkillSide(1.25),114);
});

test('explore.css: the stick and the attack share one axis (centred, not bottom-aligned); the stick is --joystick',()=>{
  assert.equal(value(EXPLORE,'.explore-controls','align-items'),'center');
  assert.match(value(EXPLORE,'.explore-controls','padding'),/^24px max\(24px,.*max\(24px,env\(safe-area-inset-bottom\)\) max\(24px,/);
  assert.equal(value(EXPLORE,'.explore-stick','--j'),'var(--joystick)');
  assert.equal(value(EXPLORE,'.explore-stick','width'),'var(--j)');
  assert.equal(value(EXPLORE,'@media(max-width:370px),(max-height:500px) .explore-stick','--j'),'var(--joystick-justo)');
});

test('inventory.css: the phone column sits right-aligned over the attack, as foneFooter places it',()=>{
  assert.equal(value(INV,BOX,'left'),'auto');
  assert.equal(value(INV,BOX,'right'),'max(24px,env(safe-area-inset-right))');
  assert.equal(value(INV,BOX,'bottom'),`calc(max(24px,env(safe-area-inset-bottom)) + (var(--inv-eixo) + var(--botao-habilidade)) / 2 + ${RODAPE.lift}px)`);
  assert.equal(value(INV,BOX,'--inv-eixo'),'max(var(--joystick),var(--botao-habilidade))');
  assert.match(value(INV,BOX,'--inv-lado'),new RegExp(`^${RODAPE.slot}px;?`));
  assert.equal(value(INV,TIGHT,'right'),'max(18px,env(safe-area-inset-right))');
  assert.equal(value(INV,TIGHT,'--inv-eixo'),'max(var(--joystick-justo),var(--botao-habilidade))');
  assert.match(value(INV,TIGHT,'--inv-lado'),new RegExp(`^${RODAPE.tightSlot}px;?`));
  // Rows from the bottom up, right-aligned.
  assert.equal(value(INV,'.rh[data-hud=fone] .rh-inv-slots','flex-wrap'),'wrap-reverse');
  assert.equal(value(INV,'.rh[data-hud=fone] .rh-inv-slots','justify-content'),'flex-end');
  // The room it keeps over the attack: what foneFooter says.
  const wide=foneFooter({viewport:{width:390,height:844},items:6}),tight=foneFooter({viewport:{width:360,height:800},items:6});
  assert.equal(value(INV,':root:has(.rh[data-hud=fone] .rh-inv:not([hidden]))','--inv-coluna'),`calc(2 * ${RODAPE.slot}px + ${RODAPE.gap}px + ${RODAPE.lift}px)`);
  assert.equal(wide.coluna,2*RODAPE.slot+RODAPE.gap+RODAPE.lift);assert.equal(tight.coluna,2*RODAPE.tightSlot+RODAPE.tightGap+RODAPE.lift);
  // No dashed empty slots on the phone, and a 44 px tap area around a slot.
  assert.equal(value(INV,'.rh[data-hud=fone] .rh-inv-slot[data-empty=true]','display'),'none');
  assert.equal(value(INV,'.rh[data-hud=fone] .rh-inv-slot::before','inset'),`calc((var(--inv-lado) - ${RODAPE.hit}px) / 2)`);
  for(const d of INV.filter(d=>/hud=fone/.test(d.selector)))assert.match(d.selector,/\.rh\[data-hud=fone\]/);
});

const inflate=(r:Rect,d:number):Rect=>({x:r.x-d,y:r.y-d,width:r.width+2*d,height:r.height+2*d});
const centreY=(r:Rect)=>r.y+r.height/2;

for(const viewport of VIEWPORTS)for(const scale of [1,1.25])for(let items=1;items<=6;items++){
  test(`footer ${viewport.width}×${viewport.height} at ${scale*100} % with ${items} item(s): column over the attack, no overlap`,()=>{
    const f=foneFooter({viewport,scale,items});
    assert.equal(centreY(f.stick),centreY(f.attack),'stick and attack on one axis');
    assert.equal(f.slots.length,items,'only the filled slots');
    // The hand slot is drawn 1.1× and 3 px up: its grown box still keeps 12 px over the attack and clear of the stick.
    const lift=f.slotSide*(RODAPE.handScale-1)/2;
    for(const s of f.slots){
      const grown=inflate({...s,y:s.y-3},lift);
      assert.ok(f.attack.y-bottom(grown)>=RODAPE.lift-lift-3-1e-9,`slot ${bottom(grown)} vs attack ${f.attack.y}`);
      assert.ok(!crosses(grown,f.stick)&&!crosses(grown,f.attack));
      assert.ok(s.x>=0&&right(s)<=viewport.width&&s.y>=0&&bottom(s)<=viewport.height);
      const hit=inflate(s,Math.max(0,(RODAPE.hit-s.width)/2));
      assert.ok(hit.width>=RODAPE.hit);
      assert.ok(!crosses(hit,f.stick)&&!crosses(hit,f.attack),'tap area clear of the stick and the attack');
    }
    for(let i=1;i<f.slots.length;i++)for(let j=0;j<i;j++)assert.ok(!crosses(f.slots[i],f.slots[j]),'slots never overlap');
    // Right-aligned with the attack; the first three (the weapons) are the bottom row, next to the thumb.
    assert.ok(Math.abs(Math.max(...f.slots.map(right))-right(f.attack))<0.5,'right-aligned with the attack');
    assert.ok(Math.abs(Math.max(...f.slots.map(bottom))-(f.attack.y-RODAPE.lift))<0.5,'12 px over the attack');
    const rowOf=(i:number)=>f.slots[i].y;
    for(let i=0;i<Math.min(3,items);i++)assert.equal(rowOf(i),rowOf(0),'slots 1–3 share the bottom row');
    if(items>3)assert.ok(rowOf(3)<rowOf(0),'slots 4–6 go above them');
    assert.ok(f.attack.y-f.box.y<=f.coluna+0.5,'the column stays in the room it keeps (--inv-coluna)');
    // Nothing over the hero or the minimap.
    const top=foneLayout({viewport,players:4});
    for(const r of [...f.slots,f.stick,f.attack]){
      assert.ok(!crosses(r,top.hero),'clear of the hero');
      assert.ok(!crosses(r,top.minimap),'clear of the minimap');
    }
  });
}
