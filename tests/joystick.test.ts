import test from 'node:test';
import assert from 'node:assert/strict';
import {JoystickInput} from '../src/game/joystick.ts';

test('a second finger cannot take over or release the moving finger',()=>{
  const stick=new JoystickInput();
  assert.equal(stick.start(1),true);stick.move(1,40,0,30);
  assert.equal(stick.start(2),false);assert.equal(stick.move(2,-40,0,30),false);
  assert.equal(stick.end(2),false);assert.equal(stick.x,1);
  assert.equal(stick.end(1),true);assert.equal(stick.x,0);assert.equal(stick.y,0);
});
test('dead zone stops drift and diagonal input cannot exceed full strength',()=>{
  const stick=new JoystickInput();stick.start(7);stick.move(7,2,1,30);
  assert.equal(stick.x,0);assert.equal(stick.y,0);
  stick.move(7,90,-90,30);assert.ok(Math.abs(Math.hypot(stick.x,stick.y)-1)<1e-9);
  assert.ok(stick.x>0&&stick.y<0);
  stick.reset();assert.equal(stick.pointer,undefined);assert.equal(stick.x,0);
  assert.equal(stick.move(7,30,0,30),false);assert.equal(stick.start(8),true);
});
