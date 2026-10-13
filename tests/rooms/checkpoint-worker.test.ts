// NEW-20261013-E5-checkpoint-por-round, the Durable Object side: the room's checkpoint goes to its own storage row
// ('checkpoint', linked from the roster), a restarted object (load) resumes it after ready(), and the row goes once the
// run is over. GameRoom runs under node with a stand-in for `cloudflare:workers` (as in worker-lab.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CHECKPOINT_FROM_ROUND,type Room,type RoomCheckpoint,type RoomRoster} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {GameRoom}=await import('../../multiplayer/worker.ts');

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:TestPeer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
/** Durable Object storage on a Map; values go in and out as JSON (a stored row is a copy, never the room's object). */
function storage(){
  const data=new Map<string,unknown>(),deleted:string[]=[];
  const copy=(v:unknown)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  return {data,deleted,get:async(k:string)=>copy(data.get(k)),
    put:async(k:string|Record<string,unknown>,v?:unknown)=>{if(typeof k==='string')data.set(k,copy(v));else for(const [a,b] of Object.entries(k))data.set(a,copy(b));},
    delete:async(k:string)=>{deleted.push(k);return data.delete(k);},setAlarm:async()=>{}};
}
const env={ALLOW_LOCAL:'false'} as any;
/** A GameRoom on `store` on the endless map (the bundled city is a wrangler Text module, absent under node). */
const gameRoom=(store:ReturnType<typeof storage>)=>{const g=new GameRoom({storage:store} as any,env) as any;g.city=undefined;g.defaults={map:'infinito'};return g;};

/** The first object: Ana and two bots play into the round-2 intermission; the roster and the checkpoint land in `store`. */
async function firstObject(){
  const store=storage(),created=Date.now(),seed=31337;
  store.data.set('created',created);store.data.set('terrainSeed',seed);
  const g=gameRoom(store),room=g.create(created,seed) as Room;await room.ready();
  const a=peer();let t=created;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'},t);
  say(room,a,{t:'bot-add',round:1},t);say(room,a,{t:'bot-add',round:1},t+=400);
  say(room,a,{t:'ready',round:1,ready:true},t+=50);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const w=room.sim.world;
  for(let i=0;i<20*180&&!(w.round.index===CHECKPOINT_FROM_ROUND&&w.round.phase==='prepare');i++){room.advance(t+=50);if(i%20===0)say(room,a,{t:'ack',seq:0},t);}
  assert.equal(room.run.snapshot().phase,'combat');assert.equal(w.round.index,CHECKPOINT_FROM_ROUND);
  return {store,created,room,a,t};
}

test('Worker: the checkpoint has its own row, linked from the roster; a restarted object (load) resumes it after ready()',async()=>{
  const {store,created,room,a,t}=await firstObject();
  const cp=store.data.get('checkpoint') as RoomCheckpoint,roster=store.data.get('roster') as RoomRoster;
  assert.ok(cp,'the checkpoint row');assert.equal(cp.round,CHECKPOINT_FROM_ROUND);
  assert.deepEqual(roster.checkpoint,{round:cp.round,tick:cp.tick});assert.equal(roster.running,true);
  assert.equal(JSON.stringify(roster).length<2000,true,'the roster row stays small: the run is not in it');
  // Deploy: a new object on the same storage.
  const next=gameRoom(store),restored=await next.load(created) as Room;
  assert.equal(restored.run.snapshot().phase,'combat');assert.equal(restored.sim.world.round.index,cp.round);assert.equal(restored.sim.tick,cp.tick);
  assert.equal(restored.sim.world.team.level,room.sim.world.team.level);
  assert.deepEqual([...restored.sim.players.values()].map(p=>JSON.stringify(p.build)),[...room.sim.players.values()].map(p=>JSON.stringify(p.build)));
  const back=peer();restored.connect(back,t+100);say(restored,back,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(a).token},t+100);
  assert.equal(welcome(back).run.phase,'combat');assert.deepEqual(back.messages.filter(m=>m.t==='notice').map(m=>m.kind),['resumed']);
  // The run ends (the result): the roster no longer links a checkpoint and its row goes, once.
  restored.run.finish('defeat');let now=t+150;restored.advance(now+=50);restored.advance(now+=50);
  assert.equal((store.data.get('roster') as RoomRoster).running,false);assert.equal(store.data.has('checkpoint'),false);assert.deepEqual(store.deleted,['checkpoint']);
});

test('Worker: a roster linking a checkpoint whose row is missing or stale restarts in the lobby, as before',async()=>{
  const {store,created,a,t}=await firstObject();
  const cp=store.data.get('checkpoint') as RoomCheckpoint;
  for(const row of [undefined,{...cp,tick:cp.tick-20}]){
    const copy=storage();for(const [k,v] of store.data)copy.data.set(k,v);
    if(row)copy.data.set('checkpoint',row);else copy.data.delete('checkpoint');
    const restored=await gameRoom(copy).load(created) as Room;
    assert.equal(restored.run.snapshot().phase,'lobby');
    const back=peer();restored.connect(back,t+100);say(restored,back,{t:'join',protocol:ROOM_PROTOCOL,token:welcome(a).token},t+100);
    assert.deepEqual(back.messages.filter(m=>m.t==='notice').map(m=>m.kind),['restarted']);
  }
});
