// BUG-20261024-ORQ-viaduto-bot-preso-rampa: the city bench (scripts/bench-city-run.ts) on the main with the viaduct
// (mapa-175-com-viaduto): in seed 4 1p the bot starts on the deck (andar 1) and stayed at its west side (76.6, 35–38)
// the whole run, alternating plaza/unstick: the wrapper aimed it on the ground's flow field, which on the deck pushes
// into the deck's side. The room's brain walks the deck down its ramp; now the bench's wrapper does too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {CityNavigator,playRun,HZ} from '../../scripts/bench-city-run.ts';

const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const hash=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8')).hash;

test('seed 4 1p: the bot that starts on the deck walks down the ramp into the base in round 1, never stuck',async()=>{
  const loaded=await cityTerrainFrom(text,hash);if(!loaded.ok)throw new Error(loaded.error);
  const city=loaded.terrain;
  const r=playRun({seed:4,players:1,capTicks:40*HZ,city,nav:new CityNavigator(city),route:'none',towers:true});
  const arrived=r.nav.round1ArrivalS.bot1;
  assert.ok(arrived!==null&&arrived!==undefined&&arrived<30,`round 1 arrival ${arrived} s`);
  assert.equal(r.nav.stuck,0,`stuck ${r.nav.stuck} times (modes ${JSON.stringify(r.nav.modeTicks)})`);
});
