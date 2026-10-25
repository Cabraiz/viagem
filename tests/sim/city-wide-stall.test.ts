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
import {syncBarricades} from '../../src/sim/stonewards/barricades.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,planner=cityPlanner(city);
/** Street distance (u) to the plaza and to the nearest avenue end, on the planner's fields. */
const units=(c:number)=>c===UNREACHABLE?Infinity:c/STRAIGHT_COST*city.asset.unitsPerCell;
const toPlaza=(p:{x:number;y:number})=>units(planner.plazaField.costAt(p.x,p.y));
const toExit=(p:{x:number;y:number})=>units(planner.exitField.costAt(p.x,p.y));
/**
 * A spot of the 1.7× city (asset v3) on asset v4, the city 1.75× shorter (NEW-20261023-ORQ-mapa-175-com-viaduto): the
 * compaction's own mapping (scripts/compactar-cidade.ts, 192 → 110 cells). The E8 spots were written on the .w3x-sized
 * city (× 1.7 first).
 */
const v4=(x:number,y:number)=>({x:x*110/192,y:y*110/192});

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
  const sim=cityRun(),e=add(sim,v4(87.485*1.7,77.949*1.7));
  e.memory!.siege=1;
  assert.ok(e.radius>.5,`a wide body (${e.radius})`);
  const before=toPlaza(e);
  assert.ok(Number.isFinite(before),'the spot reaches the plaza');
  for(let i=0;i<ticks(3);i++)sim.step(sim.tick*50);
  const after=toPlaza(e);
  assert.ok(before-after>=2,`3 s: ${before.toFixed(1)} → ${after.toFixed(1)} u from the plaza, at (${e.x.toFixed(2)},${e.y.toFixed(2)})`);
});

test('E8: a retreating elite tio-pavê at (87.5, 81.5) backs up its avenue instead of standing there until the cap',()=>{
  const sim=cityRun(),e=add(sim,v4(87.67*1.7,81.535*1.7),true);
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

// balanco-pos-1-7 part B: an elite Trio Elétrico (1.03 after ENEMY_RADIUS_SCALE) retreating from the plaza, bench seed 1
// (1p, wall mode, round 5, barricade N down), shuffled in place at (133.7, 149.2) until the 60 s cap: its own disc
// grazed a planter on the planner's way out (mouth N), the barricade-free planner then led it a step toward mouth O,
// and the next tick the planner led it back. Now the planner's own way is tried squeezed (hero rule) before the barricade-free one.
test('balanco-pos-1-7: a retreating elite Trio Elétrico in the plaza backs out instead of shuffling in place until the cap',()=>{
  const sim=cityRun(),st=sim.run.stonewards.state,avenues=sim.run.avenues!;
  // The bench's round 5: barricade N broken, the other three standing (the tutorial's round 1 has them all down).
  for(const b of st.barricades??[]){b.down=b.id==='barricada-N';b.hp=b.down?0:b.maxHp;}
  delete st.raiseBarricades;
  for(const rect of syncBarricades(sim.world.terrain,st)){avenues.grid.refresh(rect);avenues.invalidate([rect]);}
  const e=createEnemy(sim.world as unknown as SimContext,'trio-eletrico',v4(133.698,149.132),1,{elite:true});
  // The bench's body (its radius there, 1.025): its own disc cannot take the planner's next step here, the hero's can.
  e.speed=citySpeed(e.speed);e.radius=1.025271;
  assert.ok(e.radius>1,`a widest-class body (${e.radius})`);
  e.memory={...e.memory!,retreat:1};e.damage=0;
  sim.run.director.state.retreating.push({id:e.id,x:e.x,y:e.y,untilTick:sim.tick+ticks(60)});
  const from={x:e.x,y:e.y};
  for(let i=0;i<ticks(3)&&sim.world.enemies.has(e.id);i++)sim.step(sim.tick*50);
  const gone=!sim.world.enemies.has(e.id),moved=Math.hypot(e.x-from.x,e.y-from.y);
  assert.ok(gone||moved>=2,`3 s: ${moved.toFixed(2)} u, from (${from.x},${from.y}) to (${e.x.toFixed(2)},${e.y.toFixed(2)})`);
});
