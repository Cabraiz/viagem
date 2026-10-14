/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, part 1) through a REAL city Room: the frames the phone decodes
 * (FrameDecoder) carry RunView.banks in BOTH city modes (the default chaveiro and objective:false, the wall): the
 * static fields (id, place, name) on the full frame, the saldo/state changes afterwards, the bank-* events, and
 * EnemyView.prime (the Cliente Prime's crown).
 * D-031: sim ticks and decoded frames only; nothing about wall-clock time is asserted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {BANK_IDS,ticks,type BankView,type EnemyView,type RunView} from '../../src/contract/index.ts';
import {BANCO} from '../../src/rules/bancos.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const STEP_MS=50;

/** Frame header (protocol4.ts): u8 magic, u8 version, uvar seq, uvar baseSeq (0 = a full frame). */
function isFull(f:Uint8Array){
  let i=2;const uvar=()=>{let v=0,shift=0,b:number;do{b=f[i++];v+=(b&127)*2**shift;shift+=7;}while(b&128);return v;};
  uvar();return uvar()===0;
}
interface Seen {full:boolean;view:RunView}
/**
 * A solo city room in combat (Ana alone, no bots), with `options` (objective:false for the wall). Ana's phone decodes
 * every frame as it arrives and acks it (the room stops sending to a phone that never acks); `seen` is what the phone
 * held after each frame.
 */
async function cityRoom(options:object){
  let t=1000;
  const room=new Room(t,7,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',solo:true,...options}),a=peer();
  const decoder=new FrameDecoder(),seen:Seen[]=[];
  let read=0;
  const phone=()=>{
    for(;read<a.frames.length;read++){
      const f=a.frames[read],r=decoder.decode(f);
      assert.ok(r.ok,`frame decodes: ${r.ok?'':JSON.stringify(r)}`);
      if(!r.ok)continue;
      seen.push({full:isFull(f),view:structuredClone(r.view)});
      say(room,a,r.ack,t);
    }
  };
  const tick=()=>{room.advance(t+=STEP_MS);phone();};
  await room.ready();
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  const ana=a.messages.find(m=>m.t==='welcome')?.id as string;
  assert.ok(ana,'Ana sits');
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t+=STEP_MS);
  for(let i=0;i<2000&&room.run.snapshot().phase!=='combat';i++)tick();
  assert.equal(room.run.snapshot().phase,'combat');
  return {room,a,ana,seen,advance:(n:number)=>{for(let i=0;i<n;i++)tick();}};
}

for(const [mode,options] of [['chaveiro (default)',{}],['muralha (objective:false)',{objective:false}]] as const){
  test(`bancos through a city room, ${mode}: the frames carry the banks (static on the full frame, saldo/state after), the events and the Prime crown`,async()=>{
    const r=await cityRoom(options);
    const sim=r.room.sim;
    assert.equal(sim.objective,'objective' in options?undefined:'chaveiro');
    assert.ok(sim.run.banks,'the city room has banks');
    const places=sim.run.banks.places;
    assert.equal(places.length,BANCO.count);
    r.advance(10);
    const seen=r.seen;
    assert.ok(seen.length>0,'frames');
    // The lobby already shows the city's banks on its first (full) frame; the run that starts with the combat draws its
    // own (Simulation.resetRun: a new run seed), and the phone must hold THOSE: id, place and name, R$ 40, 'aberto'.
    const firstFrame=seen.find(s=>s.view.banks);
    assert.ok(firstFrame,'the banks reach the phone');
    assert.equal(seen[0].full,true);assert.ok(seen[0].view.banks,'the first full frame carries them');
    const held=seen.at(-1)!.view.banks as BankView[];
    assert.deepEqual(held.map(b=>[b.id,b.name]),places.map(p=>[p.id,p.name]));
    assert.deepEqual([...held.map(b=>b.name)].sort(),[...BANK_IDS].sort());
    for(const [i,b] of held.entries()){
      assert.ok(Math.abs(b.x-places[i].x)<.1&&Math.abs(b.y-places[i].y)<.1,`${b.id} where this run's sim put it: ${b.x},${b.y} vs ${places[i].x},${places[i].y}`);
      assert.equal(b.saldo,BANCO.saldo);assert.equal(b.state,'aberto');
    }
    for(const s of seen.slice(seen.indexOf(firstFrame)))assert.equal(s.view.banks?.length,3,'every later frame still holds them');
    // Ana stands at bank 1: after 3 s the phone sees 'sacando', R$ 38 and a bank-cash by 'hero'.
    const b0=places[0],ana=sim.players.get(r.ana)!;
    const hold=()=>{ana.x=b0.x+1;ana.y=b0.y;ana.hp=ana.stats.maxHp;ana.downed=false;};
    // Clear the critters near the ATM so nobody queues (the wave goes on elsewhere).
    const clear=()=>{for(const e of sim.world.enemies.values())if(Math.hypot(e.x-b0.x,e.y-b0.y)<BANCO.filaR+2&&!e.boss)sim.world.enemies.delete(e.id);};
    const from=seen.length;
    for(let i=0;i<ticks(BANCO.saqueS)*2+4;i++){hold();clear();r.advance(1);}
    const after=seen.slice(from);
    assert.ok(after.length>=ticks(BANCO.saqueS),`the phone kept getting frames: ${after.length}`);
    const last=after.at(-1)!.view.banks!.find(b=>b.id===b0.id)!;
    assert.equal(last.state,'sacando');
    assert.ok(last.saldo<=BANCO.saldo-2*BANCO.nota,`two notes out: R$ ${last.saldo}`);
    const cashEvents=after.flatMap(s=>s.view.events).filter(e=>e.type==='bank-cash');
    assert.ok(cashEvents.some(e=>e.type==='bank-cash'&&e.bank===b0.id&&e.by==='hero'&&e.amount===BANCO.nota),'the bank-cash event reaches the phone');
    // The other banks are as the sim has them.
    for(const b of after.at(-1)!.view.banks!){const i=places.findIndex(p=>p.id===b.id),row=sim.run.banks.state.list[i];assert.deepEqual([b.saldo,b.state],[row.saldo,row.state],b.id);}
    assert.ok(after.some(s=>!s.full),'delta frames carry the change');
    // A critter made Cliente Prime wears the crown on the phone.
    ana.x=b0.x+30;
    let prime:string|undefined;
    for(let i=0;i<ticks(30)&&!prime;i++){
      r.advance(1);
      const e=[...sim.world.enemies.values()].filter(x=>x.hp>0&&!x.boss).sort((p,q)=>Math.hypot(p.x-ana.x,p.y-ana.y)-Math.hypot(q.x-ana.x,q.y-ana.y))[0];
      // Crowned (as bancos/system.ts does at R$ 10) and brought next to Ana, inside her area of interest.
      if(e){(e as {prime?:true}).prime=true;e.x=ana.x+3;e.y=ana.y;prime=e.id;}
    }
    assert.ok(prime,'a critter to crown');
    r.advance(4);
    const crowned=seen.at(-1)!.view.enemies as EnemyView[];
    // The phone names the critters by their wire label ('e-12' → 'e12').
    const wire=(id:string)=>id.replace(/[^a-z0-9]/gi,'');
    assert.equal(crowned.find(e=>wire(e.id)===wire(prime!))?.prime,true,'EnemyView.prime reaches the phone');
    assert.ok(crowned.filter(e=>wire(e.id)!==wire(prime!)).every(e=>!e.prime),'only the crowned one');
  });
}
