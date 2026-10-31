// BUG-20261013-E4-bot-gasta-material: with a person in the room the forger bot spends only in the last
// BOT_FORGE_LEFT_WITH_PEOPLE of the intermission, and never evolves a defense a person (here, online) built.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {BOT_FORGE_LEFT_WITH_PEOPLE} from '../../multiplayer/room-bots.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {SIM_HZ} from '../../src/contract/index.ts';
import {buildPlanFor} from '../../src/maps/index.ts';
import {showEveryTower} from '../../src/rules/kits-off.ts';
// torres-3-base-9: these bots build the legacy guarita by ficha; with the bichos shown they only place kits.
showEveryTower();

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);

test('1 person + 2 bots, a 13 s intermission: the person builds first; the bot spends only at the end and leaves the person\'s tower alone',()=>{
  const t0=Date.now(),room=new Room(t0),a=peer();
  room.connect(a,t0);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'},t0);
  say(room,a,{t:'bot-add',round:room.run.snapshot().round},t0+1100);say(room,a,{t:'bot-add',round:room.run.snapshot().round},t0+2300);
  let t=t0+3500;say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<600&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  for(const p of room.sim.players.values())p.invulnerableUntil=Number.MAX_SAFE_INTEGER;
  const w=room.sim.world,st=room.sim.run.stonewards.state,ana=a.messages.find(m=>m.t==='welcome').id;
  // A real intermission (round ≥ 1; the run opens on round 0's placeholder 'prepare' with no time in it).
  for(let i=0;i<20_000&&!(w.round.phase==='prepare'&&w.round.index>=1&&w.round.phaseEndsTick-w.tick>20);i++){if(i%20===0)say(room,a,{t:'ack',seq:0},t);room.advance(t+=50);}
  assert.equal(w.round.phase,'prepare');
  // A short intermission (13 s) and a full camp.
  w.round.phaseEndsTick=w.tick+13*SIM_HZ;st.balance.units=160;
  let n=0;const tick=()=>{room.advance(t+=50);if(++n%20===0)say(room,a,{t:'ack',seq:0},t);};
  // 3 s in: the bots have not touched the material; Ana builds.
  for(let i=0;i<3*SIM_HZ;i++)tick();
  assert.equal(room.bots.built+room.bots.forged,0,'nothing spent by the bots 10 s before the end (they gather meanwhile)');
  // Ana steps next to the site first (the sim's reach rule, torres-ajustes).
  const hero=room.sim.players.get(ana)!,site=buildPlanFor(room.sim.terrain).sites.find(x=>x.id==='obra-01')!;
  hero.x=site.x;hero.y=site.y;
  say(room,a,{t:'build',round:room.run.snapshot().round,req:1,site:'obra-01'},t);
  assert.equal(a.messages.findLast(m=>m.t==='built')?.ok,true,'the person builds inside the short intermission');
  const mine=room.sim.defenses().find(d=>d.owner===ana)!;
  mine.readyTick=w.tick; // ready at once: an evolvable tower the bot could take
  // Up to BOT_FORGE_LEFT_WITH_PEOPLE before the end: still nothing from the bots.
  while(w.round.phaseEndsTick-w.tick>BOT_FORGE_LEFT_WITH_PEOPLE+4)tick();
  assert.equal(room.bots.built+room.bots.forged,0,'the bots wait for the last seconds');
  // The last seconds: the bot builds its own, never evolves Ana's.
  while(w.round.phase==='prepare')tick();
  assert.ok(room.bots.built>0,'the bot built in the last seconds');
  assert.equal(mine.kind,'vigia-do-predio','the person\'s tower is still hers to evolve');
  assert.ok(room.sim.defenses().some(d=>d.owner!==ana),'the bot\'s own defense');
});
