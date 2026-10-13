// NEW-20261012-ORQ-cidade-10 (D-026, D-035): the room's default map. Since cidade-10 ROOM_DEFAULT_MAP is the city and
// CITY_PLAYABLE is true (the flip). These tests still build the flipped room by option (map + cityPlayable) and the
// flipped Worker by its `defaults` (mapa-padrao-worker.test.ts), so they do not depend on the constants, and prove it: the room opens on the city at
// construction, the first welcome already names it (no {t:'map'} right after), a restart restores the owner's last
// pick (city or endless) and a row from before cidade-10 (no `map`) comes back on the endless map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,ROSTER_BOTS_MS,OWNER_GAP_MS,type RoomOptions,type RoomRoster} from '../../multiplayer/room.ts';
import {cityTerrainFor} from '../../src/maps/index.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {CITY_PLAYABLE,INFINITO_REF,ROOM_DEFAULT_MAP,clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const BOTH=clientCatalog(CITY);
/** The flip, by option: the city as the default map, playable, its asset handed over (as worker.ts does). */
const FLIPPED:RoomOptions={cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada'};
/** Today's Worker room: the constants as they are, the asset handed over (since cidade-10: on the city). */
const TODAY:RoomOptions={cityText,cityRef:CITY};
/** A room still on the endless map (a row written before the owner picked the city, or before cidade-10). */
const ENDLESS:RoomOptions={cityText,cityRef:CITY,map:'infinito'};

function peer(){
  const messages:any[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:(code:number,reason:string)=>{closes.push({code,reason});}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:TestPeer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,extra:object={})=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',maps:BOTH,...extra},now);};
const back=(room:Room,p:TestPeer,token:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,token,maps:BOTH},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
const maps=(p:TestPeer)=>p.messages.filter(m=>m.t==='map');
/** A roster row as storage hands it back (plain JSON). */
const stored=(r:RoomRoster)=>JSON.parse(JSON.stringify(r)) as RoomRoster;

// Must stay the first test: nothing in this process has decoded the city yet, so the flipped constructor's switch is
// still waiting on its decode when restore() names the endless map (the restart race).
test('flipped restart from an endless-map row while the city still decodes: the row wins, no {t:map}',async()=>{
  assert.equal(cityTerrainFor(CITY.hash!),undefined,'the city must not be decoded yet');
  const today=new Room(1000,7,ENDLESS),a=peer();join(today,a,'Ana',1000);
  const row=stored(today.roster());assert.equal(row.map,'infinito');
  const again=new Room(1000,7,FLIPPED);again.restore(row,2000);await again.ready();
  assert.deepEqual(again.map,INFINITO_REF);assert.equal(again.sim.terrain.world,'infinito');
  const a2=peer();back(again,a2,welcome(a).token,2100);
  assert.deepEqual(welcome(a2).map,INFINITO_REF);assert.equal(welcome(a2).world.kind,'infinito');assert.deepEqual(maps(a2),[]);
});

test('flipped room: opens on the city at construction; the first welcome names it, no {t:map} flicker',async()=>{
  const logs:string[]=[];
  const room=new Room(1000,7,{...FLIPPED,log:l=>logs.push(l)});await room.ready();
  assert.deepEqual(room.map,CITY);assert.equal(room.sim.terrain.world,'cidade');assert.deepEqual(logs,[]);
  const a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1100);
  for(const p of [a,b]){
    assert.deepEqual(welcome(p).map,CITY);
    assert.deepEqual(welcome(p).world,{kind:'cidade',terrainVersion:welcome(p).world.terrainVersion,generatorVersion:0,seed:0,signature:CITY.hash});
    assert.deepEqual(maps(p),[]);
  }
  assert.equal(room.roster().map,'cidade-nevada');
  // Once decoded in this isolate, a new flipped room is on the city synchronously (no ready() needed).
  const next=new Room(1000,8,FLIPPED);assert.deepEqual(next.map,CITY);
  // An older build (no join.maps) cannot sit on the city: the update text, as with an owner's switch.
  const old=peer();join(room,old,'Velho',1200,{maps:undefined});assert.equal(welcome(old),undefined);assert.equal(old.closes[0]?.code,4003);
});

test('flipped room where the city cannot be played (locked or no asset): the endless map, one log line, never a crash',async()=>{
  for(const options of [{...FLIPPED,cityPlayable:false},{map:'cidade-nevada',cityPlayable:true}] as RoomOptions[]){
    const logs:string[]=[];
    const room=new Room(1000,7,{...options,log:l=>logs.push(l)});await room.ready();
    assert.deepEqual(room.map,INFINITO_REF);
    assert.deepEqual(logs.map(l=>JSON.parse(l)),[{ev:'map',fallback:'cidade-nevada',why:'create',to:'infinito'}]);
    const a=peer();join(room,a,'Ana',1000);assert.deepEqual(welcome(a).map,INFINITO_REF);assert.deepEqual(maps(a),[]);
  }
});

test('flipped restart restores the owner\'s last pick: the endless map stays endless, the city stays the city',async()=>{
  const rows:RoomRoster[]=[];
  const room=new Room(1000,7,{...FLIPPED,onRoster:r=>rows.push(r)}),a=peer();await room.ready();join(room,a,'Ana',1000);
  // The owner goes back to the endless map, a second after the join row (map rows are one a second).
  say(room,a,{t:'setMap',map:'infinito'},1000+ROSTER_BOTS_MS);
  assert.deepEqual(room.map,INFINITO_REF);assert.equal(rows.at(-1)!.map,'infinito');
  const endless=new Room(1000,7,FLIPPED);endless.restore(stored(rows.at(-1)!),3000);await endless.ready();
  assert.deepEqual(endless.map,INFINITO_REF);
  const a2=peer();back(endless,a2,welcome(a).token,3100);assert.deepEqual(welcome(a2).map,INFINITO_REF);assert.deepEqual(maps(a2),[]);
  // And the city again: a restart keeps it.
  say(room,a,{t:'setMap',map:'cidade-nevada'},1000+ROSTER_BOTS_MS+OWNER_GAP_MS);await room.ready();
  room.advance(1000+3*ROSTER_BOTS_MS);assert.equal(rows.at(-1)!.map,'cidade-nevada');
  const city=new Room(1000,7,FLIPPED);city.restore(stored(rows.at(-1)!),4000);await city.ready();
  assert.deepEqual(city.map,CITY);
  const a3=peer();back(city,a3,welcome(a).token,4100);assert.deepEqual(welcome(a3).map,CITY);assert.deepEqual(maps(a3),[]);
});

test('a row from before cidade-10 (no map) comes back on the endless map, flipped or not',async()=>{
  const today=new Room(1000,7,TODAY),a=peer();join(today,a,'Ana',1000);
  const row=stored(today.roster());delete row.map;
  for(const options of [FLIPPED,TODAY,{}] as RoomOptions[]){
    const rows:RoomRoster[]=[];
    const again=new Room(1000,7,{...options,onRoster:r=>rows.push(r)});again.restore(row,2000);await again.ready();
    assert.deepEqual(again.map,INFINITO_REF);assert.equal(again.sim.terrain.world,'infinito');
    assert.equal(again.roster().map,'infinito');assert.equal(again.sim.players.size,1);
    const a2=peer();back(again,a2,welcome(a).token,2100);assert.deepEqual(welcome(a2).map,INFINITO_REF);assert.deepEqual(maps(a2),[]);
    again.advance(2200);
    for(const r of rows)assert.equal(r.map,'infinito');
  }
});

test('today\'s constants (cidade-10): a room with the asset opens on the city and its roster says so; without the asset, the endless map silently',async()=>{
  assert.equal(ROOM_DEFAULT_MAP,'cidade-nevada');assert.equal(CITY_PLAYABLE,true);
  const room=new Room(1000,7,TODAY);await room.ready();const a=peer();join(room,a,'Ana',1000);
  assert.deepEqual(welcome(a).map,CITY);assert.deepEqual(maps(a),[]);
  assert.deepEqual(room.map,CITY);assert.equal(room.roster().map,'cidade-nevada');
  const logs:string[]=[];
  const bare=new Room(1000,7,{log:l=>logs.push(l)});await bare.ready();
  assert.deepEqual(bare.map,INFINITO_REF);assert.deepEqual(logs,[]);
});
