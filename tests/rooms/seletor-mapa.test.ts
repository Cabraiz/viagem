// NEW-20261012-ORQ-cidade-09-seletor-mapa (D-026, D-034, D-035): the owner picks the map in the lobby, the room
// switches its terrain, tells everyone and keeps the choice. Since cidade-10 the city is playable and the default map;
// the rooms below start on the endless map on purpose (map:'infinito') so they still exercise the switch TO the city,
// and the locked city (D-035) stays covered through the `cityPlayable:false` option.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,ROSTER_BOTS_MS,SILENT_MS,mapMissingText,type Peer,type RoomOptions,type RoomRoster} from '../../multiplayer/room.ts';
import {cityTerrainFor} from '../../src/maps/index.ts';
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
/** A room with the city asset that starts on the endless map (the default would be the city since cidade-10). */
const cityRoom=(options:RoomOptions={})=>new Room(1000,7,{...asset,cityPlayable:true,map:'infinito',...options});
/** The same room with the city locked, as before cidade-10 (D-035). */
const lockedRoom=(options:RoomOptions={})=>new Room(1000,7,{...asset,cityPlayable:false,map:'infinito',...options});
const ready=(room:Room,id:string)=>room.run.snapshot().members.find(m=>m.id===id)?.ready;

// Must stay the first test that picks the city: nothing in this process has decoded it yet, so every city pick here
// waits on its decode (cidade-09 review F5, repro R1). All rooms are driven before the first await, for the same reason.
test('F5: while the city decodes, a newer pick supersedes it and the room ends on the last one; the pending pick again is a no-op',async()=>{
  assert.equal(cityTerrainFor(CITY.hash!),undefined,'the city must not be decoded yet');
  // City, then the endless map 300 ms later: the room stays on the endless map (the city job gives way), no broadcast.
  const back=cityRoom(),a=peer();join(back,a,'Ana',1000);const sim=back.sim;
  say(back,a,{t:'setMap',map:'cidade-nevada'},2000);say(back,a,{t:'setMap',map:'infinito'},2000+OWNER_GAP_MS);
  // City, endless, city: the city, switched once.
  const again=cityRoom(),b=peer();join(again,b,'Bia',1000);
  for(const [i,map] of ['cidade-nevada','infinito','cidade-nevada'].entries())say(again,b,{t:'setMap',map},2000+i*OWNER_GAP_MS);
  // The city twice: the second pick equals the pending one, so nothing new (no notice, one switch).
  const same=cityRoom(),c=peer();join(same,c,'Caio',1000);
  say(same,c,{t:'setMap',map:'cidade-nevada'},2000);say(same,c,{t:'setMap',map:'cidade-nevada'},2000+OWNER_GAP_MS);
  // F3: an older build (no `maps`) joins while the city decodes (the room is still endless); it ships the endless map,
  // so the owner's way back is not blocked by it.
  const old=cityRoom(),d=peer(),e=peer();join(old,d,'Duda',1000);
  say(old,d,{t:'setMap',map:'cidade-nevada'},2000);join(old,e,'Edu',2100,{maps:undefined});say(old,d,{t:'setMap',map:'infinito'},2000+OWNER_GAP_MS);
  assert.ok(welcome(e),'the older build sits while the room is on the endless map');
  await Promise.all([back.ready(),again.ready(),same.ready(),old.ready()]);
  assert.deepEqual(back.map,INFINITO_REF);assert.equal(back.sim,sim);assert.deepEqual(maps(a),[]);assert.deepEqual(notices(a),[]);
  assert.deepEqual(again.map,CITY);assert.equal(again.sim.terrain.world,'cidade');assert.equal(maps(b).length,1);assert.deepEqual(notices(b),[]);
  assert.deepEqual(same.map,CITY);assert.equal(maps(c).length,1);assert.deepEqual(notices(c),[]);
  assert.deepEqual(old.map,INFINITO_REF);assert.deepEqual(notices(d),[]);assert.deepEqual([...maps(d),...maps(e)],[]);
  // And with the decode done, a pick of the current map is still a no-op.
  setMap(again,b,'cidade-nevada',5000);await again.ready();assert.equal(maps(b).length,1);assert.deepEqual(notices(b),[]);
});

test('cidade-10: the city is playable and the default; a room built with the asset opens on it (welcome carries the city); `cityPlayable:false` still locks it with CITY_SOON',async()=>{
  assert.equal(CITY_PLAYABLE,true);
  const logs:string[]=[];
  const open=new Room(1000,7,{...asset,log:l=>logs.push(l)});await open.ready();
  assert.deepEqual(open.map,CITY);assert.equal(open.sim.terrain.world,'cidade');assert.deepEqual(logs,[]);
  const p=peer();join(open,p,'Ana',1000);
  assert.deepEqual(welcome(p).map,CITY);assert.equal(welcome(p).world.kind,'cidade');assert.equal(open.roster().map,'cidade-nevada');
  // Locked through the option: even with its asset the room answers CITY_SOON and stays on the endless map.
  const room=lockedRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  setMap(room,a,'cidade-nevada',1100);
  assert.deepEqual(notices(a),[CITY_SOON]);
  assert.deepEqual(room.map,INFINITO_REF);assert.equal(room.sim.terrain.world,'infinito');
  assert.deepEqual([...maps(a),...maps(b)],[]);
  assert.equal(room.roster().map,'infinito');
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
  const room=lockedRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
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
  // The run state went out after the map.
  const ia=a.messages.indexOf(ma),run=a.messages.findLastIndex(m=>m.t==='run');
  assert.ok(run>ia,'run state after the map');
  // The next frame is full and describes the city (the client swapped its terrain on {t:map} before it).
  for(let t=1850;b.frames.length===framesBefore;t+=50)room.advance(t);
  const feed=new FrameRunFeed();let world;
  for(const f of b.frames.slice(0,framesBefore))feed.decode(f);
  const r=feed.decode(b.frames[framesBefore]) as any;
  assert.ok(r.ok);world=r.world??feed.world;
  assert.equal(world.kind,'cidade');assert.equal(world.signature,CITY.hash);
  // The stored row names the city once the bots/map gap (one row a second after the joins) let the tick write it.
  assert.equal(rows.at(-1)!.map,'infinito');
  room.advance(1000+ROSTER_BOTS_MS);assert.equal(rows.at(-1)!.map,'cidade-nevada');
  // And back to the endless map, at once (no asset to decode).
  setMap(room,a,'infinito',3000);
  assert.deepEqual(maps(a).at(-1).map,INFINITO_REF);assert.equal(maps(a).at(-1).world.kind,'infinito');
  assert.equal(room.sim.terrain.world,'infinito');assert.equal(room.roster().map,'infinito');
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
  // A build without the city at all is refused too, and so is an older build that sends no `maps` (it ships the
  // endless map only, review F3): same text, same close.
  join(room,c,'Caio',1300,{maps:[INFINITO_REF]});
  assert.deepEqual(c.messages.at(-1),{t:'error',message:MAP_TEXT.update});
  const d=peer();join(room,d,'Duda',1300,{maps:undefined});
  assert.equal(welcome(d),undefined);assert.deepEqual(d.messages.at(-1),{t:'error',message:MAP_TEXT.update});assert.equal(d.closes[0].code,4003);
  assert.equal(room.sim.players.size,1);
});

test('F3 (R2): an older build cannot sit in a city room, so it never blocks the way back to the endless map',async()=>{
  const room=cityRoom(),a=peer(),old=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',2000);await room.ready();assert.deepEqual(room.map,CITY);
  join(room,old,'Velho',2100,{maps:undefined});
  assert.equal(welcome(old),undefined);assert.deepEqual(old.messages.at(-1),{t:'error',message:MAP_TEXT.update});assert.equal(old.closes[0].code,4003);
  setMap(room,a,'infinito',3000);
  assert.deepEqual(room.map,INFINITO_REF);assert.deepEqual(notices(a),[]);
  // Back on the endless map it sits again, as a build that ships only that map: the city is refused naming it.
  const again=peer();join(room,again,'Velho',3100,{maps:undefined});assert.ok(welcome(again));
  setMap(room,a,'cidade-nevada',3500);await room.ready();
  assert.deepEqual(notices(a),[mapMissingText(['Velho'])]);assert.deepEqual(room.map,INFINITO_REF);
});

test('F4 (R3): after a restart only connected people count; an away seat is checked again when it comes back',async()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  const again=cityRoom();again.restore(JSON.parse(JSON.stringify(room.roster())),5000);await again.ready();
  // Only Ana is back: her catalog came with this join; Bia's seat waits, with no catalog the room could check.
  const a2=peer();again.connect(a2,5000);say(again,a2,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(a).token,maps:BOTH},5000);
  setMap(again,a2,'cidade-nevada',6000);await again.ready();
  assert.deepEqual(notices(a2),[]);assert.deepEqual(again.map,CITY);
  // Bia comes back with a build that lacks the city: refused at join with the update text, her seat kept for a fix.
  const b2=peer();again.connect(b2,6500);say(again,b2,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(b).token,maps:[INFINITO_REF]},6500);
  assert.equal(welcome(b2),undefined);assert.deepEqual(b2.messages.at(-1),{t:'error',message:MAP_TEXT.update});
  // After the page update she sits on the city.
  const b3=peer();again.connect(b3,7000);say(again,b3,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(b).token,maps:BOTH},7000);
  assert.equal(welcome(b3).id,welcome(b).id);assert.deepEqual(welcome(b3).map,CITY);
  // A person who drops is not counted either while away (no stale catalog blocks the owner).
  const c=peer();setMap(again,a2,'infinito',7500);join(again,c,'Caio',7600,{maps:[INFINITO_REF]});
  again.closed(c,{code:1006},7700);
  setMap(again,a2,'cidade-nevada',8000);await again.ready();
  assert.deepEqual(notices(a2),[]);assert.deepEqual(again.map,CITY);
});

test('roster: map switches are written at most one row a second like the bots, the last one by the tick or the last socket end',async()=>{
  const rows:RoomRoster[]=[];
  const room=cityRoom({onRoster:r=>rows.push(r)}),a=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',1000);await room.ready();
  assert.equal(rows.length,1,'a switch right after the join waits for the bots/map gap');
  room.advance(1000+ROSTER_BOTS_MS);
  assert.equal(rows.length,2);assert.equal(rows.at(-1)!.map,'cidade-nevada');
  // The owner flips four times in under a second: no row until the gap, then one with the last pick.
  let t=3000;
  for(const map of ['infinito','cidade-nevada','infinito','cidade-nevada']){t=setMap(room,a,map,t);await room.ready();}
  assert.equal(rows.length,3,'the first flip after a quiet second is written at once');assert.equal(rows.at(-1)!.map,'infinito');
  room.advance(t+1);assert.equal(rows.length,3);
  room.advance(3000+ROSTER_BOTS_MS);assert.equal(rows.length,4);assert.equal(rows.at(-1)!.map,'cidade-nevada');
  // A pick still waiting when the last phone goes: the socket end writes it (the room's clock stops with no socket).
  t=setMap(room,a,'infinito',4100);assert.equal(rows.length,4);
  room.closed(a,{code:1001},t+10);
  assert.equal(rows.length,5);assert.equal(rows.at(-1)!.map,'infinito');assert.notEqual(rows.at(-1)!.players[0].until,null);
  // Restarted from that row: the endless map, as picked last.
  const again=cityRoom();again.restore(rows.at(-1)!,t+20);await again.ready();assert.deepEqual(again.map,INFINITO_REF);
});

test('restore with a city that fails to decode: the room plays the endless map and the row stops naming the city',async()=>{
  const rows:RoomRoster[]=[],logs:string[]=[];
  const room=cityRoom({onRoster:r=>rows.push(r)}),a=peer();join(room,a,'Ana',1000);
  setMap(room,a,'cidade-nevada',2500);await room.ready();
  const row=JSON.parse(JSON.stringify(rows.at(-1)));assert.equal(row.map,'cidade-nevada');
  // A bundle whose city bytes do not match the manifest hash (never cached in this process): the decode fails.
  const broken={...CITY,hash:'0'.repeat(64)};
  const stored:RoomRoster[]=[];
  const again=new Room(1000,7,{cityText,cityRef:broken,cityPlayable:true,log:l=>logs.push(l),onRoster:r=>stored.push(r)});
  again.restore(row,5000);
  assert.equal(stored.length,0);
  await again.ready();
  assert.deepEqual(again.map,INFINITO_REF);assert.equal(again.sim.terrain.world,'infinito');
  assert.equal(JSON.parse(logs[0]).failed,'cidade-nevada');
  assert.equal(stored.length,1);assert.equal(stored[0].map,'infinito');assert.equal(stored[0].players.length,1);
});

test('R4: a seated phone that keeps talking (pings while it downloads the city) stays; one silent for SILENT_MS is closed',()=>{
  const room=cityRoom(),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',3000);
  for(let t=3050;t<3000+SILENT_MS+200;t+=50){if(t%2000<50)say(room,a,{t:'ping',at:t},t);room.advance(t);}
  assert.deepEqual(a.closes,[]);
  assert.equal(b.closes.length,1);assert.equal(b.closes[0].code,4004);
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
  // The only person voted: straight to the countdown (UX-resultado-revanche).
  assert.equal(room.run.snapshot().phase,'countdown');
  assert.equal(room.sim,sim);assert.deepEqual(room.map,CITY);assert.equal(room.sim.terrain.world,'cidade');
  assert.equal(room.roster().map,'cidade-nevada');
});

test('a restarted room keeps the city; a city it can no longer play comes back as the endless map (logged)',async()=>{
  const rows:RoomRoster[]=[];
  const room=cityRoom({onRoster:r=>rows.push(r)}),a=peer();join(room,a,'Ana',1000);
  // A second after the join row, so the switch is written at once (map rows are one a second, like the bots').
  setMap(room,a,'cidade-nevada',1000+ROSTER_BOTS_MS);await room.ready();
  const row=JSON.parse(JSON.stringify(rows.at(-1)));assert.equal(row.map,'cidade-nevada');
  // The Durable Object restarts: same roster, the city still playable.
  const again=cityRoom();again.restore(row,1500);await again.ready();
  assert.deepEqual(again.map,CITY);assert.equal(again.sim.terrain.world,'cidade');
  const back=peer();again.connect(back,1600);say(again,back,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(a).token,maps:BOTH},1600);
  assert.equal(welcome(back).id,welcome(a).id);assert.deepEqual(welcome(back).map,CITY);assert.equal(welcome(back).world.kind,'cidade');
  // Restored where the city is locked (or without its asset): the endless map, one log line, the row rewritten.
  for(const options of [{...asset,cityPlayable:false,map:'infinito'},{cityPlayable:true}] as RoomOptions[]){
    const logs:string[]=[],stored:RoomRoster[]=[];
    const locked=new Room(1000,7,{...options,log:l=>logs.push(l),onRoster:r=>stored.push(r)});
    locked.restore(row,1500);await locked.ready();
    assert.deepEqual(locked.map,INFINITO_REF);assert.equal(locked.sim.terrain.world,'infinito');
    assert.equal(locked.sim.players.size,1);
    assert.deepEqual(logs.map(l=>JSON.parse(l)),[{ev:'map',fallback:'cidade-nevada',why:'restore',to:'infinito'}]);
    locked.advance(1600);
    assert.equal(stored.length,1);assert.equal(stored[0].map,'infinito');
  }
});

test('a room created on the city while it is locked opens on the endless map, never crashes',async()=>{
  const logs:string[]=[];
  const room=lockedRoom({map:'cidade-nevada',log:l=>logs.push(l)});await room.ready();
  assert.deepEqual(room.map,INFINITO_REF);assert.equal(logs.length,1);
  const open=cityRoom({map:'cidade-nevada'});await open.ready();
  assert.deepEqual(open.map,CITY);assert.equal(open.sim.terrain.world,'cidade');
});
