import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GHOST_SPEED_MULT,GhostCam,clampGhost,ghostBounds,ghostSpeed,ghostStep,type GhostFrame} from '../../src/client/ghost.ts';
import {GHOST_TEXT,spectatorView} from '../../src/client/hud/spectator.ts';
import {heroSpeed} from '../../src/maps/index.ts';

const frame=(over:Partial<GhostFrame>={}):GhostFrame=>({out:true,fell:true,from:{x:5,y:5},steer:{x:0,y:0},seconds:.1,speed:10,...over});

test('a fall starts the ghost free where the hero fell; standing still it stays there', ()=>{
  const g=new GhostCam();
  assert.deepEqual(g.update(frame()),{x:5,y:5});
  assert.equal(g.mode,'free');assert.equal(g.out,true);
});

test('the stick walks the ghost faster than the hero, through anything, inside the map', ()=>{
  const g=new GhostCam();
  const at=g.update(frame({steer:{x:3,y:0}}))!;
  assert.ok(Math.abs(at.x-6)<1e-9&&at.y===5,JSON.stringify(at));
  assert.equal(ghostSpeed(),heroSpeed()*GHOST_SPEED_MULT);assert.ok(GHOST_SPEED_MULT>=1);
  // Clamped to the bounds; a long frame is capped like the hero's walk (0.1 s).
  assert.deepEqual(ghostStep({x:9.5,y:0},{direction:{x:1,y:0}},5,10,{x:0,y:0,w:10,h:10}).at,{x:10,y:0});
  assert.deepEqual(clampGhost({x:-3,y:20},{x:0,y:0,w:10,h:10}),{x:0,y:10});
  assert.deepEqual(clampGhost({x:-3,y:20}),{x:-3,y:20});
});

test('a click sends the ghost in a straight line until it arrives; the stick wins over it', ()=>{
  const g=new GhostCam();
  assert.equal(g.goTo({x:0,y:0}),false,'not out: the hero walks');
  g.update(frame());
  assert.equal(g.goTo({x:5,y:8}),true);
  const half=g.update(frame())!;assert.deepEqual(half,{x:5,y:6});
  assert.deepEqual(g.update(frame({from:half})),{x:5,y:7});
  assert.deepEqual(g.update(frame({from:{x:5,y:7}})),{x:5,y:8});assert.equal(g.target,undefined);
  g.goTo({x:50,y:50});g.update(frame({steer:{x:1,y:0}}));assert.equal(g.target,undefined,'the stick drops the click');
});

test('‹ › pin a friend (follow); the stick or a click lets go again; joined mid-run starts following', ()=>{
  const g=new GhostCam();
  g.update(frame());g.pin();
  assert.equal(g.update(frame()),undefined);assert.equal(g.mode,'follow');
  assert.deepEqual(g.update(frame({from:{x:20,y:20},steer:{x:0,y:1}})),{x:20,y:21},'free again, from the friend');
  g.pin();g.goTo({x:20,y:30});assert.ok(g.update(frame({from:{x:20,y:20}})));assert.equal(g.mode,'free');
  const late=new GhostCam();
  assert.equal(late.update(frame({fell:false})),undefined);assert.equal(late.mode,'follow');
});

test('back in the run (revanche) everything resets; the next fall is free again', ()=>{
  const g=new GhostCam();
  g.update(frame());g.goTo({x:9,y:9});
  assert.equal(g.update(frame({out:false})),undefined);
  assert.equal(g.out,false);assert.equal(g.target,undefined);assert.equal(g.goTo({x:1,y:1}),false);
  g.pin();assert.deepEqual(g.update(frame({from:{x:2,y:2}})),{x:2,y:2});assert.equal(g.mode,'free');
});

test('the ghost keeps to the city\'s playable area and the island\'s grid; the endless world has no edge', ()=>{
  const city={world:'cidade',asset:{playable:{x:2,y:3,w:40,h:50}}} as unknown as Parameters<typeof ghostBounds>[0];
  assert.deepEqual(ghostBounds(city),{x:2,y:3,w:40,h:50});
  assert.deepEqual(ghostBounds(),{x:-4,y:-4,w:32,h:32});
  assert.equal(ghostBounds({chunks:{}} as unknown as Parameters<typeof ghostBounds>[0]),undefined);
});

test('the torcida\'s bar while the ghost walks: "Fantasma · Pelo mapa", ‹ › pin any friend still in the run', ()=>{
  assert.deepEqual(spectatorView({phase:'combat',eliminated:true,ghost:{choices:1}}),{show:true,name:GHOST_TEXT,arrows:true,ghost:true});
  assert.equal(spectatorView({phase:'combat',eliminated:true,ghost:{choices:0}}).arrows,false);
  assert.equal(spectatorView({phase:'result',eliminated:true,ghost:{choices:2}}).show,false);
  assert.match(readFileSync('src/client/hud/spectator.css','utf8'),/\.spect\[data-ghost\] \.spect-quem::before\{content:'Fantasma'\}/);
});

test('client only: the ghost never reaches the room (no net in ghost.ts; the scene sends a standing hero while out)', ()=>{
  const ghost=readFileSync('src/client/ghost.ts','utf8');
  assert.doesNotMatch(ghost,/\bnet\b|socket|send\(/);
  const scene=readFileSync('src/client/scene.ts','utf8');
  assert.match(scene,/if\(!out&&Math\.hypot\(sx,sy\)>\.05\)\{this\.route=\[\];direction=screenDirection/);
  assert.match(scene,/!frozen&&!out&&!!this\.hooks\.attacking/);
  // The stick stays live while out (it walks the ghost); only the attack and the etiqueta hide.
  assert.doesNotMatch(readFileSync('src/client/explore.ts','utf8'),/shell\.dataset\.out==='true'\|\|shell\.dataset\.controls==='off'/);
  assert.doesNotMatch(readFileSync('src/client/coop.css','utf8'),/data-out=true\] \.explore-stick\{/);
});
