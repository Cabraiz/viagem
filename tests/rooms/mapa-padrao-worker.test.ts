// NEW-20261012-ORQ-cidade-10 PREP: the Worker side of the default map (see mapa-padrao.test.ts). GameRoom runs under
// node with a stand-in for `cloudflare:workers` (as in worker-lab.test.ts); the flipped Worker is built by overriding
// its `defaults` (map + cityPlayable), never the constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,type RoomRoster} from '../../multiplayer/room.ts';
import {cityTerrainFor} from '../../src/maps/index.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {CITY_PLAYABLE,INFINITO_REF,ROOM_DEFAULT_MAP,clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {GameRoom}=await import('../../multiplayer/worker.ts');

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const BOTH=clientCatalog(CITY);

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:TestPeer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',maps:BOTH},now);};
const back=(room:Room,p:TestPeer,token:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,token,maps:BOTH},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
const maps=(p:TestPeer)=>p.messages.filter(m=>m.t==='map');
const stored=(r:RoomRoster)=>JSON.parse(JSON.stringify(r)) as RoomRoster;
function storage(){
  const data=new Map<string,unknown>();
  return {data,get:async(k:string)=>data.get(k),put:async(k:string|Record<string,unknown>,v?:unknown)=>{if(typeof k==='string')data.set(k,v);else for(const [a,b] of Object.entries(k))data.set(a,b);},setAlarm:async()=>{}};
}
const env=(local:string,extra:object={})=>({ALLOW_LOCAL:local,...extra}) as any;
/** A GameRoom with the bundled city already in hand (loadCity is the wrangler Text module, absent under node). */
function gameRoom(local='false',extra:object={},defaults?:object){
  const ctx={storage:storage()},g=new GameRoom(ctx as any,env(local,extra)) as any;
  g.city={text:cityText,ref:CITY};if(defaults)g.defaults=defaults;
  return {g,ctx};
}
// Must stay the first test: the city is not decoded yet, so init() has to wait for it.
test('flipped Worker: init() hands the room over only once the city is in, so the first welcome names it',async()=>{
  assert.equal(cityTerrainFor(CITY.hash!),undefined,'the city must not be decoded yet');
  const {g,ctx}=gameRoom('false',{},{map:'cidade-nevada',cityPlayable:true});
  await g.init();
  assert.ok(ctx.storage.data.get('created'));
  const room=g.room as Room;assert.deepEqual(room.map,CITY);assert.equal(await g.loading,room);
  const a=peer();join(room,a,'Ana',Date.now());assert.deepEqual(welcome(a).map,CITY);assert.deepEqual(maps(a),[]);
  // A second init (the same code) changes nothing.
  await g.init();assert.equal(g.room,room);
});

test('Worker: create() passes ROOM_DEFAULT_MAP; lab rooms on LAB_WORLD=ilha stay on the endless map whatever the default',async()=>{
  const {g}=gameRoom();
  assert.deepEqual(g.defaults,{map:ROOM_DEFAULT_MAP});
  const room=g.create(1000,7);await room.ready();
  assert.deepEqual(room.map,ROOM_DEFAULT_MAP==='cidade-nevada'&&CITY_PLAYABLE?CITY:INFINITO_REF);
  const lab=gameRoom('true',{LAB_WORLD:'ilha'},{map:'cidade-nevada',cityPlayable:true}).g.create(1000,7);await lab.ready();
  assert.deepEqual(lab.map,INFINITO_REF);assert.equal(lab.sim.terrain.chunks,undefined,'still the island world');
  // A lab without LAB_WORLD follows the default like the deployed Worker.
  const plain=gameRoom('true',{},{map:'cidade-nevada',cityPlayable:true}).g.create(1000,7);await plain.ready();
  assert.deepEqual(plain.map,CITY);
});

test('flipped Worker restart (load): the stored pick wins over the default; an old row is the endless map',async()=>{
  const owner=new Room(1000,7,{cityText,cityRef:CITY}),a=peer();join(owner,a,'Ana',1000);
  const endless=stored(owner.roster()),old=stored(owner.roster());delete old.map;
  const city={...endless,map:'cidade-nevada' as const};
  for(const [row,want] of [[endless,INFINITO_REF],[old,INFINITO_REF],[city,CITY],[undefined,CITY]] as [RoomRoster|undefined,MapRef][]){
    const {g,ctx}=gameRoom('false',{},{map:'cidade-nevada',cityPlayable:true});
    ctx.storage.data.set('created',Date.now());ctx.storage.data.set('terrainSeed',7);if(row)ctx.storage.data.set('roster',row);
    const room=await g.load(Date.now()) as Room;
    assert.deepEqual(room.map,want,JSON.stringify(row?.map??'no row'));
    if(row){const a2=peer();back(room,a2,welcome(a).token,Date.now());assert.deepEqual(welcome(a2).map,want);assert.deepEqual(maps(a2),[]);}
  }
});
