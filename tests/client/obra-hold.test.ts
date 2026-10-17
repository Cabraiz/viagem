// D-052 (obra-hud-ajustes): the phone holds the hero still while their own accepted free obra builds, like the room's
// holdsObra; the step cut is the prediction's capStep with cap 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ObraHold} from '../../src/client/net/obra-hold.ts';
import {capStep} from '../../src/maps/prediction.ts';

const muro=(phase:string,id='s7')=>({id,kind:'muro',phase,c:10,r:4});

test('an accepted free obra holds while it builds (by the room\'s wire id), then lets go', ()=>{
  const h=new ObraHold();
  h.order(5,{piece:'muro',c:10,r:4});
  assert.equal(h.holding([]),false); // sent, not accepted yet
  h.answer({req:5,ok:true,defense:'s7'});
  assert.equal(h.holding([muro('obra-1')]),true);
  assert.equal(h.holding([muro('obra-3')]),true);
  assert.equal(h.holding([muro('pronta')]),false);
  assert.equal(h.holding([muro('obra-1')]),false); // released for good
});

test('without the id the obra is found by its kind and cell', ()=>{
  const h=new ObraHold();
  h.order(1,{piece:'barricada',c:3,r:9,rot:1});
  h.answer({req:1,ok:true});
  assert.equal(h.holding([{id:'y',kind:'barricada',phase:'obra-2',c:3,r:8}]),false); // another cell: not ours
  assert.equal(h.holding([{id:'x',kind:'barricada',phase:'obra-2',c:3,r:9}]),true);
  // Matched once, it is followed by that id.
  assert.equal(h.holding([{id:'x',kind:'barricada',phase:'pronta',c:3,r:9}]),false);
});

test('refusals, unknown answers, a gone obra and a new run never hold', ()=>{
  const h=new ObraHold();
  h.order(1,{piece:'muro',c:1,r:1});h.answer({req:1,ok:false});
  h.answer({req:99,ok:true,defense:'zz'});
  assert.equal(h.holding([muro('obra-1','zz')]),false);
  h.order(2,{piece:'muro',c:10,r:4});h.answer({req:2,ok:true,defense:'s7'});
  assert.equal(h.holding([muro('obra-1')]),true);
  assert.equal(h.holding([]),false); // destroyed while building
  h.order(3,{piece:'muro',c:10,r:4});h.answer({req:3,ok:true,defense:'s7'});h.reset();
  assert.equal(h.holding([muro('obra-1')]),false);
  // An accepted obra the frames never show stops waiting after 2 s of frames.
  h.order(4,{piece:'muro',c:2,r:2});h.answer({req:4,ok:true,defense:'q'});
  for(let i=0;i<41;i++)h.holding([]);
  assert.equal(h.holding([muro('obra-1','q')]),false);
});

test('a cap of 0 keeps the hero in place; the client wires the hold into the prediction', ()=>{
  assert.deepEqual(capStep({x:5,y:5},{x:5.1,y:5},0),{x:5,y:5});
  const src=readFileSync(new URL('../../src/client/net/client.ts',import.meta.url),'utf8');
  assert.match(src,/this\.stepCap=this\.obraHold\.holding\(view\.structures\)\?0:carStepCap\(car,this\.id\)/);
  assert.match(src,/this\.obraHold\.order\(req,/);
  assert.match(src,/this\.obraHold\.answer\(\{req:m\.req,ok:m\.ok/);
});
