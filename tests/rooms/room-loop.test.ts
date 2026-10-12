/**
 * The room's clock in the Durable Object (N17 review): it stops when no socket is left — closed by the phone, cut by
 * the room for silence (no close handshake ever comes back) or by the alarm — and a catch-up burst sends one frame
 * per client. worker.ts runs under node with a stand-in for `cloudflare:workers`, sockets are fakes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../multiplayer/simulation.ts';
import {TickLoop} from '../../multiplayer/tick-clock.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {GameRoom}=await import('../../multiplayer/worker.ts');

/** A server-side socket: what the room sends, how it was closed, and a way to fire the browser's events. */
class FakeSocket {
  sent:(string|Uint8Array)[]=[];closed?:{code:number;reason:string};
  private on=new Map<string,((e:any)=>void)[]>();
  send(data:string|Uint8Array){this.sent.push(data);}
  close(code:number,reason:string){this.closed={code,reason};}
  addEventListener(type:string,fn:(e:any)=>void){this.on.set(type,[...(this.on.get(type)??[]),fn]);}
  fire(type:string,e:any={}){for(const fn of this.on.get(type)??[])fn(e);}
  get frames(){return this.sent.filter(d=>typeof d!=='string').length;}
}
/** A Durable Object with fake storage and a loop on fake timers (nothing fires unless the test says). */
function object(){
  const store=new Map<string,unknown>();let deleted=false;
  const ctx={storage:{get:async(k:string)=>store.get(k),put:async(k:string|object,v?:unknown)=>{if(typeof k==='string')store.set(k,v);else for(const [a,b] of Object.entries(k))store.set(a,b);},
    setAlarm:async()=>{},deleteAll:async()=>{deleted=true;store.clear();}}};
  const o=new GameRoom(ctx as any,{ALLOW_LOCAL:'false'} as any) as any;
  const room=new Room(Date.now(),1);o.room=room;
  let pending=0;
  o.loop=new TickLoop((now:number,last:boolean)=>o.room?.advance(now,last),{now:()=>Date.now(),set:()=>++pending,clear:()=>{}});
  return {o,room,get deleted(){return deleted;}};
}
const join=(o:any,room:Room,name:string)=>{const s=new FakeSocket();o.attach(s,room);s.fire('message',{data:JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'})});return s;};

test('the last socket closing stops the clock; one of two does not',()=>{
  const {o,room}=object();
  const a=join(o,room,'Tia'),b=join(o,room,'Zé');
  assert.equal(o.loop.active,true);
  a.fire('close');assert.equal(o.loop.active,true,'Zé is still there');
  b.fire('error');assert.equal(o.loop.active,false,'nobody left: no more ticks, no more duration');
  assert.equal(o.peers.size,0);
  // A phone back: the clock starts again.
  join(o,room,'Tia');assert.equal(o.loop.active,true);o.loop.stop();
});

test('every phone silent: the room cuts them for silence and the clock stops without any close event',()=>{
  const {o,room}=object();
  const a=join(o,room,'Tia'),b=join(o,room,'Zé');
  // Room bots do not keep the clock going (they have no socket).
  room.receive([...room.connections.keys()][0],JSON.stringify({t:'bot-add'}),Date.now());
  room.advance(Date.now()+13_000);
  assert.equal(a.closed?.code,4004);assert.equal(b.closed?.code,4004);
  assert.equal(o.peers.size,0,'taken out at once: with no network the close handshake never ends');
  assert.equal(o.loop.active,false);
  // The late close event (if one ever comes) changes nothing.
  a.fire('close');assert.equal(o.loop.active,false);
});

test('the alarm closes the sockets and stops the clock',async()=>{
  const r=object();
  const a=join(r.o,r.room,'Tia');assert.equal(r.o.loop.active,true);
  await r.o.alarm();
  assert.equal(a.closed?.code,4004);assert.equal(r.o.loop.active,false);assert.equal(r.deleted,true);
});

test('a binary message from a client closes it with 1003 and takes it out',()=>{
  const {o,room}=object();
  const a=join(o,room,'Tia');a.fire('message',{data:new ArrayBuffer(2)});
  assert.equal(a.closed?.code,1003);assert.equal(o.loop.active,false);
});

test('a catch-up burst of three ticks sends one frame per client, on the last tick',()=>{
  const {o,room}=object();
  const sockets=['Tia','Zé','Bia'].map(n=>join(o,room,n));
  const now=Date.now();
  for(let i=0;i<4;i++)room.advance(now);
  const before=sockets.map(s=>s.frames);
  room.advance(now,false);room.advance(now,false);
  assert.deepEqual(sockets.map(s=>s.frames),before,'nothing sent inside the burst');
  room.advance(now,true);
  assert.deepEqual(sockets.map(s=>s.frames-before[sockets.indexOf(s)]),[1,1,1],'one frame each at the end');
  // Without bursts the slots keep their rhythm: two plain ticks, one frame per client.
  const mid=sockets.map(s=>s.frames);room.advance(now);room.advance(now);
  assert.deepEqual(sockets.map((s,i)=>s.frames-mid[i]),[1,1,1]);
  o.loop.stop();
});

test('N27: a slow phone that went quiet for good still stops the clock, within SLOW_SILENT_MAX_MS',async()=>{
  const {SLOW_SILENT_MAX_MS}=await import('../../multiplayer/room.ts');
  const {o,room}=object();
  const a=join(o,room,'Tia lenta');
  const t0=Date.now(),c=[...room.connections.values()][0];
  // Its acks kept naming frames 30 s old: the room learned it is slow, not gone.
  for(let i=1;i<=3;i++){room.advance(t0+i*100);}
  room.receive(c.peer,JSON.stringify({t:'ack',seq:c.encoder!.lastSeq}),t0+20_000);
  c.lag=30_000;c.lateAcks=3;
  room.advance(t0+20_000+40_000);
  assert.equal(a.closed,undefined,'40 s of silence after 20 s gaps and a 30 s lag: still slow, not gone');
  assert.equal(o.loop.active,true);
  room.advance(t0+20_000+SLOW_SILENT_MAX_MS+1);
  assert.equal(a.closed?.code,4004);
  assert.equal(o.loop.active,false,'the empty room stops its clock at the cap');
});
