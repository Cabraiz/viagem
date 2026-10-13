// VGM-047 / input-10hz on the real CoopClient: an in-memory socket bridges it to a real Room (no network, fake clock).
import test,{mock,after} from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {REPLACED_MESSAGE} from '../../src/protocol/room.ts';

const store=new Map<string,string>();
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
/** The network: which room answers, and whether new connections fail (phone without signal). */
const net={room:undefined as Room|undefined,down:false,opened:0,sent:[] as {at:number;t:string}[]};
class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='blob';
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  readonly peer:Peer;
  constructor(_url:unknown){
    net.opened++;
    this.peer={send:d=>{const data=typeof d==='string'?d:d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength);setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data});},0);},
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
const client=(name='Ana')=>{const c=new CoopClient('http://sala','ABCDEF1234',name,'cidadao-comum');clients.push(c);return c;};
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
    // A duplicated tab copies sessionStorage: same token.
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

test('client: after a restart of the room the player is seated again and the waiting room carries the notice',async()=>{
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
    // Two phones: each its own sessionStorage (the shared fake one is cleared so Bia does not take Ana's token).
    const ana=client('Ana'),bia=client('Bia');await ana.join();store.clear();await bia.join();
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
