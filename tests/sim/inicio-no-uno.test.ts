/**
 * Card NEW-20261023-ORQ-inicio-no-uno-caixas-120 on the real Cidade Nevada (mode 'ninhos', the chaveiro, the manual
 * combat: the live game): the whole team spawns together beside the Uno (sim/city/uno-start.ts), whatever the seed and
 * the room size; the minuto de Minerva is 120 s and the first wave still leaves 150–180 s after the start. The rounds
 * mode keeps its walk from the wreck (cityRunStart). Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RADIUS,cityAsField} from '../../src/maps/index.ts';
import {ticks} from '../../src/contract/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityRunStart} from '../../src/sim/city/tutorial.ts';
import {UNO_START_CLEAR,cityUnoStart,startSlots} from '../../src/sim/city/uno-start.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {MINERVA_S,NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city),car=placeWall(city);
/** The farthest a spawn slot may stand from the car's centre (u): beside it, in the same view. */
const BESIDE=5;

test('the start beside the Uno: six slots on open ground, clear of the car, all within a few steps of it',()=>{
  const start=cityUnoStart(city);
  for(const slot of startSlots(start)){
    const d=Math.hypot(slot.x-car.x,slot.y-car.y);
    assert.ok(d>=UNO_START_CLEAR&&d<=BESIDE,`slot ${slot.x},${slot.y} at ${d.toFixed(2)} u of the car`);
    assert.ok(city.clearDisc(slot.x,slot.y,RADIUS),'open ground');
  }
  assert.deepEqual(cityUnoStart(city),start,'once per asset');
});

test('mode ninhos: every hero of 1..6 spawns beside the Uno, on every seed, at the run start and after a rematch',()=>{
  for(const seed of [1,7,21,4242]){
    for(const players of [1,3,6]){
      const sim=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
      for(let i=0;i<players;i++)sim.add(`p${i}`,`P${i}`,'cidadao-comum');
      for(const round of [0,1]){
        if(round)sim.resetRun();
        const live=sim.run.chaveiro!.state.car;
        for(const p of sim.players.values())assert.ok(Math.hypot(p.x-live.x,p.y-live.y)<=BESIDE,`seed ${seed}, ${players}p, ${p.id} at ${Math.hypot(p.x-live.x,p.y-live.y).toFixed(1)} u of the Uno`);
      }
    }
  }
});

test('the rounds mode keeps the walk from the wreck (cityRunStart, far from the plaza)',()=>{
  const sim=new Simulation(3,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro'});
  sim.add('p0','P0','cidadao-comum');
  const p=sim.players.get('p0')!,start=cityRunStart(city);
  assert.ok(Math.hypot(p.x-start.x,p.y-start.y)<2);
  assert.ok(Math.hypot(p.x-car.x,p.y-car.y)>20);
});

test('the minuto de Minerva is 120 s and the first wave leaves 150–180 s after the start (as with the 60 s one)',()=>{
  assert.equal(MINERVA_S,120);assert.equal(NEST_PACE.minerva,120);
  assert.deepEqual(NEST_PACE.first,[30,60]);
  for(const seed of [1,2,3,4,5]){
    const sim=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    sim.add('p0','P0','cidadao-comum');sim.resetRun();
    let now=1000;sim.step(now+=50);
    const nests=sim.run.nests!.state,start=nests.startTick!;
    assert.equal(nests.minervaUntil,start+ticks(120));
    assert.ok(nests.nextWave!>=start+ticks(150)&&nests.nextWave!<=start+ticks(180),`seed ${seed}: first wave at ${(nests.nextWave!-start)/20} s`);
  }
});
