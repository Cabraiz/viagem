// BUG-20261013-E8 (tio preso na cidade): wide bodies stood for good on the strip north of mouth N, between two blocks,
// where only the hero fits. The planner's fields (plaza, barricade, exit) are hero-size, so they lead a body there whose
// own disc (moveSafely with its radius) cannot follow: a siege tio-pavê (0.52) walking to the plaza stood at
// (87.5, 77.9), and in the wider camera contract (D-046) five retreating elite tios-pavê (0.78) stood at (87.5, 81.5)
// until the liveness cap, holding round 3 open (132.6 s > 115 s, city-room-bots). Now such a body squeezes by the hero
// rule there (grid.ts run, director.ts moveCityRetreats). The bodies are placed at the stall spots on the real asset,
// in the real Simulation, without the camera contract. D-031: positions and ticks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {STRAIGHT_COST,UNREACHABLE} from '../../src/maps/flowfield.ts';
import {ticks} from '../../src/contract/types.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {citySpeed} from '../../src/sim/city/speed.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import type {SimContext} from '../../src/sim/context.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,planner=cityPlanner(city);
/** Street distance (u) to the plaza and to the nearest avenue end, on the planner's fields. */
const units=(c:number)=>c===UNREACHABLE?Infinity:c/STRAIGHT_COST*city.asset.unitsPerCell;
const toPlaza=(p:{x:number;y:number})=>units(planner.plazaField.costAt(p.x,p.y));
const toExit=(p:{x:number;y:number})=>units(planner.exitField.costAt(p.x,p.y));

/** A city run with one standing (idle) bot, in the round-1 wave. */
function cityRun(){
  const sim=new Simulation(4242,{world:'cidade',terrain:city,cityStructures:true});
  sim.addBot('bot-1','bot-1','cidadao-comum');sim.resetRun();
  for(let i=0;i<ticks(30)&&sim.world.round.phase!=='wave';i++)sim.step(sim.tick*50);
  assert.equal(sim.world.round.phase,'wave');
  return sim;
}
const add=(sim:Simulation,at:{x:number;y:number},elite=false)=>{
  const e=createEnemy(sim.world as unknown as SimContext,'tio-pave',at,1,{elite});e.speed=citySpeed(e.speed);return e;
};

test('E8: a siege tio-pavê on the strip north of mouth N walks on to the plaza instead of standing at the corner',()=>{
  const sim=cityRun(),e=add(sim,{x:87.485,y:77.949});
  e.memory!.siege=1;
  assert.ok(e.radius>.5,`a wide body (${e.radius})`);
  const before=toPlaza(e);
  assert.ok(Number.isFinite(before),'the spot reaches the plaza');
  for(let i=0;i<ticks(3);i++)sim.step(sim.tick*50);
  const after=toPlaza(e);
  assert.ok(before-after>=2,`3 s: ${before.toFixed(1)} → ${after.toFixed(1)} u from the plaza, at (${e.x.toFixed(2)},${e.y.toFixed(2)})`);
});

test('E8: a retreating elite tio-pavê at (87.5, 81.5) backs up its avenue instead of standing there until the cap',()=>{
  const sim=cityRun(),e=add(sim,{x:87.67,y:81.535},true);
  assert.ok(e.radius>.75,`an elite tio-pavê (${e.radius})`);
  e.memory={...e.memory!,retreat:1};e.damage=0;
  const director=sim.run.director;
  director.state.retreating.push({id:e.id,x:e.x,y:e.y,untilTick:sim.tick+ticks(60)});
  const from={x:e.x,y:e.y},before=toExit(e);
  assert.ok(Number.isFinite(before),'the spot reaches an avenue end');
  for(let i=0;i<ticks(3)&&sim.world.enemies.has(e.id);i++)sim.step(sim.tick*50);
  const gone=!sim.world.enemies.has(e.id),after=toExit(e);
  assert.ok(gone||before-after>=2,`3 s: ${before.toFixed(1)} → ${after.toFixed(1)} u from an avenue end, from (${from.x},${from.y}) to (${e.x.toFixed(2)},${e.y.toFixed(2)})`);
});
