// BUG-20261013-E4-corneta-jogador-longe: a city Room (cityPlayable:true, the real Cidade Nevada asset) with one person
// who never leaves the helicopter spawn (pinned there every tick, acking every second like an idle phone) and two of the
// room's bots. The person stands ~79 u (~41.6 s of walk) from the plaza, about the whole ~42 s intermission, so the horn
// used to count her walk back and sound on the intermission's first tick: the bots went home at once and nothing was
// gathered (0 units in every intermission). The wall, the barricades and the players are kept whole (invulnerable), as
// in the investigation's repro, so the run reaches round 5 on any seed.
// Per intermission r2–r4:
//  - the horn sounds in the last ~10 s (HORN_LEAD_CITY): the bots do not escort the idle person (room-bots.ts, city) and
//    go home on their own walk back (bot-brain.ts, city), so nobody but her is far; the sim lists her as idle
//    (StonewardsState.cityHornIdle) when it sounds;
//  - the team gathers at least MIN_GATHERED units (the change in stonewards.state.gathered over the intermission, not
//    the camp balance, which the forger spends).
// D-031: results only (positions, events, ticks).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {SIM_HZ} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainOf} from '../../src/sim/city/grid.ts';
import {cityFarthestReturn,cityLoot} from '../../src/sim/stonewards/loot.ts';
import {HORN_LEAD_CITY} from '../../src/sim/stonewards/system.ts';
import {returnTicks} from '../../src/rules/stonewards.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
/** Units the two bots gather at least in each intermission (20 with the fix on seed 4242; 0 before it). */
const MIN_GATHERED=6;
/** Intermissions checked: the prepare phases before rounds 2, 3 and 4. */
const ROUNDS=[2,3,4];
/** Slack on the horn's timing (one second). */
const HORN_SLACK=SIM_HZ;

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const round=(room:Room)=>room.run.snapshot().round;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;

test('ACCEPTANCE (BUG-20261013-E4): a person idle at the city spawn does not sound the horn early, and the two bots still gather every intermission',async()=>{
  const room=new Room(1000,4242,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada'}),a=peer();
  await room.ready();
  let t=1000;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  const ana=a.messages.find(m=>m.t==='welcome')?.id as string;
  assert.ok(ana,'Ana sits');
  for(let i=0;i<2;i++)say(room,a,{t:'bot-add',round:round(room)},t+=OWNER_GAP_MS);
  say(room,a,{t:'ready',round:round(room),ready:true},t+=OWNER_GAP_MS);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const sim=room.sim,city=cityTerrainOf(sim.terrain),loot=cityLoot(sim.terrain);
  assert.ok(city&&loot,'the room plays the city');
  assert.equal(sim.bots.size,2,'two bots seated');
  const st=sim.run.stonewards.state,w=sim.world;
  const spawn={x:sim.players.get(ana)!.x,y:sim.players.get(ana)!.y};
  const anaWalk=loot.distanceToPlaza(spawn);
  assert.ok(anaWalk!==undefined&&anaWalk/loot.speed>30,`precondition: Ana spawns far from the plaza (${anaWalk?.toFixed(1)} u)`);
  const total=()=>Object.values(st.gathered).reduce((s,v)=>s+v,0);
  /** Ticks the farthest standing hero other than Ana needs to be back (what the horn may wait for). */
  const othersBack=()=>cityFarthestReturn({players:sim.players} as unknown as SimContext,loot,
    p=>returnTicks(Math.hypot(p.x-st.wall.x,p.y-st.wall.y)),id=>id===ana);
  const seen=new Map<number,{start:number;from:number;hornLeft?:number;othersLead?:number;anaIdle?:boolean;gathered?:number}>();
  for(let i=0;i<20*60*SIM_HZ&&room.run.snapshot().phase==='combat'&&w.round.index<=ROUNDS.at(-1)!;i++){
    const p=sim.players.get(ana)!;
    p.x=spawn.x;p.y=spawn.y;
    for(const q of sim.players.values())q.invulnerableUntil=Number.MAX_SAFE_INTEGER;
    st.wall.hp=st.wall.maxHp;
    for(const b of st.barricades??[])if(!b.down)b.hp=b.maxHp;
    t+=50;
    if(i%SIM_HZ===0)say(room,a,{t:'ack',seq:0},t);
    room.advance(t);
    for(const e of sim.events){
      if(e.type==='round'&&e.phase==='prepare'&&ROUNDS.includes(e.index))seen.set(e.index,{start:sim.tick,from:total()});
      const r=seen.get(w.round.index);
      if(e.type==='horn'&&r&&r.hornLeft===undefined){
        r.hornLeft=e.endsTick-sim.tick;r.othersLead=othersBack();
        r.anaIdle=!!st.cityHornIdle?.includes(ana);
      }
      if(e.type==='round'&&e.phase==='wave'){const q=seen.get(e.index);if(q)q.gathered=total()-q.from;}
    }
  }
  console.log(`[BUG-20261013-E4] city room, Ana idle at the spawn (${anaWalk!.toFixed(1)} u from the plaza) + 2 bots, seed 4242: `
    +ROUNDS.map(r=>{const q=seen.get(r);return `r${r} ${q?`horn ${q.hornLeft===undefined?'-':secs(q.hornLeft)} before the wave (others need ${secs(q.othersLead??0)}), gathered ${q.gathered?.toFixed(1)??'-'}`:'not reached'}`;}).join('; ')
    +`; per bot ${JSON.stringify(st.gathered)}`);
  for(const r of ROUNDS){
    const q=seen.get(r);
    assert.ok(q&&q.hornLeft!==undefined&&q.gathered!==undefined,`intermission before round ${r} played to its end`);
    assert.ok(q.anaIdle,`r${r}: Ana idle at the spawn is left out of the horn (cityHornIdle)`);
    assert.ok(q.hornLeft!<=HORN_LEAD_CITY+HORN_SLACK,`r${r}: horn ${secs(q.hornLeft!)} before the wave (the others need ${secs(q.othersLead!)}, Ana is idle)`);
  }
  for(const r of ROUNDS){
    const q=seen.get(r)!;
    assert.ok(q.gathered!>=MIN_GATHERED,`r${r}: the team gathered ${q.gathered!.toFixed(1)} units (at least ${MIN_GATHERED})`);
  }
});
