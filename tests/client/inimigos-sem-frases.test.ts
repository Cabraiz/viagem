import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENEMY_ANIM_RATE,fileFps,fileInfo} from '../../src/client/art/horde-art.ts';
import {HERO_ANIM_RATE} from '../../src/client/sprites/sprite-motion.ts';

// inimigos-sem-frases-anim-lenta: the critters say nothing over their heads, and their art plays 30% slower than drawn.
test('a bark draws no balloon: layers.ts only lets it cue the action art',()=>{
  const layers=readFileSync(new URL('../../src/client/render/layers.ts',import.meta.url),'utf8');
  assert.doesNotMatch(layers,/case 'bark':\s*this\./,'no bark handler in the FX layer');
  assert.doesNotMatch(layers,/spawnBubble\(/,'the critter balloon is gone');
  assert.match(layers,/case 'say':/,'player and chaveiro lines stay');
  assert.match(layers,/case 'skill':this\.spawnSkillBubble/,'skill lines stay');
});

test('enemy art plays at ×0.7 like the hero; the file fps (and projectiles) keep the drawn rate',()=>{
  assert.equal(ENEMY_ANIM_RATE,.7);assert.equal(ENEMY_ANIM_RATE,HERO_ANIM_RATE);
  const walk={cell:[128,128] as [number,number],frames:8,directions:8,fps:{walk:10}};
  assert.equal(fileFps(walk,'walk'),10,'the drawn rate');
  assert.equal(fileInfo('bebado','walk',walk).fps,7,'played 30% slower');
});
