// D-047: a city room with no objective asked plays the chaveiro (CITY_OBJECTIVE_DEFAULT); ?modo=muralha asks for the wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {CAR_ID} from '../../src/contract/objective.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {GameRoom}=await import('../../multiplayer/worker.ts');

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
/** What the phone holds after each frame: the objective block and the structure kinds. */
function seen(frames:readonly Uint8Array[]){
  const decoder=new FrameDecoder(),out:{objective:boolean;kinds:string[]}[]=[];
  for(const f of frames){const r=decoder.decode(f);if(r.ok)out.push({objective:!!r.view.objective,kinds:r.view.structures.map(s=>s.kind)});}
  return out;
}

/** A room as the Worker makes it for "Jogar sozinho" (born on the city, solo): lobby frames, then combat with one bot. */
async function solo(options:object){
  const t0=1000,room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,...options}),a=peer();
  await room.ready();
  let t=t0;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  say(room,a,{t:'bot-add',round:room.run.snapshot().round},t+=OWNER_GAP_MS);
  for(let i=0;i<20;i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'lobby');
  const lobby=seen(a.frames);
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=OWNER_GAP_MS);
  for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  for(let i=0;i<40;i++)room.advance(t+=50);
  return {room,a,lobby,all:seen(a.frames)};
}

test('D-047: "Jogar sozinho" with no objective asked plays the chaveiro in the city (sim, lobby frames and combat frames)',async()=>{
  const {room,lobby,all}=await solo({});
  assert.equal(room.run.snapshot().phase,'combat');
  assert.equal(room.sim.objective,'chaveiro','the sim runs the chaveiro');
  assert.ok(room.sim.objectiveView());
  assert.ok(lobby.length>0,'frames in the lobby');
  for(const [name,list] of [['lobby',lobby],['combat',all]] as const){
    assert.ok(list.at(-1)!.objective,`the phone holds the objective block (${name})`);
    assert.ok(list.at(-1)!.kinds.includes(CAR_ID),`the car stands at the base (${name})`);
    for(const f of list)assert.ok(!f.kinds.includes('muralha'),`no wall structure in any ${name} frame`);
  }
});

test('D-047: objective:false (?modo=muralha) still plays the wall mode, lobby and combat',async()=>{
  const {room,lobby,all}=await solo({objective:false});
  assert.equal(room.run.snapshot().phase,'combat');
  assert.equal(room.sim.objective,undefined);
  assert.equal(room.sim.objectiveView(),undefined);
  for(const list of [lobby,all]){
    assert.ok(list.at(-1)!.kinds.includes('muralha'),'the wall stands');
    for(const f of list)assert.ok(!f.objective&&!f.kinds.includes(CAR_ID),'no objective block, no car');
  }
});

test('D-051: mode ninhos (?modo=ninhos) plays the nests with the chaveiro: the frames carry the nests; ignored with the wall mode',async()=>{
  const {room,all}=await solo({mode:'ninhos'});
  assert.equal(room.run.snapshot().phase,'combat');
  assert.equal(room.sim.mode,'ninhos');assert.equal(room.sim.objective,'chaveiro');
  assert.equal(room.sim.run.nests?.state.nests.length,8);
  assert.ok(all.at(-1)!.kinds.includes('ninho'),'the phone holds the nests');
  const wall=await solo({mode:'ninhos',objective:false});
  assert.equal(wall.room.sim.mode,undefined,'no nests without the chaveiro');
  assert.ok(!wall.all.some(f=>f.kinds.includes('ninho')));
  const plain=await solo({});
  assert.equal(plain.room.sim.mode,undefined,'the default stays the rounds');
});

/** A GameRoom with an in-memory storage and the bundled city (node cannot import the JSON as text). */
const storage=()=>{
  const store=new Map<string,unknown>();
  return {store,get:async(k:string)=>store.get(k),put:async(k:string|Record<string,unknown>,v?:unknown)=>{if(typeof k==='string')store.set(k,v);else for(const [a,b] of Object.entries(k))store.set(a,b);},setAlarm:async()=>{},delete:async()=>true};
};
const gameRoom=(s:ReturnType<typeof storage>)=>{
  const g=new GameRoom({storage:s,id:{toString:()=>'obj'},waitUntil:()=>{}} as any,{ALLOW_LOCAL:'false'} as any) as any;
  g.city={text:cityText,ref:CITY};g.defaults={...g.defaults,cityPlayable:true};return g;
};

test('the Worker (rodada-legado): a create asking for the wall gets the chaveiro with the nests; a wall row from before still restarts as the wall',async()=>{
  const s=storage(),g=gameRoom(s);
  await g.init('ABCDEF1234',{map:'cidade-nevada',solo:true,objective:'muralha'});
  assert.equal(g.room.map.id,'cidade-nevada');assert.equal(g.room.sim.objective,'chaveiro','the wall is legacy: the chaveiro');
  assert.deepEqual(s.store.get('options'),{map:'cidade-nevada',solo:true,mode:'ninhos',combat:'manual'});
  // A row stored before rodada-legado with the wall (storedOptions) restarts as it was created, to the end of its match.
  const legacy=storage();legacy.store.set('created',Date.now());legacy.store.set('terrainSeed',7);legacy.store.set('options',{map:'cidade-nevada',solo:true,objective:'muralha'});
  assert.equal((await gameRoom(legacy).load(legacy.store.get('created'))).sim.objective,undefined,'still the wall after a restart');
  // A row stored before ?modo=muralha existed: {map, solo} (or none) restarts as it was, on the city's default.
  for(const options of [{map:'cidade-nevada',solo:true},undefined]){
    const old=storage();old.store.set('created',Date.now());old.store.set('terrainSeed',7);if(options)old.store.set('options',options);
    const room=await gameRoom(old).load(old.store.get('created'));
    assert.equal(room.map.id,'cidade-nevada');assert.equal(room.sim.objective,'chaveiro',`a row with ${JSON.stringify(options)} plays the chaveiro`);
  }
});

test('a friends room stored with the wall (before rodada-legado) keeps it when the owner switches to the city',async()=>{
  const s=storage();s.store.set('created',Date.now());s.store.set('terrainSeed',7);s.store.set('options',{objective:'muralha'});
  const room=await gameRoom(s).load(s.store.get('created')) as Room,a=peer();let t=Date.now();
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  say(room,a,{t:'setMap',map:'infinito'},t+=OWNER_GAP_MS);await room.ready();
  assert.equal(room.map.id,'infinito');
  say(room,a,{t:'setMap',map:'cidade-nevada'},t+=OWNER_GAP_MS);await room.ready();
  assert.equal(room.map.id,'cidade-nevada');
  assert.equal(room.sim.objective,undefined,'back on the city: still the wall');
  assert.ok(room.sim.view('x').structures.some(st=>st.kind==='muralha'));
});
