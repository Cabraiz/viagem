// Card NEW-20261023-ORQ-boss-fim-onda-1: the chefão's arrival scene (multiplayer/boss-scene.ts). On the tick he appears
// the room stops stepping the sim for CENA.totalMs, like the level-up pause: nothing moves, nobody takes damage,
// RunState.cena tells every phone who and where, the commands are refused ('pausa'), and it plays once per arrival.
// The arrival is faked on the room's systems (the sim's own is tests/sim/chefao-onda.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {BossScene} from '../../multiplayer/boss-scene.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {CENA} from '../../src/rules/index.ts';

function peer(){
  const messages:any[]=[];
  return {messages,gone:false,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const peers=new WeakMap<Room,TestPeer[]>();
const join=(room:Room,p:TestPeer,name:string,now:number)=>{if(!peers.has(room))peers.set(room,[]);peers.get(room)!.push(p);room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const lastRun=(p:TestPeer)=>p.messages.findLast(m=>m.t==='run')?.run;
function step(room:Room,now:number){for(const p of peers.get(room)??[])if(!p.gone)say(room,p,{t:'ping',at:now},now);room.advance(now);}
function combat(room:Room,ps:TestPeer[],from=1100){
  let t=from;for(const p of ps)say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat'||room.sim.world.round.phase!=='wave';t+=50)step(room,t);
  return t;
}
/** Two people in combat; the chefão "appears" on the next step's tick (enemy 'chefao-1' at 10, 12). */
function arriving(){
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  const t=combat(room,[a,b]);
  const at=room.sim.tick+1;
  (room.sim.run as {chefao?:unknown}).chefao={who:{id:'mapinguari-do-shopping'},arrival:(tick:number)=>tick===at?{enemy:'chefao-1',who:'mapinguari-do-shopping',x:10,y:12}:undefined,up:()=>true};
  return {room,a,b,t,at};
}

test('the scene holds the sim for CENA.totalMs: the tick and the critters stand still, RunState.cena says who and where',()=>{
  let {room,a,t,at}=arriving();
  step(room,t+=50);
  assert.equal(room.sim.tick,at,'the arrival step ran');
  assert.equal(room.cena.playing,true);
  const enemies=JSON.stringify([...room.sim.world.enemies.values()].map(e=>[e.x,e.y,e.hp]));
  const hp=JSON.stringify([...room.sim.players.values()].map(p=>p.hp));
  const cena=lastRun(a).cena;
  assert.deepEqual({...cena,leftMs:undefined},{who:'mapinguari-do-shopping',enemy:'chefao-1',x:10,y:12,leftMs:undefined,totalMs:CENA.totalMs,tick:at});
  for(let i=0;i<CENA.totalMs/50-2;i++)step(room,t+=50);
  assert.equal(room.sim.tick,at,'the tick has not moved');
  assert.equal(JSON.stringify([...room.sim.world.enemies.values()].map(e=>[e.x,e.y,e.hp])),enemies,'nothing moved');
  assert.equal(JSON.stringify([...room.sim.players.values()].map(p=>p.hp)),hp,'nobody took damage');
  assert.ok(lastRun(a).cena.leftMs<=1000,`left ${lastRun(a).cena.leftMs}`);
  for(let i=0;i<4;i++)step(room,t+=50);
  assert.equal(room.cena.playing,false);
  assert.equal(lastRun(a).cena,undefined,'the run message drops the scene');
  const tick=room.sim.tick;step(room,t+=50);assert.equal(room.sim.tick,tick+1,'the sim steps again');
});

test('during the scene the commands are refused (the rope: pausa); it plays once per arrival',()=>{
  let {room,a,t}=arriving();
  step(room,t+=50);
  say(room,a,{t:'puxar',round:room.run.snapshot().round,req:1,on:true},t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='puxou'),{t:'puxou',req:1,ok:false,reason:'pausa'});
  for(let i=0;i<CENA.totalMs/50+4;i++)step(room,t+=50);
  assert.equal(room.cena.playing,false);
  // The same arrival seen again (a fake answering on every tick) opens nothing.
  (room.sim.run as {chefao?:unknown}).chefao={who:{id:'mapinguari-do-shopping'},arrival:()=>({enemy:'chefao-1',who:'mapinguari-do-shopping',x:10,y:12}),up:()=>true};
  for(let i=0;i<5;i++){step(room,t+=50);assert.equal(room.cena.playing,false);}
});

test('BossScene alone: opens on the arrival tick, holds until totalMs, a new run forgets what it played',()=>{
  const s=new BossScene();let tick=4;
  const sim={get tick(){return tick;},run:{chefao:{arrival:(k:number)=>k===5?{enemy:'b',who:'o-grande-credor',x:1,y:2}:undefined}}};
  s.noteStep(sim,0);assert.equal(s.playing,false);
  tick=5;s.noteStep(sim,100);assert.equal(s.playing,true);
  assert.equal(s.update(100+CENA.totalMs-1),true);assert.equal(s.view(100)?.leftMs,CENA.totalMs);
  assert.equal(s.update(100+CENA.totalMs),false);assert.equal(s.view(0),undefined);
  s.noteStep(sim,5000);assert.equal(s.playing,false,'played');
  s.reset();s.noteStep(sim,6000);assert.equal(s.playing,true,'a new run plays it again');
  assert.equal(CENA.goMs+CENA.holdMs+CENA.backMs,CENA.totalMs);
});

test('lab {chefao:true} (dev rooms only) asks the sim for the chefão on its next step',()=>{
  for(const lab of [true,false]){
    const room=new Room(1000,undefined,lab?{lab:true}:{}),a=peer();join(room,a,'Ana',1000);
    const t=combat(room,[a]);let asked=0;
    (room.sim.run as {chefao?:unknown}).chefao={who:{id:'mapinguari-do-shopping'},arrival:()=>undefined,up:()=>false,summon:()=>{asked++;return true;}};
    say(room,a,{t:'lab',chefao:true},t);
    assert.equal(asked,lab?1:0,lab?'a lab room calls him':'never outside a lab room');
  }
});

test('the run chefão rides the {t:elenco} list, so every phone loads his art before he arrives',()=>{
  const {room}=arriving();
  assert.ok(room.sim.rotationIds().includes('mapinguari-do-shopping'));
  assert.equal(room.sim.rotationIds().filter(id=>id==='mapinguari-do-shopping').length,1);
});
