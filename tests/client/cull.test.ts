// Culling of the horde off camera (card NEW-20261018-ORQ-culling-horda, estudo-desempenho F2): the view test the
// renderer uses to skip a critter, at each edge of the view, with the figure's width, height and the margin.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CULL_MARGIN_CSS,inView} from '../../src/client/render/cull.ts';

const v={x:100,y:200,right:500,bottom:800};

test('a critter inside the view is drawn', () => {
  assert.equal(inView(v,300,500,20,60,0),true);
});

test('left and right: the figure half width and the margin reach past the edge', () => {
  assert.equal(inView(v,79,500,20,60,0),false);
  assert.equal(inView(v,80,500,20,60,0),true); // its right side touches x
  assert.equal(inView(v,70,500,20,60,10),true);
  assert.equal(inView(v,521,500,20,60,0),false);
  assert.equal(inView(v,520,500,20,60,0),true);
});

test('above: the body over the feet counts, so a tall one under the bottom edge still shows its head', () => {
  assert.equal(inView(v,300,199,20,60,0),false); // feet over the top edge, body further up
  assert.equal(inView(v,300,200,20,60,0),true);
  assert.equal(inView(v,300,860,20,60,0),true); // head at 800
  assert.equal(inView(v,300,861,20,60,0),false);
  assert.equal(inView(v,300,861,20,60,1),true);
});

test('below the feet only the margin counts', () => {
  assert.equal(inView(v,300,190,20,60,10),true);
  assert.equal(inView(v,300,189,20,60,10),false);
});

test('far away in any direction is culled, whatever the size', () => {
  for(const [x,y] of [[-5000,500],[5000,500],[300,-5000],[300,5000]])assert.equal(inView(v,x,y,40,120,CULL_MARGIN_CSS),false);
});
