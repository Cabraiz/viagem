// NEW-20261018-ORQ-animacao-heroi-70 (the user's ask, 18/10): every hero animation plays 30 % slower (rate × 0.7) —
// the player's hero and the team's, the R06 movement sheets and the legacy clips — while the walking speed in the
// world stays the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_ANIM_RATE,SPRITE_CLIPS,ATTACK_VISUAL_MS} from '../../src/client/sprites/sprite-motion.ts';
import {MOVEMENT128_DURATION,movement128Frame} from '../../src/client/sprites/movement128.ts';
import {HERO_SPEED_MULT} from '../../src/maps/world.ts';

test('the factor is 0.7: the R06 walk takes 600/0.7 ms a cycle, the attack 1000/0.7 ms; the art keeps its own 600/1000',()=>{
  assert.equal(HERO_ANIM_RATE,.7);
  assert.deepEqual(MOVEMENT128_DURATION,{walk:600,attack:1000},'the manifest\'s timing (the art) is untouched');
  const walk={durationMs:600,loop:true},attack={durationMs:1000,loop:false};
  assert.equal(movement128Frame(walk,600),Math.floor(.7*128),'after the drawn 600 ms only 70 % of the walk played');
  assert.equal(movement128Frame(walk,Math.ceil(600/.7)),0,'the cycle closes at ~857 ms');
  assert.equal(movement128Frame(attack,1000),Math.floor(.7*128));
  assert.equal(movement128Frame(attack,Math.ceil(1000/.7)),127,'the swing ends at ~1429 ms');
  assert.ok(Math.abs(ATTACK_VISUAL_MS-1000/.7)<1e-9,'the swing shows as long as its slowed clip');
});

test('the legacy clips play at 0.7 of their rate; the hero walks as fast as before',()=>{
  assert.equal(SPRITE_CLIPS.walk.frameRate,5*HERO_SPEED_MULT*.7);
  assert.equal(SPRITE_CLIPS.attack.frameRate,6*.7);
  assert.equal(SPRITE_CLIPS.idle.frameRate,3*.7);
  assert.equal(HERO_SPEED_MULT,2,'the walking speed (velocidade-heroi-e-projetil) does not change');
});
