/**
 * BUG infinito-placas: the endless map's chunk POIs are drawn with the endless names (rules/zueira-infinito.ts), never
 * with the island landmark names the chunk generator copies; the island keeps its own three. Source checks of scene.ts
 * (Phaser does not load under node), like tests/client/city-camera.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');

test('chunk POIs get infinitoPoiName for their kind and chunk, not the island name they carry', () => {
  const loop=scene.slice(scene.indexOf('for(const p of c.pois)'),scene.indexOf('this.chunkProps.set(key'));
  assert.ok(loop.length>0,'chunk POI loop found');
  assert.match(loop,/this\.drawLandmark\(p,index,infinitoPoiName\(index,cx,cy,this\.field\.seed\)\)/);
  assert.doesNotMatch(loop,/drawLandmark\([^)]*p\.name\)/);
});

test('the island still draws its own landmarks by name, only on the island', () => {
  const build=scene.slice(scene.indexOf('buildWorld('));
  const guard=build.indexOf('if(city||this.field.chunks)return;'),draw=build.indexOf('landmarks.forEach');
  assert.ok(guard>=0&&draw>=0&&guard<draw);
});
