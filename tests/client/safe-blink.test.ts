/** comeca-armado-e-levanta-seguro (itens 2 e 3): the hero blinks while the server keeps him untouchable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ticks} from '../../src/contract/index.ts';
import {REVIVE_INVULNERABLE_TICKS,START_GRACE_S} from '../../src/rules/index.ts';
import {SAFE_ALPHA,SAFE_ALPHA_REDUCED,SAFE_BLINK_MS,SafeClock,safeAlpha} from '../../src/client/render/you-rules.ts';

test('SafeClock: the start grace until the first crate or START_GRACE_S, getting up for REVIVE_INVULNERABLE_TICKS',()=>{
  const c=new SafeClock();
  c.push(5,[],false);assert.equal(c.on('a',5),false,'the waiting room: never');
  c.push(10,[],true);assert.equal(c.on('a',10),true);assert.equal(c.on('b',10),true);
  c.push(20,[{type:'pickup',player:'a',kind:'chest'},{type:'pickup',player:'b',kind:'item'}],true);
  assert.equal(c.on('a',20),false,'his first crate ends it');assert.equal(c.on('b',20),true,'an item is not a crate');
  const end=ticks(START_GRACE_S);
  assert.equal(c.on('b',end-1),true);assert.equal(c.on('b',end),false,'20 s at most');
  c.push(end+100,[{type:'revived',player:'a'}],true);
  assert.equal(c.on('a',end+100+REVIVE_INVULNERABLE_TICKS-1),true);assert.equal(c.on('a',end+100+REVIVE_INVULNERABLE_TICKS),false);
  assert.equal(c.on('b',end+100),false);
  c.push(3,[],true);assert.equal(c.on('a',3),true,'a rematch: the grace again, the old crate forgotten');
});

test('safeAlpha: hard blink, the base alpha wins, a steady see-through with reduced motion',()=>{
  assert.equal(safeAlpha(1,false,SAFE_BLINK_MS),1);
  assert.deepEqual([0,SAFE_BLINK_MS,2*SAFE_BLINK_MS].map(t=>safeAlpha(1,true,t)),[1,SAFE_ALPHA,1]);
  assert.equal(safeAlpha(.85,true,SAFE_BLINK_MS),.85,'down');assert.equal(safeAlpha(0,true,SAFE_BLINK_MS),0,'in the shop');
  assert.equal(safeAlpha(1,true,0,true),SAFE_ALPHA_REDUCED);assert.equal(safeAlpha(1,true,SAFE_BLINK_MS,true),SAFE_ALPHA_REDUCED);
});

test('scene.ts: every run view feeds the clock; the hero and each ally blink through it',()=>{
  const src=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  assert.match(src,/this\.safe\.push\(runView\.tick,runView\.events,!!runView\.round\);/);
  assert.match(src,/this\.actor\.setAlpha\(safeAlpha\(.*this\.safe\.on\(net\.id,this\.viewTick\),time,this\.reduced\)\)/);
  assert.match(src,/objects\.image\.setPosition\(q\.x,q\.y\).*\.setAlpha\(safeAlpha\(.*this\.safe\.on\(player\.id,this\.viewTick\),time,this\.reduced\)\)/);
});
