// D-043: the city's combat cap is 25 min (its boss spawns at 15.6–21.9 sim minutes in the cidade-11 balance; the endless
// map keeps 20), set by the room's map — also when the owner switches it in the lobby, never during a match — and a room
// lives 50 min so a lobby plus a 25 min city match fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,ROOM_LIFETIME_MS} from '../../multiplayer/room.ts';
import {RunLifecycle,RUN_DURATION_TICKS,CITY_RUN_DURATION_TICKS,RUN_HZ} from '../../src/sim/run.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};

test('D-043: city 25 min, endless 20 min, chosen by the room map and kept through a lobby switch',async()=>{
  assert.equal(CITY_RUN_DURATION_TICKS,25*60*RUN_HZ);assert.equal(RUN_DURATION_TICKS,20*60*RUN_HZ);
  const city=new Room(1000,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada'});await city.ready();
  assert.equal(city.map.id,'cidade-nevada');assert.equal(city.run.snapshot().remaining,CITY_RUN_DURATION_TICKS);
  const endless=new Room(1000,7,{cityText,cityRef:CITY,cityPlayable:true,map:'infinito'});await endless.ready();
  assert.equal(endless.map.id,'infinito');assert.equal(endless.run.snapshot().remaining,RUN_DURATION_TICKS);
  const fixed=new Room(1000,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',durationTicks:123});await fixed.ready();
  assert.equal(fixed.run.snapshot().remaining,123,'an explicit cap (tests, tools) wins');
});

test('D-043: the cap never changes during a match; a room lives 50 min',()=>{
  const run=new RunLifecycle('r',RUN_DURATION_TICKS);
  assert.equal(run.setDurationTicks(CITY_RUN_DURATION_TICKS),true);assert.equal(run.snapshot().remaining,CITY_RUN_DURATION_TICKS);
  assert.equal(run.setDurationTicks(0),false);assert.equal(run.setDurationTicks(1.5),false);
  run.join('a');run.ready('a',run.snapshot().round,true);
  for(let i=0;i<RUN_HZ*5&&run.snapshot().phase!=='combat';i++)run.step();
  assert.equal(run.snapshot().phase,'combat');
  assert.equal(run.setDurationTicks(RUN_DURATION_TICKS),false,'never during a match');
  assert.equal(ROOM_LIFETIME_MS,50*60_000);
  assert.ok(ROOM_LIFETIME_MS>=CITY_RUN_DURATION_TICKS/RUN_HZ*1000+10*60_000,'a lobby plus the city cap fit');
});
