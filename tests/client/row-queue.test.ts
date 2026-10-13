/** The announcement slot's line for the shell's quiet rows (VGM-048 review): one at a time, after notices and the coach. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RowQueue} from '../../src/client/hud/row-queue.ts';

test('a row waits while the slot is busy, shows when it frees, leaves after its time',()=>{
  const q=new RowQueue<string>();q.queue('eco',9000);
  assert.deepEqual(q.turn(0,true),{show:undefined,hide:[]},'the coach hint holds the slot: it waits');
  assert.equal(q.waiting,1);
  assert.deepEqual(q.turn(500,false),{show:'eco',hide:[]});
  assert.equal(q.shown,'eco');
  assert.deepEqual(q.turn(9400,false),{show:undefined,hide:[]});
  assert.deepEqual(q.turn(9500,false),{show:undefined,hide:['eco']},'9 s on screen, then gone');
  assert.equal(q.shown,undefined);assert.equal(q.waiting,0);
});

test('a notice takes the slot back; the row returns after it with the time it had left',()=>{
  const q=new RowQueue<string>();q.queue('eco',9000);q.turn(0,false);
  assert.deepEqual(q.turn(4000,true),{show:undefined,hide:['eco']},'danger over the joke');
  assert.deepEqual(q.turn(20_000,true),{show:undefined,hide:[]});
  assert.deepEqual(q.turn(21_000,false),{show:'eco',hide:[]});
  assert.deepEqual(q.turn(25_999,false).hide,[]);
  assert.deepEqual(q.turn(26_000,false).hide,['eco'],'5 s left after the 4 s it had shown');
});

test('two rows never stack: the second waits for the first; drop leaves the line',()=>{
  const q=new RowQueue<string>();q.queue('a',1000);q.queue('b',1000);
  assert.equal(q.turn(0,false).show,'a');
  assert.equal(q.turn(500,false).show,undefined,'b waits');
  const t=q.turn(1000,false);assert.deepEqual(t,{show:'b',hide:['a']});
  q.drop('b');assert.equal(q.shown,undefined);assert.deepEqual(q.turn(1100,false),{show:undefined,hide:[]});
});

test("the city's walk to the plaza holds a row only so long: the row takes its turn, then the walk comes back (cidade-08)",()=>{
  const q=new RowQueue<string>(),walk={busy:true,ms:4000};
  q.queue('eco',3000);
  assert.equal(q.turn(0,false,walk).show,undefined,'it waits for the walk first');
  assert.equal(q.turn(3999,false,walk).show,undefined);
  assert.equal(q.turn(4000,false,walk).show,'eco','then takes the slot from it, never the whole walk long');
  // The walk is out while the row shows; the row keeps its time even if the walk wants back in.
  assert.deepEqual(q.turn(5000,false,walk).hide,[],'a soft hold never pushes a shown row off');
  assert.deepEqual(q.turn(7000,false,{busy:false,ms:4000}).hide,['eco'],'its 3 s, then gone (the walk returns)');
  // The next row waits for the walk again from when it reached the head: rows and the walk interleave.
  q.queue('b',1000);
  assert.equal(q.turn(7100,false,walk).show,undefined);
  assert.equal(q.turn(11_100,false,walk).show,'b');
  assert.deepEqual(q.turn(12_100,false,walk).hide,['b']);
  // A notice still holds a row for as long as it lasts.
  q.queue('c',1000);
  assert.equal(q.turn(12_200,true,walk).show,undefined);
  assert.equal(q.turn(30_000,true,walk).show,undefined,'danger holds it however long');
  assert.equal(q.turn(30_050,false,walk).show,'c','the soft wait already ran behind the notice');
});

test('the HUD blocks the coach while a shell row shows, and the row counts in the slot that dodges the hero',()=>{
  const hud=readFileSync(new URL('../../src/client/hud/hud.ts',import.meta.url),'utf8');
  assert.match(hud,/const blocked=[^\n]*\.rh-row:not\(\[hidden\]\)/);
  assert.match(hud,/\.rh-coach:not\(\[hidden\]\),\.rh-row:not\(\[hidden\]\)'\)\]/,'avoidHero counts the row');
});
