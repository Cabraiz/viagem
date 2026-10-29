/**
 * BUG-20261012-ORQ-reconecta-round2: one JSON log line per socket end, for `wrangler tail`. The line builder is pure
 * (closeLogLine); the Durable Object logs each end once, whoever ended it. worker.ts runs under node with a stand-in
 * for `cloudflare:workers`, sockets are fakes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {Room,MSG_BURST,closeLogLine,CLOSE_REASON_MAX,type CloseLog} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {TickLoop} from '../../multiplayer/tick-clock.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {GameRoom}=await import('../../multiplayer/worker.ts');

const base:CloseLog={by:'client',code:1006,reason:'',clean:false,phase:'combat',run:1,round:2,roundPhase:'prepare',tick:1234,
  ageMs:61_234.6,idleMs:96.4,limitMs:12_000,bytes:654_321,frames:612,received:70,lag:180,lateAcks:0,seated:true,conns:1};

test('closeLogLine: one JSON line, fixed keys in order, numbers rounded',()=>{
  const line=closeLogLine(base);
  assert.equal(line.includes('\n'),false);
  assert.equal(line,'{"ev":"ws-end","by":"client","code":1006,"reason":"","clean":false,"phase":"combat","run":1,"round":2,"roundPhase":"prepare","tick":1234,'+
    '"ageMs":61235,"idleMs":96,"limitMs":12000,"bytes":654321,"frames":612,"received":70,"lag":180,"lateAcks":0,"seated":true,"conns":1}');
});

test('closeLogLine: the reason is cut to 60 characters, odd values become null, unknown `by` reads as the room',()=>{
  const f=JSON.parse(closeLogLine({...base,by:'x' as any,code:null,reason:'a'.repeat(200),clean:null,tick:NaN,lag:Infinity,phase:{} as any}));
  assert.equal(f.reason.length,CLOSE_REASON_MAX);assert.equal(CLOSE_REASON_MAX,60);
  assert.equal(f.code,null);assert.equal(f.clean,null);assert.equal(f.tick,null);assert.equal(f.lag,null);assert.equal(f.phase,'');assert.equal(f.by,'room');
});

test('closeLogLine: no secrets: extra fields (name, token, ids, address) never reach the line',()=>{
  const secret={...base,name:'Orquestra',token:'tok-123456',playerId:'p-uuid-1',ip:'203.0.113.9',hash:'ab'.repeat(32)} as CloseLog;
  const line=closeLogLine(secret);
  for(const s of ['Orquestra','tok-123456','p-uuid-1','203.0.113.9','abab'])assert.equal(line.includes(s),false,s);
  assert.deepEqual(Object.keys(JSON.parse(line)),['ev','by','code','reason','clean','phase','run','round','roundPhase','tick','ageMs','idleMs','limitMs','bytes','frames','received','lag','lateAcks','seated','conns']);
});

/** A server-side socket: what the room sends, how it was closed, and a way to fire the browser's events. */
class FakeSocket {
  sent:(string|Uint8Array)[]=[];closed?:{code:number;reason:string};
  private on=new Map<string,((e:any)=>void)[]>();
  send(data:string|Uint8Array){this.sent.push(data);}
  close(code:number,reason:string){this.closed={code,reason};}
  addEventListener(type:string,fn:(e:any)=>void){this.on.set(type,[...(this.on.get(type)??[]),fn]);}
  fire(type:string,e:any={}){for(const fn of this.on.get(type)??[])fn(e);}
}
/** A Durable Object whose room logs into `logs`, its loop on fake timers. */
function object(){
  const logs:any[]=[];
  const ctx={storage:{get:async()=>undefined,put:async()=>{},setAlarm:async()=>{},deleteAll:async()=>{}}};
  const o=new GameRoom(ctx as any,{ALLOW_LOCAL:'false'} as any) as any;
  const room=new Room(Date.now(),1,{log:line=>logs.push(JSON.parse(line))});o.room=room;
  o.loop=new TickLoop((now:number,last:boolean)=>o.room?.advance(now,last),{now:()=>Date.now(),set:()=>0,clear:()=>{}});
  return {o,room,logs};
}
const join=(o:any,room:Room,name:string)=>{const s=new FakeSocket();o.attach(s,room);s.fire('message',{data:JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'})});return s;};

test('a close event from the browser or the network: one line by the client, with its code, reason and wasClean',()=>{
  const {o,room,logs}=object();
  const a=join(o,room,'Tia');
  a.fire('close',{code:1006,reason:'',wasClean:false});
  assert.equal(logs.length,1);
  assert.deepEqual({by:logs[0].by,code:logs[0].code,clean:logs[0].clean,seated:logs[0].seated,phase:logs[0].phase},{by:'client',code:1006,clean:false,seated:true,phase:'lobby'});
  assert.ok(logs[0].frames>=1&&logs[0].received===1,JSON.stringify(logs[0]));
  // A second event for the same socket (error after close) logs nothing more.
  a.fire('error');assert.equal(logs.length,1);
});

test('an error event waits for the close event, which carries the code; with no close event it ends after 2 s',(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {o,room,logs}=object();
  const b=join(o,room,'Zé');
  b.fire('error');
  assert.equal(logs.length,0,'nothing yet: the close event has the code');
  b.fire('close',{code:1006,reason:'',wasClean:false});
  assert.equal(logs.length,1);assert.deepEqual({by:logs[0].by,code:logs[0].code,clean:logs[0].clean},{by:'error',code:1006,clean:false});
  t.mock.timers.tick(5000);assert.equal(logs.length,1,'the fallback does not log twice');
  const c=join(o,room,'Lu');
  c.fire('error');c.fire('error');
  t.mock.timers.tick(1999);assert.equal(logs.length,1);
  t.mock.timers.tick(1);
  assert.equal(logs.length,2,'no close event: logged once by the fallback');assert.equal(logs[1].by,'error');assert.equal(logs[1].code,null);
  assert.equal(o.peers.size,0,'both sockets left the object');
});

test('a send that throws is logged once as a room close (1011) and the socket is closed',()=>{
  const {o,room,logs}=object();
  const a=join(o,room,'Tia');
  a.send=()=>{throw new Error('socket gone');};
  room.advance(Date.now());room.advance(Date.now()+50);
  const ends=logs.filter(l=>l.code===1011);
  assert.equal(ends.length,1,JSON.stringify(logs));
  assert.equal(ends[0].by,'room');assert.equal(ends[0].seated,true);
  assert.deepEqual(a.closed,{code:1011,reason:'Falha ao enviar.'});
  a.fire('close',{code:1011,reason:'',wasClean:true});
  assert.equal(logs.filter(l=>l.code===1011).length,1,'its late close event adds nothing');
});

test('a socket the room cut for silence is logged once, by the room; its late close event adds nothing',()=>{
  const {o,room,logs}=object();
  const a=join(o,room,'Tia');
  room.advance(Date.now()+13_000);
  assert.equal(a.closed?.code,4004);
  a.fire('close',{code:1006,reason:'',wasClean:false});
  assert.equal(logs.length,1);assert.equal(logs[0].by,'room');assert.equal(logs[0].code,4004);assert.equal(logs[0].reason,'Conexão expirada.');
  assert.ok(logs[0].idleMs>=12_000,JSON.stringify(logs[0]));
});

test('room-side closes log their reason: binary message (1003), flood (4008), refused join (4003), replaced (4009), leave, alarm',async()=>{
  const {o,room,logs}=object();
  const a=join(o,room,'Tia');a.fire('message',{data:new ArrayBuffer(2)});
  assert.equal(a.closed?.code,1003);assert.equal(room.connections.size,0,'out of the room at once, not after 12 s of silence');
  const b=join(o,room,'Zé');for(let i=0;i<=MSG_BURST;i++)b.fire('message',{data:'{"t":"ping","at":1}'});
  assert.equal(b.closed?.code,4008);
  const c=new FakeSocket();o.attach(c,room);c.fire('message',{data:JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'',classId:'cidadao-comum'})});
  assert.equal(c.closed?.code,4003);
  const d=join(o,room,'Bia');const token=JSON.parse(d.sent.find(m=>typeof m==='string'&&m.includes('"welcome"')) as string).token;
  const e=new FakeSocket();o.attach(e,room);e.fire('message',{data:JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token})});
  assert.equal(d.closed?.code,4009);
  e.fire('message',{data:JSON.stringify({t:'leave'})});assert.equal(e.closed?.code,1000);
  const f=join(o,room,'Lu');await o.alarm();assert.equal(f.closed?.code,4004);
  assert.deepEqual(logs.map(l=>[l.by,l.code,l.reason]),[
    ['room',1003,'Texto esperado.'],['room',4008,'Limite de mensagens.'],['room',4003,'Nome ou herói inválidos.'],
    ['room',4009,'Personagem entrou por outra conexão.'],['room',1000,'Saiu da sala.'],['room',4004,'Sala encerrada.']]);
  assert.equal(o.loop.active,false);
});

test('the deployed Durable Object writes the line with console.log',()=>{
  const o=new GameRoom({storage:{}} as any,{ALLOW_LOCAL:'false'} as any) as any,room:Room=o.create(Date.now(),1);
  const printed:string[]=[],log=console.log;
  console.log=(line:string)=>{printed.push(line);};
  try{const peer={send:()=>{},close:()=>{}};room.connect(peer,Date.now());room.closed(peer,{code:1001,reason:'',clean:true});}
  finally{console.log=log;}
  assert.equal(printed.length,1);assert.equal(JSON.parse(printed[0]).code,1001);assert.equal(JSON.parse(printed[0]).seated,false);
});
