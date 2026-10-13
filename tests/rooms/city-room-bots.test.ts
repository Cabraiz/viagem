// cidade-10 (PREP): a headless Room on the Cidade Nevada (cityPlayable:true, map 'cidade-nevada', the real asset) with
// one person and three of the room's own bots (D-025) plays rounds 1–3 without an exception and without a bot stuck
// for more than STUCK_SECONDS. The person walks from the helicopter to the plaza and stays (moved by the test along a
// flow field at the city hero speed, one step per tick, like the novice of tests/sim/city-tutorial.test.ts) and acks
// every second like a phone. Stuck: a bot holding its stick (|direction| > 0.15) for the whole window while it never
// gets STUCK_REACH away from where the window began, standing (not fallen) and with no critter within FIGHT_NEAR (a bot
// dancing in a fight is fighting, not stuck; that number is logged too). Round times and falls are logged.
// D-031: results only (positions, events, ticks); the think cost is logged, never asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {heroSpeed,walkable,type Point} from '../../src/maps/world.ts';
import {SIM_HZ,ticks} from '../../src/contract/types.ts';
import {cityFlowGrid,cityPlanner,cityTerrainOf} from '../../src/sim/city/grid.ts';
import {botRouteStats} from '../../src/sim/city/bot-routes.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const STUCK_SECONDS=5,STUCK_REACH=1,FIGHT_NEAR=6;

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const round=(room:Room)=>room.run.snapshot().round;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;

test('ACCEPTANCE (c): a city room with three bots plays rounds 1-3 without an exception or a bot stuck > 5 s',async()=>{
  const room=new Room(1000,4242,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada'}),a:TestPeer=peer();
  await room.ready();
  let t=1000;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  const ana=a.messages.find(m=>m.t==='welcome')?.id as string;
  assert.ok(ana,'Ana sits');
  const sim=room.sim,city=cityTerrainOf(sim.terrain);
  assert.ok(city,'the room plays the city');
  for(let i=0;i<3;i++)say(room,a,{t:'bot-add',round:round(room)},t+=OWNER_GAP_MS);
  const bots=[...sim.bots];
  assert.equal(bots.length,3,'three bots seated');
  say(room,a,{t:'ready',round:round(room),ready:true},t+=OWNER_GAP_MS);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);

  // The bots' sticks, as the driver sets them.
  const stick=new Map<string,Point>(),set=sim.setBotInput.bind(sim);
  sim.setBotInput=(id,direction,skill)=>{stick.set(id,{x:direction.x,y:direction.y});set(id,direction,skill);};
  // Ana walks to the plaza at the city hero speed and stays there.
  const plaza=city.asset.points.praca,route=new FlowField(cityFlowGrid(city),[plaza]),judge=cityPlanner(city),dir={x:0,y:0},v=heroSpeed(city)/SIM_HZ;
  const window=ticks(STUCK_SECONDS);
  const trail=new Map(bots.map(id=>[id,[] as {x:number;y:number;moving:boolean;free:boolean}[]]));
  const stuck=new Map(bots.map(id=>[id,{run:0,worst:0,at:''}])),confined=new Map(bots.map(id=>[id,{run:0,worst:0}]));
  const rounds:{index:number;wave?:number;end?:number}[]=[],falls:string[]=[];
  let anaArrived:number|undefined;
  for(let i=0;i<ticks(500)&&!rounds.find(r=>r.index===3)?.end&&room.run.snapshot().phase==='combat';i++){
    const p=sim.players.get(ana)!;
    if(!p.downed){
      route.directionAt(p.x,p.y,dir);
      const next={x:p.x+dir.x*v,y:p.y+dir.y*v};
      if((dir.x||dir.y)&&walkable(next,city)){p.x=next.x;p.y=next.y;}
      if(anaArrived===undefined&&judge.insideBase(p))anaArrived=sim.tick;
    }
    t+=50;
    if(i%SIM_HZ===0)say(room,a,{t:'ack',seq:0},t);
    room.advance(t);
    for(const e of sim.events){
      if(e.type==='round'){
        if(e.phase==='wave')rounds.push({index:e.index,wave:sim.tick});
        if(e.phase==='end'){const r=rounds.find(x=>x.index===e.index);if(r)r.end=sim.tick;}
      }
      if(e.type==='downed')falls.push(`${sim.bots.has(e.player)?e.player:'Ana'} r${sim.world.round.index} ${secs(sim.tick)}`);
    }
    for(const id of bots){
      const b=sim.players.get(id)!,s=stick.get(id)??{x:0,y:0},h=trail.get(id)!;
      const fight=sim.enemies.some(e=>Math.hypot(e.x-b.x,e.y-b.y)<FIGHT_NEAR);
      h.push({x:b.x,y:b.y,moving:Math.hypot(s.x,s.y)>.15&&!b.downed,free:!fight});
      if(h.length>window)h.shift();
      const near=h.length===window&&h.every(q=>q.moving&&Math.hypot(q.x-h[0].x,q.y-h[0].y)<STUCK_REACH);
      const c=confined.get(id)!;c.run=near?c.run+1:0;c.worst=Math.max(c.worst,c.run);
      const w=stuck.get(id)!;w.run=near&&h.every(q=>q.free)?w.run+1:0;
      if(w.run>w.worst){w.worst=w.run;w.at=`(${b.x.toFixed(1)},${b.y.toFixed(1)}) r${sim.world.round.index} ${sim.world.round.phase} ${secs(sim.tick)}`;}
    }
  }
  const brains=(room as unknown as {bots:{thinkMs:number;thinks:number}}).bots;
  console.log(`[cidade-10] city room, Ana + 3 bots, seed 4242: `
    +rounds.map(r=>`round ${r.index} wave ${secs(r.wave!)}→${r.end===undefined?'-':`${secs(r.end)} (${secs(r.end-r.wave!)})`}`).join(', ')
    +`; Ana in the plaza ${anaArrived===undefined?'never':secs(anaArrived)}; falls ${falls.length?falls.join(', '):'none'}`
    +`\n  stuck (no critter within ${FIGHT_NEAR} u) beyond ${STUCK_SECONDS} s: ${bots.map(id=>{const w=stuck.get(id)!;return `${id} ${secs(w.worst)}${w.worst?` at ${w.at}`:''}`;}).join(', ')}`
    +`\n  confined within ${STUCK_REACH} u beyond ${STUCK_SECONDS} s, fights included: ${bots.map(id=>`${id} ${secs(confined.get(id)!.worst)}`).join(', ')}`
    +`\n  think ${brains.thinks} decisions, ${(brains.thinkMs/Math.max(1,brains.thinks)).toFixed(3)} ms each; route fields built ${botRouteStats.builds}, served ${botRouteStats.hits}`);
  assert.ok(rounds.find(r=>r.index===3)?.end!==undefined,`rounds 1-3 ended (${rounds.map(r=>`${r.index}:${r.end===undefined?'on':'end'}`).join(' ')}; phase ${room.run.snapshot().phase})`);
  for(const id of bots)assert.equal(stuck.get(id)!.worst,0,`${id} stuck ${secs(stuck.get(id)!.worst)} beyond ${STUCK_SECONDS} s at ${stuck.get(id)!.at}`);
  assert.ok(anaArrived!==undefined,'Ana reached the plaza');
});
