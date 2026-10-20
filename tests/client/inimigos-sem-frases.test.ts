import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ENEMY_ANIM_RATE,fileFps,fileInfo} from '../../src/client/art/horde-art.ts';
import {HERO_ANIM_RATE} from '../../src/client/sprites/sprite-motion.ts';
import {DEATH_POP_CHANCE,DEATH_POP_GAP_MS,deathPopAllowed} from '../../src/client/render/jokes.ts';

// inimigos-sem-frases-anim-lenta: the critters say nothing over their heads, and their art plays 30% slower than drawn.
test('a bark draws no balloon: layers.ts only lets it cue the action art',()=>{
  const layers=readFileSync(new URL('../../src/client/render/layers.ts',import.meta.url),'utf8');
  assert.doesNotMatch(layers,/case 'bark':\s*this\./,'no bark handler in the FX layer');
  assert.doesNotMatch(layers,/spawnBubble\(/,'the critter balloon is gone');
  assert.match(layers,/case 'say':/,'player and chaveiro lines stay');
  assert.match(layers,/case 'skill':this\.spawnSkillBubble/,'skill lines stay');
});

test('death jokes are rare: ~1 kill in 10, never two inside DEATH_POP_GAP_MS, the same on every client; the chefe always',()=>{
  // 2000 kills, one every 250 ms (a busy horde), ids like the sim's.
  const shown:number[]=[];let last=-Infinity;
  for(let i=0;i<2000;i++){const now=i*250;if(deathPopAllowed(`e${i}`,now,last)){shown.push(now);last=now;}}
  assert.ok(shown.length>0,'they still show');assert.ok(shown.length<=2000*250/DEATH_POP_GAP_MS,'at most one per gap');
  assert.ok(shown.length<2000*DEATH_POP_CHANCE,'fewer than the chance alone (the gap cuts more)');
  for(let i=1;i<shown.length;i++)assert.ok(shown[i]-shown[i-1]>=DEATH_POP_GAP_MS,`two texts ${shown[i]-shown[i-1]} ms apart`);
  // Without the gap the draw alone is ~10% and deterministic by id.
  let drawn=0;for(let i=0;i<5000;i++)if(deathPopAllowed(`e${i}`,0,-Infinity))drawn++;
  assert.ok(drawn>5000*.07&&drawn<5000*.13,`${drawn} of 5000`);
  assert.equal(deathPopAllowed('e7',0,-Infinity),deathPopAllowed('e7',0,-Infinity));
  assert.equal(deathPopAllowed('qualquer',1,0,true),true,'the chefe always shows');
  const layers=readFileSync(new URL('../../src/client/render/layers.ts',import.meta.url),'utf8');
  assert.match(layers,/if\(!deathPopAllowed\(id,this\.now,this\.lastDeathPopAt,k==='chefe'\)\)return;/,'spawnDeath goes through the rule');
});

test('enemy art plays at ×0.7 like the hero; the file fps (and projectiles) keep the drawn rate',()=>{
  assert.equal(ENEMY_ANIM_RATE,.7);assert.equal(ENEMY_ANIM_RATE,HERO_ANIM_RATE);
  const walk={cell:[128,128] as [number,number],frames:8,directions:8,fps:{walk:10}};
  assert.equal(fileFps(walk,'walk'),10,'the drawn rate');
  assert.equal(fileInfo('bebado','walk',walk).fps,7,'played 30% slower');
});
