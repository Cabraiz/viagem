/**
 * Ninhos (D-051, NEW-20261014-ORQ-ninhos-sim, E2): the sleeping bodies (sim/ninhos/sono.ts) on a synthetic plan. They
 * stay out of ctx.enemies until something wakes them; damage wakes the body and its band (core damageEnemy), the nest
 * call (E1) wakes a nest, wakeAround a disc; every wake emits one `acordou`; a checkpoint rebuilds the same bodies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SimWorld} from '../../src/sim/core.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import type {NestPlan} from '../../src/maps/nests.ts';
import {createSono,BAND_RADIUS,type Sono} from '../../src/sim/ninhos/sono.ts';
import type {SimEvent} from '../../src/contract/types.ts';

/** Two nests (A: 3 bodies close together, B: 2) and one loose band of 2 far away. */
const PLAN:NestPlan={seed:1,players:1,nests:[
  {id:'A',kind:'terreno',x:0,y:0,size:'P',radius:6,sleepers:[{x:0,y:0},{x:2,y:0},{x:0,y:2}]},
  {id:'B',kind:'terreno',x:40,y:0,size:'P',radius:6,sleepers:[{x:40,y:0},{x:41,y:1}]},
],loose:[{x:0,y:40,training:false,members:[{x:0,y:40},{x:1.5,y:40}]}]};

function world(saved?:Sono['state']){
  const w=new SimWorld({terrain:defaultTerrain,seed:7});
  const sono=createSono({plan:PLAN,kindOf:()=>'bebado'},saved);
  w.sleepers=sono.sleepers;
  w.register({id:'director',step:ctx=>sono.step(ctx)});
  return {w,sono};
}
const woke=(events:readonly SimEvent[])=>events.filter((e):e is Extract<SimEvent,{type:'acordou'}>=>e.type==='acordou');

test('the plan sleeps out of ctx.enemies, with ids by plan order', ()=>{
  const {w,sono}=world();
  w.step();
  assert.equal(w.enemies.size,0);
  assert.equal(sono.sleepers.size,7);
  assert.deepEqual(sono.bodies.map(b=>b.id),['z-0','z-1','z-2','z-3','z-4','z-5','z-6']);
  assert.deepEqual(sono.bodiesOf('A'),['z-0','z-1','z-2']);
  assert.equal(sono.asleepIn('B'),2);
  assert.deepEqual(sono.sleepers.query(0,0,3).map(e=>e.id).sort(),['z-0','z-1','z-2']);
});

test('a hit on a sleeper wakes it and its band (≤ BAND_RADIUS), lands, and emits one acordou', ()=>{
  const {w,sono}=world();
  w.step();
  const hp=sono.sleepers.get('z-0')!.hp;
  assert.ok(BAND_RADIUS>=2*Math.SQRT2);
  assert.equal(w.damageEnemy('z-0',1),false);
  assert.equal(w.enemies.get('z-0')?.hp,hp-1);
  assert.deepEqual([...w.enemies.keys()].sort(),['z-0','z-1','z-2']);
  assert.equal(sono.asleepIn('A'),0);
  assert.equal(sono.asleepIn('B'),2);
  const events=w.flush();
  assert.deepEqual(woke(events).map(e=>e.n),[1+2]);
  assert.ok(events.findIndex(e=>e.type==='acordou')<events.findIndex(e=>e.type==='damage'));
  // Awake now: the next hit is an ordinary one.
  w.damageEnemy('z-0',1);
  assert.equal(woke(w.flush()).length,0);
});

test('wakeNest and wakeAround wake only what is asleep there', ()=>{
  const {w,sono}=world();
  w.step();
  assert.equal(sono.wakeNest(w,'B','ninho'),2);
  assert.equal(sono.wakeNest(w,'B','ninho'),0);
  assert.equal(sono.wakeAround(w,0,40,1,'chamado'),1);
  assert.equal(sono.wakeAround(w,0,40,5,'chamado'),1);
  assert.deepEqual(woke(w.flush()).map(e=>e.n),[2,1,1]);
  assert.equal(sono.sleepers.size,3);
  assert.equal(sono.sleepers.has('z-3'),false);
  assert.deepEqual(sono.sleepers.query(40,0,5),[]);
});

test('the checkpoint keeps who died and the hp; an awake body sleeps again at its spot', ()=>{
  const {w,sono}=world();
  w.step();
  w.damageEnemy('z-0',1);
  w.enemies.get('z-1')!.x=10;
  while(w.enemies.has('z-2'))w.damageEnemy('z-2',100);
  w.step();
  const saved=structuredClone(sono.state);
  assert.deepEqual(saved.life.slice(0,3).map(l=>l[0]),[2,2,0]);
  const again=world(saved);
  again.w.step();
  assert.equal(again.w.enemies.size,0);
  assert.equal(again.sono.sleepers.size,6);
  assert.equal(again.sono.sleepers.has('z-2'),false);
  const z0=again.sono.sleepers.get('z-0')!,z1=again.sono.sleepers.get('z-1')!;
  assert.equal(z0.hp,z0.maxHp-1);
  assert.deepEqual({x:z1.x,y:z1.y},{x:2,y:0});
});
