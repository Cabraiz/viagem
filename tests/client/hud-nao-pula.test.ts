// The phone's HUD never jumps in a match played with the finger (card NEW-20261029-ORQ-hud-nao-pula): data-hud follows
// the input kind only (desktop-input.ts InputKindWatch, explore.ts syncInput), never the phase or the clock. The audit's
// jump at 40 s (evidence/auditoria-ui-menus-28-10.md item 10) was its page.click on the gear: a mouse pointer, which on
// a touch laptop rightly brings the desktop's HUD. Audits of the phone tap (Playwright page.tap / touchscreen.tap).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {InputKindWatch} from '../../src/client/desktop-input.ts';

const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');

test('a match played with the finger stays on the phone HUD from start to end',()=>{
  const watch=new InputKindWatch(false);
  // Taps, the joystick's drag, a pinch, a stylus: pointerdown and pointermove of touch or pen, never mouse.
  const round:[string,boolean][]=[['touch',true],['touch',false],['touch',false],['touch',true],['touch',false],['pen',true],['pen',false]];
  for(let i=0;i<500;i++)for(const [type,down] of round)assert.equal(watch.pointer(type,down),false,`${type} ${down?'down':'move'}`);
  // The on-screen keyboard's keys the browser cannot name are not game keys.
  assert.equal(watch.key('Unidentified','Unidentified'),false);
  assert.equal(watch.kind,'touch');
});

test('a mouse is what brings the desktop HUD (a touch laptop; a test that clicks instead of tapping), a tap brings the phone back',()=>{
  const watch=new InputKindWatch(false);
  assert.equal(watch.pointer('mouse',true),true);assert.equal(watch.kind,'mouse');
  assert.equal(watch.pointer('touch',true),true);assert.equal(watch.kind,'touch');
});

test('explore.ts: the HUD changes layout only in syncInput, run by the input events (never by the phase or a timer)',()=>{
  const explore=read('src/client/explore.ts');
  assert.equal(explore.match(/\.setInput\(/g)?.length,1,'one call of RunHud.setInput');
  assert.match(explore,/const syncInput=\(\)=>\{[\s\S]*?hud\?\.setInput\(kind\);hud\?\.layoutChanged\(\);/);
  // Its callers: the shell's opening, a pointerdown, a pointermove and a game key. Nothing else.
  assert.equal(explore.match(/syncInput\(\)/g)?.length,4,'four calls of syncInput');
  assert.match(explore,/\n  syncInput\(\);\n/);
  assert.match(explore,/addEventListener\('pointerdown',event=>\{if\(inputWatch\.pointer\(event\.pointerType,true\)\)syncInput\(\);\}/);
  assert.match(explore,/addEventListener\('pointermove',event=>\{if\(inputWatch\.pointer\(event\.pointerType,false\)\)syncInput\(\);\}/);
  assert.match(explore,/if\(inputWatch\.key\(event\.code,event\.key\)\)syncInput\(\);/);
  // data-hud is written in one place, RunHud.setInput.
  const hud=read('src/client/hud/hud.ts');
  assert.equal(hud.match(/dataset\.hud=[^=]/g)?.length,1,'data-hud written once');
  assert.match(hud,/setInput\(kind:InputKind\)\{\n    const hud=kind==='touch'\?'fone':'mesa';/);
});
