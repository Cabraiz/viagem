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

test('a room tells the index when its match starts and ends (only while someone is connected), once each',async()=>{
  const rows:any[]=[];
  const env={ALLOW_LOCAL:'false',INDEX:{idFromName:(n:string)=>n,get:()=>({report:async(code:string,row:any)=>{rows.push([code,row]);}})}} as any;
  const storage={put:async()=>{},get:async()=>undefined};
  const g=new GameRoom({storage,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,env) as any;
  const t0=Date.now();g.code='ROOM123456';g.created=t0;
  const room=g.create(t0,1);await room.ready();
  // A socket as the Durable Object sees it; the object's own clock is stopped, the test drives the ticks.
  const on:Record<string,(e:any)=>void>={};
  const server={send(){},close(){},addEventListener(type:string,fn:(e:any)=>void){on[type]=fn;}};
  g.room=room;g.attach(server,room);g.loop.stop();
  const p=[...g.peers.values()][0];
  room.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'}),t0);
  room.receive(p,JSON.stringify({t:'ready',round:room.run.snapshot().round,ready:true}),t0+100);
  let t=t0+100;for(let i=0;i<400&&room.run.snapshot().phase!=='combat';i++,t+=50)room.advance(t);
  assert.equal(room.run.snapshot().phase,'combat');
  for(let i=0;i<40;i++)room.advance(t+=50);
  await new Promise(r=>setTimeout(r,0));
  const running=rows.filter(([,r])=>r?.running);
  assert.equal(running.length,1,'one row when the match starts');
  assert.deepEqual(running[0],['ROOM123456',{running:true,players:1,until:t0+ROOM_LIFETIME_MS}]);
  // Everybody gone mid-match: the room stops ticking, the row stops holding deploys back; back: in a match again.
  on.close({code:1006,reason:'',wasClean:false});
  assert.equal(rows.at(-1)[1].running,false,'nobody connected');
  const again={send(){},close(){},addEventListener(){}};g.attach(again,room);g.loop.stop();
  assert.equal(rows.at(-1)[1].running,true,'someone back in the match');
  room.run.finish('defeat',room.sim.shameMoment());
  for(let i=0;i<4;i++)room.advance(t+=50);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(rows.at(-1)[1].running,false,'one row when it ends');
  assert.equal(rows.filter(([,r])=>r?.running).length,2);
  const n=rows.length;await g.alarm().catch(()=>{});
  assert.deepEqual(rows.slice(n),[['ROOM123456',null]],'the room is gone: its row too');
});
