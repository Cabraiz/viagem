import test from 'node:test';
import assert from 'node:assert/strict';
import {projectView,unprojectView,rotateVector,viewDepth,screenDirection,normalizeView} from '../src/game/projection.ts';
import {project,obstacles,SPAWN} from '../src/game/world.ts';
import {fitIsland,ISLAND_VIEWS} from '../src/game/framing.ts';

test('four views preserve world coordinates and elevation during picking',()=>{
  for(let view=0;view<4;view++)for(let x=2;x<=22;x+=.5)for(let y=2;y<=22;y+=.5){
    const point={x,y},screen=projectView(point,view),back=unprojectView(screen,view);
    assert.ok(Math.hypot(back.x-x,back.y-y)<1e-7,`view ${view}: ${x},${y}`);
    assert.deepEqual(point,{x,y});
    if(!view)assert.deepEqual(screen,project(point));
  }
});
test('joystick stays screen relative in all four views',()=>{
  for(let view=0;view<4;view++)for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1],[.7,.3]]){
    const world=screenDirection(x,y,view),camera=rotateVector(world,view);
    assert.ok(Math.abs((camera.x-camera.y)-x)<1e-10);
    assert.ok(Math.abs((camera.x+camera.y)/2-y)<1e-10);
  }
});
test('four turns restore the view and opposite camera reverses occlusion',()=>{
  assert.equal(normalizeView(4),0);assert.equal(normalizeView(-1),3);
  const a={x:4,y:8},b={x:16,y:18};
  assert.ok(viewDepth(a,0)<viewDepth(b,0));assert.ok(viewDepth(a,2)>viewDepth(b,2));
  for(const point of [...obstacles,SPAWN])assert.deepEqual(projectView(point,4),projectView(point,0));
});
test('entire island and tall trees fit portrait and landscape at every angle',()=>{
  for(let view=0;view<4;view++)for(const [w,h] of [[320,640],[390,844],[844,390],[1280,720],[640,320]]){
    const fit=fitIsland(w,h,view),bounds=ISLAND_VIEWS[view];
    for(const x of [bounds.left,bounds.right])for(const y of [bounds.top,bounds.bottom]){
      const sx=(x-fit.x)*fit.zoom+w/2,sy=(y-fit.y)*fit.zoom+h/2;
      assert.ok(sx>=15.99&&sx<=w-15.99);assert.ok(sy>=15.99&&sy<=h-15.99);
    }
  }
});
