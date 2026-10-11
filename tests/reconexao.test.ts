// VGM-047: reconnection on phones, the old socket still open, two tabs, and a restart of the room's Durable Object.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer,type RoomRoster} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL,GRACE_MS,ROOM_RESTARTED_NOTICE,REPLACED_MESSAGE} from '../src/game/net/shared.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,frames,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:(code:number,reason:string)=>{closes.push({code,reason});}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,token?:string)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',...(token?{token}:{})},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
function combat(room:Room,peers:TestPeer[],from=1100){
  let t=from;for(const p of peers)say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  return t;
}

test('the old socket still open: the new connection with the token takes the character, the old one gets 4009',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const id=welcome(a).id,token=welcome(a).token,p=room.sim.players.get(id)!;
  // Phone changes network: the room still sees a's socket; the same phone comes back on a new one.
  const again=peer();join(room,again,'Ana',t+=50,token);
  assert.equal(welcome(again).id,id);assert.equal(room.sim.players.size,2);assert.equal(p.online,true);
  assert.deepEqual(a.closes.map(c=>c.code),[4009]);assert.equal(a.messages.at(-1).t,'replaced');assert.equal(a.messages.at(-1).message,REPLACED_MESSAGE);
  assert.equal(room.run.snapshot().phase,'combat');assert.ok(again.frames.length>=1,'a full frame right away');
  // The dead socket's close arrives later: the character stays online, its input still counts.
  room.disconnect(a,t+=50);assert.equal(p.online,true);
  say(room,again,{t:'input',round:1,seq:welcome(again).ack+1,steps:[[welcome(again).ack+1,1,0,0]]},t);
  for(let i=0;i<4;i++)room.advance(t+=50);
  assert.ok(p.ack>welcome(again).ack);
});

test('two real tabs with one token: each explicit join moves the character once, nothing bounces on its own',()=>{
  const room=new Room(1000),one=peer();join(room,one,'Ana',1000);
  const token=welcome(one).token;
  const two=peer();join(room,two,'Ana',1100,token);
  assert.deepEqual(one.closes.map(c=>c.code),[4009]);assert.deepEqual(two.closes,[]);
  for(let t=1150;t<3000;t+=50)room.advance(t);
  // The replaced tab does not come back by itself (the client never retries 4009): the newest one stays.
  assert.deepEqual(two.closes,[]);assert.equal(room.connections.size,1);
  // A tap on "Atualizar" in the first tab takes it back, once.
  const back=peer();join(room,back,'Ana',3000,token);
  assert.deepEqual(two.closes.map(c=>c.code),[4009]);assert.deepEqual(back.closes,[]);assert.equal(room.sim.players.size,1);
});

test('drops of 5 s and 20 s in the middle of combat: same character, offers kept (clock paused), no double counting',()=>{
  for(const seconds of [5,20]){
    const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
    let t=combat(room,[a,b]);
    const id=welcome(a).id,token=welcome(a).token,p=room.sim.players.get(id)!;
    // Every damage event of the run, to check the server counter against.
    let dealt=0;const step=room.sim.step.bind(room.sim);
    room.sim.step=(now?:number)=>{const events=step(now);for(const e of events)if(e.type==='damage'&&e.source===id&&!room.sim.players.has(e.target))dealt+=e.amount;return events;};
    room.sim.run.progression.grantLevelOffers(room.sim.world,2);
    // Ana's weapon hits a critter next to her before and while she is away.
    for(let i=0;i<4;i++)createEnemy(room.sim.world,'gosma',{x:p.x+1.2,y:p.y+(i-1.5)*.4});
    for(let i=0;i<10;i++)room.advance(t+=50);
    const offers=room.sim.offers(id).map(o=>({id:o.id,deadline:o.deadlineTick})),tickAtDrop=room.sim.tick;
    assert.equal(offers.length,1);
    // Network gone: the room hears nothing; after 12 s of silence it closes the socket itself (5 s: it does not).
    const end=t+seconds*1000;
    for(;t<end;t+=50){if(t%1000===0)say(room,b,{t:'ack',seq:0},t);room.advance(t);}
    assert.equal(p.online,seconds<12,`${seconds} s: the room ${seconds<12?'still holds':'dropped'} the silent socket`);
    const back=peer();join(room,back,'Ana',t,token);
    assert.equal(welcome(back).id,id);assert.equal(room.sim.players.size,2);assert.equal(p.online,true);
    // The offer is still there, its deadline moved by the time offline (12 s+ of a 20 s drop), never lost.
    const pushed=back.messages.find(m=>m.t==='offers');
    assert.deepEqual(pushed.offers.map((o:any)=>o.id),offers.map(o=>o.id));
    // Held offers (combat chip) keep their far deadline; clocked ones are pushed back tick by tick while she is offline.
    if(seconds>=12)assert.ok(room.sim.offers(id)[0].deadlineTick>=offers[0].deadline,'the deadline never ran while offline');
    // Server counters: the damage dealt equals the sum of her damage events, each counted once.
    for(let i=0;i<10;i++)room.advance(t+=50);
    const stats=room.sim.statsOf(id);
    assert.ok(room.sim.tick>tickAtDrop);assert.ok(dealt>0,'she hit something');
    assert.ok(Math.abs(stats.damage-dealt)<1e-6,'each hit counted once across the drop and the rejoin');
    say(room,back,{t:'choose',round:1,offer:offers[0].id,index:0},t);
    assert.deepEqual(back.messages.findLast(m=>m.t==='offers').offers,[]);
  }
});

test('the seat survives the mobile grace and not beyond; the last one standing who dropped keeps the run alive meanwhile',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ana=welcome(a),bia=room.sim.players.get(welcome(b).id)!;
  // Bia falls; Ana switches apps for 90 s. The run waits for Ana instead of a defeat after 5 s.
  bia.invulnerableUntil=0;room.sim.world.damagePlayer(bia.id,1e6,'test');
  room.disconnect(a,t);
  const away=t+90_000;
  for(;t<away;t+=50){say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  assert.equal(room.run.snapshot().phase,'combat','not lost while Ana may come back');
  const back=peer();join(room,back,'Ana',t,ana.token);assert.equal(welcome(back).id,ana.id);
  // Gone for longer than the grace: the seat is free and the run ends (042a R1 with the grace).
  room.disconnect(back,t);
  for(const end=t+GRACE_MS+1000;t<end;t+=50){say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  const late=peer();join(room,late,'Ana',t,ana.token);
  assert.equal(late.closes[0].code,4003);assert.equal(late.messages[0].message,'Sua sessão expirou. Entre novamente.');
  assert.equal(room.run.snapshot().phase,'result');
});

test('restart of the room: the roster comes back from storage, the run is lost honestly, each player hears it once',()=>{
  const writes:RoomRoster[]=[];
  const room=new Room(1000,4242,{onRoster:r=>writes.push(structuredClone(r))}),a=peer(),b=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  assert.equal(writes.length,2,'one row per join');
  let t=combat(room,[a,b]);
  assert.equal(writes.at(-1)!.running,true);
  const before=writes.length;
  for(let i=0;i<100;i++)room.advance(t+=50);
  assert.equal(writes.length,before,'combat ticks write nothing');
  // The object restarts (deploy, eviction): a new Room from the same storage.
  const roster=writes.at(-1)!,restarted=new Room(1000,4242,{onRoster:r=>writes.push(structuredClone(r))});
  restarted.restore(roster,t);
  assert.equal(restarted.sim.players.size,2);assert.equal(restarted.run.snapshot().phase,'lobby');
  assert.ok([...restarted.sim.players.values()].every(p=>!p.online));
  const back=peer();join(restarted,back,'Ana',t+100,welcome(a).token);
  assert.equal(welcome(back).id,welcome(a).id);assert.equal(welcome(back).run.phase,'lobby');
  assert.deepEqual(back.messages.filter(m=>m.t==='notice').map(m=>m.message),[ROOM_RESTARTED_NOTICE]);
  // Back again later (another drop): no second notice.
  restarted.disconnect(back,t+200);const again=peer();join(restarted,again,'Ana',t+300,welcome(a).token);
  assert.deepEqual(again.messages.filter(m=>m.t==='notice'),[]);
  // Bia too, and a new run starts normally; a forged token is still refused.
  const bia=peer();join(restarted,bia,'Bia',t+400,welcome(b).token);assert.equal(welcome(bia).id,welcome(b).id);
  const fake=peer();join(restarted,fake,'Eu',t+400,'not-a-token');assert.equal(fake.closes[0].code,4003);
  combat(restarted,[again,bia],t+500);
  assert.equal(restarted.sim.players.size,2);
  // Restarted outside a run: back in the lobby without any notice.
  const quiet=new Room(1000,4242);quiet.restore({...roster,running:false},t);
  const q=peer();join(quiet,q,'Ana',t+100,welcome(a).token);assert.deepEqual(q.messages.filter(m=>m.t==='notice'),[]);
});

test('roster rows per run stay small (free plan: 100k rows written per day)',()=>{
  let rows=0;
  const room=new Room(1000,undefined,{onRoster:()=>{rows++;}});
  const peers=Array.from({length:6},()=>peer());peers.forEach((p,i)=>join(room,p,`P${i}`,1000));
  let t=combat(room,peers);
  for(const p of room.sim.players.values()){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
  for(let i=0;i<20*35&&room.run.snapshot().phase==='combat';i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'result');
  say(room,peers[0],{t:'rematch',round:1},t);room.advance(t+=50);
  for(const p of peers)say(room,p,{t:'leave'},t);
  // 6 joins + combat start + result + 6 leaves; the rematch's lobby has the same roster as the result.
  assert.ok(rows<=14,`${rows} rows`);
});

test('a restored roster ignores junk and never seats more than six',()=>{
  const room=new Room(1000);
  room.restore({v:1,running:true,players:[
    ...Array.from({length:8},(_,i)=>({id:`p${i}`,name:`P${i}`,classId:'cidadao-comum',token:`t${i}`})),
  ]},1000);
  assert.equal(room.sim.players.size,6);
  const other=new Room(1000);
  other.restore({v:2} as unknown as RoomRoster,1000);other.restore({v:1,running:true,players:[{id:'x',name:'X',classId:'nada',token:'t'}]},1000);
  assert.equal(other.sim.players.size,0);
});
