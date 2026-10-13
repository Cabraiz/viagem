// emote-relay-sala: the room relays {t:'emote',round,id} to everyone (sender included) as {t:'emote',player,id,round},
// in a match only, once per EMOTE_COOLDOWN_MS − EMOTE_SLACK_MS per player; spectators, unknown ids and stale rounds drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {EMOTE_COOLDOWN_MS,EMOTE_SLACK_MS,EMOTE_IDS} from '../../src/rules/index.ts';
import {EMOTES} from '../../src/client/fun/emotes.ts';

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const emotes=(p:TestPeer)=>p.messages.filter(m=>m.t==='emote');

test('the client catalog and the shared ids are the same four emotes',()=>{
  assert.deepEqual(EMOTES.map(e=>e.id),[...EMOTE_IDS]);
});

test('an emote in a match reaches everyone, the sender too; floods, unknown ids, stale rounds and the lobby are dropped',()=>{
  const t0=Date.now(),room=new Room(t0),a=peer(),b=peer();join(room,a,'Ana',t0);join(room,b,'Bia',t0);
  const ana=a.messages.find(m=>m.t==='welcome').id;
  // Lobby: nothing.
  say(room,a,{t:'emote',round:room.run.snapshot().round,id:'kkkk'},t0);
  assert.equal(emotes(b).length,0,'not in the lobby');
  let t=t0+100;for(const p of [a,b])say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const round=room.run.snapshot().round;
  say(room,a,{t:'emote',round,id:'kkkk'},t);
  assert.deepEqual(emotes(b),[{t:'emote',player:ana,id:'kkkk',round}]);assert.deepEqual(emotes(a),emotes(b),'the sender hears its confirmation');
  // Flood inside the gate, unknown id, stale round: dropped.
  say(room,a,{t:'emote',round,id:'vem'},t+EMOTE_COOLDOWN_MS-EMOTE_SLACK_MS-1);
  say(room,a,{t:'emote',round,id:'xingar'},t+5000);say(room,a,{t:'emote',round:round-1,id:'vem'},t+5000);
  assert.equal(emotes(b).length,1);
  // Two honest taps 2 s apart arrive closer (network jitter): still relayed.
  say(room,a,{t:'emote',round,id:'foimal'},t+EMOTE_COOLDOWN_MS-EMOTE_SLACK_MS);
  assert.deepEqual(emotes(b).at(-1),{t:'emote',player:ana,id:'foimal',round});
  // Each player has their own gate.
  say(room,b,{t:'emote',round,id:'vem'},t+1);
  assert.equal(emotes(a).at(-1).id,'vem');
  // A spectator (joined mid-run) watches.
  const c=peer();join(room,c,'Caio',t+10);say(room,c,{t:'emote',round,id:'kkkk'},t+10);
  assert.ok(!emotes(a).some(m=>m.player===c.messages.find(x=>x.t==='welcome').id),'a spectator is not relayed');
});
