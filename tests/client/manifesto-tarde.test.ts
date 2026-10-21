// cidade-10 PREP: a slow phone is never refused from a city room just because the city manifest came after the lobby's
// 1 s budget. The real CoopClient on scripted sockets with mocked timers: the room's refusal (or a welcome on the city
// the catalog lacks) makes the client wait for the manifest (bounded) and knock once more with the full catalog and the
// same seat token. Plus the city's labels (settings panel and result screen); the island and endless texts stay.
import test,{mock,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAP_TEXT,ROOM_PROTOCOL,INFINITO_REF,type MapRef} from '../../src/protocol/index.ts';
import {TERRAIN_VERSION,cityTerrainFrom} from '../../src/maps/index.ts';
import {mapInfoText,MANIFEST_BUDGET_MS} from '../../src/client/lobby.ts';
import {resultSeedText} from '../../src/client/hud/result.ts';

const MANIFEST=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const CITY_REF:MapRef={id:'cidade-nevada',version:MANIFEST.version,hash:MANIFEST.hash};
const CITY_WORLD={kind:'cidade',terrainVersion:TERRAIN_VERSION,generatorVersion:0,seed:0,signature:CITY_REF.hash!};
const RUN={round:1,phase:'lobby',elapsed:0,remaining:0,owner:'p1',members:[{id:'p1',online:true,ready:false,spectator:false}]};
// Decoded once (one instance per hash): a welcome of the city room then needs no download in these tests.
const decoded=await cityTerrainFrom(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'),CITY_REF.hash!);
assert.ok(decoded.ok);

class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  static all:FakeSocket[]=[];
  readyState=0;binaryType='blob';sent:any[]=[];
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  constructor(_url:unknown){FakeSocket.all.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
  send(data:string){this.sent.push(JSON.parse(data));}
  close(code=1000){if(this.readyState===3)return;this.readyState=3;setTimeout(()=>this.onclose?.({code}),0);}
  push(message:object){this.onmessage?.({data:JSON.stringify(message)});}
  /** The room's reject(): {t:'error'} then close 4003. */
  refuse(message:string){this.push({t:'error',message});this.close(4003);}
}
(globalThis as any).WebSocket=FakeSocket;
const store=new Map<string,string>();
(globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
const {CoopClient,CITY_RETRY_WAIT_MS,CITY_RETRY_STATUS}=await import('../../src/client/net/client.ts');

const CODE='ABCDEF1234',KEY=`viagem:room:${CODE}`;
const cityWelcome=(id='p1',token='tok')=>({t:'welcome',protocol:ROOM_PROTOCOL,id,token,tick:0,run:RUN,world:CITY_WORLD,map:CITY_REF});
/** Mocked clock: `ms` of timers, then the promise chains they started (setImmediate is not mocked). */
async function advance(ms:number){
  mock.timers.tick(ms);
  for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));
}
/** A client joining without the city (the manifest missed the budget); `manifest` is what reading it again gives. */
async function lateJoin(manifest:()=>Promise<(MapRef&{bytes?:number})|undefined>){
  const client=new CoopClient('http://sala',CODE,'Ana','cidadao-comum');
  const status:string[]=[];client.onStatus=m=>status.push(m);
  let reads=0;client.cityManifest=()=>{reads++;return manifest();};
  const before=FakeSocket.all.length;
  const joining=client.join();
  let outcome:'pending'|'joined'|Error='pending';
  joining.then(()=>{outcome='joined';},e=>{outcome=e as Error;});
  await advance(0);
  assert.equal(FakeSocket.all.length,before+1);
  return {client,status,joining,ws:FakeSocket.all.at(-1)!,reads:()=>reads,outcome:()=>outcome};
}
const delayed=<T>(ms:number,value:T)=>()=>new Promise<T>(r=>setTimeout(()=>r(value),ms));

beforeEach(()=>{mock.timers.enable({apis:['setTimeout','setInterval']});store.clear();});
afterEach(()=>{mock.timers.reset();});

test('slow phone: the city room refuses the join without the city; the client waits for the manifest and joins once more',async()=>{
  assert.equal(MANIFEST_BUDGET_MS,1000,'the fast join is kept');
  assert.equal(CITY_RETRY_WAIT_MS,6000);
  const j=await lateJoin(delayed(2500,{...CITY_REF,bytes:MANIFEST.bytes}));
  assert.deepEqual(j.ws.sent[0].maps,[INFINITO_REF],'the first join went without the city');
  const sockets=FakeSocket.all.length;
  j.ws.refuse(MAP_TEXT.update);
  await advance(0);
  assert.equal(j.client.fatal,undefined,'not the update panel');assert.equal(j.outcome(),'pending');
  assert.equal(j.status.at(-1),CITY_RETRY_STATUS);
  assert.equal(j.reads(),1,'the manifest is read again');
  await advance(2000);
  assert.equal(FakeSocket.all.length,sockets,'no socket while the manifest is on its way');
  await advance(500);await advance(0);
  assert.equal(FakeSocket.all.length,sockets+1,'one more join');
  const ws2=FakeSocket.all.at(-1)!;
  assert.equal(ws2.sent[0].t,'join');
  assert.deepEqual(ws2.sent[0].maps,[INFINITO_REF,CITY_REF],'the full catalog, exactly {id,version,hash}');
  assert.equal(ws2.sent[0].token,undefined,'a fresh join stays fresh: the room had seated nobody');
  ws2.push(cityWelcome());
  await advance(0);
  assert.equal(j.outcome(),'joined');
  assert.equal(j.client.connected,true);assert.deepEqual(j.client.map,CITY_REF);assert.equal(j.client.terrain.signature,CITY_REF.hash);
  assert.equal(JSON.parse(store.get(KEY)!).token,'tok');
  j.client.leave();
});

test('a saved seat (back from a reload): the refusal keeps the token, the retry presents it again (no ghost seat)',async()=>{
  store.set(KEY,JSON.stringify({token:'tok9',until:Date.now()+60_000}));
  const j=await lateJoin(async()=>CITY_REF);
  assert.equal(j.ws.sent[0].token,'tok9');
  j.ws.refuse(MAP_TEXT.update);
  await advance(0);await advance(0);
  assert.equal(JSON.parse(store.get(KEY)!).token,'tok9','the room refused before the seat: the token is still good');
  const ws2=FakeSocket.all.at(-1)!;
  assert.notEqual(ws2,j.ws);
  assert.equal(ws2.sent[0].token,'tok9');assert.deepEqual(ws2.sent[0].maps,[INFINITO_REF,CITY_REF]);
  ws2.push(cityWelcome('p9','tok9'));await advance(0);
  assert.equal(j.outcome(),'joined');assert.equal(j.client.id,'p9');
  j.client.leave();
});

test('a welcome on the city the catalog lacks (the room seated this phone): the retry takes that seat back by its token',async()=>{
  const j=await lateJoin(delayed(300,CITY_REF));
  j.ws.push(cityWelcome('p7','tok7'));
  await advance(0);
  assert.equal(j.ws.readyState,FakeSocket.CLOSED,'this socket is dropped');
  assert.equal(j.client.fatal,undefined);assert.equal(j.client.connected,false);
  assert.equal(j.client.token,'tok7');assert.equal(JSON.parse(store.get(KEY)!).token,'tok7','kept for the retry');
  await advance(300);await advance(0);
  const ws2=FakeSocket.all.at(-1)!;
  assert.equal(ws2.sent[0].token,'tok7','same seat, not a second one');assert.deepEqual(ws2.sent[0].maps,[INFINITO_REF,CITY_REF]);
  ws2.push(cityWelcome('p7','tok7'));await advance(0);
  assert.equal(j.outcome(),'joined');assert.equal(j.client.id,'p7');
  j.client.leave();
});

test('the manifest never comes: at CITY_RETRY_WAIT_MS the join ends with the room\'s update text, and nothing loops',async()=>{
  const j=await lateJoin(()=>new Promise(()=>{}));
  const sockets=FakeSocket.all.length;
  j.ws.refuse(MAP_TEXT.update);
  await advance(CITY_RETRY_WAIT_MS-1);
  assert.equal(j.outcome(),'pending');assert.equal(j.client.fatal,undefined);
  await advance(1);
  assert.ok(j.outcome() instanceof Error);assert.equal((j.outcome() as Error).message,MAP_TEXT.update);
  assert.equal(j.client.fatal,MAP_TEXT.update);
  assert.equal(store.get(KEY),undefined,'a refused fresh join keeps no token');
  await advance(60_000);
  assert.equal(FakeSocket.all.length,sockets,'no retry at all');
});

test('a build that really lacks this city: the one retry is refused too and the join ends there (one retry, never two)',async()=>{
  const other={...CITY_REF,hash:'0'.repeat(64)};
  const j=await lateJoin(async()=>other);
  j.ws.refuse(MAP_TEXT.update);
  await advance(0);await advance(0);
  const ws2=FakeSocket.all.at(-1)!;
  assert.deepEqual(ws2.sent[0].maps,[INFINITO_REF,other]);
  const sockets=FakeSocket.all.length;
  ws2.refuse(MAP_TEXT.update);await advance(0);
  assert.equal(j.client.fatal,MAP_TEXT.update);assert.ok(j.outcome() instanceof Error);
  assert.equal(j.reads(),1);
  await advance(60_000);
  assert.equal(FakeSocket.all.length,sockets,'no loop');
});

test('only the map refusal waits: other refusals, a client that already has the city, or no reader end at once',async()=>{
  const full=await lateJoin(async()=>CITY_REF);
  full.ws.refuse('Sala cheia. Máximo de seis jogadores.');await advance(0);
  assert.equal(full.client.fatal,'Sala cheia. Máximo de seis jogadores.');assert.equal(full.reads(),0);
  // The catalog had the city: a map refusal is a real version mismatch.
  const had=new CoopClient('http://sala',CODE,'Ana','cidadao-comum');had.cityRef=CITY_REF;let reads=0;had.cityManifest=async()=>{reads++;return CITY_REF;};
  const hadJoin=had.join();hadJoin.catch(()=>{});await advance(0);
  FakeSocket.all.at(-1)!.refuse(MAP_TEXT.update);await advance(0);
  assert.equal(had.fatal,MAP_TEXT.update);assert.equal(reads,0);
  // No reader (older callers): today's behavior, terminal at once.
  const bare=new CoopClient('http://sala',CODE,'Ana','cidadao-comum');
  const bareJoin=bare.join();bareJoin.catch(()=>{});await advance(0);
  FakeSocket.all.at(-1)!.refuse(MAP_TEXT.update);await advance(0);
  assert.equal(bare.fatal,MAP_TEXT.update);
});

test('leaving while the manifest is on its way: no join afterwards, nothing left knocking',async()=>{
  const j=await lateJoin(delayed(1000,CITY_REF));
  j.ws.refuse(MAP_TEXT.update);await advance(0);
  j.client.retryNow();
  const sockets=FakeSocket.all.length;
  assert.equal(sockets,FakeSocket.all.indexOf(j.ws)+1,'"Tentar de novo" does not knock while the manifest is awaited');
  j.client.leave();
  await advance(1000);await advance(10_000);
  assert.equal(FakeSocket.all.length,sockets);
});

test('lobby wiring: the client gets a reader of the manifest (refetched after a failure); the fast join stays',()=>{
  const source=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  assert.match(source,/const manifestAgain=\(\)=>import\('\.\/net\/city-asset-loader\.ts'\)\.then\(m=>m\.loadCityManifest\(\)\);/);
  assert.match(source,/client\.cityRef=cityRef;client\.cityManifest=manifestAgain;/);
  assert.match(source,/const cityRef=await within\(manifest,manifestBy-performance\.now\(\)\);/);
});

// ---------- Labels (cidade-10): the city by name, the island and the endless map unchanged ----------

test('settings map line: "Cidade Nevada" with version and short hash in the city; island and endless texts unchanged',()=>{
  assert.equal(mapInfoText(7,false),'Ilha 7, relevo procedural');
  assert.equal(mapInfoText(0,false,undefined),'Ilha 0, relevo procedural');
  assert.equal(mapInfoText(123,true,INFINITO_REF),'Mapa 123');
  assert.equal(mapInfoText(123,true),'Mapa 123');
  const city=mapInfoText(0,false,CITY_REF);
  assert.equal(city,`Cidade Nevada, versão ${CITY_REF.version} (${CITY_REF.hash!.slice(0,8)})`);
  assert.doesNotMatch(city,/Ilha|relevo|Mapa 0/);
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/mapInfoText\(net\?net\.terrain\.seed:mapInfoSeed,!!net\?\.terrain\.chunks,net\?\.map\)/);
  assert.doesNotMatch(explore,/relevo procedural/,'the text lives in mapInfoText only');
});

test('result stats line: "Cidade Nevada" in the city, nothing elsewhere (no seed on screen) (explore passes the room\'s map)',()=>{
  assert.equal(resultSeedText({seed:'12'}),'');
  assert.equal(resultSeedText({seed:'9',map:'infinito'}),'');
  assert.equal(resultSeedText({seed:'0',map:'cidade-nevada'}),'Cidade Nevada');
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/\.\.\.\(net\?\.map\.id==='cidade-nevada'\?\{map:net\.map\.id\}:\{\}\)/);
  const result=readFileSync(new URL('../../src/client/hud/result.ts',import.meta.url),'utf8');
  assert.match(result,/seed\.textContent=resultSeedText\(result\);/);
});
