// D-052 (sim-carro's pending client part): a hero moving the car walks at the car's speed in the phone's prediction, as
// the room cuts it (players system stepCap = chaveiro moverCap), and with busy hands the input carries no attack.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SIM_HZ,carSpeed} from '../../src/contract/index.ts';
import {STEP,capStep,carStepCap,reconcile,simulate} from '../../src/maps/prediction.ts';
import {heroSpeed} from '../../src/maps/world.ts';
import {moverCap} from '../../src/sim/chaveiro/car.ts';
import type {PlayerInput} from '../../src/contract/index.ts';

const input=(seq:number,x=1,y=0):PlayerInput=>({seq,x,y} as PlayerInput);
const near=(a:number,b:number)=>Math.abs(a-b)<1e-9;

test('the cap is the room\'s: carSpeed(movers)/SIM_HZ for a mover, none otherwise', ()=>{
  const car={x:0,y:0,movers:['a','b']};
  assert.equal(carStepCap(car,'a'),carSpeed(2)/SIM_HZ);
  assert.equal(carStepCap(car,'a'),moverCap(car,'a'));
  assert.equal(carStepCap(car,'c'),undefined);
  assert.equal(carStepCap({x:0,y:0},'a'),undefined);
  assert.equal(carStepCap(undefined,'a'),undefined);
  // The rope holder is among the movers when the rope is taut: the same cap.
  assert.equal(carStepCap({x:0,y:0,movers:['a'],rope:'a'},'a'),carSpeed(1)/SIM_HZ);
});

test('a capped step walks the car\'s speed along its own line; a free one is untouched', ()=>{
  const from={x:5,y:5};
  const free=simulate(from,input(1),undefined,0,undefined);
  assert.ok(near(Math.hypot(free.x-from.x,free.y-from.y),heroSpeed()*STEP));
  const cap=carSpeed(1)/SIM_HZ,capped=simulate(from,input(1),undefined,0,undefined,cap);
  assert.ok(near(Math.hypot(capped.x-from.x,capped.y-from.y),cap));
  assert.ok(near(capped.y,from.y)); // same direction
  // Under the cap: unchanged.
  assert.deepEqual(capStep(from,{x:5.01,y:5},cap),{x:5.01,y:5});
  assert.deepEqual(capStep(from,{x:9,y:5},undefined),{x:9,y:5});
});

test('the replay of pending steps walks at most the cap per tick (no snap-back while pushing)', ()=>{
  const pending=[input(1),input(2),input(3),input(4)];
  const cap=carSpeed(3)/SIM_HZ,start={x:5,y:5};
  const p=reconcile(start,pending,undefined,{tick:10,cap});
  assert.ok(near(p.x-start.x,cap*4));
  const free=reconcile(start,pending,undefined,{tick:10});
  assert.ok(free.x-start.x>p.x-start.x);
});

test('the client feeds the cap to both the replay and the live step, and drops the attack with busy hands', ()=>{
  const src=readFileSync(new URL('../../src/client/net/client.ts',import.meta.url),'utf8');
  assert.match(src,/this\.stepCap=this\.obraHold\.holding\(view\.structures\)\?0:carStepCap\(car,this\.id\)/);
  // uno-bloqueio-corpo: the car's body (a box by its heading) rides along with the cap.
  // heroi-empurra-inimigos: and the copies of the solid bodies near the hero.
  assert.match(src,/cap:this\.stepCap,car:this\.carBody,bodies:this\.bodies\}/);
  assert.match(src,/simulate\(this\.predicted,input,this\.terrain,this\.tick\+this\.pending\.length,this\.effects,this\.stepCap,this\.carBody,this\.bodies\)/);
  assert.match(src,/this\.handsBusy=!!car&&\(car\.rope===this\.id\|\|!!car\.movers\?\.includes\(this\.id\)\)/);
  assert.match(src,/if\(this\.handsBusy\)attack=false;/);
  // The room uses the same cut (no drift between the phone and the room).
  // (`from` carries the floor since mapa-175-com-viaduto: the cut point keeps the step's own floor.)
  assert.match(readFileSync(new URL('../../src/sim/systems/players.ts',import.meta.url),'utf8'),/capStep\(from,p,stepCap\?\.\(p\.id\),ctx\.terrain\)/);
});
