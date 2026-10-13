/**
 * deploy-worker-sem-derrubar: the RoomIndex (which rooms are in a match), /health/rooms, and the rooms reporting only
 * when their match starts or ends. Runs worker.ts under node with a stand-in for `cloudflare:workers`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker,GameRoom}=await import('../../multiplayer/worker.ts');
const {report,summary}=await import('../../multiplayer/room-index.ts');
const {ROOM_LIFETIME_MS}=await import('../../multiplayer/room.ts');

/** Durable Object storage as the index uses it, on a Map. */
function store(){
  const m=new Map<string,unknown>();
  return {m,put:async(k:string,v:any)=>{m.set(k,structuredClone(v));},delete:async(k:string|string[])=>{for(const x of [k].flat())m.delete(x);return true;},
    list:async<T>({prefix}:{prefix:string})=>new Map([...m].filter(([k])=>k.startsWith(prefix)) as [string,T][])};
}

test('the index counts the rooms in a match and their people, and forgets rows past their room\'s end of life',async()=>{
  const s=store(),now=1_000_000;
  await report(s,'AAAA',{running:true,players:3,until:now+60_000});
  await report(s,'BBBB',{running:false,players:2,until:now+60_000});
  await report(s,'CCCC',{running:true,players:6,until:now-1});
  assert.deepEqual(await summary(s,now),{rooms:2,running:1,players:3,endsBy:now+60_000});
  assert.equal(s.m.has('r:CCCC'),false,'stale row dropped');
  await report(s,'AAAA',{running:false,players:3,until:now+60_000});
  await report(s,'BBBB',null);
  assert.deepEqual(await summary(s,now),{rooms:1,running:0,players:0,endsBy:0});
  // Garbage never lands.
  await report(s,'',{running:true,players:1,until:now+1});await report(s,'DDDD',{running:'yes',until:'x'} as any);
  assert.equal((await summary(s,now)).rooms,1);
});

test('/health/rooms answers the index summary to anyone; /health stays the same cheap answer',async()=>{
  const asked:string[]=[];
  const env={ALLOW_LOCAL:'false',INDEX:{idFromName:(n:string)=>n,get:(id:string)=>({summary:async()=>{asked.push(id);return {rooms:4,running:2,players:7,endsBy:5};}})}} as any;
  const r=await worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/health/rooms'),env);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{rooms:4,running:2,players:7,endsBy:5});assert.deepEqual(asked,['index']);
  const h=await worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/health'),env);
  assert.equal((await h.json()).protocol,ROOM_PROTOCOL);assert.equal(asked.length,1,'/health never asks the index');
  const none=await worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/health/rooms'),{ALLOW_LOCAL:'false'} as any);
  assert.equal(none.status,503);
});

/** A GameRoom on a fake index, in combat with one connected socket (the object's clock stopped: the test ticks). */
async function inMatch(){
  const rows:any[]=[];
  const env={ALLOW_LOCAL:'false',INDEX:{idFromName:(n:string)=>n,get:()=>({report:async(code:string,row:any)=>{rows.push([code,row]);}})}} as any;
  const g=new GameRoom({storage:{put:async()=>{},get:async()=>undefined},id:{toString:()=>'obj'},waitUntil:()=>{}} as any,env) as any;
  const t0=Date.now();g.code='ROOM123456';g.created=t0;
  const room=g.create(t0,1);await room.ready();g.room=room;
  const on:Record<string,(e:any)=>void>={};
  g.attach({send(){},close(){},addEventListener(type:string,fn:(e:any)=>void){on[type]=fn;}},room);g.loop.stop();
  const p=[...g.peers.values()][0];
  room.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'}),t0);
  room.receive(p,JSON.stringify({t:'ready',round:room.run.snapshot().round,ready:true}),t0+100);
  let t=t0+100;for(let n=0;n<400&&room.run.snapshot().phase!=='combat';n++,t+=50)room.advance(t);
  assert.equal(room.run.snapshot().phase,'combat');
  for(let n=0;n<20;n++)room.advance(t+=50);
  const settle=async()=>{await g.reports;};
  await settle();
  return {g,room,rows,on,t0,settle,tick:()=>room.advance(t+=50)};
}

test('a room tells the index when its match starts and when it ends with people still in it, once each',async()=>{
  const {room,rows,t0,settle,tick}=await inMatch();
  const running=rows.filter(([,r])=>r.running);
  assert.equal(running.length,1,'one row when the match starts');
  assert.deepEqual(running[0],['ROOM123456',{running:true,players:1,until:t0+ROOM_LIFETIME_MS}]);
  const before=rows.length;
  room.run.finish('defeat',room.sim.shameMoment());
  for(let n=0;n<4;n++)tick();
  await settle();
  assert.deepEqual(rows.slice(before).map(([,r])=>r.running),[false],'one row when it ends, the socket still connected');
});

test('everybody gone mid-match: the row stops holding deploys back; someone back: in a match again; in order',async()=>{
  const {g,room,rows,on,settle}=await inMatch();
  const before=rows.length;
  on.close({code:1006,reason:'',wasClean:false});
  g.attach({send(){},close(){},addEventListener(){}},room);g.loop.stop();
  await settle();
  assert.deepEqual(rows.slice(before).map(([,r])=>r.running),[false,true],'a quick false-true lands in order');
});

test('a failed report is sent again on the next change',async()=>{
  const {g,room,rows,on,settle}=await inMatch();
  let fail=true;const report=g.indexStub.report;g.indexStub={report:async(...a:any[])=>{if(fail){fail=false;throw new Error('lost');}return report(...a);}};
  const before=rows.length;
  on.close({code:1006,reason:'',wasClean:false});await settle();
  assert.equal(rows.length,before,'lost');assert.equal(g.indexed,undefined,'forgotten');
  g.attach({send(){},close(){},addEventListener(){}},room);g.loop.stop();await settle();
  assert.deepEqual(rows.slice(before).map(([,r])=>r.running),[true]);
});
