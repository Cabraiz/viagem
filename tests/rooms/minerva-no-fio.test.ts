// Card NEW-20261022-ORQ-monstros-espalhados (the user, 22/10): the "minuto de Minerva" on the wire. A ninhos city room's
// {t:'run'} carries RunState.minervaAteTick (the sim tick its first minute ends at) from the start of combat until that
// tick, then drops it; the HUD's clock (E8, relogio-minerva) reads it against the frame tick. A rounds room never sends it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {MINERVA_S} from '../../src/sim/ninhos/ninhos.ts';
import {ticks} from '../../src/contract/index.ts';

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

async function solo(options:object){
  const t0=1000,room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,...options}),a=peer();
  await room.ready();
  let t=t0;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=OWNER_GAP_MS);
  for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  // exploracao-espera-carregar: the phone drew the run at once (else the room holds the minute for it, load-wait.ts).
  say(room,a,{t:'carregou',round:room.run.snapshot().round},t);
  room.advance(t+=50);
  return {room,a,t};
}
const runs=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='run');

test('ninhos room: {t:\'run\'} carries minervaAteTick through the first minute of combat (one push), then drops it',async()=>{
  let {room,a,t}=await solo({mode:'ninhos',combat:'manual'});
  // The Fear (card fear-escuridao-sozinho) would take this hero, alone for the whole minute: keep the dark away.
  const calm=()=>{for(const p of room.sim.players.values())delete p.fear;};
  const tick=()=>{calm();say(room,a,{t:'ping',at:t},t);room.advance(t+=50);};
  const until=room.sim.run.nests!.state.minervaUntil!;
  assert.equal(until,room.sim.run.nests!.state.startTick!+ticks(MINERVA_S));
  const last=runs(a).at(-1)!;
  assert.equal(last.run.phase,'combat');
  assert.equal(last.run.minervaAteTick,until);
  assert.ok(last.tick<until);
  const before=runs(a).length;
  for(let i=0;i<20;i++)tick();
  assert.equal(runs(a).length,before,'no push per tick for it');
  while(room.sim.tick<=until+1)tick();
  const after=runs(a).at(-1)!;
  assert.equal(after.run.minervaAteTick,undefined,'gone after the minute');
  assert.ok(after.tick>=until);
});

test('a rounds room never sends minervaAteTick',async()=>{
  const {a}=await solo({});
  assert.ok(runs(a).every(m=>m.run.minervaAteTick===undefined));
});
