/**
 * Card NEW-20261028-ORQ-uno-nao-empurra-sem-querer (src/sim/chaveiro/car.ts): walking back to the Uno pushed it ~11 u
 * (auditoria-jogabilidade 28/10, item 7). In a real room (seed 11, the Cidade, the chaveiro), a person walks to the car
 * with the stick: the car rolls only after PUSH_LEAN_S leaning with the stick within PUSH_AIM_DOT of it; reaching it and
 * stopping, passing along its side or leaning askew leave it where it is; a push on purpose rolls as before.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR_PUSH_REACH,SIM_HZ,carGap,carSpeed,ticks} from '../../src/contract/index.ts';
import {PUSH_AIM_DOT,PUSH_LEAN_S,PUSH_TOUCH} from '../../src/sim/chaveiro/car.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';

const loaded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),
  (JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const terrain=loaded.terrain;

/** A room on seed 11 at the round-2 intermission (the car moves in any phase but the opening), streets kept empty. */
function room(){
  const sim=new Simulation(11,{world:'cidade',terrain,cityStructures:true,objective:'chaveiro'});
  sim.add('ana','Ana','cidadao-comum');
  sim.resetRun();
  const calm=()=>{sim.world.enemies.clear();sim.world.telegraphs.clear();sim.world.projectiles.clear();};
  for(let i=0;i<ticks(120)&&!(sim.world.round.index>=2&&sim.world.round.phase==='prepare');i++){calm();sim.step(sim.tick*50);}
  assert.equal(sim.world.round.phase,'prepare');
  const car=()=>sim.run.chaveiro!.state.car,ana=sim.players.get('ana')!;
  // The street runs east and west of the car's spot (a building ~0.5 u north): the car 5 u west, as bots-carro.
  car().x-=5;
  let seq=0;
  /** `n` ticks with the stick at `stick` (undefined: let go). */
  const walk=(n:number,stick?:{x:number;y:number})=>{for(let i=0;i<n;i++){calm();sim.input('ana',{seq:++seq,x:stick?.x??0,y:stick?.y??0,attack:false});sim.step(sim.tick*50);}};
  /** Walks with `stick` until the body stops the hero (on it: PUSH_TOUCH); the ticks it took. */
  const reach=(stick:{x:number;y:number})=>{let n=0;while(carGap(car(),ana)>PUSH_TOUCH){walk(1,stick);assert.ok(++n<ticks(10),'reaches the car');}return n;};
  return {sim,car,ana,walk,reach};
}
const EAST={x:1,y:0};
const moved=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);

test('walking back to the Uno and stopping does not move it (also a beat of the stick on it, and standing there)',()=>{
  const r=room(),c0={...r.car()};
  r.ana.x=c0.x-6;r.ana.y=c0.y;
  // Walking at it, the hero comes within CAR_PUSH_REACH of the body ticks before it stops on it: none of that is leaning.
  let near=0;
  while(carGap(r.car(),r.ana)>PUSH_TOUCH){r.walk(1,EAST);if(carGap(r.car(),r.ana)<=CAR_PUSH_REACH)near++;}
  assert.ok(near>=2,`walked ${near} ticks near it`);
  // The player lets go a moment after the body stops the hero (shorter than the lean), then stands leaning there.
  r.walk(ticks(PUSH_LEAN_S)-2,EAST);
  r.walk(ticks(2));
  assert.ok(moved(r.car(),c0)<.5,`the car moved ${moved(r.car(),c0)} u`);
  assert.equal(moved(r.car(),c0),0);
  assert.equal(r.sim.objectiveView()!.car.movers,undefined);
});

test('passing along its side or leaning on it askew (50 degrees off) does not move it',()=>{
  const r=room(),c0={...r.car()};
  // South of the body, walking east along it: the stick is across the line to the car.
  r.ana.x=c0.x-3;r.ana.y=c0.y+1.4;
  r.walk(ticks(2),EAST);
  assert.equal(moved(r.car(),c0),0,'passing by');
  // West of it, 1 s leaning with the stick 50 degrees off the car (the old rule, cos >= 0.5, pushed it).
  const a=50*Math.PI/180;
  assert.ok(Math.cos(a)<PUSH_AIM_DOT&&Math.cos(a)>=.5);
  r.ana.x=c0.x-6;r.ana.y=c0.y;r.reach(EAST);
  r.walk(SIM_HZ,{x:Math.cos(a),y:-Math.sin(a)});
  assert.equal(moved(r.car(),c0),0,'askew');
});

test('a push on purpose: after PUSH_LEAN_S on it the car rolls at carSpeed(1), as before; a wobble of the stick keeps it going',()=>{
  const r=room(),c0={...r.car()};
  r.ana.x=c0.x-6;r.ana.y=c0.y;r.reach(EAST);
  // Holding the stick at it: still for the lean (give or take the tick it touched), then it rolls.
  let still=0;
  while(r.car().x===c0.x){r.walk(1,EAST);assert.ok(++still<SIM_HZ,'rolls within a second');}
  assert.ok(still>=ticks(PUSH_LEAN_S)-2&&still<=ticks(PUSH_LEAN_S),`rolled after ${still} ticks on it`);
  const x1=r.car().x;
  r.walk(SIM_HZ/2,EAST);
  assert.ok(Math.abs(r.car().x-x1-carSpeed(1)/2)<1e-9,`half a second at carSpeed(1): ${r.car().x-x1}`);
  assert.deepEqual(r.sim.objectiveView()!.car.movers,['ana']);
  // Pushing, the stick 50 degrees off for a moment: it keeps rolling (CAR_PUSH_DOT), at carSpeed(1).
  const a=50*Math.PI/180,x2=r.car().x;
  r.walk(4,{x:Math.cos(a),y:-Math.sin(a)});
  assert.ok(r.car().x-x2>carSpeed(1)*4/SIM_HZ*Math.cos(a)-1e-9,`kept rolling ${r.car().x-x2}`);
  // Let go and come back: it waits for the lean again.
  r.walk(2);
  const x3=r.car().x;
  r.walk(ticks(PUSH_LEAN_S)-1,EAST);
  assert.equal(r.car().x,x3,'leans again');
});
