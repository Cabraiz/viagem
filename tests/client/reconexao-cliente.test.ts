// VGM-047 / input-10hz on the real CoopClient: an in-memory socket bridges it to a real Room (no network, fake clock).
import test,{mock,after} from 'node:test';
import assert from 'node:assert/strict';
import {Room,CHECKPOINT_FROM_ROUND,type Peer,type RoomCheckpoint,type RoomRoster} from '../../multiplayer/room.ts';
import {REPLACED_MESSAGE} from '../../src/protocol/room.ts';

const store=new Map<string,string>();
// The seat token lives in localStorage (all tabs of the device: F5 volta pra sala); sessionStorage is the legacy read.
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
Object.defineProperty(globalThis,'localStorage',{value:(globalThis as any).sessionStorage,configurable:true});
/** The network: which room answers, and whether new connections fail (phone without signal). */
const net={room:undefined as Room|undefined,down:false,opened:0,sent:[] as {at:number;t:string}[]};
class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='blob';
  /** The link went quiet with the socket still open (3G outage): nothing reaches the client, nothing closes. */
  deaf=false;
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  readonly peer:Peer;
  constructor(_url:unknown){
    net.opened++;
    this.peer={send:d=>{const data=typeof d==='string'?d:d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength);setTimeout(()=>{if(this.readyState===1&&!this.deaf)this.onmessage?.({data});},0);},
      close:code=>{if(this.readyState===3)return;this.readyState=3;setTimeout(()=>this.onclose?.({code}),0);}};
    setTimeout(()=>{
      if(net.down||!net.room){this.readyState=3;this.onclose?.({code:1006});return;}
      this.readyState=1;net.room.connect(this.peer,Date.now());this.onopen?.();
    },0);
  }
  send(data:string){
    if(this.readyState!==1)throw new Error('not open');
    let t='?';try{t=JSON.parse(data).t;}catch{}
    net.sent.push({at:Date.now(),t});
    net.room?.receive(this.peer,data,Date.now());
  }
  close(code=1000){if(this.readyState===3)return;this.readyState=3;net.room?.disconnect(this.peer,Date.now());setTimeout(()=>this.onclose?.({code}),0);}
  /** The link dies without the room noticing (a phone that changed networks): only this end sees a close. */
  vanish(){this.readyState=3;setTimeout(()=>this.onclose?.({code:1006}),0);}
}
(globalThis as any).WebSocket=FakeSocket;
/**
 * A fake clock instead of real time (the file took ~40 s): setTimeout, setInterval and Date are node:test's mocks, and
 * performance.now follows the same clock. Time flows on its own, like the real one, in 5 ms steps between macrotasks
 * (setImmediate stays real, so every step lets promises settle): the client's backoff, join, heartbeat and ack timers,
 * the room's 50 ms tick and the tests' sleeps all run on it, at a fraction of the wall time.
 */
const CLOCK_START=Date.parse('2026-10-12T12:00:00.000Z'),CLOCK_STEP=5;
mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:CLOCK_START});
// A page that has been open for 10 s when the tests start (performance.now never starts at 0 in a real tab).
Object.defineProperty(performance,'now',{configurable:true,writable:true,value:()=>Date.now()-CLOCK_START+10_000});
let clock:ReturnType<typeof setImmediate>|undefined;
const flow=()=>{mock.timers.tick(CLOCK_STEP);clock=setImmediate(flow);};
clock=setImmediate(flow);
after(()=>{clearImmediate(clock);mock.timers.reset();});
const {CoopClient}=await import('../../src/client/net/client.ts');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
/** The Durable Object's 50 ms timer. */
function ticking(room:Room){const timer=setInterval(()=>room.advance(Date.now()),50);return ()=>clearInterval(timer);}
const sockets=(c:InstanceType<typeof CoopClient>)=>(c as any).socket as FakeSocket;
/** Clients of the running test, left in `finally` (a failed assert must not leave timers keeping node alive). */
const clients:InstanceType<typeof CoopClient>[]=[];
// D-053: playable classes only (a hidden one would be seated as the first playable anyway).
const client=(name='Ana',classId='clt-cansado')=>{const c=new CoopClient('http://sala','ABCDEF1234',name,classId);clients.push(c);return c;};
const cleanup=()=>{for(const c of clients.splice(0))c.leave();};

test('client: the old socket still open on the room, the phone reconnects with its token and keeps the character',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    const id=ana.id,first=sockets(ana);
    // Network switch: the phone's socket dies, the room still holds it; no signal for 1.5 s.
    net.down=true;first.vanish();await sleep(1500);net.down=false;
    for(let i=0;i<80&&!ana.connected;i++)await sleep(50);
    assert.equal(ana.connected,true);assert.equal(ana.id,id);assert.equal(ana.fatal,undefined);
    assert.equal(net.room.sim.players.size,1);assert.equal(net.room.sim.players.get(id)!.online,true);
    assert.equal(net.room.connections.size,1,'the dead socket was replaced, not kept beside');
    ana.leave();
  }finally{stop();cleanup();}
});

test('client: a second tab with the same token takes over, the first stops with the message and never bounces back',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const one=client();await one.join();
    // A second tab on the same device reads the seat from localStorage: same token.
    const two=client();await two.join();
    assert.equal(two.id,one.id);
    const opened=net.opened;await sleep(2500);
    assert.equal(one.fatal,REPLACED_MESSAGE);assert.equal(one.connected,false);
    assert.equal(two.connected,true);assert.equal(two.fatal,undefined);
    assert.equal(net.opened,opened,'no reconnection attempt from the replaced tab: no ping-pong');
    assert.ok(store.get('viagem:room:ABCDEF1234'),'the token is kept, so "Atualizar" can take the character back');
    two.leave();one.leave();
  }finally{stop();cleanup();}
});

test('client: after a restart of the room in round 1 (no checkpoint yet) the player is seated again and the waiting room carries the notice',async()=>{
  store.clear();const created=Date.now();net.room=new Room(created,4242);net.down=false;let stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    assert.equal(ana.run?.phase,'combat');
    // Deploy: the object goes away with its sockets; a new one comes up from the stored roster.
    const roster=net.room.roster();stop();
    net.down=true;sockets(ana).vanish();
    for(let i=0;i<40&&ana.connected;i++)await sleep(10);
    assert.equal(ana.connected,false);
    net.room=new Room(created,4242);net.room.restore(roster);stop=ticking(net.room);net.down=false;
    for(let i=0;i<80&&!ana.connected;i++)await sleep(50);
    await sleep(100);
    assert.equal(ana.connected,true);assert.equal(ana.run?.phase,'lobby');assert.match(ana.roomNotice?.title??'',/A sala caiu e voltou/);assert.match(ana.roomNotice?.body??'',/Tô pronto/);
    ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    assert.equal(ana.run?.phase,'combat');assert.equal(ana.roomNotice,undefined,'gone once the next run starts');
    ana.leave();
  }finally{stop();cleanup();}
});

test('client: after a restart of the room mid-run the player is back in combat at the start of the round, the news shown over the match',async()=>{
  store.clear();const created=Date.now();net.down=false;
  let roster:RoomRoster|undefined,checkpoint:RoomCheckpoint|undefined;
  const first=new Room(created,4242,{onRoster:r=>{roster=JSON.parse(JSON.stringify(r));},onCheckpoint:c=>{checkpoint=JSON.parse(JSON.stringify(c));}});
  net.room=first;let stop=ticking(first);
  try{
    const ana=client();await ana.join();
    // Two bots carry the round while the phone is away (the owner adds them in the lobby).
    ana.addBot();await sleep(400);ana.addBot();await sleep(400);
    ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    assert.equal(ana.run?.phase,'combat');
    // The phone loses the network; the room plays on (Ana's hero on autopilot) into the round-2 intermission. Driven
    // here tick by tick, ahead of the page's clock, so the test does not wait the ~50 s of round 1.
    stop();net.down=true;sockets(ana).vanish();
    for(let i=0;i<40&&ana.connected;i++)await sleep(10);
    const w=first.sim.world;let t=Date.now();
    for(let i=0;i<20*180&&!(w.round.index===CHECKPOINT_FROM_ROUND&&w.round.phase==='prepare');i++)first.advance(t+=50);
    assert.equal(first.run.snapshot().phase,'combat');assert.equal(checkpoint?.round,CHECKPOINT_FROM_ROUND);assert.deepEqual(roster?.checkpoint,{round:checkpoint!.round,tick:checkpoint!.tick,run:checkpoint!.run.round});
    // Deploy: a new object from the stored roster and checkpoint; the phone's network comes back.
    const next=new Room(created,4242);next.restore(roster!);assert.equal(next.resume(checkpoint),true);
    const shown:string[]=[];ana.onResumed=news=>shown.push(news.title);
    net.room=next;stop=ticking(next);net.down=false;
    for(let i=0;i<80&&!ana.connected;i++)await sleep(50);
    await sleep(100);
    assert.equal(ana.connected,true);assert.equal(ana.run?.phase,'combat');assert.equal(ana.roomNotice,undefined,'no lobby news');
    assert.match(ana.resumedNotice?.title??'',/recomeçando a rodada 2/);assert.match(ana.resumedNotice?.body??'',/armas/);
    assert.deepEqual(shown,[ana.resumedNotice!.title],'the match is told once (its row in the HUD slot)');
    // It stays over the match (combat does not clear it, unlike the lobby's).
    await sleep(500);assert.equal(ana.run?.phase,'combat');assert.ok(ana.resumedNotice);
    ana.leave();
  }finally{stop();cleanup();}
});

test('client: walking sends at most 10 input messages per second, standing still none; acks at most once a second',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    ana.ready(true);for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    const p=net.room.sim.players.get(ana.id)!,start={x:p.x,y:p.y};
    // The scene's fixed step, stick spinning fast (a change almost every step).
    let t0=Date.now();net.sent.length=0;
    while(Date.now()-t0<2000){ana.input({x:Math.cos(Date.now()/400),y:Math.sin(Date.now()/400)},false);await sleep(50);}
    const walking=net.sent.filter(s=>s.t==='input').length/((Date.now()-t0)/1000);
    assert.ok(walking<=10.5,`${walking.toFixed(1)} inputs/s`);assert.ok(walking>=3);
    assert.ok(Math.hypot(p.x-start.x,p.y-start.y)>.5,'the room walked');
    t0=Date.now();net.sent.length=0;
    while(Date.now()-t0<3000){ana.input({x:0,y:0},false);await sleep(50);}
    const still=net.sent.filter(s=>s.t==='input').length,acks=net.sent.filter(s=>s.t==='ack').length;
    assert.ok(still<=1,`${still} inputs standing still (the stop itself)`);
    assert.ok(acks<=4,`${acks} acks in 3 s`);
    ana.leave();
  }finally{stop();cleanup();}
});

test('client: a skill tap goes at once as {t:cast} and the room answers whether it went off',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    const answers:{seq:number;ok:boolean}[]=[];ana.onCast=r=>answers.push(r);
    net.sent.length=0;const first=ana.cast()!,second=ana.cast()!;
    assert.deepEqual(net.sent.map(s=>s.t),['cast','cast'],'sent at once, not waiting for the 10 Hz slot');
    for(let i=0;i<40&&answers.length<2;i++)await sleep(50);
    assert.deepEqual(answers.map(a=>[a.seq,a.ok]),[[first,true],[second,false]],'the second tap lands on the cooldown');
  }finally{stop();cleanup();}
});

test('client: offline time for the slow-link line, and "Tentar de novo" tries at once',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();assert.equal(ana.offlineMs(),0);
    net.down=true;sockets(ana).vanish();
    for(let i=0;i<40&&ana.connected;i++)await sleep(10);
    await sleep(1200);
    assert.ok(ana.offlineMs()>=1000,`${ana.offlineMs()} ms offline`);
    net.down=false;const opened=net.opened;ana.retryNow();
    for(let i=0;i<40&&!ana.connected;i++)await sleep(25);
    assert.equal(ana.connected,true);assert.ok(net.opened>opened);assert.equal(ana.offlineMs(),0);
  }finally{stop();cleanup();}
});

test('N27 client: timers starved (slow phone), the message handler keeps the seat with an ack every KEEPALIVE_MS',async()=>{
  const {KEEPALIVE_MS}=await import('../../src/client/net/client.ts');
  store.clear();net.room=new Room(Date.now());net.down=false;net.sent=[];const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    const socket=sockets(ana);
    // CPU 6× in the lab: the heartbeat and the 1 s ack timer come 20 s late. Here they never come.
    clearInterval((ana as any).heartbeat);(ana as any).flushAck=()=>{};
    const from=Date.now();
    await sleep(13_500);
    assert.equal(sockets(ana),socket,'same socket: the room never cut it (12 s of silence would)');
    assert.equal(net.room.connections.size,1);
    const acks=net.sent.filter(s=>s.at>from&&s.t==='ack').map(s=>s.at-from);
    assert.ok(acks.length>=3&&acks.length<=4,`acks at ${acks}`);
    for(let i=1;i<acks.length;i++)assert.ok(acks[i]-acks[i-1]>=KEEPALIVE_MS-5&&acks[i]-acks[i-1]<KEEPALIVE_MS+400,`gaps ${acks}`);
  }finally{stop();cleanup();}
});

test('N27 client: a late heartbeat does not judge the silence, the next one on time does; a page late beat after beat still does past 24 s',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;
  const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    const socket=sockets(ana);const beat=(now:number)=>(ana as any).beat(socket,now);
    // The link goes deaf (nothing from the room reaches the page, pongs included); the beats are driven by hand.
    stop();(socket.peer as {send:Peer['send']}).send=()=>{};await sleep(100);clearInterval((ana as any).heartbeat);
    const t=performance.now();
    (ana as any).lastMessage=t-9000;(ana as any).beatAt=t-10_000;
    beat(t);assert.equal(socket.readyState,1,'a late beat: the page was stalled, messages may still be queued');
    beat(t+2000);assert.equal(socket.readyState,3,'the next beat on time: 11 s of silence, dead');
    // A page stalled beat after beat (every beat 5 s late): dead once the silence passes 24 s.
    const bob=client('Bob');await bob.join();const s2=sockets(bob);clearInterval((bob as any).heartbeat);
    (s2.peer as {send:Peer['send']}).send=()=>{};await sleep(50);
    const t2=performance.now();(bob as any).lastMessage=t2;(bob as any).beatAt=t2;
    for(let i=1;i<=4;i++){(bob as any).beat(s2,t2+i*5000);assert.equal(s2.readyState,1,`late beat ${i}: ${i*5} s`);}
    (bob as any).beat(s2,t2+25_000);assert.equal(s2.readyState,3,'25 s of silence: dead even though every beat was late');
  }finally{stop();cleanup();}
});

test('reconecta-round2: the banner helper and the retry schedule (150 ms first once joined, then 1, 2, 2 s)',async()=>{
  const {reconnectBanner,retryDelay,RECONNECT_BANNER_MS,FIRST_RETRY_MS}=await import('../../src/client/net/client.ts');
  assert.equal(RECONNECT_BANNER_MS,1500);assert.equal(FIRST_RETRY_MS,150);
  const at=(offline:number,extra:{connected?:boolean;fatal?:string}={})=>reconnectBanner({connected:false,...extra,offlineMs:()=>offline});
  assert.equal(at(0),false);assert.equal(at(1499),false);assert.equal(at(1500),true);assert.equal(at(30_000),true);
  assert.equal(at(5000,{connected:true}),false);assert.equal(at(5000,{fatal:'Conexão indisponível.'}),false,'terminal: the fatal window, not the banner');
  assert.deepEqual([0,1,2,3,4,5].map(n=>retryDelay(n,true)),[150,1000,2000,2000,2000,2000]);
  assert.deepEqual([0,1,2,3].map(n=>retryDelay(n,true,true)),[150,1000,1000,1000],'in a match, the first 10 s offline: 1 s cap (3g-socket-morto)');
  assert.deepEqual([0,1].map(n=>retryDelay(n,false)),[500,1000],'before joining the lobby keeps its pace');
});

test('reconecta-round2: an edge drop (1006) mid-combat reconnects to the same seat in under 1.5 s and the banner never shows',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    assert.equal(ana.run?.phase,'combat');
    const id=ana.id,old=sockets(ana);
    // Cloudflare edge drop: the page sees 1006, the room still holds the old socket, the network is fine.
    const from=Date.now();old.vanish();
    let banner=false;
    while(Date.now()-from<1500&&!(ana.connected&&sockets(ana)!==old)){banner||=ana.showReconnecting();await sleep(10);}
    const took=Date.now()-from;
    assert.equal(ana.connected,true,`still down after ${took} ms`);assert.notEqual(sockets(ana),old);
    assert.ok(took<1000,`back in ${took} ms (first retry at 150 ms)`);
    assert.equal(banner,false,'the center banner never showed');assert.equal(ana.showReconnecting(),false);
    assert.equal(ana.id,id);assert.equal(ana.fatal,undefined);
    assert.equal(net.room.sim.players.size,1,'same seat, no duplicate');assert.equal(net.room.connections.size,1);
    for(let i=0;i<40&&ana.run?.phase!=='combat';i++)await sleep(25);
    assert.equal(ana.run?.phase,'combat','the run goes on');
  }finally{stop();cleanup();}
});

test('reconecta-round2: a long outage (network down 3 s) shows the banner after 1.5 s and clears it once back',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    net.down=true;sockets(ana).vanish();
    for(let i=0;i<40&&ana.connected;i++)await sleep(10);
    assert.equal(ana.connected,false);
    const samples:{offline:number;banner:boolean}[]=[];
    const from=Date.now();
    while(Date.now()-from<3000){const now=Date.now();samples.push({offline:ana.offlineMs(now),banner:ana.showReconnecting(now)});await sleep(20);}
    assert.ok(samples.every(s=>s.banner===s.offline>=1500),'banner exactly from 1.5 s offline');
    assert.ok(samples.some(s=>s.banner),'shown during the long outage');assert.ok(samples.some(s=>!s.banner),'not at the start');
    net.down=false;
    for(let i=0;i<120&&!ana.connected;i++)await sleep(50);
    assert.equal(ana.connected,true);assert.equal(ana.showReconnecting(),false);assert.equal(ana.fatal,undefined);
  }finally{stop();cleanup();}
});

test('reconecta-round2: terminal ends (replaced by another tab, gave up) show their window, never the banner',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const one=client();await one.join();
    const two=client();await two.join();
    for(let i=0;i<40&&!one.fatal;i++)await sleep(25);
    assert.equal(one.fatal,REPLACED_MESSAGE);assert.equal(one.showReconnecting(Date.now()+60_000),false);
    // Past the reconnection window (nothing heard for GRACE_MS + 10 s): stops for good.
    store.clear();net.room=new Room(Date.now());
    const ana=client();await ana.join();
    (ana as any).lastSeenAt=0;net.down=true;sockets(ana).vanish();
    for(let i=0;i<40&&!ana.fatal;i++)await sleep(10);
    assert.match(ana.fatal??'',/Conexão indisponível/);assert.equal(ana.showReconnecting(Date.now()+60_000),false);
  }finally{stop();net.down=false;cleanup();}
});

test('3g-rede-sem-teleporte: a 3-minute drop mid-match (past the grace) with a friend still in: the client keeps knocking and takes the same seat back; the hero played on its own meanwhile',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    // Two phones: each its own localStorage (the shared fake one is cleared so Bia does not take Ana's token).
    // Ana plays on her own for 3 minutes: a frontline class (maromba) outlasts it, as the old default did.
    const ana=client('Ana','maromba'),bia=client('Bia');await ana.join();store.clear();await bia.join();
    ana.ready(true);bia.ready(true);
    for(let i=0;i<160&&ana.run?.phase!=='combat';i++)await sleep(50);
    assert.equal(ana.run?.phase,'combat');
    const id=ana.id,room=net.room,hero=room.sim.players.get(id)!;
    // Ana's phone loses the network for 3 minutes (the room sees the socket close); Bia stays.
    net.down=true;sockets(ana).close(1006);
    await sleep(2000);
    assert.equal(hero.online,false);assert.ok(room.sim.autopilot.has(id),'the room plays Ana meanwhile');
    const away={x:hero.x,y:hero.y};
    await sleep(178_000);
    assert.ok(Math.hypot(hero.x-away.x,hero.y-away.y)>.5||hero.hp<=0,'the hero was not a statue');
    assert.equal(ana.fatal,undefined,'still knocking past the grace');
    net.down=false;
    for(let i=0;i<200&&!ana.connected;i++)await sleep(50);
    assert.equal(ana.connected,true);assert.equal(ana.id,id,'the same seat');
    assert.equal(room.sim.autopilot.has(id),false,'back: her own thumb again');
    assert.ok(JSON.parse(store.get('viagem:room:ABCDEF1234')!).until>Date.now()+20*60_000,'the saved token lasts the run (a reload keeps the seat)');
  }finally{stop();cleanup();}
});

test('3g-socket-morto: a socket gone quiet (no close) on a steady link is called dead in 3-5 s, not 8-10',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();ana.ready(true);
    for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
    await sleep(3000);
    assert.equal(ana.silenceLimit(),3000,'a steady link: the floor');
    const quiet=sockets(ana),opened=net.opened,t0=Date.now();
    quiet.deaf=true;
    for(let i=0;i<200&&net.opened===opened;i++)await sleep(50);
    const called=Date.now()-t0;
    assert.ok(net.opened>opened,'a new connection was opened');
    assert.ok(called>=3000&&called<=5500,`dead after ${called} ms`);
    for(let i=0;i<80&&!ana.connected;i++)await sleep(50);
    assert.equal(ana.connected,true);assert.equal(ana.fatal,undefined);
  }finally{stop();cleanup();}
});

test('3g-socket-morto review: a 3.5 s long task (a beat 1.5 s late, not "stalled") is not called dead; real silence on top still is',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;
  const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    const socket=sockets(ana);const beat=(now:number)=>(ana as any).beat(socket,now);
    stop();(socket.peer as {send:Peer['send']}).send=()=>{};await sleep(100);clearInterval((ana as any).heartbeat);
    const t=performance.now();
    // The last message came right before a 3.5 s task; the beat due at +2 s runs at +3.5 s, before the queued messages.
    (ana as any).lastMessage=t-3500;(ana as any).beatAt=t-3500;
    beat(t);assert.equal(socket.readyState,1,'3.5 s of silence, 1.5 s of it the page itself: not dead');
    beat(t+2000);assert.equal(socket.readyState,3,'the next beat on time: 5.5 s of silence on a 3 s link, dead');
  }finally{stop();cleanup();}
});

test('3g-socket-morto review: the network coming back (online) never closes a socket still waiting for its welcome',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client();await ana.join();
    // The previous socket's last message is old; a new socket is open and has sent its join, no welcome yet.
    (ana as any).connected=false;(ana as any).lastMessage=performance.now()-10_000;
    (ana as any).resume();
    assert.notEqual(sockets(ana).readyState,3,'a socket that has not joined yet is not judged by the old silence');
    (ana as any).connected=true;
  }finally{stop();cleanup();}
});

test('emote-relay-sala: an emote from one phone reaches the other (and comes back to the sender) through the room',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=client('Ana');await ana.join();store.clear();const bia=client('Bia');await bia.join();
    ana.ready(true);bia.ready(true);
    for(let i=0;i<160&&ana.run?.phase!=='combat';i++)await sleep(50);
    const seenByBia:{player:string;id:string}[]=[],seenByAna:{player:string;id:string}[]=[];
    bia.onEmote=note=>seenByBia.push(note);ana.onEmote=note=>seenByAna.push(note);
    assert.equal(ana.emote('kkkk'),true);
    for(let i=0;i<40&&!seenByBia.length;i++)await sleep(20);
    assert.deepEqual(seenByBia,[{player:ana.id,id:'kkkk'}]);assert.deepEqual(seenByAna,[{player:ana.id,id:'kkkk'}]);
  }finally{stop();cleanup();}
});

// F5 volta pra sala (auditoria multijogador 29/10, achados 1 e 2). The page goes away without a word (F5, the phone's
// browser throwing the tab away): no leave message, the socket just closes, the page's timers are gone with it.
const pageGone=(c:InstanceType<typeof CoopClient>)=>{(c as any).stopped=true;clearInterval((c as any).heartbeat);clearTimeout((c as any).retry);sockets(c).close(1001);};
/** Ana and Bia in the room, Ana's token the one this device keeps (Bia joined from another phone). */
async function twoInRoom(){
  // Her phone keeps its own storage: the fake one is shared, so her saves (each heartbeat) stay out of it.
  const bia=client('Bia');await bia.join();(bia as any).saveToken=()=>{};store.clear();
  const ana=client('Ana','maromba');await ana.join();
  return {ana,bia};
}
async function untilPhase(c:InstanceType<typeof CoopClient>,phase:string){for(let i=0;i<200&&c.run?.phase!==phase;i++)await sleep(50);assert.equal(c.run?.phase,phase);}

test('f5-volta-pra-sala: F5 in the waiting room: the reloaded page joins with the device\'s token and gets the same seat',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const {ana}=await twoInRoom();const id=ana.id;
    pageGone(ana);await sleep(300);
    const again=client('Ana','maromba');await again.join();
    assert.equal(again.id,id,'the same seat');assert.equal(net.room.sim.players.size,2,'no third player');
    assert.equal(net.room.sim.players.get(id)!.online,true);
  }finally{stop();cleanup();}
});

test('f5-volta-pra-sala: F5 in the countdown and in combat: back to the same seat, the run goes on',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const {ana,bia}=await twoInRoom();const id=ana.id;
    ana.ready(true);bia.ready(true);await untilPhase(ana,'countdown');
    pageGone(ana);await sleep(200);
    const second=client('Ana','maromba');await second.join();
    // The drop cancelled the start (run.ts, LOBBY_AWAY_TICKS): back in the seat, ready again, and the run starts.
    assert.equal(second.id,id,'countdown: the same seat');assert.equal(net.room.sim.players.size,2,'no third player');
    second.ready(true);await untilPhase(second,'combat');
    pageGone(second);await sleep(1500);
    const room=net.room;assert.equal(room.sim.players.get(id)!.online,false,'the room saw the page go');
    const third=client('Ana','maromba');await third.join();
    assert.equal(third.id,id,'combat: the same seat');assert.equal(third.run?.phase,'combat','playing, not spectating');
    assert.equal(room.sim.players.get(id)!.online,true);assert.equal(room.sim.autopilot.has(id),false,'her own thumb again');
  }finally{stop();cleanup();}
});

test('f5-volta-pra-sala: tab closed in combat, the link opened again a minute later: the same seat',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const {ana,bia}=await twoInRoom();const id=ana.id;
    ana.ready(true);bia.ready(true);await untilPhase(ana,'combat');
    pageGone(ana);await sleep(60_000);
    const back=client('Ana','maromba');await back.join();
    assert.equal(back.id,id);assert.equal(back.run?.phase,'combat');
  }finally{stop();cleanup();}
});

test('f5-volta-pra-sala: the replaced tab leaving keeps the seat token (the newer tab plays on it); the newer one leaving forgets it',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const one=client();await one.join();
    const two=client();await two.join();await sleep(2500);
    assert.equal(one.fatal,REPLACED_MESSAGE);
    one.leave();
    assert.ok(store.get('viagem:room:ABCDEF1234'),'"Voltar" on the old tab does not cost the new one its reload');
    two.leave();
    assert.equal(store.get('viagem:room:ABCDEF1234'),undefined,'left on purpose: a reload opens the menu, not the room');
  }finally{stop();cleanup();}
});

test('f5-volta-pra-sala: the address carries the room from the welcome until the player leaves',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  const page={href:'http://jogo/?ux=1',search:'?ux=1'};const calls:string[]=[];
  const g=globalThis as any;
  g.location=page;g.history={state:null,replaceState:(_d:unknown,_u:string,url:string)=>{calls.push(url);page.href=url;page.search=new URL(url).search;}};
  try{
    const ana=client();await ana.join();
    assert.equal(page.href,'http://jogo/?ux=1&sala=ABCDEF1234','welcome: ?sala= in the address, no new history entry');
    ana.leave();
    assert.equal(page.href,'http://jogo/?ux=1','left: the room is gone from the address');
    assert.equal(calls.length,2);
  }finally{delete g.location;delete g.history;stop();cleanup();}
});

/** A full frame (base 0) cut short after its header: what a 3G stall can hand the page; it never decodes. */
const brokenFull=()=>new Uint8Array([0x56,41,0xff,0xff,0xff,0x7f,0,1,0,0]).buffer;
async function inCombat(){
  const ana=client();await ana.join();ana.ready(true);
  for(let i=0;i<120&&ana.run?.phase!=='combat';i++)await sleep(50);
  assert.equal(ana.run?.phase,'combat');
  return ana;
}

test('nao-e-versao-nova: full frames that never decode after a stall renew the link (same seat, playing), never "Saiu versão nova"',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  const {UPDATE_NEEDED}=await import('../../src/protocol/room.ts');
  try{
    const ana=await inCombat();const id=ana.id;
    for(let round=0;round<3;round++){
      const old=sockets(ana),from=Date.now();
      for(let i=0;i<3;i++)old.onmessage?.({data:brokenFull()});
      while(Date.now()-from<5000&&!(ana.connected&&sockets(ana)!==old))await sleep(10);
      assert.notEqual(sockets(ana),old,`round ${round}: a fresh socket`);
      assert.equal(ana.fatal,undefined,`round ${round}: not terminal`);assert.notEqual(ana.fatal,UPDATE_NEEDED);
      for(let i=0;i<100&&ana.run?.phase!=='combat';i++)await sleep(25);
      assert.ok(Date.now()-from<5000,`round ${round}: back playing in ${Date.now()-from} ms`);
      assert.equal(ana.id,id,'the same seat');assert.equal(ana.run?.phase,'combat');
      await sleep(300);
    }
    assert.equal(net.room.sim.players.size,1,'no duplicate');
  }finally{stop();cleanup();}
});

test('nao-e-versao-nova: one or two bad full frames only ask a resync; the socket stays',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=await inCombat();const old=sockets(ana);
    old.onmessage?.({data:brokenFull()});old.onmessage?.({data:brokenFull()});
    await sleep(400);
    assert.equal(sockets(ana),old);assert.equal(ana.connected,true);assert.equal(ana.fatal,undefined);
    assert.ok(net.sent.some(s=>s.t==='resync'),'asked the room for a full frame');
  }finally{stop();cleanup();}
});

test('nao-e-versao-nova: frames this page can never read: renewed MAX_FRAME_RENEWALS times, then LINK_LOST ("Voltar pra sala")',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  const {LINK_LOST,MAX_FRAME_RENEWALS}=await import('../../src/client/net/client.ts');
  try{
    const ana=await inCombat();const opened=net.opened;
    // Every frame fails (the welcome resets the same decoder, so the patch stays).
    (ana as any).feed.decode=()=>({ok:false,error:'malformed frame'});
    for(let i=0;i<400&&!ana.fatal;i++)await sleep(25);
    assert.equal(ana.fatal,LINK_LOST);
    assert.equal(net.opened-opened,MAX_FRAME_RENEWALS,'one fresh socket per renewal');
  }finally{stop();cleanup();}
});

test('nao-e-versao-nova: a world signature this page did not build renews the link; the welcome brings the right terrain',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  try{
    const ana=await inCombat();const id=ana.id,old=sockets(ana),right=ana.terrain.signature;
    (ana as any).terrain={...ana.terrain,signature:'outro-mundo'};
    (ana as any).out(old,{t:'resync'});
    for(let i=0;i<200&&!(ana.connected&&sockets(ana)!==old);i++)await sleep(10);
    assert.notEqual(sockets(ana),old);assert.equal(ana.fatal,undefined);
    assert.equal(ana.terrain.signature,right);assert.equal(ana.id,id);
  }finally{stop();cleanup();}
});

test('nao-e-versao-nova: the room refusing the version keeps the seat token; "Reconectar" (restart) takes the same seat back',async()=>{
  store.clear();net.room=new Room(Date.now());net.down=false;const stop=ticking(net.room);
  const {UPDATE_NEEDED}=await import('../../src/protocol/room.ts');
  try{
    const ana=await inCombat();const id=ana.id;
    sockets(ana).onmessage?.({data:JSON.stringify({t:'error',message:UPDATE_NEEDED})});
    await sleep(50);
    assert.equal(ana.fatal,UPDATE_NEEDED);assert.ok(store.get('viagem:room:ABCDEF1234'),'token kept');
    ana.restart();
    for(let i=0;i<200&&!ana.connected;i++)await sleep(10);
    assert.equal(ana.fatal,undefined);assert.equal(ana.connected,true);assert.equal(ana.id,id);
    for(let i=0;i<100&&ana.run?.phase!=='combat';i++)await sleep(25);
    assert.equal(ana.run?.phase,'combat');assert.equal(net.room.sim.players.size,1);
  }finally{stop();cleanup();}
});
