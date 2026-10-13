// 3g-rede-sem-teleporte: the room holds a dropped person's seat for the whole run while someone plays, and its light
// bot plays the hero meanwhile; an empty room keeps the grace rule (it does not tick for nobody).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL,GRACE_MS} from '../../src/protocol/room.ts';

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

test('a dropped hero plays on its own (walks, keeps its offers and its ack), and is the person again once back',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ana=welcome(a),hero=room.sim.players.get(ana.id)!;
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  // Bia walks off so the autopilot has someone to follow.
  const bia=room.sim.players.get(welcome(b).id)!,ack=hero.ack;
  room.disconnect(a,t);
  assert.ok(room.sim.autopilot.has(ana.id));assert.ok(room.autopilots.has(ana.id));
  assert.equal(room.bots.size,0,'not a room bot: not in the roster, never removed for a newcomer');
  const start={x:hero.x,y:hero.y};
  for(let i=0;i<400;i++){
    if(i%20===0)say(room,b,{t:'input',round:1,seq:bia.ack+1,steps:[[bia.ack+1,1,0,0]]},t);
    room.advance(t+=50);
  }
  assert.ok(Math.hypot(hero.x-start.x,hero.y-start.y)>1,'the hero moved while away');
  assert.equal(hero.ack,ack,'the room\'s inputs never move the person\'s ack');
  assert.equal(room.sim.offers(ana.id).length,1,'the level-up pick waits for the person');
  const back=peer();join(room,back,'Ana',t,ana.token);
  assert.equal(welcome(back).id,ana.id);
  assert.equal(room.sim.autopilot.has(ana.id),false);assert.equal(room.autopilots.has(ana.id),false);
});

test('the seat is held for the whole run while someone plays: back 30 s past the grace, same character',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ana=welcome(a);
  // Bia cannot fall (the run must not end by itself): what is checked is the seat.
  for(const p of room.sim.players.values())p.invulnerableUntil=Number.MAX_SAFE_INTEGER;
  room.disconnect(a,t);
  for(const end=t+GRACE_MS+30_000;t<end;t+=50){if(t%1000===0)say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  assert.equal(room.run.snapshot().phase,'combat');
  const back=peer();join(room,back,'Ana',t,ana.token);
  assert.equal(welcome(back).id,ana.id);assert.equal(back.closes.length,0);
});

test('an empty room keeps the grace rule: everybody away past GRACE_MS frees the seats and ends the run',()=>{
  const room=new Room(1000),a=peer();join(room,a,'Ana',1000);
  let t=combat(room,[a]);
  const ana=welcome(a);
  room.disconnect(a,t);
  for(const end=t+GRACE_MS+1000;t<end;t+=50)room.advance(t);
  assert.notEqual(room.run.snapshot().phase,'combat');
  const late=peer();join(room,late,'Ana',t,ana.token);
  assert.equal(late.closes[0]?.code,4003);
});

test('a person who never came back is not held into the rematch: the seat frees GRACE_MS after their run, the owner moves on',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ana=welcome(a),bia=welcome(b);
  room.disconnect(a,t);
  // Bia ends the run quickly (the lab's team down), then rematches over and over.
  const run=room.run.snapshot().round;
  room.run.finish('defeat',room.sim.shameMoment());
  for(let i=0;i<4;i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'result');
  say(room,b,{t:'rematch',round:run},t);
  for(let i=0;i<10&&room.run.snapshot().phase!=='lobby';i++)room.advance(t+=50);
  say(room,b,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<600&&room.run.snapshot().phase!=='combat';i++,t+=50){if(t%1000===0)say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  for(const p of room.sim.players.values())p.invulnerableUntil=Number.MAX_SAFE_INTEGER;
  // Held through the countdown at most (she is still a member then), never into the new run's combat (a spectator of it).
  for(const end=t+GRACE_MS+20_000;t<end;t+=50){if(t%1000===0)say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  assert.equal(room.run.snapshot().phase,'combat');
  const late=peer();join(room,late,'Ana',t,ana.token);
  assert.equal(late.closes[0]?.code,4003,'Ana is not held by the new run (she is not one of its players)');
  assert.equal(room.roster().owner??bia.id,bia.id);
});
