// NEW-20261012-E5-cidade-barricadas-cliente: the city room's frames carry its 4 barricades (kind 'barricada', the
// Simulation built with cityStructures) with wire ids that stay put while the room prunes the ids of the gone (once a
// second); the island and the endless world send exactly the wall as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:Peer,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},now);};
/** Every decoded frame's structures, as the phone sees them. */
function structuresSeen(frames:readonly Uint8Array[]){
  const feed=new FrameRunFeed(),out:{id:string;kind:string;x:number;y:number}[][]=[];
  for(const f of frames){const r=feed.decode(f) as {ok:boolean;view?:{structures:{id:string;kind:string;x:number;y:number}[]}};if(r.ok&&r.view)out.push(r.view.structures);}
  return out;
}

test('a city room: frames carry the 4 barricades, and their wire ids stay the same over 4 s of prunes',async()=>{
  const room=new Room(1000,7,{cityText,cityRef:CITY,cityPlayable:true}),a=peer();join(room,a,1000);
  say(room,a,{t:'setMap',map:'cidade-nevada'},1000+OWNER_GAP_MS);await room.ready();
  assert.equal(room.sim.terrain.world,'cidade');
  assert.equal(room.sim.cityStructures,true,'the city sim is built with cityStructures');
  const start=a.frames.length;
  // 6 s of room ticks (the room prunes wire ids once a second): ids must not be re-issued.
  for(let i=0;i<120;i++)room.advance(2000+i*50);
  const seen=structuresSeen(a.frames).slice(-40);
  assert.ok(a.frames.length-start>=40,`frames sent (${a.frames.length-start})`);
  const barricades=seen.map(list=>list.filter(s=>s.kind==='barricada'));
  assert.equal(barricades.at(-1)!.length,4,'4 barricades in the frames');
  const ids=barricades.at(-1)!.map(s=>s.id).sort();
  assert.ok(ids.every(id=>!id.startsWith('barricada-')),`the client gets wire labels, not server ids: ${ids}`);
  for(const list of barricades)assert.deepEqual(list.map(s=>s.id).sort(),ids,'same wire ids in every frame');
  // Each barricade stands on its own boca (the client finds the mouth by the nearest one).
  const bocas=JSON.parse(cityText).points.bocas as Record<string,{x:number;y:number}>;
  for(const b of barricades.at(-1)!)assert.ok(Object.values(bocas).some(p=>Math.hypot(p.x-b.x,p.y-b.y)<.5),`${b.id} on a boca`);
  assert.equal(seen.at(-1)!.filter(s=>s.kind==='muralha').length,1);
});

test('the island and the endless rooms still send only the wall',()=>{
  for(const world of ['ilha','infinito'] as const){
    const room=new Room(1000,7,{world}),a=peer();join(room,a,1000);
    assert.equal(room.sim.cityStructures,false,world);
    for(let i=0;i<50;i++)room.advance(1100+i*50);
    const seen=structuresSeen(a.frames);
    assert.ok(seen.length>0,world);
    for(const list of seen)assert.deepEqual(list.map(s=>s.kind),['muralha'],world);
    assert.equal(new Set(seen.map(list=>list[0].id)).size,1,`${world}: the wall keeps its wire id`);
  }
});
