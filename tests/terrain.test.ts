import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainField} from '../src/game/terrain/field.ts';
import {findPath,clearSegment,walkable,SPAWN,landmarks,moveDirection} from '../src/game/world.ts';
import {projectView,unprojectView} from '../src/game/projection.ts';
import {fitIsland} from '../src/game/framing.ts';
import {Simulation,simulate,reconcile} from '../src/game/net/shared.ts';

test('same seed reproduces the entire field, while different seeds change coast and relief',()=>{
  const a=new TerrainField(17),b=new TerrainField(17),c=new TerrainField(18);
  assert.equal(a.signature,b.signature);assert.deepEqual(a.heights,b.heights);
  assert.notEqual(a.signature,c.signature);assert.notEqual(a.coast(20,14),c.coast(20,14));
  assert.ok(Math.max(...a.heights)>55);assert.ok(Math.min(...a.heights)<-20);
});
test('spawn, all landmarks and routes stay safe across 40 generated seeds',()=>{
  for(let seed=0;seed<40;seed++){
    const field=new TerrainField(seed*7919);
    for(const target of [SPAWN,...landmarks]){
      assert.ok(walkable(target,field),`${seed}: dry landmark`);
      const route=findPath(SPAWN,target,field);assert.ok(route.length,`${seed}: reachable landmark`);
      let p=SPAWN;for(const next of route){assert.ok(clearSegment(p,next,field));p=next;}
    }
    let p={...SPAWN};for(let i=0;i<150;i++)p=moveDirection(p,{x:0,y:1},.1,field);
    assert.ok(walkable(p,field));assert.ok(field.coast(p.x,p.y)>.4);
  }
});
test('generated relief picking and framing agree in all camera views',()=>{
  for(const seed of [0,1,17,123456,0xffffffff]){
    const field=new TerrainField(seed);
    for(let view=0;view<4;view++){
      for(let x=3;x<=21;x+=.6)for(let y=3;y<=21;y+=.6){
        const point={x,y};if(!field.land(x,y,.8))continue;
        const pixel=projectView(point,view,field),back=unprojectView(pixel,view,field);
        assert.ok(Math.hypot(back.x-x,back.y-y)<.002,`${seed}/${view}: ${x},${y} -> ${back.x},${back.y}`);
      }
      for(const [width,height] of [[390,844],[844,390]]){
        const f=fitIsland(width,height,view,field);
        for(const point of [SPAWN,...landmarks]){
          const p=projectView(point,view,field),sx=(p.x-f.x)*f.zoom+width/2,sy=(p.y-f.y)*f.zoom+height/2;
          assert.ok(sx>=0&&sx<=width&&sy>=0&&sy<=height);
        }
      }
    }
  }
});
test('room seed travels in snapshot and controls server, prediction and reconciliation',()=>{
  const sim=new Simulation(54321);const player=sim.add('a','A','cidadao-comum');
  const terrain=sim.snapshot().terrain!;const clientField=new TerrainField(terrain.seed);
  assert.equal(clientField.signature,terrain.signature);
  let client={x:player.x,y:player.y};const initial={...client},inputs=[];
  for(let seq=1;seq<=20;seq++){
    const input={seq,x:0,y:1,attack:false};inputs.push(input);sim.input('a',input);sim.step();client=simulate(client,input,clientField);
    assert.deepEqual(client,{x:player.x,y:player.y});
  }
  assert.deepEqual(reconcile(initial,inputs,clientField),client);
  assert.notEqual(new Simulation(54322).terrain.signature,sim.terrain.signature);
});
