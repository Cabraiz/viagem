import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {classes} from '../src/classes.ts';
import {spriteCatalog} from '../src/game/sprite-catalog.ts';
import {SpriteMotion} from '../src/game/sprite-motion.ts';
import {Simulation,packPlayer,unpackPlayer} from '../src/game/net/shared.ts';

test('all 36 class IDs have a transparent 18-frame sheet and a measured scale',async()=>{
  assert.equal(Object.keys(spriteCatalog).length,classes.length);
  for(const hero of classes){
    assert.ok(spriteCatalog[hero.id].height>0);
    const m=await sharp(`public/art/sprites/${hero.id}.webp`).metadata();
    assert.deepEqual([m.width,m.height,m.hasAlpha],[1152,576,true],hero.id);
  }
});

test('an attack finishes once, survives movement, then yields to locomotion',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(0,false),'idle');
  assert.equal(motion.update(20,true),'walk');
  assert.equal(motion.update(100,true,5),'attack');
  assert.equal(motion.update(450,false,5),'attack');
  assert.equal(motion.update(600,true,5),'walk');
  assert.equal(motion.update(800,false,5),'idle');
  assert.equal(motion.update(900,false,17),'attack');
  assert.equal(motion.update(950,true,17,false),'idle');
  assert.equal(motion.update(960,false,17,true),'idle');
});

test('accepted attack events reach observers without changing cooldown or old-wire compatibility',()=>{
  const room=new Simulation();const p=room.add('sprite-test','Sprite','pedreiro');
  room.input(p.id,{seq:1,x:0,y:0,attack:true});room.step();
  const first=p.attackTick;assert.equal(first,1);
  assert.equal(unpackPlayer(packPlayer(p)).attackTick,first);
  room.input(p.id,{seq:2,x:0,y:0,attack:true});room.step();
  assert.equal(p.attackTick,first);
  const legacy=packPlayer(p);legacy.pop();assert.equal(unpackPlayer(legacy).attackTick,0);
});

