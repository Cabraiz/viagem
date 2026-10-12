import test from 'node:test';
import assert from 'node:assert/strict';
import {WATER_MAX_SIDE,WATER_TEXELS,waterCacheSize} from '../../src/client/terrain/water-size.ts';

test('water cache follows the view shape: square texels on screen, same texel budget as the old 256×192',()=>{
  for(const [w,h] of [[390,844],[844,390],[1024,768],[360,800],[1920,1080]]){
    const c=waterCacheSize(w,h),tx=w/c.width,ty=h/c.height;
    assert.ok(Math.abs(tx/ty-1)<.12,`${w}x${h}: texel ${tx.toFixed(2)} × ${ty.toFixed(2)} px`);
    assert.ok(c.width*c.height<=WATER_TEXELS*1.15,`${w}x${h}: ${c.width}x${c.height}`);
    assert.ok(Math.max(c.width,c.height)<=WATER_MAX_SIDE);
  }
  // The old fixed cache in portrait: texels 1,5 × 4,4 px (stretched 3×); now ~2,6 px square.
  const p=waterCacheSize(390,844);assert.ok(390/p.width<3&&844/p.height<3);
  assert.deepEqual(waterCacheSize(0,0),waterCacheSize(1,1));
});
