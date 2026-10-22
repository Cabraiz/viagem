/**
 * BUG-20261022-ORQ-hud-mobile-rodape: the phone's footer was a mess (the 2×3 inventory against the stick's ring, its
 * dashed empty slots loose on the snow, the attack off the stick's axis). Pins (1) that explore.css/inventory.css draw
 * what hud/fone-layout.ts foneFooter says, phone only, and (2) its guarantees at 360×800, 382×850 (the user's phone),
 * 390×844, 412×915 and 844×390, at 100 % and 125 % text, with 1 to 6 items: stick and attack on one axis, the slots
 * clear of both by 12 px or more (the hand slot's lift included), centred between them, tap areas ≥ 44 px, nothing
 * over the hero or the minimap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {declarations} from '../../scripts/lint-design.mjs';
import {foneFooter,foneLayout,RODAPE} from '../../src/client/hud/fone-layout.ts';
import {crosses,right,bottom,type Rect} from '../../src/client/hud/zones.ts';

type Decl={selector:string;prop:string;value:string};
const read=(file:string)=>declarations(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8')) as Decl[];
const INV=read('src/client/hud/inventory.css'),EXPLORE=read('src/client/explore.css');
const value=(decls:Decl[],selector:string,prop:string)=>{
  const found=decls.filter(d=>d.selector===selector&&d.prop===prop).at(-1);
  assert.ok(found,`${selector} { ${prop} }`);return found.value;
};
const VIEWPORTS=[{width:360,height:800},{width:382,height:850},{width:390,height:844},{width:412,height:915},{width:844,height:390}];
const TIGHT='@media (max-width:370px),(max-height:500px) .rh[data-hud=fone] .rh-inv';

test('explore.css: the stick and the attack share one axis (centred, not bottom-aligned)',()=>{
  assert.equal(value(EXPLORE,'.explore-controls','align-items'),'center');
  assert.match(value(EXPLORE,'.explore-controls','padding'),/^24px max\(24px,.*max\(24px,env\(safe-area-inset-bottom\)\) max\(24px,/);
  assert.match(value(EXPLORE,'.explore-stick','width'),new RegExp(`^${RODAPE.stick}px$`));
});

test('inventory.css: the phone box spans the gap between the controls, as foneFooter places it',()=>{
  const box='.rh[data-hud=fone] .rh-inv';
  assert.equal(value(INV,box,'left'),`calc(max(24px,env(safe-area-inset-left)) + var(--inv-stick) + ${RODAPE.clear}px)`);
  assert.equal(value(INV,box,'right'),`calc(max(24px,env(safe-area-inset-right)) + var(--botao-habilidade) + ${RODAPE.clear}px)`);
  assert.equal(value(INV,box,'bottom'),'max(24px,env(safe-area-inset-bottom))');
  assert.equal(value(INV,box,'height'),'max(var(--inv-stick),var(--botao-habilidade))');
  assert.match(value(INV,box,'--inv-stick'),new RegExp(`^${RODAPE.stick}px;?`));
  assert.match(value(INV,box,'--inv-lado'),new RegExp(`min\\(${RODAPE.slot}px,\\(100cqi - 2 \\* var\\(--inv-gap\\)\\) / ${RODAPE.perRow} - 0\\.5px\\)`));
  assert.equal(value(INV,TIGHT,'left'),`calc(max(18px,env(safe-area-inset-left)) + var(--inv-stick) + ${RODAPE.clear}px)`);
  assert.equal(value(INV,TIGHT,'bottom'),'max(16px,env(safe-area-inset-bottom))');
  assert.equal(value(INV,TIGHT,'--inv-stick'),`${RODAPE.tightStick}px`);
  // No dashed empty slots on the phone, and a 44 px tap area around a shrunk slot.
  assert.equal(value(INV,'.rh[data-hud=fone] .rh-inv-slot[data-empty=true]','display'),'none');
  assert.match(value(INV,'.rh[data-hud=fone] .rh-inv-slot::before','inset'),new RegExp(`\\(var\\(--inv-lado\\) - ${RODAPE.hit}px\\) / 2`));
  for(const d of INV.filter(d=>/hud=fone/.test(d.selector)))assert.match(d.selector,/\.rh\[data-hud=fone\]/);
});

const inflate=(r:Rect,d:number):Rect=>({x:r.x-d,y:r.y-d,width:r.width+2*d,height:r.height+2*d});
const centreY=(r:Rect)=>r.y+r.height/2;

for(const viewport of VIEWPORTS)for(const scale of [1,1.25])for(let items=1;items<=6;items++){
  test(`footer ${viewport.width}×${viewport.height} at ${scale*100} % with ${items} item(s): clean, centred, no overlap`,()=>{
    const f=foneFooter({viewport,scale,items});
    assert.equal(centreY(f.stick),centreY(f.attack),'stick and attack on one axis');
    assert.equal(f.slots.length,items,'only the filled slots');
    // The hand slot is drawn 1.1× (and 3 px up): its grown box still keeps 12 px from both controls.
    const lift=f.slotSide*(RODAPE.handScale-1)/2;
    for(const s of f.slots){
      const grown=inflate(s,lift);
      assert.ok(grown.x-right(f.stick)>=12,`slot ${grown.x} vs stick ${right(f.stick)}`);
      assert.ok(f.attack.x-right(grown)>=12,`slot ${right(grown)} vs attack ${f.attack.x}`);
      assert.ok(!crosses(grown,f.stick)&&!crosses(grown,f.attack));
      assert.ok(s.x>=0&&right(s)<=viewport.width&&s.y>=0&&bottom(s)<=viewport.height);
      // The visual slot may shrink at 125 % on a narrow phone; its tap area is 44 px (::before), still clear of the controls.
      const hit=inflate(s,Math.max(0,(RODAPE.hit-s.width)/2));
      assert.ok(hit.width>=RODAPE.hit);
      assert.ok(!crosses(hit,f.stick)&&!crosses(hit,f.attack),'tap area clear of the stick and the attack');
      assert.ok(s.width>=22,`slot ${s.width} px still holds its sticker`);
    }
    for(let i=1;i<f.slots.length;i++)for(let j=0;j<i;j++)assert.ok(!crosses(f.slots[i],f.slots[j]),'slots never overlap');
    // Centred between the controls, and on their axis.
    const xs=f.slots.map(s=>s.x),x0=Math.min(...xs),x1=Math.max(...f.slots.map(right));
    assert.ok(Math.abs((x0+x1)/2-(right(f.stick)+f.attack.x)/2)<0.5,'centred between stick and attack');
    const y0=Math.min(...f.slots.map(s=>s.y)),y1=Math.max(...f.slots.map(bottom));
    assert.ok(Math.abs((y0+y1)/2-centreY(f.stick))<0.5,'centred on the axis');
    if(viewport.width>viewport.height)assert.equal(new Set(f.slots.map(s=>s.y)).size,1,'landscape: one row');
    else assert.ok(f.slots.length<=3||new Set(f.slots.map(s=>s.y)).size===2,'portrait: at most 2 rows of 3');
    // Nothing over the hero or the minimap.
    const top=foneLayout({viewport,players:4});
    for(const r of [...f.slots,f.stick,f.attack]){
      assert.ok(!crosses(r,top.hero),'clear of the hero');
      assert.ok(!crosses(r,top.minimap),'clear of the minimap');
    }
  });
}
