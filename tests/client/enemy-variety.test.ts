// Card inimigos-variedade: two critters of one kind are not clones (a slight tone and size from the id).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_TONES,SIZE_RANGE,enemyLook} from '../../src/client/render/enemy-variety.ts';

test('the look is deterministic, within ±5 %, and neutral for the elite and the boss',()=>{
  assert.deepEqual(enemyLook('e-42'),enemyLook('e-42'));
  assert.deepEqual(enemyLook('e-42',true),{tone:0xffffff,size:1});
  assert.deepEqual(enemyLook(''),{tone:0xffffff,size:1});
  for(const t of ENEMY_TONES)for(const sh of [16,8,0])assert.ok(((t>>sh)&255)>=Math.floor(255*.92),`tone ${t.toString(16)}`);
  for(let i=0;i<500;i++){const {size}=enemyLook(`z-${i}`);assert.ok(size>=SIZE_RANGE[0]&&size<=SIZE_RANGE[1],`${size}`);}
});

test('a horde spreads over every tone and many sizes (no tone above a third)',()=>{
  const tones=new Map<number,number>(),sizes=new Set<number>();
  for(let i=0;i<600;i++){const l=enemyLook(`z-${i}`);tones.set(l.tone,(tones.get(l.tone)??0)+1);sizes.add(l.size);}
  assert.equal(tones.size,ENEMY_TONES.length);
  assert.ok(Math.max(...tones.values())<600/3);
  assert.ok(sizes.size>=8,`${sizes.size} sizes`);
});
