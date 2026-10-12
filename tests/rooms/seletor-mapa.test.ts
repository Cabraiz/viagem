// NEW-20261012-ORQ-cidade-09-seletor-mapa (D-026, D-034, D-035): the owner picks the map in the lobby, the room
// switches its terrain, tells everyone and keeps the choice. The city stays locked (CITY_PLAYABLE=false) until
// cidade-10; here the rooms built with cityPlayable:true only switch in the lobby and never step combat on the city.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,mapMissingText,type Peer,type RoomOptions,type RoomRoster} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {CITY_PLAYABLE,CITY_SOON,INFINITO_REF,clientCatalog} from '../../src/protocol/map-catalog.ts';
import {MAP_TEXT,type MapRef} from '../../src/protocol/map-select.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
/** The exact asset text, as worker.ts hands it over (wrangler Text module). */
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
/** What a current build sends at join (`maps`): the endless map and the city. */
const BOTH=clientCatalog(CITY);
const asset={cityText,cityRef:CITY};

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,frames,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:(code:number,reason:string)=>{closes.push({code,reason});}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
/** A join from a current build (maps: BOTH) unless `extra` says otherwise ({maps:undefined} = an older client). */
const join=(room:Room,p:TestPeer,name:string,now:number,extra:object={})=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',maps:BOTH,...extra},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
const round=(room:Room)=>room.run.snapshot().round;
const notices=(p:TestPeer)=>p.messages.filter(m=>m.t==='notice').map(m=>m.message);
const maps=(p:TestPeer)=>p.messages.filter(m=>m.t==='map');
/** Owner commands from one phone are at least OWNER_GAP_MS apart (the room drops the rest): space them like a finger. */
const lastCmd=new WeakMap<object,number>();
const setMap=(room:Room,p:TestPeer,map:string,now:number)=>{const t=Math.max(now,(lastCmd.get(p)??-Infinity)+OWNER_GAP_MS);lastCmd.set(p,t);say(room,p,{t:'setMap',map},t);return t;};
const cityRoom=(options:RoomOptions={})=>new Room(1000,7,{...asset,cityPlayable:true,...options});
const ready=(room:Room,id:string)=>room.run.snapshot().members.find(m=>m.id===id)?.ready;

test('D-035: the city is locked by default; even with its asset the room answers CITY_SOON and stays on the endless map',()=>{
  assert.equal(CITY_PLAYABLE,false);
  const room=new Room(1000,7,asset),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  setMap(room,a,'cidade-nevada',1100);
  assert.deepEqual(notices(a),[CITY_SOON]);
  assert.deepEqual(room.map,INFINITO_REF);assert.equal(room.sim.terrain.world,'infinito');
  assert.deepEqual([...maps(a),...maps(b)],[]);
  assert.equal(room.roster().map,undefined);
});

test('the welcome carries the map next to world',async()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);
  assert.deepEqual(welcome(a).map,INFINITO_REF);assert.equal(welcome(a).world.kind,'infinito');
  setMap(room,a,'cidade-nevada',1100);await room.ready();
  join(room,b,'Bia',1200);
  assert.deepEqual(welcome(b).map,CITY);
  assert.deepEqual(welcome(b).world,{kind:'cidade',terrainVersion:welcome(b).world.terrainVersion,generatorVersion:0,seed:0,signature:CITY.hash});
});

test('only the owner picks the map; a guest hears why and nothing changes',async()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  setMap(room,b,'cidade-nevada',1100);setMap(room,b,'infinito',1100);await room.ready();
  assert.deepEqual(notices(b),[MAP_TEXT.ownerOnly,MAP_TEXT.ownerOnly]);
  assert.deepEqual(room.map,INFINITO_REF);assert.deepEqual([...maps(a),...maps(b)],[]);
});

test('lobby only: countdown, combat and result refuse the switch',async()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=1100;
  for(const p of [a,b])say(room,p,{t:'ready',round:round(room),ready:true},t);
  assert.equal(room.run.snapshot().phase,'countdown');
  t=setMap(room,a,'cidade-nevada',t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  t=setMap(room,a,'cidade-nevada',t);
  room.run.finish('defeat');room.advance(t+=50);assert.equal(room.run.snapshot().phase,'result');
  t=setMap(room,a,'cidade-nevada',t);
  await room.ready();
  assert.deepEqual(notices(a),[MAP_TEXT.lobbyOnly,MAP_TEXT.lobbyOnly,MAP_TEXT.lobbyOnly]);
  assert.deepEqual(room.map,INFINITO_REF);assert.deepEqual(maps(a),[]);
});

test('throttled like the other owner commands: one setMap per OWNER_GAP_MS per connection',async()=>{
  const room=new Room(1000,7,asset),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  say(room,b,{t:'setMap',map:'infinito'},2000);say(room,b,{t:'setMap',map:'infinito'},2000+OWNER_GAP_MS-1);
  assert.deepEqual(notices(b),[MAP_TEXT.ownerOnly]);
  say(room,b,{t:'setMap',map:'infinito'},2000+OWNER_GAP_MS);
  assert.deepEqual(notices(b),[MAP_TEXT.ownerOnly,MAP_TEXT.ownerOnly]);
  // The locked city goes through the same gate.
  say(room,a,{t:'setMap',map:'cidade-nevada'},3000);say(room,a,{t:'setMap',map:'cidade-nevada'},3001);
  assert.deepEqual(notices(a),[CITY_SOON]);
});

test('malformed or unknown maps are refused with the catalog text',()=>{
  const room=cityRoom(),a=peer();join(room,a,'Ana',1000);
  let t=1100;
  for(const m of [{t:'setMap',map:'ilha'},{t:'setMap',map:'infinito',round:1},{t:'setMap'},{t:'setMap',map:'__proto__'}]){t+=OWNER_GAP_MS;say(room,a,m,t);}
  assert.deepEqual(notices(a),[MAP_TEXT.unknown,MAP_TEXT.unknown,MAP_TEXT.unknown,MAP_TEXT.unknown]);
  assert.deepEqual(room.map,INFINITO_REF);
});

test('the switch: everyone gets the same {t:map} (city ref, world cidade seed 0, signature = hash), readies reset, bots stay ready',async()=>{
  const rows:RoomRoster[]=[];
  const room=cityRoom({onRoster:r=>rows.push(r)}),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  say(room,a,{t:'bot-add',round:round(room)},1400);
  const bot=room.run.snapshot().members.find(m=>m.bot)!.id;
  say(room,b,{t:'ready',round:round(room),ready:true},1500);assert.equal(ready(room,welcome(b).id),true);
  room.advance(1550);
  const framesBefore=b.frames.length;
  setMap(room,a,'cidade-nevada',1800);await room.ready();
  const [ma]=maps(a),[mb]=maps(b);
  assert.deepEqual(ma,mb);
  assert.deepEqual(ma,{t:'map',map:CITY,world:{kind:'cidade',terrainVersion:ma.world.terrainVersion,generatorVersion:0,seed:0,signature:CITY.hash}});
  assert.equal(room.sim.terrain.world,'cidade');assert.deepEqual(room.map,CITY);
  // Same people and bot, same seats; the guest has to say ready again, the bot did not.
  assert.deepEqual([...room.sim.players.keys()].sort(),[welcome(a).id,welcome(b).id,bot].sort());
  assert.ok(room.sim.bots.has(bot));
  assert.equal(ready(room,welcome(b).id),false);assert.equal(ready(room,bot),true);
  assert.equal(room.run.snapshot().phase,'lobby');
  // The run state went out after the map, and the stored row names the city.
  const ia=a.messages.indexOf(ma),run=a.messages.findLastIndex(m=>m.t==='run');
  assert.ok(run>ia,'run state after the map');
  assert.equal(rows.at(-1)!.map,'cidade-nevada');
  // The next frame is full and describes the city (the client swapped its terrain on {t:map} before it).
  for(let t=1850;b.frames.length===framesBefore;t+=50)room.advance(t);
  const feed=new FrameRunFeed();let world;
  for(const f of b.frames.slice(0,framesBefore))feed.decode(f);
  const r=feed.decode(b.frames[framesBefore]) as any;
  assert.ok(r.ok);world=r.world??feed.world;
  assert.equal(world.kind,'cidade');assert.equal(world.signature,CITY.hash);
  // And back to the endless map, at once (no asset to decode).
  setMap(room,a,'infinito',3000);
  assert.deepEqual(maps(a).at(-1).map,INFINITO_REF);assert.equal(maps(a).at(-1).world.kind,'infinito');
  assert.equal(room.sim.terrain.world,'infinito');assert.equal(room.roster().map,undefined);
});

test('a switch to the map already in use changes nothing (no broadcast, readies kept)',async()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  say(room,b,{t:'ready',round:round(room),ready:true},1100);
  const sim=room.sim;
  setMap(room,a,'infinito',1200);
  assert.equal(room.sim,sim);assert.deepEqual(maps(a),[]);assert.deepEqual(notices(a),[]);assert.equal(ready(room,welcome(b).id),true);
  setMap(room,a,'cidade-nevada',1600);await room.ready();
  const city=room.sim;
  setMap(room,a,'cidade-nevada',2000);await room.ready();
  assert.equal(room.sim,city);assert.equal(maps(a).length,1);
});

test('someone whose build lacks the city blocks the switch: the owner hears the names',async()=>{
  const room=cityRoom(),a=peer(),b=peer(),c=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000,{maps:[INFINITO_REF]});join(room,c,'Caio',1000,{maps:undefined});
  assert.ok(welcome(b)&&welcome(c),'both still join the endless map');
  setMap(room,a,'cidade-nevada',1100);await room.ready();
  assert.deepEqual(notices(a),[mapMissingText(['Bia','Caio'])]);
  assert.deepEqual(room.map,INFINITO_REF);assert.deepEqual(maps(a),[]);
  // Once they leave, the switch goes through.
  say(room,b,{t:'leave'},1200);say(room,c,{t:'leave'},1200);
  setMap(room,a,'cidade-nevada',1500);await room.ready();
  assert.deepEqual(room.map,CITY);
});

test('a join whose build has another city (hash) is refused on the city, with the update text',async()=>{
  const room=cityRoom(),a=peer(),b=peer(),c=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',1100);await room.ready();
  join(room,b,'Bia',1200,{maps:[INFINITO_REF,{...CITY,hash:'f'.repeat(64)}]});
  assert.equal(welcome(b),undefined);
  assert.deepEqual(b.messages.at(-1),{t:'error',message:MAP_TEXT.update});assert.equal(b.closes[0].code,4003);
  // A build without the city at all is refused too; an older client without `maps` is let in (the protocol gate decides).
  join(room,c,'Caio',1300,{maps:[INFINITO_REF]});
  assert.deepEqual(c.messages.at(-1),{t:'error',message:MAP_TEXT.update});
  const d=peer();join(room,d,'Duda',1300,{maps:undefined});assert.ok(welcome(d));
  assert.equal(room.sim.players.size,2);
});

test('rematch keeps the map (the same Simulation persists)',async()=>{
  const room=cityRoom(),a=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',1100);await room.ready();
  const sim=room.sim;
  let t=1200;say(room,a,{t:'ready',round:round(room),ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  // Combat on the city waits for cidade-05 (the director): end the run before any combat step.
  room.run.finish('defeat');room.advance(t+=50);assert.equal(room.run.snapshot().phase,'result');
  say(room,a,{t:'rematch',round:round(room)},t);
  assert.equal(room.run.snapshot().phase,'lobby');
  assert.equal(room.sim,sim);assert.deepEqual(room.map,CITY);assert.equal(room.sim.terrain.world,'cidade');
  assert.equal(room.roster().map,'cidade-nevada');
});

test('a restarted room keeps the city; a city it can no longer play comes back as the endless map (logged)',async()=>{
  const rows:RoomRoster[]=[];
  const room=cityRoom({onRoster:r=>rows.push(r)}),a=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',1100);await room.ready();
  const row=JSON.parse(JSON.stringify(rows.at(-1)));assert.equal(row.map,'cidade-nevada');
  // The Durable Object restarts: same roster, the city still playable.
  const again=cityRoom();again.restore(row,1500);await again.ready();
  assert.deepEqual(again.map,CITY);assert.equal(again.sim.terrain.world,'cidade');
  const back=peer();again.connect(back,1600);say(again,back,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(a).token,maps:BOTH},1600);
  assert.equal(welcome(back).id,welcome(a).id);assert.deepEqual(welcome(back).map,CITY);assert.equal(welcome(back).world.kind,'cidade');
  // Restored where the city is locked (or without its asset): the endless map, one log line, the row rewritten.
  for(const options of [{...asset},{cityPlayable:true}] as RoomOptions[]){
    const logs:string[]=[],stored:RoomRoster[]=[];
    const locked=new Room(1000,7,{...options,log:l=>logs.push(l),onRoster:r=>stored.push(r)});
    locked.restore(row,1500);await locked.ready();
    assert.deepEqual(locked.map,INFINITO_REF);assert.equal(locked.sim.terrain.world,'infinito');
    assert.equal(locked.sim.players.size,1);
    assert.deepEqual(logs.map(l=>JSON.parse(l)),[{ev:'map',fallback:'cidade-nevada',why:'restore',to:'infinito'}]);
    locked.advance(1600);
    assert.equal(stored.length,1);assert.equal(stored[0].map,undefined);
  }
});

test('a room created on the city while it is locked opens on the endless map, never crashes',async()=>{
  const logs:string[]=[];
  const room=new Room(1000,7,{...asset,map:'cidade-nevada',log:l=>logs.push(l)});await room.ready();
  assert.deepEqual(room.map,INFINITO_REF);assert.equal(logs.length,1);
  const open=cityRoom({map:'cidade-nevada'});await open.ready();
  assert.deepEqual(open.map,CITY);assert.equal(open.sim.terrain.world,'cidade');
});
