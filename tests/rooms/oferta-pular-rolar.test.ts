// D-052 (NEW-20261016-ORQ-oferta-melhoria-centro, the Orquestrador's option b): "Pular" and "Rolar de novo" in the
// offer window. Each player starts a run with OFFER_SKIPS skips and OFFER_REROLLS rerolls; a reroll changes only that
// player's cards (new offer id: a pick against the old cards is refused); a skip closes that player's offer with no
// prize and counts as picked for the level-up pause; the counters go per player in RunState.pause.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {OFFER_REROLLS,OFFER_SKIPS} from '../../src/sim/progression.ts';

function peer(){
  const messages:any[]=[];
  return {messages,gone:false,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const peers=new WeakMap<Room,TestPeer[]>();
const join=(room:Room,p:TestPeer,name:string,now:number)=>{if(!peers.has(room))peers.set(room,[]);peers.get(room)!.push(p);room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const welcome=(p:TestPeer)=>p.messages.find(m=>m.t==='welcome');
const lastRun=(p:TestPeer)=>p.messages.findLast(m=>m.t==='run')?.run;
function step(room:Room,now:number){for(const p of peers.get(room)??[])if(!p.gone)say(room,p,{t:'ping',at:now},now);room.advance(now);}
function paused(){
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=1100;for(const p of [a,b])say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat'||room.sim.world.round.phase!=='wave';t+=50)step(room,t);
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  step(room,t+=50);
  return {room,a,b,t,ida:welcome(a).id as string,idb:welcome(b).id as string};
}
const round=(room:Room)=>room.run.snapshot().round;
const cards=(room:Room,id:string)=>JSON.stringify(room.sim.offers(id)[0]?.choices);

test('two of each per run, per player, in RunState.pause',()=>{
  const {room,a,ida,idb}=paused();
  assert.equal(room.levelup.paused,true);
  assert.equal(OFFER_SKIPS,2);assert.equal(OFFER_REROLLS,2);
  assert.deepEqual(lastRun(a).pause.skips,{[ida]:2,[idb]:2});
  assert.deepEqual(lastRun(a).pause.rerolls,{[ida]:2,[idb]:2});
});

test('"Rolar de novo": new cards and id for that player only; the old id is refused; at 0 nothing happens',()=>{
  let {room,a,t,ida,idb}=paused();
  const before=room.sim.offers(ida)[0]!.id,bia=cards(room,idb),biaId=room.sim.offers(idb)[0]!.id;
  // Seeded rolls can repeat a hand; reroll until the cards differ at least once within the two charges.
  say(room,a,{t:'reroll',round:round(room),offer:before},t);step(room,t+=50);
  const after={...room.sim.offers(ida)[0]!};
  assert.notEqual(after.id,before,'a new id');
  assert.match(after.id,/^lvl-2-[\w-]+~\d+$/,'still a valid offer id (room OFFER_ID)');
  assert.equal(cards(room,idb),bia,'Bia keeps her cards');assert.equal(room.sim.offers(idb)[0]!.id,biaId);
  assert.deepEqual(lastRun(a).pause.rerolls,{[ida]:1,[idb]:2});
  assert.equal(room.levelup.paused,true,'a reroll is not a pick: the pause still waits for Ana');
  assert.ok(lastRun(a).pause.waiting.includes(ida));
  // The client got the new queue.
  assert.equal(a.messages.findLast(m=>m.t==='offers')?.offers?.[0]?.id,after.id);
  // A pick against the old cards is refused.
  say(room,a,{t:'choose',round:round(room),offer:before,index:0},t);step(room,t+=50);
  assert.equal(room.sim.offers(ida)[0]!.id,after.id,'the stale pick did nothing');
  // Second reroll in the same paused tick: a different id again; third: refused (none left).
  say(room,a,{t:'reroll',round:round(room),offer:after.id},t);step(room,t+=50);
  const second=room.sim.offers(ida)[0]!.id;
  assert.notEqual(second,after.id);
  assert.deepEqual(lastRun(a).pause.rerolls,{[ida]:0,[idb]:2});
  say(room,a,{t:'reroll',round:round(room),offer:second},t);step(room,t+=50);
  assert.equal(room.sim.offers(ida)[0]!.id,second,'no rerolls left: the same offer');
  assert.equal(room.sim.run.progression.rerollOffer(room.sim.world,ida,second).ok,false);
});

test('"Pular": closes the offer with no prize, counts as picked for the pause, spends one skip',()=>{
  let {room,a,b,t,ida,idb}=paused();
  const build=JSON.stringify(room.sim.players.get(ida)!.build);
  say(room,a,{t:'skip',round:round(room),offer:room.sim.offers(ida)[0]!.id},t);step(room,t+=50);
  assert.equal(room.sim.offers(ida).length,0,'Ana has no offer left');
  assert.equal(JSON.stringify(room.sim.players.get(ida)!.build),build,'and no prize');
  assert.deepEqual(lastRun(a).pause.waiting,[idb],'only Bia left to pick');
  assert.deepEqual(lastRun(a).pause.skips,{[ida]:1,[idb]:2});
  // Bia skips too: the pause ends at once.
  say(room,b,{t:'skip',round:round(room),offer:room.sim.offers(idb)[0]!.id},t);step(room,t+=50);
  assert.equal(room.levelup.paused,false,'everybody "picked": the run goes on');
});

test('refusals: a forged or stale id, no offer, out of combat; the counters reset with a new run',()=>{
  const {room,ida}=paused();
  const prog=room.sim.run.progression,world=room.sim.world;
  assert.deepEqual(prog.skip(world,ida,'lvl-99-x'),{ok:false,reason:'unknown-offer'});
  assert.deepEqual(prog.skip(world,'ninguem','lvl-2-x'),{ok:false,reason:'no-player'});
  const id=room.sim.offers(ida)[0]!.id;
  assert.equal(prog.skip(world,ida,id).ok,true);
  assert.deepEqual(prog.skip(world,ida,id),{ok:false,reason:'no-offer'});
  assert.deepEqual(prog.charges(ida),[1,2]);
  prog.reset();
  assert.deepEqual(prog.charges(ida),[2,2],'a new run starts with two of each');
});

test('the counters survive a checkpoint (they live in the JSON-safe progression state)',()=>{
  const {room,ida}=paused();
  const prog=room.sim.run.progression;
  assert.equal(prog.rerollOffer(room.sim.world,ida,room.sim.offers(ida)[0]!.id).ok,true);
  const copy=JSON.parse(JSON.stringify(prog.state));
  assert.deepEqual(copy.charges,{[ida]:[2,1]});
});
