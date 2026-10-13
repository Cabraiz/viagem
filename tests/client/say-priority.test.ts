import test from 'node:test';
import assert from 'node:assert/strict';
import {SAY_PRIORITY,SAY_TAGS,SKILL_BUBBLE_GAP_MS,bubbleAllowed,sayPriority,sayTag} from '../../src/client/render/jokes.ts';

test('the left-behind line is a priority say: shown as a normal balloon, never swallowed by the 2 s gap',()=>{
  assert.ok(SAY_PRIORITY.has('ficou-pra-tras'));
  assert.equal(sayPriority('ficou-pra-tras'),true);
  assert.equal(sayTag('ficou-pra-tras'),undefined,'a normal balloon with the line, not a red status tag');
  assert.equal(sayPriority('no-coco'),false);assert.equal(sayPriority(undefined),false);
  // A crate line 0.5 s ago: the left-behind line still shows; an ordinary line still waits.
  assert.equal(bubbleAllowed(10_500,10_000,{priority:true}),true);
  assert.equal(bubbleAllowed(10_500,10_000),false);
  assert.equal(bubbleAllowed(10_000+SKILL_BUBBLE_GAP_MS,10_000),true,'after the gap anything shows');
  assert.equal(bubbleAllowed(10_100,10_000,{tag:true}),true,'status tags keep skipping the gap');
  assert.equal(bubbleAllowed(0,-Infinity),true,'first line of a player');
  for(const key of SAY_PRIORITY)assert.ok(!Object.hasOwn(SAY_TAGS,key),`${key} is not also a tag`);
});
