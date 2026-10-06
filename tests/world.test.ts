import test from 'node:test';
import assert from 'node:assert/strict';
import {project,unproject,findPath,clearSegment,walkable,moveAlong,moveDirection,SPAWN,SPEED,landmarks,obstacles} from '../src/game/world.ts';

test('screen picking returns the same ground point at every elevation',()=>{
  for(let x=3;x<=21;x+=.6)for(let y=3;y<=21;y+=.6){const p=unproject(project({x,y}));assert.ok(Math.hypot(p.x-x,p.y-y)<.00001);}
});
test('all landmarks are reachable; each path segment respects hero radius and obstacles',()=>{
  for(const a of [SPAWN,...landmarks])for(const b of landmarks){
    const route=findPath(a,b);assert.ok(route.length>0);let current=a;
    for(const p of route){assert.ok(clearSegment(current,p));current=p;}
    assert.deepEqual(current,{x:b.x,y:b.y});
  }
});
test('route around a rock does not cut through its collision volume',()=>{
  const a={x:9.5,y:12},b={x:12.5,y:12};
  assert.equal(clearSegment(a,b),false);
  const route=findPath(a,b);assert.ok(route.length>1);
  let current=a;for(const p of route){assert.ok(clearSegment(current,p));current=p;}
});
test('sea, occupied targets and non-finite commands cannot be reached',()=>{
  for(const target of [{x:-10,y:12},{x:NaN,y:12},{x:Infinity,y:12},...obstacles]){
    assert.equal(walkable(target),false);assert.deepEqual(findPath(SPAWN,target),[]);
  }
});
test('travel distance is independent of frame rate and diagonal input magnitude',()=>{
  for(const fps of [30,60,120]){
    let p={...SPAWN};const route=[{x:12,y:21}];
    for(let i=0;i<fps;i++)p=moveAlong(p,route,1/fps);
    assert.ok(Math.abs(p.y-SPAWN.y-SPEED)<.00001);
  }
  const a=moveDirection(SPAWN,{x:1,y:1},.1),b=moveDirection(SPAWN,{x:4,y:4},.1);
  assert.deepEqual(a,b);assert.ok(Math.abs(Math.hypot(a.x-SPAWN.x,a.y-SPAWN.y)-SPEED*.1)<1e-8);
});
test('large elapsed times cannot teleport a player through obstacles or to the edge',()=>{
  let p={x:9.5,y:12};for(let i=0;i<100;i++)p=moveDirection(p,{x:1,y:0},99);
  assert.ok(p.x<10.28);assert.ok(walkable(p));
  p={...SPAWN};for(let i=0;i<300;i++)p=moveDirection(p,{x:0,y:1},1/30);
  assert.ok(walkable(p));assert.ok(p.y<22);
});
