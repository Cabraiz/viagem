// Card NEW-20261023-ORQ-animacao-receber-dano: a hit while the hero rests plays its flinch for HURT_MS; it never holds a
// walk, a swing or a push, and a damage over time shows one flinch per HURT_GAP_MS, not one per tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HurtGate,HURT_MS,HURT_GAP_MS} from '../../src/client/sprites/sprite-motion.ts';

test('a drop in hp while resting flinches for HURT_MS, from 0 to 1',()=>{
  const g=new HurtGate();
  assert.equal(g.update(0,100,true),undefined);
  assert.equal(g.update(16,100,true),undefined);
  assert.equal(g.update(32,90,true),0);
  assert.equal(g.update(32+HURT_MS/2,90,true),.5);
  assert.equal(g.update(32+HURT_MS,90,true),undefined);
});

test('the first hp seen, a heal, a respawn or a rematch are not hits',()=>{
  const g=new HurtGate();
  assert.equal(g.update(0,40,true),undefined);
  assert.equal(g.update(10,100,true),undefined);
  assert.equal(g.update(20,undefined,true),undefined);
  assert.equal(g.update(30,80,true),undefined);
});

test('moving, swinging or pushing never flinches, and moving cuts a flinch at once (the controls are never held)',()=>{
  const g=new HurtGate();
  g.update(0,100,false);
  assert.equal(g.update(10,90,false),undefined);
  assert.equal(g.update(20,90,true),undefined,'a hit while running does not show later, when it stops');
  const h=new HurtGate();
  h.update(0,100,true);assert.equal(h.update(10,90,true),0);
  assert.equal(h.update(60,90,false),undefined);
  assert.equal(h.update(80,90,true),undefined,'stopping again does not resume it');
});

test('a damage over time ticking every 100 ms flinches once per HURT_GAP_MS',()=>{
  const g=new HurtGate();let hp=100,starts=0,was=false;
  g.update(0,hp,true);
  for(let t=16;t<=3000;t+=16){
    if(t%96===0)hp--;
    const p=g.update(t,hp,true),on=p!==undefined;
    if(on&&(!was||p===0))starts++;was=on;
  }
  assert.ok(starts>=4&&starts<=Math.ceil(3000/HURT_GAP_MS),`${starts} flinches`);
});

test('a clock that goes back (a new scene) does not freeze the gate',()=>{
  const g=new HurtGate();
  g.update(5000,100,true);assert.equal(g.update(5010,90,true),0);
  g.update(0,90,true);
  assert.equal(g.update(10,80,true),0);
});
