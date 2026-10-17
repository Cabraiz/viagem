// NEW-20261017-ORQ-seed-vaza-estado: a Worker plays many matches in one process (one module scope for every room), so
// a match must not depend on the ones played before it. The room's own drive (room.ts advance: bots.think, then
// sim.step) plays seed A, then seed B, then seed A again on the real Cidade Nevada (a fresh terrain each, as the
// Worker's rooms get the shared asset): A's second run must end on the same checkpoint as its first. The module caches
// (bot-routes' field LRU, the per-asset loot/grid/relief caches, the enemy catalog) are all in play.
// What leaked in the 1p bench (seed 16 won alone and lost after seed 15) was the bench's own crate-field cache
// (scripts/bench-city-run.ts CityNavigator, keyed by the crate's id, which every match numbers again): see
// tests/tools/bench-city-run-seeds.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {SIM_HZ} from '../../src/contract/types.ts';

const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const hash=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')).hash;
/** Three minutes of match: the tutorial walk, rounds 2–3 with their intermissions (crates, the forge, towers). */
const TICKS=3*60*SIM_HZ;

async function play(seed:number,players:number){
  const loaded=await cityTerrainFrom(text,hash);if(!loaded.ok)throw new Error(loaded.error);
  const sim=new Simulation(seed,{world:'cidade',terrain:loaded.terrain,combat:'manual'} as ConstructorParameters<typeof Simulation>[1]);
  const bots=new RoomBots();
  for(let i=0;i<players;i++){sim.addBot(`bot-${i+1}`,`Bot ${i+1}`,['coach','motoboy','influencer'][i%3]);bots.add(`bot-${i+1}`,i);}
  sim.botState=()=>bots.state();sim.resetRun();bots.reset();
  for(let t=0;t<TICKS;t++){bots.think(sim);sim.step();}
  const cp=sim.checkpoint();
  return {round:sim.world.round.index,digest:createHash('sha256').update(JSON.stringify(cp)).digest('hex').slice(0,16)};
}

test('the same seed twice in one process (another match in between) ends on the same checkpoint',async()=>{
  for(const players of [1,3]){
    const first=await play(16,players),other=await play(15,players),again=await play(16,players);
    assert.ok(first.round>=2,`${players}p: the match got past the tutorial (round ${first.round})`);
    assert.notEqual(other.digest,first.digest,'another seed is another match');
    assert.deepEqual(again,first,`${players}p: seed 16 after seed 15 differs from seed 16 alone`);
  }
});
