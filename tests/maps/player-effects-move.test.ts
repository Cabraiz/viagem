/**
 * D-036 movement effects (maps/prediction.ts moveStep), shared by the room's players system and the phone's replay:
 * the slow scales the walk by PLAYER_SLOW_MULT, the slip slides along `slip` at PLAYER_SLIP_SPEED (× the world's walk over
 * SPEED: × HERO_SPEED_MULT on the island since the 2× walk) ignoring the stick,
 * both deterministic from (effects, tick) and collision-safe (never into the sea, a tree or a rock).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {moveStep,reconcile,simulate,slipping,slowed,STEP,type MoveEffects} from '../../src/maps/prediction.ts';
import {HERO_SPEED_MULT,heroSpeed,moveDirection,walkable,obstacles,SPAWN,SPEED,type Point} from '../../src/maps/world.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT,type PlayerInput} from '../../src/contract/index.ts';
import {Rng} from '../../src/contract/rng.ts';

const T=defaultTerrain;
/** The island walk (2 × SPEED) and its slip (PLAYER_SLIP_SPEED × walk / SPEED, the proportion kept). */
const WALK=heroSpeed(T),SLIP=PLAYER_SLIP_SPEED*WALK/SPEED;
test('the island walk is 2 × SPEED and the slip keeps its proportion to it',()=>{
  assert.equal(WALK,SPEED*HERO_SPEED_MULT);assert.equal(HERO_SPEED_MULT,2);
  assert.ok(Math.abs(SLIP-PLAYER_SLIP_SPEED*HERO_SPEED_MULT)<1e-12);
});
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const input=(seq:number,x:number,y:number):PlayerInput=>({seq,x,y,attack:false});

test('no effects: moveStep is the plain walk (old prediction unchanged)',()=>{
  for(const d of [{x:1,y:0},{x:.3,y:-.8},{x:0,y:0}])
    assert.deepEqual(moveStep(SPAWN,d,100,undefined,T),moveDirection(SPAWN,d,STEP,T));
  assert.deepEqual(simulate(SPAWN,input(1,1,0),T),simulate(SPAWN,input(1,1,0),T,100,{}));
});

test('slow: speed × PLAYER_SLOW_MULT while tick < slowUntil, plain walk from slowUntil on',()=>{
  const e:MoveEffects={slowUntil:50};
  const slow=moveStep(SPAWN,{x:1,y:0},49,e,T),plain=moveStep(SPAWN,{x:1,y:0},50,e,T);
  assert.ok(Math.abs(dist(SPAWN,slow)-WALK*PLAYER_SLOW_MULT*STEP)<1e-12,`slowed step ${dist(SPAWN,slow)}`);
  assert.ok(Math.abs(dist(SPAWN,plain)-WALK*STEP)<1e-12);
  assert.ok(slowed(e,49)&&!slowed(e,50)&&!slowed(undefined,0));
});

test('slip: slides along `slip` at the island slip speed, the stick ignored, until slipUntil; then walking again',()=>{
  const e:MoveEffects={slipUntil:20,slip:{x:0,y:-1},slowUntil:40};
  for(const stick of [{x:1,y:0},{x:0,y:1},{x:-.6,y:.8}]){
    const q=moveStep(SPAWN,stick,10,e,T);
    assert.ok(Math.abs(q.x-SPAWN.x)<1e-12&&Math.abs(SPAWN.y-q.y-SLIP*STEP)<1e-12,'slides up whatever the stick');
  }
  // The slip wins over the slow; after it, the slow still applies.
  const after=moveStep(SPAWN,{x:1,y:0},20,e,T);
  assert.ok(Math.abs(dist(SPAWN,after)-WALK*PLAYER_SLOW_MULT*STEP)<1e-12);
  assert.equal(slipping(e,19)?.y,-1);assert.equal(slipping(e,20),undefined);
  assert.equal(slipping({slipUntil:99,slip:{x:0,y:0}},1),undefined,'a zero vector never slides');
  assert.equal(slipping({slipUntil:99,slip:{x:NaN,y:1}},1),undefined,'nor a broken one');
  assert.equal(slipping({slipUntil:99},1),undefined);
});

test('a step without a direction stands while slipping: the attack or the skill held in place never slides (BUG-20261022-ORQ-botao-direito-anda)',()=>{
  const e:MoveEffects={slipUntil:1e9,slip:{x:1,y:0}};
  for(const stick of [{x:0,y:0},{x:.004,y:-.003},{x:NaN,y:0}])assert.deepEqual(moveStep(SPAWN,stick,10,e,T),SPAWN);
  // The phone's replay of a held attack (attack steps, no direction) stays put too, slipping or not.
  const held:PlayerInput[]=Array.from({length:10},(_,i)=>({seq:i+1,x:0,y:0,attack:true}));
  assert.deepEqual(reconcile(SPAWN,held,T,{tick:10,effects:e}),SPAWN);
  // A walking step still slides along `slip`, whatever the stick.
  const q=moveStep(SPAWN,{x:0,y:1},10,e,T);
  assert.ok(Math.abs(q.x-SPAWN.x-SLIP*STEP)<1e-12&&Math.abs(q.y-SPAWN.y)<1e-12);
});

test('a slide never enters the sea, a tree or a rock (island, random spots and directions)',()=>{
  const rng=new Rng(36);let tested=0,blocked=0;
  for(let n=0;n<400;n++){
    let p={x:rng.range(2,24),y:rng.range(2,24)};
    if(!walkable(p,T))continue;
    tested++;
    const a=rng.next()*Math.PI*2,e:MoveEffects={slipUntil:1e9,slip:{x:Math.cos(a),y:Math.sin(a)}};
    for(let tick=0;tick<60;tick++){
      const q=moveStep(p,{x:-Math.cos(a),y:-Math.sin(a)},tick,e,T);
      assert.ok(walkable(q,T),`slid out of the walkable ground at ${q.x},${q.y}`);
      assert.ok(dist(p,q)<=SLIP*STEP+1e-9,'never more than one slide step');
      if(dist(p,q)<1e-12)blocked++;
      p=q;
    }
  }
  assert.ok(tested>100,`spots ${tested}`);assert.ok(blocked>0,'some slides ran into the coast or an obstacle and stopped');
  // Straight into a tree: stops at its edge.
  const tree=obstacles[0];let p={x:tree.x,y:tree.y-1.2};
  assert.ok(walkable(p,T));
  for(let tick=0;tick<40;tick++){p=moveStep(p,{x:1,y:0},tick,{slipUntil:1e9,slip:{x:0,y:1}},T);assert.ok(walkable(p,T));}
  assert.ok(p.y<tree.y,'did not pass through the tree');
  // Straight to the sea from the spawn: stops on the shore.
  p={...SPAWN};
  for(let tick=0;tick<400;tick++){p=moveStep(p,{x:1,y:0},tick,{slipUntil:1e9,slip:{x:0,y:1}},T);assert.ok(walkable(p,T));}
  assert.ok(T.coast(p.x,p.y)>.4,'still on land');
});

test('deterministic: the same effects, ticks and inputs give the same path; reconcile = moveStep tick by tick',()=>{
  const effects:MoveEffects={slowUntil:108,slipUntil:115,slip:{x:-181/256,y:181/256}};
  const inputs=Array.from({length:30},(_,k)=>input(k+1,Math.cos(k/5),Math.sin(k/5)));
  const run=()=>{let p={...SPAWN};const path:Point[]=[];for(let k=0;k<inputs.length;k++){p=simulate(p,inputs[k],T,100+1+k,effects);path.push(p);}return path;};
  const a=run(),b=run();
  assert.deepEqual(a,b);
  assert.deepEqual(reconcile(SPAWN,inputs,T,{tick:100,effects}),a[a.length-1],'k-th pending input on tick frameTick+1+k');
  assert.deepEqual(reconcile(SPAWN,inputs,T),inputs.reduce((p,i)=>moveDirection(p,{x:i.x,y:i.y},STEP,T),{...SPAWN}),'no clock: plain replay');
});
