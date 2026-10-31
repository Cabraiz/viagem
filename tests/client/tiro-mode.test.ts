import test from 'node:test';
import assert from 'node:assert/strict';
import {tiroMode} from '../../src/client/hud/tiro-mode.ts';

test('?tiro= picks the aim: no drag by default, b fires on its own, velho keeps the brown drag aim',()=>{
  assert.equal(tiroMode(''),'a');
  assert.equal(tiroMode('?tiro=a'),'a');
  assert.equal(tiroMode('?x=1&tiro=b'),'b');
  assert.equal(tiroMode('?tiro=velho'),'velho');
  assert.equal(tiroMode('?tiro=zzz'),'a');
  assert.equal(tiroMode(),'a','node: no location');
});
