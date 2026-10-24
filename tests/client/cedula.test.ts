// NEW-20261024-ORQ-tirar-drops-cedula-girando: the kill's cédula floats and turns like the crate's item, its back while
// the turn faces away, pops in, and a pile grows a little with its value.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {CEDULA_ART,CEDULA_LIFT,CEDULA_PILE_MAX,CEDULA_POP_MS,cedulaPile,cedulaPop,cedulaPose} from '../../src/client/render/cedula.ts';
import {FLOAT_BOB,FLOAT_LIFT,FLOAT_TURN_MS,floatSpin} from '../../src/client/render/arsenal-rules.ts';

test('the cédula turns like the crate\'s item: one turn in FLOAT_TURN_MS, its back shown for half of it, never edge-on to nothing',()=>{
  let angle=0,backs=0,minTurn=1;
  const steps=FLOAT_TURN_MS/10;
  for(let i=0;i<steps;i++){
    angle=floatSpin(angle,10,0);
    const pose=cedulaPose(10_000+i*10,0,.3,angle,1);
    if(pose.back)backs++;
    minTurn=Math.min(minTurn,pose.turn);
    assert.ok(pose.turn>0&&pose.turn<=1);
  }
  assert.ok(Math.abs(backs/steps-.5)<.02,`back ${backs}/${steps}`);
  assert.ok(minTurn>0,'a sliver at the edge');
  assert.ok(Math.abs(angle)<1e-6||Math.abs(angle-2*Math.PI)<1e-6,'a whole turn');
});

test('it floats at CEDULA_LIFT (± the item\'s bob, scaled), pops in, and reduced motion keeps it still and facing us',()=>{
  for(let t=0;t<3000;t+=50){
    const pose=cedulaPose(10_000+t,0,0,0,1);
    const k=CEDULA_LIFT/FLOAT_LIFT;
    assert.ok(pose.lift>=(FLOAT_LIFT-FLOAT_BOB)*k-1e-9&&pose.lift<=(FLOAT_LIFT+FLOAT_BOB)*k+1e-9);
  }
  assert.equal(cedulaPop(0),0);assert.equal(cedulaPop(CEDULA_POP_MS),1);
  assert.ok(Math.max(...Array.from({length:24},(_,i)=>cedulaPop(i*10)))>1,'a small overshoot');
  assert.deepEqual(cedulaPose(5,0,.7,2.5,1,true),{lift:CEDULA_LIFT,turn:1,back:false,scale:1,shadow:1});
});

test('a pile grows with its value (log), capped; the art is a 2-frame front/back sheet in the lite folder',()=>{
  assert.equal(cedulaPile(1),1);
  assert.ok(cedulaPile(5)>cedulaPile(2)&&cedulaPile(2)>1);
  assert.equal(cedulaPile(1e6),CEDULA_PILE_MAX);
  assert.ok(existsSync(`public${CEDULA_ART.url}`),CEDULA_ART.url);
  assert.ok(CEDULA_ART.cell[0]>CEDULA_ART.cell[1],'a note is wider than tall');
});
