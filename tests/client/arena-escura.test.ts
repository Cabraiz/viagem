/**
 * The chefão's arena in the dark (card NEW-20261023-ORQ-boss-fim-onda-1, etapa 7, src/client/render/arena-rules.ts and
 * arena-dark.ts): only the 1st wave's chefão on his feet darkens the map; it closes in over ARENA.inS, opens over
 * ARENA.outS once he falls, the arena follows him eased; drawn under the fear's dark and wired into the run scene.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ARENA,ArenaClock,arenaBoss} from '../../src/client/render/arena-rules.ts';
import {WAVE_BOSS_IDS} from '../../src/rules/index.ts';

const boss=(hp=100)=>({id:'e-9',kind:WAVE_BOSS_IDS[0],x:10,y:20,hp});

test('only the wave chefão on his feet makes the arena', () => {
  assert.equal(arenaBoss([{id:'e-1',kind:'zumbi',x:0,y:0,hp:5}]),undefined);
  assert.equal(arenaBoss([{id:'e-2',kind:'chefe',x:0,y:0,hp:5}]),undefined,'the final boss keeps its own fight');
  assert.equal(arenaBoss([boss(0)]),undefined,'a fallen chefão opens it');
  assert.equal(arenaBoss([{id:'e-1',kind:'zumbi',x:0,y:0,hp:5},boss()])?.id,'e-9');
});

test('the dark closes in over ARENA.inS and opens over ARENA.outS', () => {
  const clock=new ArenaClock();
  assert.equal(clock.step(undefined,16).alpha,0);
  const first=clock.step(boss(),100);
  assert.ok(first.alpha>0&&first.alpha<ARENA.alpha*.1,'no pop');
  let f=first;for(let t=100;t<ARENA.inS*1000;t+=100)f=clock.step(boss(),100);
  assert.ok(Math.abs(f.alpha-ARENA.alpha)<1e-9,'full at ARENA.inS');
  for(let t=0;t<ARENA.outS*500;t+=50)f=clock.step(undefined,50);
  assert.ok(f.alpha>0&&f.alpha<ARENA.alpha,'half open');
  assert.deepEqual(f.at,{x:10,y:20},'the arena stays where he fell while it opens');
  for(let t=0;t<ARENA.outS*500+50;t+=50)f=clock.step(undefined,50);
  assert.equal(f.alpha,0);assert.equal(f.at,undefined);
});

test('the arena follows him eased, no jump on a 20 Hz step', () => {
  const clock=new ArenaClock();
  clock.step(boss(),16);
  const f=clock.step({x:12,y:20},16);
  assert.ok(f.at!.x>10&&f.at!.x<10.2,`eased: ${f.at!.x}`);
  clock.reset();
  assert.equal(clock.step(undefined,16).alpha,0);
});

test('drawn under the fear dark, with the arena clear edge at ARENA.radius, wired into the run', () => {
  const dark=readFileSync('src/client/render/arena-dark.ts','utf8'),scene=readFileSync('src/client/scene.ts','utf8');
  assert.match(dark,/ARENA_DEPTH=VIGNETTE_DEPTH\+9/);
  assert.match(scene,/this\.drawYou\(_time\);this\.drawArena\(delta\)/);
  assert.match(scene,/ARENA\.radius\*grow/);
});
