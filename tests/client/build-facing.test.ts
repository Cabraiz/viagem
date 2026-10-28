// Card NEW-20261025-ORQ-animacao-construir-6: a hero within the sim's reach of an obra going up faces it (build16); out of
// reach, or by a finished defense, it just rests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFacing,isObraPhase,BUILD_FACING_REACH} from '../../src/client/sprites/build-facing.ts';
import {BUILD_REACH} from '../../src/sim/towers/system.ts';

test('the reach is the sim\'s BUILD_REACH, from the footprint\'s edge',()=>{
  assert.equal(BUILD_FACING_REACH,BUILD_REACH);
  const obra={x:10,y:10,r:1};
  assert.deepEqual(buildFacing({x:10-1-3,y:10},[obra]),{x:1,y:0});
  assert.equal(buildFacing({x:10-1-3.01,y:10},[obra]),undefined);
});

test('it faces the nearest obra; on its centre it looks down the screen',()=>{
  const a={x:0,y:0,r:1},b={x:5,y:0,r:1};
  const f=buildFacing({x:3.5,y:0},[a,b])!;
  assert.ok(f.x>.99,'faces b, the nearer edge');
  assert.deepEqual(buildFacing({x:0,y:0},[a]),{x:0,y:1});
});

test('the rail counts by its half extents',()=>{
  const rail={x:0,y:0,r:6,half:[6,1] as const};
  const f=buildFacing({x:5,y:3.9},[rail])!;
  assert.ok(f.y<0,'faces up to the rail');
  assert.equal(buildFacing({x:5,y:4.1},[rail]),undefined);
});

test('only the obra phases are building',()=>{
  for(const p of ['obra-1','obra-2','obra-3'])assert.ok(isObraPhase(p));
  for(const p of ['pronta','danificada','ruina',undefined])assert.ok(!isObraPhase(p));
});
