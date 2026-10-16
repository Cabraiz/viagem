// ?perf=1 (BUG-20261014-ORQ-engasgo-andando-celular): the frame meter. A frame over STALL_MS is a stall, charged to the
// work marked during it; logic and render only explain what the finer marks do not; the rest is "?" (or "GC?" when the
// heap shrank); the stalls of the last minute give the rate and the worst.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GC_DROP_BYTES,PerfMeter,STALL_MS,causesText} from '../../src/client/dev/perf-meter.ts';
import {perfEnabled} from '../../src/client/dev/perf-flag.ts';

test('a stall is charged to its marks; logic and render only beyond the finer ones; the rest is ? or GC?',()=>{
  const m=new PerfMeter();
  assert.equal(m.frame(16,16),undefined);
  m.mark('bake',60);m.mark('upload',20);m.mark('render',90);m.mark('hud',0);
  const s=m.frame(120,136)!;
  assert.equal(s.ms,120);assert.ok(STALL_MS===50);
  assert.deepEqual(s.causes[0],{kind:'bake',ms:60});
  assert.deepEqual(s.causes.map(c=>c.kind),['bake','upload','?','render']);
  assert.equal(s.causes.find(c=>c.kind==='render')!.ms,10,'the render beyond the bake and the upload inside it');
  const rest=s.causes.find(c=>c.kind==='?')!.ms;assert.ok(rest>13&&rest<14,'the frame minus the explained minus one 60 Hz frame');
  assert.equal(causesText(s),'bake 60 · upload 20 · ? 13');
  // Marks are cleared with their frame; a shrinking heap names the rest GC?.
  const g=m.frame(100,236,GC_DROP_BYTES+1)!;
  assert.deepEqual(g.causes.map(c=>c.kind),['gc?']);
});

test('stats: fps of the last second, percentiles, stalls per minute over at least 10 s, the worst and the last',()=>{
  const m=new PerfMeter();
  m.frame(16,16);m.mark('chunk',70);m.frame(120,136);m.frame(100,236);
  const s=m.stats(236);
  assert.equal(s.frames,3);assert.equal(s.fps,3);assert.equal(s.worst,120);assert.equal(s.last!.ms,100);
  assert.equal(s.perMin,12,'2 stalls in a window counted as 10 s');
  assert.equal(s.p50,100);assert.equal(s.p95,120);
  // A minute later the stalls are gone.
  m.frame(16,236+60001);
  const later=m.stats(236+60001);
  assert.equal(later.perMin,0);assert.equal(later.worst,0);assert.equal(later.last,undefined);
});

test('the flag: perf=1 turns it on for the tab, perf=0 off, nothing else keeps what the tab had',()=>{
  const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  assert.equal(perfEnabled('',store),false);
  assert.equal(perfEnabled('?perf=1',store),true);
  assert.equal(perfEnabled('?modo=chaveiro',store),true,'kept for the tab');
  assert.equal(perfEnabled('?perf=0',store),false);
  assert.equal(perfEnabled('',store),false);
  assert.equal(perfEnabled('?perf=sim',store),false);
});
