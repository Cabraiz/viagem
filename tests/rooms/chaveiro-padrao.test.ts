// D-047: a city room with no objective asked plays the chaveiro (CITY_OBJECTIVE_DEFAULT); ?modo=muralha asks for the wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);

/** A room as the Worker makes it for "Jogar sozinho" (born on the city, solo), played into combat with one bot. */
async function solo(options:object){
  const t0=1000,room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,...options}),a=peer();
  await room.ready();
  let t=t0;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  say(room,a,{t:'bot-add',round:room.run.snapshot().round},t+=OWNER_GAP_MS);
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=OWNER_GAP_MS);
  for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  for(let i=0;i<40;i++)room.advance(t+=50);
  return {room,a};
}

test('D-047: "Jogar sozinho" with no objective asked plays the chaveiro in the city (sim and frames)',async()=>{
  const {room,a}=await solo({});
  assert.equal(room.run.snapshot().phase,'combat');
  assert.ok(room.sim.objectiveView(),'the sim runs the chaveiro');
  const decoder=new FrameDecoder();let seen=false;
  for(const f of a.frames){const r=decoder.decode(f);if(r.ok&&r.view.objective)seen=true;}
  assert.ok(seen,'the phone gets the objective block');
});

test('D-047: objective:false (?modo=muralha) still plays the wall mode',async()=>{
  const {room}=await solo({objective:false});
  assert.equal(room.run.snapshot().phase,'combat');
  assert.equal(room.sim.objectiveView(),undefined);
});
