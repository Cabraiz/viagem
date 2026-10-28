// Card NEW-20261028-ORQ-exploracao-espera-carregar-e-sem-arma (auditoria 28/10 item 13): the time to explore waits for
// the team to load. A ninhos room keeps the minuto de Minerva full (RunState.minervaAteTick a whole minute ahead) until
// every human online in the run said {t:'carregou'} (its scene drew the first combat frame), at most LOAD_WAIT_MS; an
// older phone never says it, so the cap starts the clock for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,OWNER_GAP_MS,DANCE_RELAY_MS,type Peer} from '../../multiplayer/room.ts';
import {LoadWait,LOAD_WAIT_MS} from '../../multiplayer/load-wait.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {MINERVA_S} from '../../src/sim/ninhos/ninhos.ts';
import {SIM_HZ,ticks} from '../../src/contract/index.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
await import('../../multiplayer/worker.ts');

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);

/** A ninhos city room with two humans, Ana and Bia, at the first tick of combat. */
async function pair(){
  const t0=1000,room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',mode:'ninhos',combat:'manual'}),a=peer(),b=peer();
  await room.ready();
  let t=t0;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  room.connect(b,t);say(room,b,{t:'join',protocol:ROOM_PROTOCOL,name:'Bia',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  t+=OWNER_GAP_MS;
  for(const p of [b,a])say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<4000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'combat');
  return {room,a,b,t};
}
const lastRun=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='run').at(-1)!;
/** Whole seconds of the minute the clock shows now (hud/model.ts secondsLeft, read on the room's tick). */
const shown=(room:Room,p:ReturnType<typeof peer>)=>Math.ceil((lastRun(p).run.minervaAteTick-room.sim.tick)/SIM_HZ);

/** Runs the room for `ms` of wall clock (50 ms a tick, both phones pinging, the fear kept away: they stand alone). */
function run(room:Room,peers:Peer[],from:number,ms:number,each?:(t:number)=>void){
  let t=from;
  for(const end=from+ms;t<end;){
    t+=50;for(const p of room.sim.players.values())delete p.fear;
    for(const p of peers)say(room,p,{t:'ping',at:t},t);
    room.advance(t);each?.(t);
  }
  return t;
}

test('two humans, one takes 15 s to draw the run: the minute of Minerva starts at 15 s, full',async()=>{
  let {room,a,b,t}=await pair();
  const round=room.run.snapshot().round;
  say(room,a,{t:'carregou',round},t);
  t=run(room,[a,b],t,15_000,now=>assert.equal(shown(room,a),MINERVA_S,`still full at ${now}`));
  say(room,b,{t:'carregou',round},t);
  const start=room.sim.tick;
  t=run(room,[a,b],t,50);
  const until=room.sim.run.nests!.state.minervaUntil!;
  assert.ok(until-start<=ticks(MINERVA_S)&&until-start>ticks(MINERVA_S-1),`the minute runs from Bia's frame (${until-start} ticks)`);
  t=run(room,[a,b],t,3000);
  assert.equal(room.sim.run.nests!.state.minervaUntil,until,'no more hold once everyone drew it');
  assert.equal(shown(room,b),MINERVA_S-3);
});

test('a phone that never says carregou (older client): the cap starts the minute at LOAD_WAIT_MS',async()=>{
  let {room,a,b,t}=await pair();
  say(room,a,{t:'carregou',round:room.run.snapshot().round},t);
  const t0=t;
  t=run(room,[a,b],t,LOAD_WAIT_MS-1000);
  assert.equal(shown(room,a),MINERVA_S,'held until the cap');
  t=run(room,[a,b],t,1000);
  const until=room.sim.run.nests!.state.minervaUntil!;
  t=run(room,[a,b],t,5000);
  assert.equal(room.sim.run.nests!.state.minervaUntil,until,'released at the cap');
  assert.ok(t-t0>=LOAD_WAIT_MS);
  assert.equal(shown(room,a),MINERVA_S-5);
});

test('the hold pushes {t:\'run\'} twice a second at most, not once a tick',async()=>{
  let {room,a,b,t}=await pair();
  const before=a.messages.filter(m=>m.t==='run').length;
  t=run(room,[a,b],t,10_000);
  const pushes=a.messages.filter(m=>m.t==='run').length-before;
  assert.ok(pushes<=22,`${pushes} pushes in 10 s`);
});

test('LoadWait: a player who leaves is not waited for; no humans, no wait',()=>{
  const w=new LoadWait();
  w.arm(['a','b'],0);
  assert.equal(w.holding(100,()=>true),true);
  w.loaded('a');
  assert.equal(w.holding(200,id=>id!=='b'),false,'b went offline');
  assert.deepEqual(w.pending,[]);
  w.arm([],0);
  assert.equal(w.holding(1,()=>true),false);
  w.arm(['a'],0);
  assert.equal(w.holding(LOAD_WAIT_MS,()=>true),false,'the cap');
});

test('Dançar: the room relays {t:"dancou"} to the team at once, one per DANCE_RELAY_MS per player',async()=>{
  let {room,a,b,t}=await pair();
  const round=room.run.snapshot().round,ana=a.messages.find(m=>m.t==='welcome').id;
  const dances=()=>b.messages.filter(m=>m.t==='dancou');
  say(room,a,{t:'dancar',round},t);
  assert.deepEqual(dances(),[{t:'dancou',player:ana}]);
  say(room,a,{t:'dancar',round},t+100);
  say(room,a,{t:'dancar',round:round+1},t+DANCE_RELAY_MS);
  assert.equal(dances().length,1,'a burst is one; a stale round drops');
  say(room,a,{t:'dancar',round},t+DANCE_RELAY_MS);
  assert.equal(dances().length,2);
});
