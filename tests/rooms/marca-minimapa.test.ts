// minimapa-wc3: a minimap ping rides the emote relay as id 'marca' with x,y. The room relays it to everyone (sender
// included) as {t:'emote',player,id:'marca',round,x,y}, once per MARK_COOLDOWN_MS per player, on its own clock (a ping
// never eats an emote's turn); bad points, the lobby and spectators drop. Old clients ignore it (not an emote id).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {MARK_COOLDOWN_MS,MARK_ID,parseMark,relayMark} from '../../src/rules/index.ts';
import {parseEmote} from '../../src/client/fun/emotes.ts';

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const marks=(p:TestPeer)=>p.messages.filter(m=>m.t==='emote'&&m.id===MARK_ID);

test('a ping in a match reaches everyone with its point; floods, bad points and the lobby drop; emotes keep their turn',()=>{
  const t0=Date.now(),room=new Room(t0),a=peer(),b=peer();join(room,a,'Ana',t0);join(room,b,'Bia',t0);
  const ana=a.messages.find(m=>m.t==='welcome').id;
  say(room,a,{t:'emote',round:room.run.snapshot().round,id:MARK_ID,x:3,y:4},t0);
  assert.equal(marks(b).length,0,'not in the lobby');
  let t=t0+100;for(const p of [a,b])say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const round=room.run.snapshot().round;
  say(room,a,{t:'emote',round,id:MARK_ID,x:12.3456,y:-7.891},t);
  assert.deepEqual(marks(b),[{t:'emote',player:ana,id:MARK_ID,round,x:12.35,y:-7.89}]);assert.deepEqual(marks(a),marks(b),'the sender hears it too');
  // Inside the cooldown, without a point, a NaN or a huge point: dropped.
  say(room,a,{t:'emote',round,id:MARK_ID,x:1,y:1},t+MARK_COOLDOWN_MS-1);
  say(room,a,{t:'emote',round,id:MARK_ID},t+5000);say(room,a,{t:'emote',round,id:MARK_ID,x:'1',y:2},t+5000);say(room,a,{t:'emote',round,id:MARK_ID,x:1e9,y:2},t+5000);
  assert.equal(marks(b).length,1);
  // An emote right after a ping still goes (its own clock).
  say(room,a,{t:'emote',round,id:'kkkk'},t+10);
  assert.ok(b.messages.some(m=>m.t==='emote'&&m.id==='kkkk'),'the ping did not eat the emote');
  say(room,a,{t:'emote',round,id:MARK_ID,x:5,y:6},t+MARK_COOLDOWN_MS);
  assert.equal(marks(b).length,2,'after the cooldown');
});

test('both sides tolerate the other: an old client ignores a mark, a plain emote is no mark',()=>{
  const relayed={t:'emote',player:'p1',id:MARK_ID,round:2,x:1.5,y:2};
  assert.equal(parseEmote(relayed),null,'an old client (emote ids only) drops it');
  assert.deepEqual(parseMark(relayed),{player:'p1',x:1.5,y:2});
  assert.equal(parseMark({t:'emote',player:'p1',id:'vem',round:2}),null);
  assert.equal(parseMark({t:'emote',player:'p1',id:MARK_ID,round:2}),null,'an old room would never relay it; a pointless one is nothing');
  assert.equal(relayMark({x:Infinity,y:0}),null);assert.deepEqual(relayMark({x:-1.005,y:3}),{x:-1,y:3});
});
