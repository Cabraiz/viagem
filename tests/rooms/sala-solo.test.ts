// sala-solo-privada: a "Jogar sozinho" room is born on the asked map (the city) and only its person sits; bots go on;
// the Worker reads {map,solo} from an optional create body, keeps it for a restart, and an older client gets a plain room.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL,SOLO_ROOM_REFUSED} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker,GameRoom,createOptions}=await import('../../multiplayer/worker.ts');

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[],closes:number[]=[];
  return {messages,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:(code:number)=>{closes.push(code);}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,token?:string)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',maps:clientCatalog(CITY),...(token?{token}:{})},now);};

test('a solo room is born on the city; a second person is refused with the reason; the person comes back with the token; bots go on',async()=>{
  const t0=Date.now(),room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true});await room.ready();
  assert.equal(room.map.id,'cidade-nevada','born on the city, no switch');
  const ana=peer();join(room,ana,'Ana',t0);
  const w=ana.messages.find(m=>m.t==='welcome');assert.ok(w);assert.equal(w.map?.id,'cidade-nevada');
  const bia=peer();join(room,bia,'Bia',t0+10);
  assert.deepEqual(bia.messages.map(m=>[m.t,m.message]),[['error',SOLO_ROOM_REFUSED]]);assert.deepEqual(bia.closes,[4003]);
  assert.equal(room.sim.players.size,1);
  // Bots are still welcome (the owner's command).
  say(room,ana,{t:'bot-add',round:room.run.snapshot().round},t0+1100);
  assert.equal(room.sim.players.size,2,'a bot sits');
  // Ana's network changes: she comes back with her token (a new connection), never refused.
  const again=peer();join(room,again,'Ana',t0+1500,w.token);
  assert.equal(again.messages.find(m=>m.t==='welcome')?.id,w.id);
});

test('an ordinary room still takes a second person',async()=>{
  const t0=Date.now(),room=new Room(t0,7,{});await room.ready();
  const a=peer(),b=peer();join(room,a,'Ana',t0);join(room,b,'Bia',t0+10);
  assert.ok(b.messages.some(m=>m.t==='welcome'));assert.equal(room.solo,false);
});

test('the Worker: POST /rooms reads {map,solo} from an optional body (junk and old clients get a plain room); the object keeps it for a restart',async()=>{
  assert.deepEqual(createOptions({map:'cidade-nevada',solo:true}),{map:'cidade-nevada',solo:true});
  assert.deepEqual(createOptions({map:'lua',solo:'yes',extra:1}),{});assert.deepEqual(createOptions(null),{});
  const inits:unknown[]=[];
  const env={ALLOW_LOCAL:'false',CREATE_LIMIT:{limit:async()=>({success:true})},ROOMS:{idFromName:(n:string)=>n,get:()=>({init:async(_c:string,o:unknown)=>{inits.push(o);}})}} as any;
  const post=(body?:string)=>worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/rooms',{method:'POST',headers:{Origin:'https://viagem.cyou'},...(body===undefined?{}:{body})}),env);
  for(const body of [JSON.stringify({map:'cidade-nevada',solo:true}),undefined,'{nope','x'.repeat(500)])assert.equal((await post(body)).status,201);
  assert.deepEqual(inits,[{map:'cidade-nevada',solo:true},{},{},{}]);
  // The object stores what it was created with and a restart (load) builds the same solo city room.
  const store=new Map<string,unknown>();
  const storage={get:async(k:string)=>store.get(k),put:async(k:string|Record<string,unknown>,v?:unknown)=>{if(typeof k==='string')store.set(k,v);else for(const [a,b] of Object.entries(k))store.set(a,b);},setAlarm:async()=>{},delete:async()=>true};
  const g=new GameRoom({storage,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,{ALLOW_LOCAL:'false'} as any) as any;
  await g.init('ABCDEF1234',{map:'cidade-nevada',solo:true});
  assert.deepEqual(store.get('options'),{map:'cidade-nevada',solo:true});
  assert.equal(g.room.solo,true);
  const restarted=new GameRoom({storage,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,{ALLOW_LOCAL:'false'} as any) as any;
  const room=await restarted.load(store.get('created'));
  assert.equal(room.solo,true,'still solo after a restart');
});
