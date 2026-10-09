import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {classes} from '../src/classes.ts';
import {spriteCatalog} from '../src/game/sprite-catalog.ts';
import {SpriteMotion,SPRITE_CLIPS,ATTACK_VISUAL_MS} from '../src/game/sprite-motion.ts';
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
  assert.equal(motion.update(1099,true,5),'attack');
  assert.equal(motion.update(1100,false,5),'idle');
  assert.equal(motion.update(1200,false,17),'attack');
  assert.equal(motion.update(1250,true,17,false),'idle');
  assert.equal(motion.update(1260,false,17,true),'idle');
});

test('accepted attack events reach observers without changing cooldown or old-wire compatibility',()=>{
  const room=new Simulation();const p=room.add('sprite-test','Sprite','pedreiro');
  room.input(p.id,{seq:1,x:0,y:0,attack:true});room.step();
  const first=p.attackTick;assert.equal(first,1);
  assert.equal(unpackPlayer(packPlayer(p)).attackTick,first);
  room.input(p.id,{seq:2,x:0,y:0,attack:true});room.step();
  assert.equal(p.attackTick,first);
  const legacy=packPlayer(p);legacy.length=9;assert.equal(unpackPlayer(legacy).attackTick,0);assert.equal(unpackPlayer(legacy).spectator,false);
});



test('all classes hold one idle pose and use half-speed walk and attack clips',()=>{
  assert.deepEqual(SPRITE_CLIPS.idle.frames,[0]);
  assert.equal(SPRITE_CLIPS.walk.frameRate,10/2);
  assert.equal(SPRITE_CLIPS.attack.frameRate,12/2);
  assert.equal(ATTACK_VISUAL_MS,1000);
  assert.equal(SPRITE_CLIPS.attack.repeat,0);
});

test('overlapping server attacks cannot restart or extend the slower visual swing',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(0,false,1),'attack');
  assert.equal(motion.update(600,true,13),'attack');
  assert.equal(motion.update(999,true,13),'attack');
  assert.equal(motion.update(1000,true,13),'walk');
  assert.equal(motion.update(1200,false,25),'attack');
  assert.equal(motion.update(2200,false,25),'idle');
  for(let time=2300;time<10000;time+=100)assert.equal(motion.update(time,false,25),'idle');
});

test('rematch clears old attack ticks and accepts the first swing of the new round',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(10000,false,240),'attack');
  assert.equal(motion.update(10100,false,0),'idle');
  assert.equal(motion.update(10200,false,1),'attack');
});
