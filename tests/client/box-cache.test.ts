import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutCache} from '../../src/client/hud/box-cache.ts';

/** A scheduler the test runs by hand: the "paint" happens when the test says so. */
function paints(){
  const queue:(()=>void)[]=[];
  return {schedule:(read:()=>void)=>{queue.push(read);},paint:()=>{for(const read of queue.splice(0))read();},get waiting(){return queue.length;}};
}

test('LayoutCache: the first read is at once, the later ones wait for the paint (F3: no layout forced mid-frame)',()=>{
  let layout=1,reads=0;const p=paints();
  const cache=new LayoutCache(()=>{reads++;return layout;},500,p.schedule);
  assert.equal(cache.get(0,'a'),1);assert.equal(reads,1,'nothing to show before the first read');
  layout=2;
  assert.equal(cache.get(100,'a'),1,'inside the age: the cached boxes');assert.equal(p.waiting,0);
  assert.equal(cache.get(501,'a'),1,'too old: the old boxes this frame…');assert.equal(reads,1,'…and no read inside the frame');
  assert.equal(p.waiting,1);
  cache.get(520,'a');cache.get(540,'a');assert.equal(p.waiting,1,'one read pending at a time');
  p.paint();assert.equal(reads,2);
  assert.equal(cache.get(560,'a'),2,'after the paint: the new boxes');
});

test('LayoutCache: a new key (zones changed, another window) asks for a read at once, still after the paint',()=>{
  let layout='top',reads=0;const p=paints();
  const cache=new LayoutCache(()=>{reads++;return layout;},500,p.schedule);
  cache.get(0,'zonesA');layout='low';
  assert.equal(cache.get(16,'zonesB'),'top');assert.equal(reads,1);assert.equal(p.waiting,1);
  p.paint();assert.equal(cache.get(32,'zonesB'),'low');
  assert.equal(p.waiting,0,'same key and young: nothing scheduled');
});

test('viewportSize: the window size without reading innerWidth/innerHeight every frame (they force a style recalc)',async ()=>{
  const {viewportSize}=await import('../../src/client/hud/box-cache.ts');
  const g=globalThis as unknown as {innerWidth?:number;innerHeight?:number};
  g.innerWidth=390;g.innerHeight=844;
  assert.deepEqual({...viewportSize()},{width:390,height:844});
  delete g.innerWidth;delete g.innerHeight;
});
