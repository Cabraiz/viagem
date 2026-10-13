// NEW-20261012-ORQ-cidade-10 PREP (D-026): a room on the city refuses a join without `maps` ("Atualize a página").
// The lab and bench scripts join like a current build (join.maps from clientCatalog and the city manifest), and the
// benches that build a Room themselves pin the endless map, so the flip of ROOM_DEFAULT_MAP never changes them silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const SCRIPTS=['scripts/check-multiplayer.mjs','scripts/bots/run.ts','scripts/bench-room-bots.ts','scripts/bench-horde-bytes.ts','scripts/bench-resgate.ts'];

test('every current-protocol join in the scripts sends maps (an old-protocol knock is the only exception)',()=>{
  for(const path of SCRIPTS){
    const joins=read(path).split('\n').filter(l=>/t:'join'/.test(l)&&!/PROTOCOL_VERSION-1/.test(l));
    assert.ok(joins.length>0,`${path} joins somewhere`);
    for(const line of joins)assert.match(line,/\bmaps\b/,`${path}: ${line.trim().slice(0,120)}`);
    assert.match(read(path),/clientCatalog\(/,`${path} builds join.maps with clientCatalog`);
  }
});

test('benches that build a Room pin the endless map; the bot runs and the check take --map',()=>{
  for(const path of ['scripts/bench-room-bots.ts','scripts/bench-horde-bytes.ts','scripts/bench-resgate.ts'])
    for(const line of read(path).split('\n').filter(l=>/new Room\(/.test(l)))assert.match(line,/map:'infinito'/,`${path}: ${line.trim()}`);
  for(const path of ['scripts/check-multiplayer.mjs','scripts/bots/run.ts'])assert.match(read(path),/'--map'/,path);
});
