// cidade-09 (D-034/D-035): the lobby's map selector and the client side of the map switch. Pure selector and lobby
// helpers, then the real CoopClient on a scripted socket: join.maps, welcome.map, setMap, {t:'map'} with the city
// download holding frames until the terrain is swapped, and a failed download that keeps the seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as city from '../../src/client/hud/city/index.ts';
import {soonMaps,mapNews,mapLoadText,roomMapId,syncSelector,besideSelector,lobbyOrientation,readyBlock,within,CITY_NOT_ARRIVED,READY_BLOCKED,MANIFEST_BUDGET_MS} from '../../src/client/lobby.ts';
import {readCityManifest,loadCity,CITY_FAILED} from '../../src/client/net/city-asset-loader.ts';
import {CITY_PLAYABLE,CITY_SOON,INFINITO_REF,ROOM_DEFAULT_MAP,clientCatalog,MAP_TEXT,ROOM_PROTOCOL,UPDATE_NEEDED,type MapId,type MapRef} from '../../src/protocol/index.ts';
import {TerrainField,TERRAIN_VERSION,CHUNK_VERSION,cityTerrainFrom,cityTerrainFor} from '../../src/maps/index.ts';
import type {SelectorEvent,SelectorState} from '../../src/client/hud/city/index.ts';

const MANIFEST=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const CITY_REF:MapRef={id:'cidade-nevada',version:MANIFEST.version,hash:MANIFEST.hash};
const step=(s:SelectorState,e:SelectorEvent)=>city.selectorReducer(s,e);
const lcg=(seed:number)=>{let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2**32;};};

// ---------- Selector: the city locked "em breve" (D-035) ----------
// Since cidade-10 the city is playable; the locked tests below drive the selector with the locked option
// (soonMaps(false)), so "em breve" stays covered for a build or room that turns the city off again.

test('D-035: the city is locked "em breve" when cityPlayable is off; cidade-10: today it is playable and the room default',()=>{
  assert.deepEqual(soonMaps(false),{'cidade-nevada':CITY_SOON});
  assert.deepEqual(soonMaps(true),{});
  // Today's constants: nothing locked, and the room opens on the city, which the client takes from the welcome.
  assert.equal(CITY_PLAYABLE,true);assert.deepEqual(soonMaps(),{});
  assert.equal(ROOM_DEFAULT_MAP,'cidade-nevada');assert.equal(roomMapId({map:CITY_REF}),'cidade-nevada');
  // A welcome without `map` (a room from before cidade-09) is still the endless map.
  assert.equal(city.DEFAULT_MAP,'infinito');assert.equal(roomMapId({}),'infinito');
});

test('owner taps the locked city: nothing is sent, the map stays, the hint says "em breve" (both orientations)',()=>{
  const owner:SelectorState={...city.initialSelector(true,'infinito'),soon:soonMaps(false)};
  const out=step(owner,{type:'tap',map:'cidade-nevada',nowMs:10});
  assert.equal(out.send,undefined,'never sent: the room would refuse it');
  assert.equal(out.state.confirmed,'infinito');assert.equal(out.state.pending,undefined);
  for(const orientation of ['portrait','landscape'] as const){
    const before=city.selectorView(owner,orientation),after=city.selectorView(out.state,orientation);
    const cidade=before.options.find(o=>o.id==='cidade-nevada')!;
    assert.equal(cidade.soon,true);assert.equal(cidade.disabled,true);assert.equal(cidade.sticker,'cadeado');
    assert.equal(cidade.subtitle,city.SELECTOR_TEXT.soon,`${orientation}: "em breve" stays in landscape too`);
    assert.equal(after.hint,CITY_SOON,orientation);
    assert.equal(after.options.find(o=>o.id==='infinito')!.selected,true);
  }
  // The hint goes away at the next event that settles (confirmation, lock) and comes back on the next tap.
  assert.equal(step(out.state,{type:'confirm',map:'infinito'}).state.notice,undefined);
  assert.equal(step(out.state,{type:'countdown',on:true}).state.notice,undefined);
});

test('tapping infinito when it is already the map does nothing; guests and locked/offline owners never get the notice',()=>{
  const owner:SelectorState={...city.initialSelector(true,'infinito'),soon:soonMaps(false)};
  const same=step(owner,{type:'tap',map:'infinito',nowMs:0});
  assert.equal(same.send,undefined);assert.equal(same.state,owner,'same state object: nothing changed');
  const guest:SelectorState={...city.initialSelector(false,'infinito'),soon:soonMaps(false)};
  assert.equal(step(guest,{type:'tap',map:'cidade-nevada',nowMs:0}).state,guest);
  assert.equal(city.selectorView(guest,'portrait').hint,city.SELECTOR_TEXT.guest,'the guest keeps the owner hint');
  assert.equal(step(step(owner,{type:'countdown',on:true}).state,{type:'tap',map:'cidade-nevada',nowMs:0}).state.notice,undefined);
  assert.equal(step(step(owner,{type:'offline',on:true}).state,{type:'tap',map:'cidade-nevada',nowMs:0}).state.notice,undefined);
});

test('the room\'s own map is never shown locked (a city room still shows the city selected)',()=>{
  const s:SelectorState={...city.initialSelector(true,'cidade-nevada'),soon:soonMaps(false)};
  const v=city.selectorView(s,'portrait');
  const cidade=v.options.find(o=>o.id==='cidade-nevada')!;
  assert.equal(cidade.selected,true);assert.equal(cidade.soon,undefined);assert.equal(cidade.sticker,'pronto');
  // The other one is live: a tap on infinito is sent.
  assert.equal(step(s,{type:'tap',map:'infinito',nowMs:0}).send,'infinito');
});

test('with "em breve" on, random events never send the locked city and never leave a dead or stuck control',()=>{
  const maps:MapId[]=['cidade-nevada','infinito'];
  for(const seed of [3,9,2026]){
    const rnd=lcg(seed);let now=0,s:SelectorState={...city.initialSelector(rnd()<.5,'infinito'),soon:soonMaps(false)};
    for(let i=0;i<1500;i++){
      now+=Math.floor(rnd()*900);
      const k=rnd(),map=maps[Math.floor(rnd()*2)];
      const e:SelectorEvent=k<.4?{type:'tap',map,nowMs:now}:k<.5?{type:'tick',nowMs:now}:k<.56?{type:'confirm',map:'infinito'}:k<.64?{type:'countdown',on:rnd()<.5}
        :k<.70?{type:'reconnect'}:k<.80?{type:'owner',canManage:rnd()<.7}:k<.92?{type:'offline',on:rnd()<.5}:{type:'download',text:rnd()<.5?city.downloadText(rnd()):undefined};
      const out=step(s,e);s=out.state;
      const where=`seed ${seed}, step ${i}, ${JSON.stringify(e)}`;
      assert.notEqual(out.send,'cidade-nevada',`${where}: the locked city was sent`);
      assert.equal(s.confirmed,'infinito',where);
      if(s.notice!==undefined)assert.ok(s.canManage&&!s.locked&&!s.offline&&!s.pending,`${where}: notice ${s.notice}`);
      for(const orientation of ['portrait','landscape'] as const){
        const view=city.selectorView(s,orientation);
        const cidade=view.options.find(o=>o.id==='cidade-nevada')!;
        assert.ok(cidade.disabled&&cidade.soon,`${where}: the city looks live`);
        assert.equal(cidade.subtitle,city.SELECTOR_TEXT.soon,where);
        for(const o of view.options){
          const tap=step(s,{type:'tap',map:o.id,nowMs:now});
          if(o.disabled||o.selected)assert.equal(tap.send,undefined,`${where}: ${o.id} sends`);
        }
      }
    }
  }
});

// ---------- Lobby helpers ----------

test('lobby helpers: news, download text, the room\'s map while downloading, orientation',()=>{
  assert.equal(mapNews('infinito'),'Mapa trocado: Mapa infinito. Todo mundo confirma de novo.');
  assert.equal(mapNews('cidade-nevada'),'Mapa trocado: Cidade Nevada. Todo mundo confirma de novo.');
  assert.equal(mapLoadText(undefined),undefined);
  assert.equal(mapLoadText({progress:.4}),'Baixando a cidade: 40%');
  assert.equal(mapLoadText({progress:.4,failed:CITY_FAILED}),CITY_NOT_ARRIVED);
  assert.equal(roomMapId({}),'infinito');
  assert.equal(roomMapId({map:INFINITO_REF}),'infinito');
  assert.equal(roomMapId({map:INFINITO_REF,mapLoad:{ref:CITY_REF}}),'cidade-nevada','the room already switched: the selector follows it');
  assert.equal(lobbyOrientation({width:390,height:844}),'portrait');
  assert.equal(lobbyOrientation({width:844,height:390}),'landscape');
});

test('review: no "pronto" while the room\'s map downloads here or did not arrive (pt-BR reason on the button)',()=>{
  assert.equal(readyBlock(undefined),undefined,'nothing downloading: the button is free');
  assert.equal(readyBlock({progress:.4}),READY_BLOCKED.downloading);
  assert.equal(READY_BLOCKED.downloading,'Baixando a cidade…');
  assert.equal(readyBlock({progress:0,failed:CITY_FAILED}),READY_BLOCKED.failed);
  // The lobby wires it: blocked (not ready yet) disables the button and puts the reason on it; backing out stays free.
  const source=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  // The map download blocks first; the match preload (3g-precarga) can only add its own block after it.
  assert.match(source,/const blocked=view\.selfReady\?undefined:readyBlock\(load\)(?:\?\?\(preloader\?preloadBlock\([^;]*\):undefined\))?;[\s\S]{0,400}?readyButton\.disabled=!client\.connected\|\|!!blocked;/);
  assert.match(source,/setText\(readyButton,blocked\?\?/);
});

test('review: the lobby does not wait on the city manifest (≤ 1 s budget, a late or broken one is left out)',async()=>{
  assert.ok(MANIFEST_BUDGET_MS<=1000);
  assert.equal(await within(Promise.resolve(7),0),7,'already there: taken even with no time left');
  const start=performance.now();
  assert.equal(await within(new Promise(()=>{}),30),undefined,'never arrives: undefined at the budget');
  assert.ok(performance.now()-start<500,'the budget bounds the wait');
  assert.equal(await within(Promise.reject(new Error('x')),30),undefined,'a failed fetch: undefined, never a throw');
  assert.equal(await within(new Promise(r=>setTimeout(()=>r('late'),200)),20),undefined,'later than the budget: left out');
  // openLobby: the manifest is started, not awaited, next to the endpoint; the join takes it within the budget.
  const source=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  const open=source.slice(source.indexOf('export async function openLobby'));
  assert.doesNotMatch(open,/Promise\.all\(\[\s*fetch\('\/multiplayer\.json'/,'the endpoint no longer waits for the manifest');
  assert.match(open,/const cityRef=await within\(manifest,manifestBy-performance\.now\(\)\);/);
});

test('review (a11y): the portrait hint that says "em breve" is a polite live region, rewritten only when it changes',()=>{
  const source=readFileSync(new URL('../../src/client/hud/city/map-selector.ts',import.meta.url),'utf8');
  assert.match(source,/hint\.setAttribute\('aria-live','polite'\)/);
  assert.doesNotMatch(source,/hint\.hidden=/,'never display:none: a live region shown together with its text is not announced');
  assert.match(source,/if\(hint\.dataset\.key!==hintKey\)/);
  const css=readFileSync(new URL('../../src/client/hud/city/city-hud.css',import.meta.url),'utf8');
  assert.match(css,/\.ch-selector-hint\.is-empty\{min-height:0;margin:0\}/);
  const owner:SelectorState={...city.initialSelector(true,'infinito'),soon:soonMaps(false)};
  assert.equal(city.selectorView(step(owner,{type:'tap',map:'cidade-nevada',nowMs:0}).state,'portrait').hint,CITY_SOON);
});

test('syncSelector follows the room: owner, countdown lock, connection, map (pending confirmed) and download',()=>{
  const base:SelectorState={...city.initialSelector(false,'infinito'),soon:soonMaps(true)};
  const room={canManage:true,countdown:false,connected:true,map:'infinito' as MapId};
  let s=syncSelector(base,room);
  assert.equal(s.canManage,true);
  assert.equal(syncSelector(s,room),s,'nothing changed: same object');
  const tap=step(s,{type:'tap',map:'cidade-nevada',nowMs:0});assert.equal(tap.send,'cidade-nevada');
  s=syncSelector(tap.state,room);assert.ok(s.pending,'still waiting for the room');
  s=syncSelector(s,{...room,map:'cidade-nevada',download:city.downloadText(.4)});
  assert.equal(s.pending,undefined);assert.equal(s.confirmed,'cidade-nevada');assert.equal(s.download,'Baixando a cidade: 40%');
  assert.equal(city.selectorView(s,'portrait').options[0].subtitle,'Baixando a cidade: 40%');
  s=syncSelector(s,{...room,map:'cidade-nevada',countdown:true});assert.equal(s.locked,true);assert.equal(s.download,undefined);
  s=syncSelector(s,{...room,map:'cidade-nevada',connected:false});assert.equal(s.locked,false);assert.equal(s.offline,true);
  s=syncSelector(s,{...room,canManage:false,map:'cidade-nevada'});assert.equal(s.offline,false);assert.equal(s.canManage,false);
});

test('lobby framing: the band around the waiting window keeps clear of the landscape selector window',()=>{
  const sel=city.selectorRects({width:844,height:390}).selector;
  assert.deepEqual(sel,{x:718,y:84,width:112,height:144});
  // Owner window {150,…,544,…} at the bottom: the band above it spans the whole width and is cut before the selector.
  const above={x:0,y:0,width:844,height:150};
  assert.deepEqual(besideSelector(above,sel),{x:0,y:0,width:710,height:150});
  // Mirror (notch on the right): the selector on the left, the band starts after it.
  const mirror=city.selectorRects({width:844,height:390},{top:0,right:47,bottom:0,left:0}).selector;
  assert.deepEqual(besideSelector(above,mirror),{x:134,y:0,width:710,height:150});
  // Portrait (no window), or no overlap: unchanged.
  assert.deepEqual(besideSelector(above,undefined),above);
  assert.deepEqual(besideSelector({x:0,y:300,width:844,height:90},sel),{x:0,y:300,width:844,height:90});
});

test('city manifest: only {id,version,hash} of the city passes (bytes kept for the progress)',()=>{
  assert.deepEqual(readCityManifest(MANIFEST),{...CITY_REF,bytes:MANIFEST.bytes});
  assert.equal(readCityManifest({...MANIFEST,id:'infinito'}),undefined);
  assert.equal(readCityManifest({...MANIFEST,hash:'abc'}),undefined);
  assert.equal(readCityManifest(null),undefined);
  assert.deepEqual(clientCatalog(readCityManifest(MANIFEST)),[INFINITO_REF,{...CITY_REF,bytes:MANIFEST.bytes}]);
});

// ---------- CoopClient on a scripted socket ----------

class FakeSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  static all:FakeSocket[]=[];
  readyState=0;binaryType='blob';sent:any[]=[];
  onopen?:()=>void;onmessage?:(e:{data:unknown})=>void;onclose?:(e:{code:number})=>void;onerror?:()=>void;
  constructor(_url:unknown){FakeSocket.all.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
  send(data:string){this.sent.push(JSON.parse(data));}
  close(code=1000){if(this.readyState===3)return;this.readyState=3;setTimeout(()=>this.onclose?.({code}),0);}
  push(message:object|ArrayBuffer){this.onmessage?.({data:message instanceof ArrayBuffer?message:JSON.stringify(message)});}
}
(globalThis as any).WebSocket=FakeSocket;
(globalThis as any).sessionStorage??={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const {CoopClient}=await import('../../src/client/net/client.ts');
type Client=InstanceType<typeof CoopClient>;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const worldOf=(t:TerrainField)=>({kind:t.chunks?'infinito':'ilha',terrainVersion:TERRAIN_VERSION,generatorVersion:t.chunks?CHUNK_VERSION:0,seed:t.seed,signature:t.signature});
const INFINITO_WORLD=worldOf(new TerrainField(7,{world:'infinito'}));
const CITY_WORLD={kind:'cidade',terrainVersion:TERRAIN_VERSION,generatorVersion:0,seed:0,signature:CITY_REF.hash!};
const RUN={round:1,phase:'lobby',elapsed:0,remaining:0,owner:'p1',members:[{id:'p1',online:true,ready:true,spectator:false}]};
const welcome=(extra:object={})=>({t:'welcome',protocol:ROOM_PROTOCOL,id:'p1',token:'tok',tick:0,run:RUN,world:INFINITO_WORLD,...extra});
/** A joined client: the join sent, the welcome answered. Frames are recorded with the terrain they were read against. */
async function joined(opts:{cityRef?:MapRef;welcome?:object}={}){
  const client=new CoopClient('http://sala','ABCDEF1234','Ana','cidadao-comum');
  if(opts.cityRef)client.cityRef=opts.cityRef;
  const frames:string[]=[];
  (client as any).frame=(_ws:unknown,_data:ArrayBuffer)=>{frames.push(client.terrain.signature);};
  const joining=client.join();
  await sleep(5);
  const ws=FakeSocket.all.at(-1)!;
  ws.push(welcome(opts.welcome));
  return {client,ws,frames,joining};
}

test('join sends maps = clientCatalog(cityRef); a welcome without map (older room) plays the endless map',async()=>{
  const {client,ws,joining}=await joined({cityRef:{...CITY_REF,bytes:1} as MapRef});
  await joining;
  assert.deepEqual(ws.sent[0].maps,[INFINITO_REF,CITY_REF],'exactly {id,version,hash}: the manifest\'s bytes stay home');
  assert.deepEqual(client.map,INFINITO_REF);
  client.leave();
  const old=await joined();await old.joining;
  assert.deepEqual(old.ws.sent[0].maps,[INFINITO_REF],'no manifest: the endless map only');
  old.client.leave();
});

test('welcome.map: a map this build does not ship (or garbage) stops the join with the update text',async()=>{
  for(const map of [CITY_REF,{id:'infinito',version:2,hash:null},{id:'x'}]){
    const {client,joining}=await joined({welcome:{map}});
    await assert.rejects(joining);
    assert.equal(client.fatal,MAP_TEXT.update,JSON.stringify(map));
  }
  const ok=await joined({cityRef:CITY_REF,welcome:{map:INFINITO_REF}});await ok.joining;
  assert.equal(ok.client.fatal,undefined);ok.client.leave();
});

test('setMap sends exactly {t:"setMap",map} (no round) and nothing while offline',async()=>{
  const {client,ws,joining}=await joined();await joining;
  assert.equal(client.setMap('infinito'),true);
  assert.deepEqual(ws.sent.at(-1),{t:'setMap',map:'infinito'});
  assert.deepEqual(Object.keys(ws.sent.at(-1)),['t','map']);
  client.connected=false;const count=ws.sent.length;
  assert.equal(client.setMap('cidade-nevada'),false);assert.equal(ws.sent.length,count);
  client.leave();
});

test('{t:"map"} with a map this build cannot load is refused with the update text',async()=>{
  const {client,ws,joining}=await joined();await joining;
  ws.push({t:'map',map:CITY_REF,world:CITY_WORLD});
  assert.equal(client.fatal,UPDATE_NEEDED);
});

// Runs before the success case: the decoded city is shared per hash, so later switches need no download.
test('a city download that fails keeps the seat: selector text + notice, frames dropped, a switch back recovers',async()=>{
  assert.equal(cityTerrainFor(CITY_REF.hash!),undefined,'the city is not decoded yet');
  const {client,ws,frames,joining}=await joined({cityRef:CITY_REF});await joining;
  const notices:string[]=[];client.onNotice=m=>notices.push(m);
  client.loadCity=async(_ref,progress)=>{progress(.3);await sleep(5);return CITY_FAILED;};
  ws.push({t:'map',map:CITY_REF,world:CITY_WORLD});
  assert.equal(client.mapLoad?.ref.id,'cidade-nevada');
  await sleep(20);
  assert.equal(client.mapLoad?.failed,CITY_FAILED);assert.deepEqual(notices,[CITY_FAILED]);
  assert.equal(client.fatal,undefined,'not terminal: the owner can switch back');
  assert.equal(mapLoadText(client.mapLoad),CITY_NOT_ARRIVED);
  ws.push(new ArrayBuffer(4));assert.deepEqual(frames,[],'frames of the city are dropped');
  ws.push({t:'map',map:INFINITO_REF,world:INFINITO_WORLD});
  assert.equal(client.mapLoad,undefined);assert.equal(client.map.id,'infinito');
  ws.push(new ArrayBuffer(4));assert.deepEqual(frames,[INFINITO_WORLD.signature]);
  // Failed again, and the round starts there anyway: this phone cannot play it.
  ws.push({t:'map',map:CITY_REF,world:CITY_WORLD});await sleep(20);
  ws.push({t:'run',run:{...RUN,phase:'combat'},tick:1});
  assert.equal(client.fatal,CITY_FAILED);
});

/** sessionStorage that records what the client saves (the seat token), restored after the test. */
function recordStorage(){
  const before=(globalThis as any).sessionStorage,store=new Map<string,string>();
  (globalThis as any).sessionStorage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
  return {store,restore:()=>{(globalThis as any).sessionStorage=before;}};
}

// Review C2/F1: the room drops a seat silent for 12 s and the city may take 30 s.
test('review F1: a welcome held for the city keeps the socket alive and the seat; a lost socket comes back with the token',async()=>{
  assert.equal(cityTerrainFor(CITY_REF.hash!),undefined,'the city is not decoded yet');
  const storage=recordStorage();
  try{
    const client=new CoopClient('http://sala','ABCDEF1234','Bia','cidadao-comum');client.cityRef=CITY_REF;
    let release!:(error:string|undefined)=>void;const download=new Promise<string|undefined>(r=>{release=r;});
    let calls=0;client.loadCity=()=>{calls++;return download;};
    const joining=client.join();joining.catch(()=>{});await sleep(5);
    const ws=FakeSocket.all.at(-1)!;
    ws.push({t:'welcome',protocol:ROOM_PROTOCOL,id:'p2',token:'tok2',tick:0,run:RUN,world:CITY_WORLD,map:CITY_REF});
    assert.equal(client.connected,false,'not applied before the city is there');
    assert.equal(client.token,'tok2','the seat token is kept at once');assert.equal(client.id,'p2');
    assert.equal(JSON.parse(storage.store.get('viagem:room:ABCDEF1234')!).token,'tok2','and saved, so a reload keeps the seat');
    // The heartbeat runs while the welcome waits: a ping well inside the room's 12 s.
    await sleep(2300);
    assert.ok(ws.sent.some(m=>m.t==='ping'),JSON.stringify(ws.sent.map(m=>m.t)));
    // A frame after KEEPALIVE_MS without sending answers with a ping (no ack of a frame not applied).
    (client as any).sentAt=-1e9;const before=ws.sent.length;
    ws.push(new ArrayBuffer(4));
    assert.deepEqual(ws.sent.slice(before).map(m=>m.t),['ping']);
    // The socket dies mid-download: the retry joins with the token (same seat, no ghost).
    // The retry goes after 500 ms ±25% (3g-rede-sem-teleporte jitter): waited for, not timed.
    // Waited for the retry's join itself (the socket opens asynchronously after it is created), not for a fixed time.
    const joined=()=>{const last=FakeSocket.all.at(-1)!;return last!==ws&&last.sent.length>0;};
    ws.close(1006);for(let i=0;i<150&&!joined();i++)await sleep(20);
    const ws2=FakeSocket.all.at(-1)!;
    assert.notEqual(ws2,ws);
    assert.equal(ws2.sent[0].t,'join');assert.equal(ws2.sent[0].token,'tok2');
    ws2.push({t:'welcome',protocol:ROOM_PROTOCOL,id:'p2',token:'tok2',tick:0,run:RUN,world:CITY_WORLD,map:CITY_REF});
    assert.equal(calls,2,'the second welcome waits on the same download');
    // The download fails: the join ends with the download's text and the socket closes, no limbo.
    release(CITY_FAILED);
    await assert.rejects(joining,(e:Error)=>e.message===CITY_FAILED);
    await sleep(20);
    assert.equal(client.fatal,CITY_FAILED);assert.equal(client.connected,false);assert.equal(ws2.readyState,FakeSocket.CLOSED);
    const sockets=FakeSocket.all.length;await sleep(700);
    assert.equal(FakeSocket.all.length,sockets,'no retry after the failure');
  }finally{storage.restore();}
});

// Review C1/F2: a reconnection into a city room whose download fails used to stay not connected, not fatal, socket open.
test('review F2: reconnecting into a city room whose download fails ends clearly (fatal, closed), never in limbo',async()=>{
  assert.equal(cityTerrainFor(CITY_REF.hash!),undefined,'the city is not decoded yet');
  const {client,ws,joining}=await joined({cityRef:CITY_REF,welcome:{map:INFINITO_REF}});await joining;
  client.loadCity=async()=>{await sleep(5);return CITY_FAILED;};
  (client as any).ackSeq=5;
  const n=FakeSocket.all.length;
  ws.close(1006);await sleep(700);
  assert.equal(FakeSocket.all.length,n+1,'one reconnection');
  const ws2=FakeSocket.all.at(-1)!;
  assert.equal(ws2.sent[0].token,'tok');
  ws2.push({t:'welcome',protocol:ROOM_PROTOCOL,id:'p1',token:'tok',tick:0,run:RUN,world:CITY_WORLD,map:CITY_REF});
  // While it waits, a keepalive is a ping, never an ack of the old connection's frame.
  (client as any).sentAt=-1e9;const before=ws2.sent.length;ws2.push(new ArrayBuffer(4));
  assert.deepEqual(ws2.sent.slice(before).map(m=>m.t),['ping']);
  await sleep(50);
  assert.equal(client.connected,false);assert.equal(client.fatal,CITY_FAILED,'the download text, terminal');
  assert.equal(ws2.readyState,FakeSocket.CLOSED,'the socket is closed');
  const count=FakeSocket.all.length;await sleep(700);
  assert.equal(FakeSocket.all.length,count,'no retry loop');
  client.leave();
});

test('{t:"map"} to the city: frames wait for the download, the terrain is swapped before the next frame, order kept',async()=>{
  const {client,ws,frames,joining}=await joined({cityRef:CITY_REF});await joining;
  const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const seen:string[]=[];client.onMap=m=>seen.push(m.id);
  client.loadCity=async(ref,progress)=>{progress(.4);await gate;const r=await cityTerrainFrom(text,ref.hash!);progress(1);return r.ok?undefined:r.error;};
  ws.push(new ArrayBuffer(4));
  ws.push({t:'map',map:CITY_REF,world:CITY_WORLD});
  ws.push(new ArrayBuffer(4));
  ws.push({t:'run',run:{...RUN,members:[{id:'p1',online:true,ready:false,spectator:false}]},tick:2});
  ws.push(new ArrayBuffer(4));
  assert.deepEqual(frames,[INFINITO_WORLD.signature],'nothing after the switch is read before the city is there');
  assert.deepEqual(client.mapLoad,{ref:CITY_REF,progress:.4});
  assert.equal(roomMapId(client),'cidade-nevada');
  assert.equal(client.run?.members[0].ready,true,'the run after the switch waits too');
  // The decode is real work (the city asset): waited for, not timed (a busy machine running the suite in parallel).
  release();for(let i=0;i<150&&frames.length<3;i++)await sleep(20);
  assert.deepEqual(frames,[INFINITO_WORLD.signature,CITY_REF.hash,CITY_REF.hash]);
  assert.equal(client.terrain.signature,CITY_REF.hash);assert.deepEqual(client.map,CITY_REF);
  assert.equal(client.mapLoad,undefined);assert.equal(client.mapSwitches,1);assert.deepEqual(seen,['cidade-nevada']);
  assert.equal(client.run?.members[0].ready,false,'the run pushed after the switch is applied in order');
  // A welcome of the city room (reconnection) needs no second download.
  client.loadCity=async()=>{throw new Error('no second download');};
  ws.push({t:'map',map:INFINITO_REF,world:INFINITO_WORLD});ws.push({t:'map',map:CITY_REF,world:CITY_WORLD});
  assert.equal(client.terrain.signature,CITY_REF.hash);assert.equal(client.mapSwitches,3);
  client.leave();
});

test('loadCity: a refused or wrong download says so and is not cached; progress goes up to 1 on success',async()=>{
  const fail=await loadCity({...CITY_REF,hash:'0'.repeat(64)},()=>{},async()=>new Response('{}'));
  assert.equal(fail,CITY_FAILED,'wrong hash');
  assert.equal(await loadCity(CITY_REF,()=>{},async()=>new Response('nope',{status:404})),CITY_FAILED);
  const text=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const progress:number[]=[];
  assert.equal(await loadCity({...CITY_REF,bytes:MANIFEST.bytes},p=>progress.push(p),async()=>new Response(text)),undefined);
  assert.ok(progress.length>=1&&progress.at(-1)===1&&progress.every((p,i)=>i===0||p>=progress[i-1]),JSON.stringify(progress));
});

// Review F6: a second caller of the running download got no progress.
test('loadCity: every caller waiting on the running download gets its progress',async()=>{
  const ref={...CITY_REF,hash:'1'.repeat(64),bytes:12};
  let push!:(chunk:Uint8Array|null)=>void;
  const body=new ReadableStream<Uint8Array>({start(c){push=chunk=>{if(chunk)c.enqueue(chunk);else c.close();};}});
  let fetches=0;const fetcher=async()=>{fetches++;return new Response(body);};
  const first:number[]=[],second:number[]=[],late:number[]=[];
  const a=loadCity(ref,p=>first.push(p),fetcher);
  const b=loadCity(ref,p=>second.push(p),fetcher);
  await sleep(5);
  push(new TextEncoder().encode('{"a":'));await sleep(5);
  const c=loadCity(ref,p=>late.push(p),fetcher);
  push(new TextEncoder().encode('1}'));await sleep(5);push(null);
  const results=await Promise.all([a,b,c]);
  assert.equal(fetches,1,'one download');
  assert.deepEqual(results,[CITY_FAILED,CITY_FAILED,CITY_FAILED],'the wrong hash fails for everyone');
  assert.ok(first.length>=2,JSON.stringify(first));
  assert.deepEqual(second,first,'the second caller sees the same progress');
  assert.equal(late[0],first[0],'a late caller gets the fraction reached at once');
  assert.deepEqual(late,first,'then the rest');
});
