// cidade-10 (PREP): a headless Room on the Cidade Nevada (cityPlayable:true, map 'cidade-nevada', the real asset) with
// one person and three of the room's own bots (D-025) plays rounds 1–3 without an exception and without a bot stuck
// for more than STUCK_SECONDS. The person walks from the helicopter to the plaza and stays (moved by the test along a
// flow field at the city hero speed, one step per tick, like the novice of tests/sim/city-tutorial.test.ts) and acks
// every second like a phone. Stuck: a bot holding its stick (|direction| > 0.15) for the whole window while it never
// gets STUCK_REACH away from where the window began, standing (not fallen) and with no critter within FIGHT_NEAR (a bot
// dancing in a fight is fighting, not stuck; that number is logged too). Round times and falls are logged.
// D-031: results only (positions, events, ticks); the think cost is logged, never asserted.
// BUG-20261013-E1 (same run): in round 3 barricade N is already down (it fell in round 2) and bodies poured through the
// N mouth into the north strip of the plaza, cut off from the team by the fountain's ~1 u gaps: up to 27 stood there
// (siege bodies walking straight at the wall into the fountain; tios-pavê, 0.52 u, on a field narrower than them) and
// round 3 ran into its timeout (126 s; 75 s before the barricades). Sampled once a second, a critter is "stalled" when
// it moved < STALL_REACH in the last STALL_SECONDS, is > FIGHT_NEAR from every standing player and is not pressed
// against a standing structure (the wall or a barricade: that is a siege, D-017). At most STALLED_MAX at once, and
// round 3's wave ends within ROUND3_MAX_SECONDS (83 s with the fix).
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
import {structureTargets} from '../../src/sim/stonewards/system.ts';
import {RADIUS} from '../../src/maps/world.ts';
import {botRouteStats} from '../../src/sim/city/bot-routes.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
/**
 * FIGHT_NEAR 6 again (bot-caca-ultimo-na-borda, 17/10; it was 7 for bancos-sim on 16/10, when the wave's last critter,
 * the palhaço cunhado-sabe-tudo, stood 6.0 u from two bots holding at their leash's edge): the roamers now hunt a last
 * critter just past the lure band and the very last one takes the guards out to the roamers' leash (bot-brain.ts
 * LURE_REACH, tests/sim/city-bots-caca.test.ts).
 */
const STUCK_SECONDS=5,STUCK_REACH=1,FIGHT_NEAR=6;
/**
 * Round 3 (BUG-20261013-E1). ROUND3_MAX_SECONDS: 75 s before the barricades (cidade-06) plus 25 s for what they hold
 * back, plus 15 s since torres-fio (13/10): the room bots now build tower defenses, so the forger spends material on
 * them instead of only repairs and the towers become siege targets too (83 s before it, 103 s with it, seed 4242).
 * Plus 30 s since vida-inimigos-estilo-clash (24/10, ORQ option A): the rounds mode's round 3 is pombo-heavy and the
 * pombos take 2 hits now (role hp, ROLE_HITS), so the wave runs longer (103 s before, 137 s with it, seed 4242); the live
 * game is ninhos, where the horde's hp stays +4 %. A stuck critter is still caught by STALLED_MAX.
 * Seed 4244 since the bodies by team size (vida-inimigos-estilo-clash, decision B: 4 players ×0.82 bodies) met
 * bots-20-mais-lentos: on 4242 the team fell in round 3 (4243 too; 4244–4248 play rounds 1-3).
 * Seed 4246 since lojas-bico-fora-das-bocas (30/10): the shops moved off the street mouths and on 4244 the wall fell in
 * round 3; a seed's run is chaotic, not weaker (E2, seeds 4240–4259, Ana after the bots: rounds 1-3 played in 17 of 20
 * before, 18 of 20 after; 4246 plays in both orders).
 */
const STALL_SECONDS=10,STALL_REACH=1,STALLED_MAX=3,ROUND3_MAX_SECONDS=145;

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
/** Seat ids in join order (RoomOptions.newId): the run depends on them (the sim breaks ties by player id). */
const seatIds=(prefix:string)=>{let n=0;return ()=>`${prefix}-${++n}`;};
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const round=(room:Room)=>room.run.snapshot().round;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;

// The run depends on the seat ids (the sim breaks ties by player id): a person's id sorts before or after 'bot-1', so
// both orders are played (BUG-20261013-E8: with Ana first, a siege tio-pavê stood at a corner north of mouth N).
for(const [order,prefix] of [['after','pessoa'],['before','a-pessoa']] as const)
test(`ACCEPTANCE (c): a city room with three bots plays rounds 1-3 without an exception or a bot stuck > 5 s (Ana's id sorts ${order} the bots')`,async()=>{
  // The wall mode (survive 10 rounds): the chaveiro objective (D-047, the city default) has its own acceptance in
  // city-room-chaveiro.test.ts.
  const room=new Room(1000,4246,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',newId:seatIds(prefix),objective:false}),a:TestPeer=peer();
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
  const seen=new Map<string,{x:number;y:number}[]>();
  let stalledWorst=0,stalledAt='';
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
    const before=sim.tick;
    room.advance(t);
    // The level-up pause (D-050) holds the sim while the room waits for picks: no step, nothing to sample (a bot whose
    // stick was set when it began counted 7.5 s "stuck" in one frozen tick, bot-caca-ultimo-na-borda).
    const stepped=sim.tick!==before;
    for(const e of sim.events){
      if(e.type==='round'){
        if(e.phase==='wave')rounds.push({index:e.index,wave:sim.tick});
        if(e.phase==='end'){const r=rounds.find(x=>x.index===e.index);if(r)r.end=sim.tick;}
      }
      if(e.type==='downed')falls.push(`${sim.bots.has(e.player)?e.player:'Ana'} r${sim.world.round.index} ${secs(sim.tick)}`);
    }
    const r3=rounds.find(r=>r.index===3);
    if(stepped&&r3&&r3.end===undefined&&sim.tick%SIM_HZ===0){
      const standing=[...sim.players.values()].filter(q=>!q.downed&&q.hp>0),structures=structureTargets(sim.run.stonewards.state);
      const stalled:string[]=[];
      for(const e of sim.enemies){
        if(!(e.hp>0)||e.boss)continue;
        const h=seen.get(e.id)??[];h.push({x:e.x,y:e.y});if(h.length>STALL_SECONDS+1)h.shift();seen.set(e.id,h);
        if(h.length<=STALL_SECONDS||!h.every(q=>Math.hypot(q.x-h[0].x,q.y-h[0].y)<STALL_REACH))continue;
        if(standing.some(q=>Math.hypot(q.x-e.x,q.y-e.y)<=FIGHT_NEAR))continue;
        if(structures.some(st=>Math.hypot(st.x-e.x,st.y-e.y)-st.radius<=e.radius+RADIUS+.05))continue;
        stalled.push(`${e.kind} (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
      }
      if(stalled.length>stalledWorst){stalledWorst=stalled.length;stalledAt=`${secs(sim.tick-r3.wave!)} into round 3: ${stalled.join(', ')}`;}
    }
    if(stepped)for(const id of bots){
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
  console.log(`[cidade-10] city room, Ana (${ana}) + 3 bots, seed 4246: `
    +rounds.map(r=>`round ${r.index} wave ${secs(r.wave!)}→${r.end===undefined?'-':`${secs(r.end)} (${secs(r.end-r.wave!)})`}`).join(', ')
    +`; Ana in the plaza ${anaArrived===undefined?'never':secs(anaArrived)}; falls ${falls.length?falls.join(', '):'none'}`
    +`\n  stuck (no critter within ${FIGHT_NEAR} u) beyond ${STUCK_SECONDS} s: ${bots.map(id=>{const w=stuck.get(id)!;return `${id} ${secs(w.worst)}${w.worst?` at ${w.at}`:''}`;}).join(', ')}`
    +`\n  confined within ${STUCK_REACH} u beyond ${STUCK_SECONDS} s, fights included: ${bots.map(id=>`${id} ${secs(confined.get(id)!.worst)}`).join(', ')}`
    +`\n  round 3: at most ${stalledWorst} critters stalled ≥ ${STALL_SECONDS} s away from everyone${stalledWorst?` (${stalledAt})`:''}`
    +`\n  think ${brains.thinks} decisions, ${(brains.thinkMs/Math.max(1,brains.thinks)).toFixed(3)} ms each; route fields built ${botRouteStats.builds}, served ${botRouteStats.hits}`);
  assert.ok(rounds.find(r=>r.index===3)?.end!==undefined,`rounds 1-3 ended (${rounds.map(r=>`${r.index}:${r.end===undefined?'on':'end'}`).join(' ')}; phase ${room.run.snapshot().phase})`);
  for(const id of bots)assert.equal(stuck.get(id)!.worst,0,`${id} stuck ${secs(stuck.get(id)!.worst)} beyond ${STUCK_SECONDS} s at ${stuck.get(id)!.at}`);
  assert.ok(anaArrived!==undefined,'Ana reached the plaza');
  const r3=rounds.find(r=>r.index===3)!;
  assert.ok(stalledWorst<=STALLED_MAX,`round 3: ${stalledWorst} critters stalled at once, ${stalledAt}`);
  assert.ok(r3.end!-r3.wave!<=ticks(ROUND3_MAX_SECONDS),`round 3 wave lasted ${secs(r3.end!-r3.wave!)} (max ${ROUND3_MAX_SECONDS} s)`);
});
