/**
 * The "Minuto de Minerva" clock (card NEW-20261022-ORQ-relogio-minerva, src/client/hud/minerva.ts): it shows while the
 * sim tick is before RunState.minervaAteTick, its hand follows the sim time (not the local clock), the last
 * MINERVA_URGENT_SECONDS are urgent, the wake flash shows right after and then the clock goes away.
 * Card inicio-no-uno-caixas-120: 120 s, ONLY the clock (no title, no seconds written), the hand walking BACK to 12 (the
 * sector of the time left shrinks), the last 10 s pulsing; the same clock for the time to explore after a wave.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ} from '../../src/contract/index.ts';
import {MINERVA_SECONDS,MINERVA_URGENT_SECONDS,WAKE_MS,exploraOf,minervaOf,minervaView} from '../../src/client/hud/minerva.ts';

const START=40,END=START+MINERVA_SECONDS*SIM_HZ;

test('the room field: a positive tick is the minute, absent/0/garbage is none',()=>{
  assert.equal(minervaOf({phase:'combat',minervaAteTick:END}),END);
  assert.equal(minervaOf({phase:'combat'}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:0}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:Number.NaN}),undefined);
  assert.equal(minervaOf({phase:'combat',minervaAteTick:'12'}),undefined);
});

test('the explore window field: [from, until] when both are ticks and until is after from',()=>{
  assert.deepEqual(exploraOf({exploraDesdeTick:100,exploraAteTick:2500}),{from:100,until:2500});
  assert.equal(exploraOf({}),undefined);
  assert.equal(exploraOf({exploraDesdeTick:100}),undefined);
  assert.equal(exploraOf({exploraDesdeTick:100,exploraAteTick:100}),undefined);
  assert.equal(exploraOf({exploraDesdeTick:'1',exploraAteTick:2500}),undefined);
});

test('field in the future: 120 s, the hand on a full turn (the whole sector lit)',()=>{
  assert.equal(MINERVA_SECONDS,120);assert.equal(MINERVA_URGENT_SECONDS,10);
  const v=minervaView(START,END);
  assert.deepEqual(v,{phase:'clock',seconds:120,angle:360,urgent:false});
});

test('the hand walks BACK by the sim tick: 3/4 of the turn left at 30 s, half at 60 s, seconds rounded up',()=>{
  assert.equal(minervaView(START+30*SIM_HZ,END)?.angle,270);
  assert.equal(minervaView(START+60*SIM_HZ,END)?.angle,180);
  assert.equal(minervaView(START+90*SIM_HZ,END)?.seconds,30);
  assert.equal(minervaView(START+90*SIM_HZ+1,END)?.seconds,30);
  assert.equal(minervaView(END-1,END)?.seconds,1);
  // A player who joins late sees the same hand as everyone (same ticks, same angle).
  assert.equal(minervaView(START+45*SIM_HZ,END)?.angle,minervaView(START+45*SIM_HZ,END,false)?.angle);
});

test('the last 10 s are urgent (they pulse), the 11th is not',()=>{
  assert.equal(minervaView(END-11*SIM_HZ,END)?.urgent,false);
  assert.equal(minervaView(END-10*SIM_HZ,END)?.urgent,true);
  assert.equal(minervaView(END-1,END)?.urgent,true);
});

test('at zero "acordaram" for WAKE_MS, then nothing',()=>{
  assert.equal(minervaView(END,END)?.phase,'wake');
  const wakeTicks=Math.round(WAKE_MS/1000*SIM_HZ);
  assert.equal(minervaView(END+wakeTicks-1,END)?.phase,'wake');
  assert.equal(minervaView(END+wakeTicks,END),undefined);
  assert.equal(minervaView(END+10*SIM_HZ,END),undefined);
});

test('who never saw the clock (joined after the minute) gets no notice; no field, no clock',()=>{
  assert.equal(minervaView(END+1,END,false),undefined);
  assert.equal(minervaView(START,undefined),undefined);
});

test('more than the full turn left (a longer room minute) keeps the hand on the full turn and the count at 120',()=>{
  assert.deepEqual(minervaView(START,END+20*SIM_HZ),{phase:'clock',seconds:120,angle:360,urgent:false});
});

test('the time to explore: the same clock, its full turn the window (90 s: half the turn left at 45 s)',()=>{
  const from=500,until=from+90*SIM_HZ;
  assert.deepEqual(minervaView(from,until,true,90),{phase:'clock',seconds:90,angle:360,urgent:false});
  assert.equal(minervaView(from+45*SIM_HZ,until,true,90)?.angle,180);
});

test('only the clock: no title, no seconds written on screen (an aria-label for screen readers)',()=>{
  const src=readFileSync(new URL('../../src/client/hud/minerva.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/textContent/);
  assert.doesNotMatch(src,/rh-minerva-title|rh-minerva-count/);
  assert.match(src,/setAttribute\('aria-label'/);
});

test('the HUD mounts the clock first in the announcement slot and the explore wires the room field',()=>{
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/stack\.append\(minerva\.el,/);
  assert.match(hud,/import '\.\/minerva\.css';/);
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  // Every view (the run state comes with the frames; the clock compares it with the frame's tick).
  assert.match(explore,/hud\.setMinerva\(phase==='combat'&&net\?\.run\?minervaOf\(net\.run\):undefined\);hud\.setExplora\(phase==='combat'&&net\?\.run\?exploraOf\(net\.run\):undefined\);hud\.setPause\(/);
  // It never takes taps (the joystick and Atacar keep working under it).
  const css=readFileSync(new URL('../../src/client/hud/minerva.css',import.meta.url),'utf8');
  assert.match(css,/\.rh-minerva\{[^}]*pointer-events:none/);
});

test('the phone lying down puts the clock beside the mission line, at the top of the slot, off the hero (card hud-deitado-sem-tapar-heroi)',()=>{
  const css=readFileSync(new URL('../../src/client/hud/minerva.css',import.meta.url),'utf8');
  const landscape=css.slice(css.indexOf('@media (orientation:landscape){'));
  assert.ok(landscape.length<css.length,'a landscape block');
  // Only the phone (data-hud=fone) lying down: one row, the clock (column 2) then the line (column 3), centred by the
  // flexible columns on both sides; every other row of the slot spans it, under them. PC and portrait keep the column.
  assert.match(landscape,/\.rh\[data-hud=fone\] \.rh-stack\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,auto\) minmax\(0,1fr\)/);
  assert.match(landscape,/\.rh\[data-hud=fone\] \.rh-stack>\*\{grid-column:1\/-1\}/);
  assert.match(landscape,/\.rh\[data-hud=fone\] \.rh-stack>\.rh-minerva\{grid-column:2;/);
  assert.match(landscape,/\.rh\[data-hud=fone\] \.rh-stack>:is\(\.rh-missao,\.rh-missao-grande\)\{grid-column:3\}/);
  // At ≤500 px tall the line keeps the stack's top (not centred on the clock, 12 px lower): there the hero's guard
  // (hud.ts avoidHero) sent the stack to its low slot, on the hero, once the hero spoke (640×296 in the match).
  assert.match(css,/@media \(max-height:500px\) and \(orientation:landscape\)\{[^}]*\.rh\[data-hud=fone\] \.rh-stack\{align-items:start\}/);
  // No more fixed clock under the minimap: at 296 px tall it sat on the joystick.
  assert.doesNotMatch(css,/position:fixed/);
  // inicio-no-uno-caixas-120: only the disc, no words: the face stays on the wake flash too (it is all there is).
  assert.doesNotMatch(landscape,/\.rh-minerva-face\{display:none\}/);
  // The mission line is built right after the clock, so the two share the first row (hud.ts stack order).
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/stack\.append\(minerva\.el,mission\.band,mission\.row,/);
});
