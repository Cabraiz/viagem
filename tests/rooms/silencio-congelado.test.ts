/**
 * BUG-20261012-ORQ-reconecta-round2: a page frozen in one piece at the round-2 intermission start, at the Room level.
 * Documents today's behaviour, not a target: the room alone never drops an idle phone that keeps the client's upstream
 * rhythm, an 11.5 s freeze survives, a 12.5 s one is cut (4004) at SILENT_MS (12 s) because the slow-phone extension
 * (SLOW_ACKS late acks in a row) is not armed on a first stall, while the client itself tolerates the same stall (a
 * late heartbeat judges silence only past STALLED_DEAD_MS = 24 s). The page then reconnects with its token and keeps
 * its seat and the run: a frozen page costs one quick reconnect, never the run. SILENT_MS stays (billing, VGM-048).
 */
import test from 'node:test';
// client.ts reads localStorage in a try/catch; a plain stub keeps node from warning about --localstorage-file.
// Defined without reading it first: reading node's own localStorage getter is what prints the warning.
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},configurable:true,writable:true});
import assert from 'node:assert/strict';
import {Room,type Peer,SILENT_MS,silenceLimit} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

// CoopClient.beat reads WebSocket.OPEN (node has a WebSocket global; this only covers an older node).
(globalThis as any).WebSocket??={CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3};

/**
 * A room with one idle person (the live-play flow: 3 bots, ready, no stick) driven on a fake 20 Hz clock, with the
 * real client's upstream rhythm: an ack ~1 s after a frame, a ping every 5 s. Returns once the round-2 intermission
 * (round index 2, phase 'prepare') has started, on the tick of the page's next upstream message. Every close log line the room writes lands in `logs`.
 */
function toRound2Intermission(t0:number){
  const logs:any[]=[];
  const room=new Room(t0,7,{log:line=>logs.push(JSON.parse(line))});const closed:{code:number;reason:string;at:number}[]=[];
  let t=t0;
  const messages:any[]=[];
  const peer:Peer={send:d=>{if(typeof d==='string')messages.push(JSON.parse(d));},close:(code,reason)=>{closed.push({code,reason,at:t});}};
  const say=(m:object,p=peer)=>room.receive(p,JSON.stringify(m),t);
  room.connect(peer,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Orquestra',classId:'cidadao-comum'});
  const c=room.connections.get(peer)!;
  const run=()=>room.run.snapshot().round;
  const step=(ms:number,talk=true)=>{const end=t+ms;while(t<end){t+=50;room.advance(t);if(talk)client(t);}};
  let lastAck=t,lastPing=t,lastMsg=t;
  const client=(now:number)=>{
    if(!room.connections.has(peer))return;
    if(now-lastAck>=1000){say({t:'ack',seq:c.encoder!.lastSeq});lastAck=now;lastMsg=now;}
    if(now-lastPing>=5000){say({t:'ping',at:now});lastPing=now;lastMsg=now;}
  };
  for(let i=0;i<3;i++){step(400);say({t:'bot-add',round:run()});}
  step(400);say({t:'ready',ready:true,round:run()});
  const w=room.sim.world;
  let guard=0;
  while(!(room.run.snapshot().phase==='combat'&&w.round.index===2&&w.round.phase==='prepare')){step(50);if(++guard>4000)throw new Error('never reached the round-2 intermission');}
  // Hand over right after the page's last upstream message (<= 1 s later, still early in the ~30 s intermission), so a
  // freeze's silence is the freeze itself (+ one 50 ms tick), not the freeze plus however far the round-1 clear landed
  // from the 1 s ack cadence (that offset moves with the cast and the balance: 100 ms before the new cast, 600 ms after).
  while(t!==lastMsg){step(50);if(++guard>4100)throw new Error('the page never spoke');}
  assert.equal(w.round.index,2);assert.equal(w.round.phase,'prepare');
  return {room,peer,c,closed,logs,messages,get t(){return t;},step,say,lastMsg:()=>lastMsg,
    /** The page freezes: nothing handled, nothing sent; the room keeps ticking and sending frames. */
    freeze:(ms:number)=>step(ms,false)};
}

test('an idle phone with the client rhythm reaches the round-2 intermission and stays through it (no room-side drop)',()=>{
  const s=toRound2Intermission(1_000_000);
  assert.equal(s.closed.length,0,`closed: ${JSON.stringify(s.closed)}`);
  assert.ok(s.t-1_000_000>40_000,'the round-2 intermission starts ~50 s into combat');
  s.step(30_000);
  assert.equal(s.closed.length,0);assert.deepEqual(s.logs,[],'no socket ended, no log line');
});

test('a 12.5 s freeze at the round-2 intermission start (first stall) is cut with 4004 at SILENT_MS, logged once',()=>{
  const s=toRound2Intermission(2_000_000);
  const before=s.lastMsg();
  assert.equal(s.c.lateAcks,0,'no late ack before the first stall: the slow-phone extension is not armed');
  assert.equal(silenceLimit(s.c),SILENT_MS);
  s.freeze(12_500);
  assert.equal(s.closed.length,1,`closes: ${JSON.stringify(s.closed)}`);
  assert.equal(s.closed[0].code,4004);assert.equal(s.closed[0].reason,'Conexão expirada.');
  const after=s.closed[0].at-before;
  assert.ok(after>SILENT_MS&&after<=SILENT_MS+100,`cut ${after} ms after the last message`);
  assert.equal(s.room.connections.size,0);
  // The one log line says the room cut it for silence, and where the run was.
  assert.equal(s.logs.length,1);
  const [line]=s.logs;
  assert.equal(line.ev,'ws-end');assert.equal(line.by,'room');assert.equal(line.code,4004);assert.equal(line.reason,'Conexão expirada.');assert.equal(line.clean,null);
  assert.equal(line.phase,'combat');assert.equal(line.round,2);assert.equal(line.roundPhase,'prepare');
  assert.equal(line.idleMs,after);assert.equal(line.limitMs,SILENT_MS);assert.equal(line.lateAcks,0);assert.equal(line.seated,true);assert.equal(line.conns,1);
  assert.ok(line.ageMs>after&&line.frames>0&&line.bytes>0&&line.received>0,JSON.stringify(line));
});

test('after the 4004 the page reconnects with its token: same seat, no duplicate, the run goes on',()=>{
  const s=toRound2Intermission(2_500_000);
  const {id,token}=s.messages.find(m=>m.t==='welcome');
  const people=s.room.sim.players.size;
  s.freeze(12_500);
  assert.equal(s.closed[0]?.code,4004);
  assert.equal(s.room.sim.players.get(id)?.online,false,'the seat waits (GRACE_MS)');
  // The client's first retry, a moment later, on a fresh socket.
  s.step(150,false);
  const messages:any[]=[],closes:number[]=[];
  const again:Peer={send:d=>{if(typeof d==='string')messages.push(JSON.parse(d));},close:code=>{closes.push(code);}};
  s.room.connect(again,s.t);s.say({t:'join',protocol:ROOM_PROTOCOL,name:'Orquestra',classId:'cidadao-comum',token},again);
  const welcome=messages.find(m=>m.t==='welcome');
  assert.equal(welcome?.id,id,'the same character');assert.deepEqual(closes,[]);
  assert.equal(s.room.sim.players.size,people,'no second seat');assert.equal(s.room.connections.size,1);
  assert.equal(s.room.sim.players.get(id)?.online,true);
  assert.equal(s.room.run.snapshot().phase,'combat','the run was never lost');
  assert.equal(s.room.run.snapshot().members.find(m=>m.id===id)?.spectator,false);
  assert.equal(s.logs.length,1,'one line for the cut socket, none for the new one');
});

test('an 11.5 s freeze survives; its catch-up ack is one late ack, which does not extend the limit (still 12 s)',()=>{
  const s=toRound2Intermission(3_000_000);
  s.freeze(11_500);
  assert.equal(s.closed.length,0);
  // The page wakes: its first handled message triggers the keepalive ack, naming the last frame decoded before the freeze.
  const stale=s.c.encoder!.lastSeq-Math.round(11_500/100);
  s.say({t:'ack',seq:stale});
  assert.ok(s.c.lag>=11_000,`lag ${s.c.lag}`);
  assert.equal(s.c.lateAcks,1);
  assert.equal(silenceLimit(s.c),SILENT_MS,'one late ack: limit unchanged, a second freeze >= 12 s would be cut too');
});

test('the client tolerates the same 13 s stall (late heartbeat, under STALLED_DEAD_MS = 24 s): the asymmetry',async()=>{
  const {CoopClient}=await import('../../src/client/net/client.ts');
  const client=new CoopClient('http://sala','ABCDEF1234','Orquestra','cidadao-comum') as any;
  let closedByClient=false;
  const ws={readyState:1,send:()=>{},close:()=>{closedByClient=true;}};
  const T=100_000;
  client.lastMessage=T;client.beatAt=T;client.pingAt=T;
  client.beat(ws,T+2000);                      // on time, 2 s of silence: fine
  client.beat(ws,T+2000+13_000);               // the page was frozen 13 s: this beat is late, silence not judged
  assert.equal(closedByClient,false,'the client tolerates its own 13 s stall');
  // The room did not (above): 12 s on a first stall (room) against 24 s for a stalled page (client) is the gap.
  assert.ok(SILENT_MS<24_000);
  client.beat(ws,T+2000+13_000+2000);          // the next beat on time, 17 s of silence: now the client closes too
  assert.equal(closedByClient,true);
});
