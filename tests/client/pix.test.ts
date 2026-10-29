// PIX voando (card bico-sem-limite-pix-voando): the bits that spiral around a working hero and the "+R$ 5" pops of each
// paid note. Pure poses, fixed pools (the oldest gives way), reduced motion keeps the pops still and drops the bits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BICO} from '../../src/rules/bicos.ts';
import {BIT_EVERY_MS,BIT_MS,BIT_POOL,POP_MS,POP_POOL,PixSwarm,bitPose,popPose,popText,spread,type BitPose} from '../../src/client/render/bancos/pix.ts';

const pose=():BitPose=>({dx:0,dy:0,tilt:0,alpha:0,scale:0});
const live=<T>(xs:(T|undefined)[])=>xs.filter(x=>x!==undefined) as T[];

test('a bit sprouts at the foot, rises around the body and fades; none before birth or after BIT_MS',()=>{
  const bit={worker:'a',born:1000,kind:'nota' as const,phase:0,spin:1 as const};
  assert.equal(bitPose(bit,999,pose()),undefined);assert.equal(bitPose(bit,1000+BIT_MS,pose()),undefined);
  const start={...bitPose(bit,1000,pose())!},top={...bitPose(bit,1000+BIT_MS*.9,pose())!};
  assert.equal(start.alpha,0,'fades in');assert.ok(top.dy<start.dy-40,`it rises: ${start.dy} → ${top.dy}`);
  assert.ok(top.alpha<1&&top.alpha>0,'fades out near the top');
  assert.equal(bitPose(bit,1000+BIT_MS*.5,pose())!.alpha,1);
  assert.ok(Math.abs(top.dx)<=30&&Math.abs(start.dx)<=30,'stays around the body');
});

test('a pop rises over the head and fades; reduced motion keeps it in place',()=>{
  const pop={worker:'a',born:0,text:popText(),slot:0};
  assert.equal(popText(),`+R$ ${BICO.nota}`);
  assert.ok(popPose(pop,POP_MS*.9,false)!.dy<popPose(pop,0,false)!.dy);
  assert.equal(popPose(pop,POP_MS*.9,true)!.dy,popPose(pop,0,true)!.dy);
  assert.equal(popPose(pop,POP_MS,false),undefined);assert.ok(popPose(pop,POP_MS*.9,false)!.alpha<1);
  assert.notEqual(popPose({...pop,slot:1},0,false)!.dx,popPose({...pop,slot:2},0,false)!.dx,'two pops of a view side by side');
});

test('the swarm: a bit per worker every BIT_EVERY_MS, every third a PIX; the pool never grows; reduced has no bits',()=>{
  const s=new PixSwarm();
  s.step(0,['a','b'],false);s.step(BIT_EVERY_MS/2,['a','b'],false);
  assert.equal(live(s.bits).length,2,'one each, not one per frame');
  s.step(BIT_EVERY_MS,['a'],false);s.step(BIT_EVERY_MS*2,['a'],false);
  assert.deepEqual(live(s.bits).filter(b=>b.worker==='a').map(b=>b.kind),['nota','nota','pix']);
  for(let t=3;t<200;t++)s.step(t*BIT_EVERY_MS,['a','b','c'],false);
  assert.equal(s.bits.length,BIT_POOL);assert.equal(live(s.bits).length,BIT_POOL);
  const r=new PixSwarm();for(let t=0;t<20;t++)r.step(t*BIT_EVERY_MS,['a'],true);
  assert.equal(live(r.bits).length,0);
  assert.equal(spread('a',3),spread('a',3));assert.ok(spread('a',3)>=0&&spread('a',3)<1);
});

test('cash: a "+R$ 5" pop per note over the workers by turns, two bits each; the pops\' pool holds POP_POOL',()=>{
  const s=new PixSwarm();
  s.cash(0,[],2);assert.equal(live(s.pops).length,0,'nobody working: nobody to pop over');
  s.cash(0,['a','b'],3);
  assert.deepEqual(live(s.pops).map(p=>[p.worker,p.text]),[['a',popText()],['b',popText()],['a',popText()]]);
  assert.equal(live(s.bits).length,6);
  for(let i=0;i<10;i++)s.cash(i*100,['a'],2);
  assert.equal(s.pops.length,POP_POOL);assert.equal(live(s.pops).length,POP_POOL);
  const r=new PixSwarm();r.cash(0,['a'],2,BICO.nota,true);
  assert.equal(live(r.pops).length,2);assert.equal(live(r.bits).length,0);
});
