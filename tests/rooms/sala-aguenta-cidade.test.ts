// sala-aguenta-cidade: a room lives on for a rematch after a whole city run (achado 4), takes a burst after a stall on 3G
// (achado 6), keeps the seat of a phone that hid the tab in the lobby (achado 7), and the Worker's create limit keys a
// phone by IP + device with a higher ceiling per IP (achado 5). Runs worker.ts under node with a stand-in for
// `cloudflare:workers`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,ROOM_LIFETIME_MS,ROOM_MAX_LIFETIME_MS,RUN_START_WINDOW_MS,CITY_START_WINDOW_MS,ROOM_CLOSING_NOTICE,MSG_BURST,MSG_RATE,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {CITY_RUN_DURATION_TICKS,LOBBY_AWAY_TICKS,RUN_HZ} from '../../src/sim/run.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker,GameRoom,createDevice}=await import('../../multiplayer/worker.ts');

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const MIN=60_000;

function peer(){
  const messages:any[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:(code:number,reason:string)=>closes.push({code,reason})};
}
type TestPeer=ReturnType<typeof peer>;
const join=(r:Room,p:Peer,name:string,now:number)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',maps:clientCatalog(CITY)}),now);};
const command=(r:Room,p:Peer,message:object,now:number)=>r.receive(p,JSON.stringify(message),now);
const welcome=(p:TestPeer)=>p.messages.find(m=>m.t==='welcome');
const notices=(p:TestPeer)=>p.messages.filter(m=>m.t==='notice').map(m=>m.message);
/** Ready from everyone given, then lobby ticks (50 ms) until combat; the time after it. */
function start(r:Room,peers:TestPeer[],now:number){
  for(const p of peers)command(r,p,{t:'ready',round:r.run.snapshot().round,ready:true},now);
  for(let i=0;i<200&&r.run.snapshot().phase!=='combat';i++)r.advance(now+=50);
  assert.equal(r.run.snapshot().phase,'combat');
  return now;
}

test('the city start window: the 30 min cap plus wall time the sim does not count; the endless map keeps 18 min',async()=>{
  assert.ok(CITY_START_WINDOW_MS>=CITY_RUN_DURATION_TICKS/RUN_HZ*1000+2*MIN,'cap plus pauses, scene and margin');
  assert.ok(ROOM_LIFETIME_MS-CITY_START_WINDOW_MS>=10*MIN,'a fresh room still has a 10+ min lobby before its first city run');
  const city=new Room(0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada'});await city.ready();
  assert.equal(city.startWindowMs(),CITY_START_WINDOW_MS);
  assert.equal(new Room(0,7,{map:'infinito'}).startWindowMs(),RUN_START_WINDOW_MS);
});

test('rematch after a whole city run: the room renews its end instead of refusing it, and the second run plays past 50 min',async()=>{
  const t0=1000,renewed:number[]=[];
  // A tiny tick cap so the test runs fast; the start window still is the city's (the map decides it).
  const r=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',durationTicks:40,onLifetime:at=>renewed.push(at)});await r.ready();
  const a=peer(),b=peer();join(r,a,'Ana',t0);join(r,b,'Bia',t0);
  // 14 min of lobby, then the city run: still inside the first 50 min, no renewal.
  let t=start(r,[a,b],t0+14*MIN);
  assert.deepEqual(renewed,[]);assert.equal(r.closesAt,t0+ROOM_LIFETIME_MS);
  for(let i=0;i<60&&r.run.snapshot().phase!=='result';i++)r.advance(t+=50);
  assert.equal(r.run.snapshot().phase,'result');
  // The wall clock of a whole city run (the cap, level-up pauses, the boss scene): the "topa" comes at 46 min. Before
  // sala-aguenta-cidade this was ROOM_CLOSING_NOTICE and the room closed 4 min later.
  t=t0+46*MIN;
  for(const p of [a,b])command(r,p,{t:'ping',at:t},t);
  for(const p of [a,b])command(r,p,{t:'rematch',round:r.run.snapshot().round},t);
  assert.notEqual(r.run.snapshot().phase,'result','rematch accepted');
  assert.deepEqual(renewed,[t+CITY_START_WINDOW_MS],'one renewal, to a whole city window');
  assert.equal(r.closesAt,t+CITY_START_WINDOW_MS);
  assert.deepEqual([...notices(a),...notices(b)].filter(m=>m===ROOM_CLOSING_NOTICE),[]);
  // The second run starts and is still on at 52 min, the old end of life: nobody got 4004.
  t=start(r,[a,b],t+1000);
  for(const at of [t0+50*MIN+1,t0+52*MIN]){for(const p of [a,b])command(r,p,{t:'ping',at},at);r.advance(at);}
  assert.deepEqual([...a.closes,...b.closes],[]);
  // A connection after 50 min still gets in (a phone that dropped): the room's end is closesAt now.
  const c=peer();join(r,c,'Caio',t0+52*MIN);assert.ok(welcome(c),'joined after 50 min');assert.deepEqual(c.closes,[]);
});

test('a ready in a lobby short of the window renews it too; past ROOM_MAX_LIFETIME_MS the room refuses with the notice',()=>{
  const t0=1000;
  const r=new Room(t0),a=peer();join(r,a,'Ana',t0);
  const late=t0+ROOM_LIFETIME_MS-RUN_START_WINDOW_MS+1;
  command(r,a,{t:'ping',at:late},late);command(r,a,{t:'ready',round:1,ready:true},late);
  assert.equal(r.run.snapshot().members.every(m=>m.ready),true);assert.equal(r.closesAt,late+RUN_START_WINDOW_MS);
  assert.deepEqual(notices(a),[]);
  // A room that already lived its 4 h: no more renewals, the old refusal (a notice, never a close).
  const old=new Room(t0,undefined,{closesAt:t0+ROOM_MAX_LIFETIME_MS}),b=peer();join(old,b,'Bia',t0);
  const end=t0+ROOM_MAX_LIFETIME_MS-RUN_START_WINDOW_MS+1;
  command(old,b,{t:'ready',round:1,ready:true},end);
  assert.equal(old.run.snapshot().members.some(m=>m.ready),false);assert.deepEqual(notices(b),[ROOM_CLOSING_NOTICE]);
  assert.deepEqual(b.closes,[]);
  // A stored end past the cap is clamped to it; one before the 50 min never shortens the room.
  assert.equal(new Room(t0,undefined,{closesAt:t0+99*ROOM_MAX_LIFETIME_MS}).closesAt,t0+ROOM_MAX_LIFETIME_MS);
  assert.equal(new Room(t0,undefined,{closesAt:t0+1}).closesAt,t0+ROOM_LIFETIME_MS);
});

test('a burst of 150 messages after a 3 s stall on 3G keeps the connection; a sustained flood still gets 4008',()=>{
  const r=new Room(1000),a=peer();join(r,a,'Ana',1000);
  const ping='{"t":"ping","at":1}';
  // A phone at 30 messages a second (20 Hz input plus acks) for 3 s...
  let t=1000;for(let i=0;i<90;i++)r.receive(a,ping,t+=1000/30);
  // ...then 3 s with nothing (the 3G stall), and the TCP hands the room 150 at once.
  t+=3000;for(let i=0;i<MSG_BURST;i++)r.receive(a,ping,t);
  assert.deepEqual(a.closes,[],'the burst fits the bucket');
  // And it goes on at its normal rate: the bucket refills at MSG_RATE, above the phone's 30/s.
  for(let i=0;i<90;i++)r.receive(a,ping,t+=1000/30);
  assert.deepEqual(a.closes,[]);
  // A flood at twice MSG_RATE empties the bucket in a few seconds.
  const f=peer();join(r,f,'Flood',t);
  for(let i=0;i<MSG_RATE*2*10&&!f.closes.length;i++)r.receive(f,ping,t+=1000/(MSG_RATE*2));
  assert.equal(f.closes[0]?.code,4008);
});

test('a phone that hides the tab 30 s in the lobby keeps its seat: it plays the run, not watches it',()=>{
  assert.ok(LOBBY_AWAY_TICKS/RUN_HZ>=30+12,'30 s hidden, of which the first 12 s the socket was still waiting to be dropped');
  const t0=1000,r=new Room(t0),a=peer(),b=peer();join(r,a,'Ana',t0);join(r,b,'Bia',t0);
  const token=welcome(b).token,idB=welcome(b).id;
  // Bia hides the tab at t0: her phone goes quiet and the room drops her socket after 12 s of silence. Ana pings and,
  // 20 s in, says she is ready.
  let t=t0;
  for(;t<t0+30_000;t+=50){
    if((t-t0)%5000===0)command(r,a,{t:'ping',at:t},t);
    if(t===t0+20_000)command(r,a,{t:'ready',round:1,ready:true},t);
    r.advance(t);
  }
  assert.equal(b.closes[0]?.code,4004,'the silent socket was dropped');
  assert.equal(r.run.snapshot().phase,'lobby','Ana waits for Bia');
  // Bia is back at 30 s with her token and says she is ready: both play.
  const back=peer();r.connect(back,t);r.receive(back,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token}),t);
  assert.equal(welcome(back)?.id,idB);
  command(r,a,{t:'ping',at:t},t);
  start(r,[back],t);
  assert.equal(r.sim.players.get(idB)!.spectator,false,'Bia plays');
  assert.equal(r.run.snapshot().members.filter(m=>!m.spectator).length,2);
});

test('create limit: IP + device for a phone that sends its id, the IP alone for an old site, a higher ceiling per IP',async()=>{
  assert.equal(createDevice({device:'a1B2-c3_d4'}),'a1B2-c3_d4');
  for(const d of ['short',42,'x'.repeat(65),'has space here','ã'.repeat(10)])assert.equal(createDevice({device:d}),undefined);
  assert.equal(createDevice(null),undefined);
  const keys:string[]=[],ipKeys:string[]=[];
  const counts=new Map<string,number>();
  const limiter=(limit:number,log:string[])=>({limit:async({key}:{key:string})=>{log.push(key);const n=(counts.get(log===keys?'d'+key:'i'+key)??0)+1;counts.set(log===keys?'d'+key:'i'+key,n);return {success:n<=limit};}});
  const env={ALLOW_LOCAL:'false',CREATE_LIMIT:limiter(5,keys),CREATE_LIMIT_IP:limiter(30,ipKeys),ROOMS:{idFromName:(n:string)=>n,get:()=>({init:async()=>{}})}} as any;
  const post=(body:string|undefined,ip='203.0.113.7')=>worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/rooms',{method:'POST',
    headers:{Origin:'https://viagem.cyou','CF-Connecting-IP':ip,...(body===undefined?{}:{'content-length':String(Buffer.byteLength(body))})},...(body===undefined?{}:{body})}),env);
  // A school behind one IP: 8 phones create a room each, none waits.
  for(let i=0;i<8;i++)assert.equal((await post(JSON.stringify({device:`phone-000${i}`}))).status,201);
  assert.equal(keys[0],'203.0.113.7|phone-0000');assert.equal(ipKeys.length,8);
  // One phone still has its own 5 a minute.
  for(let i=0;i<4;i++)assert.equal((await post(JSON.stringify({device:'phone-0000'}))).status,201);
  assert.equal((await post(JSON.stringify({device:'phone-0000'}))).status,429);
  // An old cached site (no device) keeps the IP's own CREATE_LIMIT, as before; another IP is apart.
  for(let i=0;i<5;i++)assert.equal((await post(undefined,'198.51.100.1')).status,201);
  assert.equal((await post(undefined,'198.51.100.1')).status,429);
  // The IP's ceiling: 30 rooms a minute across all its devices.
  let created=12;for(let i=10;created<30;i++,created++)assert.equal((await post(JSON.stringify({device:`phone-00${i}`}))).status,201);
  assert.equal((await post(JSON.stringify({device:'phone-0099'}))).status,429);
});

test('the Worker keeps a renewed end: stored, the alarm moved, the index told, and a restart reads it back',async()=>{
  const store=new Map<string,unknown>(),alarms:number[]=[],rows:any[]=[];
  const storage={get:async(k:string)=>store.get(k),put:async(k:string|Record<string,unknown>,v?:unknown)=>{if(typeof k==='string')store.set(k,v);else for(const [a,b] of Object.entries(k))store.set(a,b);},
    setAlarm:async(at:number)=>{alarms.push(at);},delete:async()=>true};
  const env={ALLOW_LOCAL:'false',INDEX:{idFromName:(n:string)=>n,get:()=>({report:async(code:string,row:any)=>{rows.push([code,row]);}})}} as any;
  const g=new GameRoom({storage,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,env) as any;
  await g.init('ROOM123456',{});
  const created=store.get('created') as number;
  assert.deepEqual(alarms,[created+ROOM_LIFETIME_MS+MIN]);
  const room:Room=g.room,at=created+40*MIN;
  assert.equal(room.renewLifetime(at),true);
  const until=at+RUN_START_WINDOW_MS;
  assert.equal(store.get('closesAt'),until);assert.deepEqual(alarms.at(-1),until+MIN);
  await g.reports;assert.equal(rows.at(-1)[1].until,until,'the index row carries the new end');
  // A deploy restarts the object: the room comes back with the renewed end.
  const again=new GameRoom({storage,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,env) as any;
  const restored:Room=await again.load(created);
  assert.equal(restored.closesAt,until);
});
