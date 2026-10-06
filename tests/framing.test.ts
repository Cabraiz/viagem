import test from 'node:test';
import assert from 'node:assert/strict';
import {fitIsland,ISLAND_BOUNDS,SHORE} from '../src/game/framing.ts';

test('the complete island fits both orientations, including very narrow and short screens',()=>{
  for(const [width,height] of [[320,640],[390,844],[844,390],[1280,720],[1920,1080],[640,320]]){
    const f=fitIsland(width,height),b=ISLAND_BOUNDS;
    for(const x of [b.left,b.right])for(const y of [b.top,b.bottom]){
      const screenX=(x-f.x)*f.zoom+width/2,screenY=(y-f.y)*f.zoom+height/2;
      assert.ok(screenX>=15.99&&screenX<=width-15.99,`${width}x${height}: horizontal clipping`);
      assert.ok(screenY>=15.99&&screenY<=height-15.99,`${width}x${height}: vertical clipping`);
    }
    assert.equal(f.x,fitIsland(height,width).x);
    assert.equal(f.y,fitIsland(height,width).y);
  }
});

test('framing includes the full shore instead of only the playable center',()=>{
  assert.ok(ISLAND_BOUNDS.left<=SHORE.x-SHORE.width/2);
  assert.ok(ISLAND_BOUNDS.right>=SHORE.x+SHORE.width/2);
  assert.ok(ISLAND_BOUNDS.top<=SHORE.y-SHORE.height/2);
  assert.ok(ISLAND_BOUNDS.bottom>=SHORE.y+SHORE.height/2);
});
