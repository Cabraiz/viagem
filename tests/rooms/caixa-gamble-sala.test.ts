// NEW-20261023-ORQ-caixa-gamble-raridade: the room keeps a crate's hiddenFor on its way to the encoder (the video of
// etapa 6 caught Simulation.frame() copying the pickups field by field and dropping it: the verde crates stayed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {FrameDecoder,FrameEncoder,WireIds} from '../../src/protocol/protocol4.ts';

test('a crate hidden for a player stays out of his frames and his view, and in the others\'',()=>{
  const sim=new Simulation(3,{combat:'manual'});
  sim.add('a','Ana','cidadao-comum');sim.add('b','Bia','cidadao-comum');
  sim.resetRun();sim.step();
  const a=sim.players.get('a')!;
  sim.world.pickups.set('bau-teste',{id:'bau-teste',kind:'chest',value:1,resource:'pistola',x:a.x+2,y:a.y,spawnTick:sim.world.tick,hiddenFor:['a']});
  const frame=sim.frame();
  assert.deepEqual(frame.pickups.find(k=>k.id==='bau-teste')?.hiddenFor,['a'],'frame() keeps hiddenFor');
  assert.ok(!sim.view('a').pickups.some(k=>k.id==='bau-teste'),'not in his view');
  assert.ok(sim.view('b').pickups.some(k=>k.id==='bau-teste'),'in the other\'s view');
  const ids=new WireIds();
  const seen=(viewer:string)=>{const r=new FrameDecoder().decode(new FrameEncoder(ids,{viewer}).encode(frame));assert.ok(r.ok);return r.view.pickups.some(k=>k.resource==='pistola'&&k.kind==='chest'&&Math.abs(k.x-(a.x+2))<.01);};
  assert.equal(seen('a'),false,'not in his frame');
  assert.equal(seen('b'),true,'in the other\'s frame');
});
