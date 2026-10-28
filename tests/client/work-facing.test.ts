// Card NEW-20261025-ORQ-animacao-trabalhar-6: a hero on a bico's shift stays in the ring playing its work16, its back to
// the shop's door (which faces the camera in every turn), and each of the 6 menu heroes has the loop in all 8 directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workFacing} from '../../src/client/sprites/work-facing.ts';
import {bicoSpots} from '../../src/client/render/bancos/bico-art.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {hasWork16,workPlan,MOVEMENT16_DURATION} from '../../src/client/sprites/movement128.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';

test('in every camera turn the working hero turns its back to the shop door',()=>{
  for(const view of [0,1,2,3]){
    const f=workFacing(view),{door}=bicoSpots(0,0,view);
    assert.equal(f.work,true);
    assert.ok(Math.abs(Math.hypot(f.x,f.y)-1)<1e-9,'a unit direction');
    assert.ok(f.x*door.x+f.y*door.y<0,`view ${view}: faces away from the door`);
  }
});

test('the 6 menu heroes loop a work16 in all 8 directions, slower than the build',()=>{
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  assert.ok(MOVEMENT16_DURATION.work>MOVEMENT16_DURATION.build);
  for(const id of ['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','aposentado','vendedor-praia']){
    assert.ok(hasWork16(id),`${id}: work16`);
    for(const d of HERO_DIRECTIONS){const p=workPlan(id,d)!;assert.equal(p.motion,'work');assert.equal(p.loop,true);assert.equal(p.frameCount,16);}
  }
});
