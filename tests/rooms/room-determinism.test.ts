// BUG-20261013 (city-room-bots not deterministic): the same room (seed, seat ids, inputs on a synthetic clock) plays the
// same run, tick for tick, however many rooms this process ran before it. Each map plays its room, then another room
// (another seed: the module-level caches, bot-routes' LRU and the per-terrain memos, fill with other entries and
// evict), then the first room again; sim.stateHash() must match on every tick.
// The cause found: a person's seat id was crypto.randomUUID() and the sim breaks ties by player id (pickups, revives,
// skills, zueira), so whether the person sorted before or after 'bot-1' changed the run (round 3 of
// city-room-bots: 88 s or 140 s). RoomOptions.newId pins the ids here. D-031: results only, no timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {heroSpeed,walkable} from '../../src/maps/world.ts';
import {SIM_HZ,ticks} from '../../src/contract/types.ts';
import {cityFlowGrid,cityTerrainOf} from '../../src/sim/city/grid.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};

/**
 * One room: a person (Ana) and three room bots, from the lobby through rounds 1–`rounds` (or `cap` combat ticks).
 * In the city Ana walks from the wreck to the plaza along a flow field and stays (like city-room-bots); in the
 * endless map she stands. Returns sim.stateHash() of every combat tick.
 */
async function play(map:'cidade-nevada'|'infinito',seed:number,rounds:number,cap:number){
  const messages:any[]=[],a={send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}} as Peer;
  let n=0;
  const room=new Room(1000,seed,{cityText,cityRef:CITY,cityPlayable:true,map,newId:()=>`pessoa-${++n}`});
  await room.ready();
  let t=1000;
  const say=(m:object)=>room.receive(a,JSON.stringify(m),t),round=()=>room.run.snapshot().round;
  room.connect(a,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)});
  const ana=messages.find(m=>m.t==='welcome')?.id as string;
  assert.ok(ana,'Ana sits');
  for(let i=0;i<3;i++){t+=OWNER_GAP_MS;say({t:'bot-add',round:round()});}
  t+=OWNER_GAP_MS;say({t:'ready',round:round(),ready:true});
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const sim=room.sim,city=cityTerrainOf(sim.terrain);
  assert.equal(!!city,map==='cidade-nevada',`${map}: the room plays it`);
  const route=city?new FlowField(cityFlowGrid(city),[city.asset.points.praca]):undefined,dir={x:0,y:0},v=heroSpeed(sim.terrain)/SIM_HZ;
  const hashes:string[]=[];
  for(let i=0;i<cap&&room.run.snapshot().phase==='combat'&&sim.world.round.index<=rounds;i++){
    const p=sim.players.get(ana)!;
    if(route&&city&&!p.downed){
      route.directionAt(p.x,p.y,dir);
      const next={x:p.x+dir.x*v,y:p.y+dir.y*v};
      if((dir.x||dir.y)&&walkable(next,city)){p.x=next.x;p.y=next.y;}
    }
    t+=50;
    if(i%SIM_HZ===0)say({t:'ack',seq:0});
    room.advance(t);
    hashes.push(`${sim.tick} r${sim.world.round.index} ${sim.stateHash()}`);
  }
  return hashes;
}

function same(first:string[],again:string[],what:string){
  const k=first.findIndex((h,i)=>h!==again[i]);
  assert.equal(k,-1,`${what}: tick ${k} differs (${first[k]} vs ${again[k]})`);
  assert.equal(again.length,first.length,`${what}: same length`);
}

test('city: the same room (3 bots + a scripted person, seed 4242) plays rounds 1-3 tick for tick alike, before and after another room',async()=>{
  const first=await play('cidade-nevada',4242,3,ticks(400));
  assert.ok(first.length>ticks(150)&&first.at(-1)!.includes(' r'),`${first.length} combat ticks`);
  await play('cidade-nevada',7,2,ticks(120));
  same(first,await play('cidade-nevada',4242,3,ticks(400)),'city seed 4242');
});

test('endless: the same room (3 bots + a person, seed 4242) plays tick for tick alike, before and after another room',async()=>{
  const first=await play('infinito',4242,3,ticks(150));
  await play('infinito',7,2,ticks(60));
  same(first,await play('infinito',4242,3,ticks(150)),'endless seed 4242');
});
